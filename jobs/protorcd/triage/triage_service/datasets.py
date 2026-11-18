"""Datasets: a stage-1 COCO file + the two stage-2 .npz files, joined into a ProposalPool.

Implements the loading contract in ``jobs/protorcd/README.md``: the .npz files must name
the COCO file's sha256, rows are joined on annotation id (never row order), and only
proposals embedded by both models enter the pool.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Dict, Optional

import numpy as np

from protorcd_pipeline.triage import ProposalPool, l2_normalize

from .config import Settings
from .storage import Storage, StorageError, safe_relative

EMBEDDING_SCHEMA_PREFIX = "protorcd.embeddings/"
META_FIELDS = (
    "model", "region", "embedding_dim", "dtype", "num_embedded", "num_skipped", "source_commit",
    "dinov3_model_size", "dinov3_image_size", "dinov3_weights", "bioclip_model", "pybioclip_version",
)


class DatasetError(ValueError):
    """The submitted files do not form a valid dataset."""


@dataclass
class LoadedDataset:
    info: dict
    pool: ProposalPool
    coco: dict
    annotation_ids: list[int]          # every COCO annotation id, pool or not


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _load_npz(path: Path, expected_model: str, coco_sha: str) -> tuple[np.ndarray, np.ndarray, dict]:
    try:
        with np.load(path, allow_pickle=False) as z:
            meta = json.loads(str(z["meta"]))
            embeddings = z["embeddings"].astype(np.float32)
            ids = z["annotation_ids"].astype(np.int64)
    except (OSError, KeyError, ValueError) as exc:
        raise DatasetError(f"{expected_model}: not a stage-2 embeddings file ({type(exc).__name__})") from exc
    if not str(meta.get("schema", "")).startswith(EMBEDDING_SCHEMA_PREFIX):
        raise DatasetError(f"{expected_model}: unexpected schema {meta.get('schema')!r}")
    if not str(meta.get("model", "")).startswith(expected_model):
        raise DatasetError(f"expected a {expected_model} file, got model {meta.get('model')!r}")
    if meta.get("coco_sha256") != coco_sha:
        raise DatasetError(
            f"{expected_model} embeddings were built from a different COCO file "
            f"({meta.get('coco_file')!r}); re-run stage 2 on this proposals file"
        )
    if embeddings.ndim != 2 or embeddings.shape[0] != ids.shape[0]:
        raise DatasetError(f"{expected_model}: embeddings/annotation_ids shapes disagree")
    if np.unique(ids).size != ids.size:
        raise DatasetError(f"{expected_model}: duplicate annotation ids")
    return embeddings, ids, meta


def load_files(coco_path: Path, dinov3_path: Path, bioclip_path: Path) -> tuple[LoadedDataset, dict]:
    """Validate the three files and build the pool. Returns (dataset, summary for info)."""
    coco_sha = sha256_file(coco_path)
    try:
        coco = json.loads(coco_path.read_text())
        images = {int(img["id"]): img for img in coco["images"]}
        annotations = {int(a["id"]): a for a in coco["annotations"]}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise DatasetError(f"not a COCO proposals file ({type(exc).__name__})") from exc
    for img in images.values():
        try:
            safe_relative(str(img["file_name"]))
        except StorageError as exc:
            raise DatasetError(str(exc)) from exc

    bg, bg_ids, bg_meta = _load_npz(dinov3_path, "dinov3", coco_sha)
    fg, fg_ids, fg_meta = _load_npz(bioclip_path, "bioclip", coco_sha)
    unknown = np.setdiff1d(np.union1d(bg_ids, fg_ids), np.fromiter(annotations, np.int64))
    if unknown.size:
        raise DatasetError(f"embeddings reference {unknown.size} ids missing from the COCO file")

    ids = np.intersect1d(bg_ids, fg_ids)                 # sorted, unique
    if ids.size == 0:
        raise DatasetError("no proposal is embedded by both models")
    bg_order = np.argsort(bg_ids)
    fg_order = np.argsort(fg_ids)
    bg_rows = bg_order[np.searchsorted(bg_ids[bg_order], ids)]
    fg_rows = fg_order[np.searchsorted(fg_ids[fg_order], ids)]

    metadata = []
    for aid in ids.tolist():
        ann = annotations[aid]
        img = images[int(ann["image_id"])]
        metadata.append({
            "proposal_id": aid,
            "image_id": int(ann["image_id"]),
            "file_name": str(img["file_name"]),
            "bbox_xywh": [float(v) for v in ann["bbox"]],
            "score": float(ann.get("score", 0.0)),
        })
    pool = ProposalPool(
        bg_x=l2_normalize(bg[bg_rows]),
        fg_x=l2_normalize(fg[fg_rows]),
        proposal_ids=ids.tolist(),
        metadata=metadata,
    )
    summary = {
        "num_images": len(images),
        "num_proposals": len(annotations),
        "num_pool": int(ids.size),
        "num_not_embedded": len(annotations) - int(ids.size),
        "dinov3": {k: bg_meta[k] for k in META_FIELDS if k in bg_meta},
        "bioclip": {k: fg_meta[k] for k in META_FIELDS if k in fg_meta},
        "coco_sha256": coco_sha,
    }
    return LoadedDataset(info={}, pool=pool, coco=coco, annotation_ids=sorted(annotations)), summary


def _check_labels(labels: Optional[Dict[int, str]]) -> Optional[Dict[str, str]]:
    if not labels:
        return None
    bad = [k for k in labels if int(k) <= 0]
    if bad:
        raise DatasetError(f"taxonomy ids must be positive (0 is background): {bad[:5]}")
    return {str(int(k)): str(v) for k, v in labels.items()}


class DatasetStore:
    def __init__(self, settings: Settings, storage: Storage) -> None:
        self.settings = settings
        self.storage = storage
        self._lock = threading.Lock()
        self._cache: OrderedDict[str, LoadedDataset] = OrderedDict()

    def _dir(self, dataset_id: str) -> Path:
        if not dataset_id.isalnum():
            raise KeyError(dataset_id)
        return self.settings.datasets_dir / dataset_id

    # ---- registration ------------------------------------------------------ #
    def _register(self, dataset_id: str, name: str, files: Dict[str, Path],
                  image_root: Optional[str], labels: Optional[Dict[int, str]]) -> dict:
        taxonomy = _check_labels(labels)
        root = self.storage.check_image_root(image_root) if image_root else None
        loaded, summary = load_files(files["coco"], files["dinov3"], files["bioclip"])
        info = {
            "dataset_id": dataset_id,
            "name": name,
            "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            **summary,
            "has_images": root is not None,
            "labels": taxonomy,
            "_files": {k: str(v) for k, v in files.items()},
            "_image_root": root,
        }
        loaded.info = info
        (self._dir(dataset_id) / "dataset.json").write_text(json.dumps(info, indent=2))
        self._remember(dataset_id, loaded)
        return info

    def _new_dir(self) -> tuple[str, Path]:
        dataset_id = uuid.uuid4().hex
        d = self._dir(dataset_id)
        d.mkdir(parents=True)
        return dataset_id, d

    def register_upload(self, name: str, coco: BinaryIO, dinov3: BinaryIO, bioclip: BinaryIO,
                        image_root: Optional[str], labels: Optional[Dict[int, str]]) -> dict:
        dataset_id, d = self._new_dir()
        try:
            files = {}
            for key, src, fname in (("coco", coco, "proposals.coco.json"),
                                    ("dinov3", dinov3, "dinov3.npz"),
                                    ("bioclip", bioclip, "bioclip.npz")):
                files[key] = d / fname
                with files[key].open("wb") as out:
                    shutil.copyfileobj(src, out, length=1 << 20)
            return self._register(dataset_id, name, files, image_root, labels)
        except BaseException:
            shutil.rmtree(d, ignore_errors=True)
            raise

    def register_uris(self, name: str, coco_uri: str, dinov3_uri: str, bioclip_uri: str,
                      image_root: Optional[str], labels: Optional[Dict[int, str]]) -> dict:
        dataset_id, d = self._new_dir()
        try:
            files = {
                "coco": self.storage.materialize(coco_uri, d / "proposals.coco.json"),
                "dinov3": self.storage.materialize(dinov3_uri, d / "dinov3.npz"),
                "bioclip": self.storage.materialize(bioclip_uri, d / "bioclip.npz"),
            }
            return self._register(dataset_id, name, files, image_root, labels)
        except BaseException:
            shutil.rmtree(d, ignore_errors=True)
            raise

    # ---- lookup ------------------------------------------------------------ #
    def get_info(self, dataset_id: str) -> dict:
        path = self._dir(dataset_id) / "dataset.json"
        if not path.exists():
            raise KeyError(dataset_id)
        return json.loads(path.read_text())

    def list(self) -> list[dict]:
        out = []
        for path in sorted(self.settings.datasets_dir.glob("*/dataset.json")):
            out.append(json.loads(path.read_text()))
        return sorted(out, key=lambda i: i["created"])

    def load(self, dataset_id: str) -> LoadedDataset:
        with self._lock:
            if dataset_id in self._cache:
                self._cache.move_to_end(dataset_id)
                return self._cache[dataset_id]
        info = self.get_info(dataset_id)
        files = info["_files"]
        loaded, _ = load_files(Path(files["coco"]), Path(files["dinov3"]), Path(files["bioclip"]))
        loaded.info = info
        self._remember(dataset_id, loaded)
        return loaded

    def _remember(self, dataset_id: str, loaded: LoadedDataset) -> None:
        with self._lock:
            self._cache[dataset_id] = loaded
            self._cache.move_to_end(dataset_id)
            while len(self._cache) > max(1, self.settings.pool_cache_size):
                self._cache.popitem(last=False)

    def delete(self, dataset_id: str) -> None:
        d = self._dir(dataset_id)
        if not (d / "dataset.json").exists():
            raise KeyError(dataset_id)
        with self._lock:
            self._cache.pop(dataset_id, None)
        shutil.rmtree(d, ignore_errors=True)
        shutil.rmtree(self.settings.image_cache_dir / dataset_id, ignore_errors=True)


def public_info(info: dict) -> dict:
    """Dataset info without server-side paths."""
    return {k: v for k, v in info.items() if not k.startswith("_")}
