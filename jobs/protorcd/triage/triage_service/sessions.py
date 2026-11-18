"""Triage sessions: ProtoRCD's ManagedSession plus a durable label journal.

The triage loop is ``serving.session_manager.ManagedSession`` (ProtoRCD, unchanged): a
worker thread runs ``TriageSession.for_protocol("split_no_veto", ...)`` and parks
whenever it needs labels. This module adds what a long-lived NRP deployment needs:

* **Journal.** Every accepted label submission is appended to
  ``<data_dir>/sessions/<id>.json``. The triage is deterministic for a given pool, seed
  and label sequence, so a session is restored after a pod restart by replaying the
  journal into a fresh ManagedSession -- no NumPy state is persisted.
* **Extending rounds.** ``max_rounds`` can be raised while the session runs, or after it
  stopped at its budget (by rebuilding it from the journal with the larger budget).
* **Validation.** A blind spot check of auto-decided proposals estimates how accurate the
  Resolve/Clear decisions are. Validation labels are recorded for the export but are NOT
  added to the support set, so the triage stays the paper's algorithm.

Every method that touches the ManagedSession is blocking; callers run them in a thread
while holding the session's ``lock``.
"""
from __future__ import annotations

import asyncio
import json
import math
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from starlette.concurrency import run_in_threadpool

from serving.session_manager import ManagedSession, PendingBatch, StaleBatchError

from .config import Settings
from .datasets import DatasetStore, LoadedDataset
from .schemas import (
    BatchMessage,
    CalibratedMessage,
    DecisionAgreement,
    FinishedMessage,
    Proposal,
    RoundResultMessage,
    RoundSummary,
    SessionCreateRequest,
    StateMessage,
    ValidationBatchMessage,
    ValidationResultMessage,
    ValidationSummary,
)

PROTOCOL = "split_no_veto"
JOURNAL_VERSION = 1

__all__ = ["NotAllowed", "InvalidLabels", "RestoreError", "StaleBatchError", "LiveSession", "SessionService"]


class NotAllowed(RuntimeError):
    """The request is valid but not possible in the session's current state."""


class InvalidLabels(ValueError):
    """Labels missing, extra, or outside the dataset's taxonomy."""


class RestoreError(RuntimeError):
    """Replaying the journal did not reproduce the recorded batches."""


def wilson_interval(agreed: int, n: int, z: float = 1.96) -> Optional[List[float]]:
    if n == 0:
        return None
    p = agreed / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return [round(max(0.0, center - half), 4), round(min(1.0, center + half), 4)]


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def start_managed(session_id: str, dataset: LoadedDataset, config: dict) -> ManagedSession:
    """Start a ManagedSession and wait until its first batch is pending."""
    managed = ManagedSession(
        session_id,
        dataset.pool,
        protocol=PROTOCOL,
        seed=int(config["seed"]),
        batch_size=int(config["batch_size"]),
        calibration_size=int(config["calibration_size"]),
        image_root=None,
        precomputed_density=None,
        max_rounds=int(config["max_rounds"]),
    )
    managed.wait_for_batch(timeout=None)
    return managed


def replay(managed: ManagedSession, submissions: List[dict]) -> None:
    """Feed recorded submissions back in order, checking each batch matches the record."""
    for sub in submissions:
        batch = managed.wait_for_batch(timeout=None)
        if batch is None or batch.batch_id != sub["batch_id"] or \
                [int(p) for p in batch.proposal_ids] != sub["proposal_ids"]:
            raise RestoreError(
                f"replay diverged at {sub['batch_id']!r} "
                f"(got {None if batch is None else batch.batch_id!r})"
            )
        labels = {int(k): int(v) for k, v in sub["labels"].items()}
        managed.submit_labels(labels, batch_id=batch.batch_id, timeout=None)
    managed.wait_for_batch(timeout=None)


class LiveSession:
    """One session: its ManagedSession, dataset, and journal."""

    def __init__(self, service: "SessionService", journal: dict, dataset: LoadedDataset,
                 managed: ManagedSession) -> None:
        self.service = service
        self.journal = journal
        self.dataset = dataset
        self.managed = managed
        self.restoring = False
        self.lock = asyncio.Lock()

    @property
    def session_id(self) -> str:
        return self.journal["session_id"]

    @property
    def taxonomy(self) -> Optional[Dict[str, str]]:
        return self.dataset.info.get("labels")

    def save(self) -> None:
        self.service.write_journal(self.journal)

    # ---- payloads ------------------------------------------------------------ #
    def proposals(self, ids) -> List[Proposal]:
        pool = self.dataset.pool
        dataset_id = self.journal["dataset_id"]
        has_images = bool(self.dataset.info.get("_image_root"))
        out = []
        for pid in ids:
            meta = pool.metadata[pool.id_to_index[int(pid)]]
            out.append(Proposal(
                proposal_id=int(pid),
                image_id=meta["image_id"],
                file_name=meta["file_name"],
                bbox_xywh=meta["bbox_xywh"],
                score=meta["score"],
                crop_url=f"/datasets/{dataset_id}/crops/{int(pid)}" if has_images else None,
            ))
        return out

    def _pending(self) -> Optional[PendingBatch]:
        try:
            return self.managed.wait_for_batch(timeout=0)
        except TimeoutError:
            return None

    def _round_of(self, pending: PendingBatch) -> int:
        # ManagedSession labels a review batch session.round + 1, but step() has already
        # incremented session.round when it asks for labels, so that is one too high.
        # The parked TriageSession's own round matches RoundInfo.round in round_result.
        return 0 if pending.phase == "calibration" else int(self.managed.session.round)

    def _batch(self, pending: PendingBatch) -> dict:
        return BatchMessage(batch_id=pending.batch_id, phase=pending.phase, round=self._round_of(pending),
                            proposals=self.proposals(pending.proposal_ids)).model_dump()

    def batch_message(self) -> Optional[dict]:
        pending = self._pending()
        return None if pending is None else self._batch(pending)

    def pending_validation_message(self) -> Optional[dict]:
        pending = self.journal.get("pending_validation")
        if not pending:
            return None
        return ValidationBatchMessage(validation_id=pending["validation_id"],
                                      proposals=self.proposals(pending["proposal_ids"])).model_dump()

    def finish_reason(self) -> Optional[str]:
        if self.managed.failed:
            return "failed"
        if self.managed.finished:
            return "pool_exhausted" if self.managed.session.finished else "max_rounds"
        return None

    def validation_summary(self) -> ValidationSummary:
        checked = agreed = 0
        for record in self.journal["validations"]:
            for pid, label in record["labels"].items():
                checked += 1
                agreed += int(label == record["predictions"][pid])
        pending = self.journal.get("pending_validation")
        return ValidationSummary(
            checked=checked, agreed=agreed,
            accuracy=round(agreed / checked, 4) if checked else None,
            ci95=wilson_interval(agreed, checked),
            pending_validation_id=pending["validation_id"] if pending else None,
        )

    def state(self) -> dict:
        base = self.managed.state()
        status = "restoring" if self.restoring else base["status"]
        if base["pending_batch"] is not None:
            pending = self._pending()
            if pending is not None and pending.batch_id == base["pending_batch"]["batch_id"]:
                base["pending_batch"]["round"] = self._round_of(pending)
        return {
            "session_id": self.session_id,
            "dataset_id": self.journal["dataset_id"],
            "created": self.journal["created"],
            "status": status,
            "error": base["error"],
            "calibrated": base["calibrated"],
            "rule": base["rule"],
            "round": base["round"],
            "rounds_completed": len(self.journal["rounds"]),
            "max_rounds": self.journal["config"]["max_rounds"],
            "cumulative_reviews": base["cumulative_reviews"],
            "remaining": base["remaining"],
            "auto_decided": len(self.managed.session.auto_indices_kept),
            "finish_reason": self.finish_reason(),
            "can_extend": not self.managed.failed and not self.managed.session.finished,
            "pending_batch": base["pending_batch"],
            "validation": self.validation_summary().model_dump(),
            "labels": self.taxonomy,
            "config": self.journal["config"],
            "websocket_path": f"/ws/sessions/{self.session_id}",
        }

    def state_message(self, **override) -> dict:
        state = self.state()
        state.update(override)
        return StateMessage(state=state).model_dump()

    def _after_phase(self) -> List[dict]:
        """Events once the worker has parked again: the next batch, or finished."""
        events = []
        nxt = self.managed.wait_for_batch(timeout=None)     # raises SessionError on failure
        if nxt is not None:
            events.append(self._batch(nxt))
        else:
            events.append(FinishedMessage(reason=self.finish_reason(),
                                          counts=self.decision_counts()).model_dump())
        events.append(self.state_message())
        return events

    # ---- label checks -------------------------------------------------------- #
    def _check_labels(self, labels: Dict[int, int], expected: List[int]) -> Dict[int, int]:
        missing = [p for p in expected if p not in labels]
        extra = [p for p in labels if p not in set(expected)]
        if missing or extra:
            raise InvalidLabels(f"labels must cover exactly the batch: missing {missing[:8]}, "
                                f"not in batch {extra[:8]}")
        taxonomy = self.taxonomy
        if taxonomy:
            unknown = sorted({v for v in labels.values() if v > 0 and str(v) not in taxonomy})
            if unknown:
                raise InvalidLabels(f"class ids not in the dataset taxonomy: {unknown[:8]}")
        return {p: int(labels[p]) for p in expected}

    # ---- the loop ------------------------------------------------------------ #
    def check_submission(self, batch_id: str, labels: Dict[int, int]) -> tuple[PendingBatch, Dict[int, int]]:
        """Fast, non-blocking validation of a label submission."""
        pending = self._pending()
        if pending is None:
            raise NotAllowed("no batch is awaiting labels")
        if batch_id != pending.batch_id:
            raise StaleBatchError(f"stale batch_id {batch_id!r}; current is {pending.batch_id!r}")
        return pending, self._check_labels(labels, [int(p) for p in pending.proposal_ids])

    def submit_labels(self, pending: PendingBatch, clean: Dict[int, int]) -> List[dict]:
        """Hand checked labels to the worker, journal them, and wait for the next batch."""
        batch_id = pending.batch_id
        expected = list(clean)
        info = self.managed.submit_labels(clean, batch_id=batch_id, timeout=None)
        self.journal["submissions"].append({
            "batch_id": batch_id, "phase": pending.phase, "round": pending.round,
            "proposal_ids": expected, "labels": {str(k): v for k, v in clean.items()},
        })
        events = []
        if info is None:   # calibration phase
            report = self.managed.session.calibration_report or {}
            events.append(CalibratedMessage(rule=report.get("rule", {}),
                                            bank_size=int(report.get("bank_size", len(expected)))).model_dump())
        else:
            counts = info.triage.counts() if info.triage is not None else {}
            summary = RoundSummary(round=info.round, acquired=len(info.acquired_ids), retired=info.retired,
                                   counts=counts, remaining=info.remaining,
                                   cumulative_reviews=info.cumulative_reviews)
            self.journal["rounds"].append(summary.model_dump())
            events.append(RoundResultMessage(result=summary).model_dump())
        self.save()
        return events + self._after_phase()

    def extend_rounds(self, additional: int) -> List[dict]:
        if self.managed.failed:
            raise NotAllowed("session failed")
        if self.managed.session.finished:
            raise NotAllowed("every proposal is already reviewed or auto-decided")
        new_max = int(self.journal["config"]["max_rounds"]) + int(additional)
        if not self.managed.finished:
            # Worker still running: it re-reads max_rounds before every round.
            self.managed.max_rounds = new_max
            self.journal["config"]["max_rounds"] = new_max
            self.save()
            return [self.state_message()]

        # Stopped at its budget: the worker has exited, so rebuild from the journal.
        config = dict(self.journal["config"], max_rounds=new_max)
        self.restoring = True
        try:
            managed = start_managed(self.session_id, self.dataset, config)
            replay(managed, self.journal["submissions"])
        finally:
            self.restoring = False
        old, self.managed = self.managed, managed
        old.close()
        self.journal["config"] = config
        self.save()
        return self._after_phase()

    # ---- decisions ----------------------------------------------------------- #
    def auto_predictions(self) -> Dict[int, int]:
        s = self.managed.session
        pool_rows = s.kept_source[s.auto_indices_kept]
        ids = self.dataset.pool.proposal_ids
        return {int(ids[r]): int(p) for r, p in zip(pool_rows.tolist(), s.auto_predictions.tolist())}

    def human_labels(self) -> Dict[int, tuple]:
        out = {}
        for sub in self.journal["submissions"]:
            status = "calibration" if sub["phase"] == "calibration" else "reviewed"
            for k, v in sub["labels"].items():
                out[int(k)] = (int(v), status)
        return out

    def validation_labels(self) -> Dict[int, int]:
        out = {}
        for record in self.journal["validations"]:
            out.update({int(k): int(v) for k, v in record["labels"].items()})
        return out

    def decisions(self) -> List[dict]:
        human = self.human_labels()
        auto = self.auto_predictions()
        checked = self.validation_labels()
        in_pool = self.dataset.pool.id_to_index
        rows = []
        for aid in self.dataset.annotation_ids:
            if aid not in in_pool:
                rows.append({"proposal_id": aid, "status": "not_embedded", "label": None, "validated": None})
            elif aid in human:
                label, status = human[aid]
                rows.append({"proposal_id": aid, "status": status, "label": label, "validated": None})
            elif aid in auto:
                pred = auto[aid]
                rows.append({
                    "proposal_id": aid,
                    "status": "auto_resolve" if pred > 0 else "auto_clear",
                    "label": checked.get(aid, pred),
                    "validated": (checked[aid] == pred) if aid in checked else None,
                })
            else:
                rows.append({"proposal_id": aid, "status": "deferred", "label": None, "validated": None})
        return rows

    def decision_counts(self, rows: Optional[List[dict]] = None) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for row in rows if rows is not None else self.decisions():
            counts[row["status"]] = counts.get(row["status"], 0) + 1
        return counts

    # ---- validation ---------------------------------------------------------- #
    def request_validation(self, sample_size: int) -> List[dict]:
        if self.managed.failed:
            raise NotAllowed("session failed")
        auto = self.auto_predictions()
        done = set(self.validation_labels())
        candidates = sorted(pid for pid in auto if pid not in done)
        if not candidates:
            raise NotAllowed("no auto-decided proposals left to validate")
        seq = int(self.journal.get("validation_seq", 0)) + 1
        rng = np.random.default_rng([int(self.journal["config"]["seed"]), seq])
        pick = rng.choice(len(candidates), size=min(sample_size, len(candidates)), replace=False)
        pending = {"validation_id": f"{self.session_id}:validation:{seq}",
                   "proposal_ids": [candidates[i] for i in pick.tolist()]}
        self.journal["validation_seq"] = seq
        self.journal["pending_validation"] = pending
        self.save()
        return [self.pending_validation_message(), self.state_message()]

    def submit_validation(self, validation_id: str, labels: Dict[int, int]) -> List[dict]:
        pending = self.journal.get("pending_validation")
        if not pending or pending["validation_id"] != validation_id:
            raise StaleBatchError(f"no pending validation {validation_id!r}")
        clean = self._check_labels(labels, pending["proposal_ids"])
        auto = self.auto_predictions()
        by = {"resolve": [0, 0], "clear": [0, 0]}
        for pid, label in clean.items():
            kind = "resolve" if auto[pid] > 0 else "clear"
            by[kind][0] += 1
            by[kind][1] += int(label == auto[pid])
        self.journal["validations"].append({
            "validation_id": validation_id,
            "proposal_ids": pending["proposal_ids"],
            "labels": {str(k): v for k, v in clean.items()},
            "predictions": {str(k): auto[k] for k in clean},
            "created": _now(),
        })
        self.journal["pending_validation"] = None
        self.save()
        checked = sum(v[0] for v in by.values())
        agreed = sum(v[1] for v in by.values())
        result = ValidationResultMessage(
            validation_id=validation_id, checked=checked, agreed=agreed,
            accuracy=round(agreed / checked, 4) if checked else None,
            ci95=wilson_interval(agreed, checked),
            by_decision={k: DecisionAgreement(checked=v[0], agreed=v[1]) for k, v in by.items()},
            cumulative=self.validation_summary(),
        )
        return [result.model_dump(), self.state_message()]

    # ---- export -------------------------------------------------------------- #
    def export_coco(self, include_background: bool = False) -> dict:
        """COCO file of final labels: human > validation correction > auto decision.

        Foreground proposals become annotations with their class as ``category_id``.
        Background (label 0) is included only with ``include_background`` (category 0).
        Deferred and not-embedded proposals are left out; counts are in ``info``.
        """
        coco = self.dataset.coco
        anns = {int(a["id"]): a for a in coco["annotations"]}
        rows = self.decisions()
        taxonomy = self.taxonomy or {}
        out_anns = []
        used = set()
        for row in rows:
            label = row["label"]
            if label is None or (label == 0 and not include_background):
                continue
            ann = dict(anns[row["proposal_id"]])
            ann["category_id"] = label
            ann["triage"] = {"source": row["status"], "validated": row["validated"]}
            out_anns.append(ann)
            used.add(label)
        ids = sorted(used | {int(k) for k in taxonomy})
        categories = [{"id": i, "name": taxonomy.get(str(i), "background" if i == 0 else f"class_{i}")}
                      for i in ids]
        return {
            "info": {
                "description": "ProtoRCD triage export",
                "date_created": _now(),
                "session_id": self.session_id,
                "dataset_id": self.journal["dataset_id"],
                "source_coco_sha256": self.dataset.info.get("coco_sha256"),
                "protocol": PROTOCOL,
                "config": self.journal["config"],
                "rule": self.managed.session.rule.as_dict() if self.managed.session.rule else None,
                "counts": self.decision_counts(rows),
                "validation": self.validation_summary().model_dump(),
            },
            "images": coco["images"],
            "annotations": out_anns,
            "categories": categories,
        }


class SessionService:
    def __init__(self, settings: Settings, datasets: DatasetStore) -> None:
        self.settings = settings
        self.datasets = datasets
        self._sessions: Dict[str, LiveSession] = {}
        self._restore_locks: Dict[str, asyncio.Lock] = {}

    # ---- journal files ------------------------------------------------------- #
    def _journal_path(self, session_id: str) -> Path:
        if not session_id.isalnum():
            raise KeyError(session_id)
        return self.settings.sessions_dir / f"{session_id}.json"

    def write_journal(self, journal: dict) -> None:
        path = self._journal_path(journal["session_id"])
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(journal))
        tmp.replace(path)

    def read_journal(self, session_id: str) -> dict:
        path = self._journal_path(session_id)
        if not path.exists():
            raise KeyError(session_id)
        return json.loads(path.read_text())

    def journals(self) -> List[dict]:
        out = []
        for path in self.settings.sessions_dir.glob("*.json"):
            try:
                out.append(json.loads(path.read_text()))
            except (OSError, ValueError):
                continue
        return sorted(out, key=lambda j: j["created"])

    def sessions_for_dataset(self, dataset_id: str) -> List[str]:
        return [j["session_id"] for j in self.journals() if j["dataset_id"] == dataset_id]

    # ---- lifecycle ----------------------------------------------------------- #
    def _create_blocking(self, req: SessionCreateRequest) -> LiveSession:
        dataset = self.datasets.load(req.dataset_id)
        session_id = uuid.uuid4().hex
        journal = {
            "version": JOURNAL_VERSION,
            "session_id": session_id,
            "dataset_id": req.dataset_id,
            "created": _now(),
            "config": req.model_dump(),
            "submissions": [],
            "rounds": [],
            "validations": [],
            "pending_validation": None,
            "validation_seq": 0,
        }
        managed = start_managed(session_id, dataset, journal["config"])
        live = LiveSession(self, journal, dataset, managed)
        live.save()
        return live

    async def create(self, req: SessionCreateRequest) -> LiveSession:
        live = await run_in_threadpool(self._create_blocking, req)
        self._sessions[live.session_id] = live
        return live

    def _restore_blocking(self, journal: dict) -> LiveSession:
        dataset = self.datasets.load(journal["dataset_id"])
        managed = start_managed(journal["session_id"], dataset, journal["config"])
        try:
            replay(managed, journal["submissions"])
        except BaseException:
            managed.close()
            raise
        return LiveSession(self, journal, dataset, managed)

    async def get(self, session_id: str) -> LiveSession:
        live = self._sessions.get(session_id)
        if live is not None:
            return live
        lock = self._restore_locks.setdefault(session_id, asyncio.Lock())
        async with lock:
            live = self._sessions.get(session_id)
            if live is None:
                journal = self.read_journal(session_id)
                live = await run_in_threadpool(self._restore_blocking, journal)
                self._sessions[session_id] = live
        return live

    def loaded(self, session_id: str) -> Optional[LiveSession]:
        return self._sessions.get(session_id)

    def delete(self, session_id: str) -> None:
        path = self._journal_path(session_id)
        live = self._sessions.pop(session_id, None)
        if live is None and not path.exists():
            raise KeyError(session_id)
        if live is not None:
            live.managed.close()
        path.unlink(missing_ok=True)

    def close_all(self) -> None:
        for live in self._sessions.values():
            live.managed.close()
        self._sessions.clear()
