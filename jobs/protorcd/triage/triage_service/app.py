"""FastAPI app: HTTP for datasets/sessions/crops/exports, WebSocket for the labelling loop.

Run:  uvicorn triage_service.app:app --host 0.0.0.0 --port 8000
Docs: /docs (Swagger UI), /redoc, /openapi.json, and /ws-protocol for the WebSocket messages.

Sessions live in this process, so run ONE worker/replica (journals make restarts safe).
"""
from __future__ import annotations

import json
import logging
import re
import secrets
import time
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Set

from fastapi import (
    APIRouter, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse, Response
from pydantic import TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from serving.crops import CropService
from serving.session_manager import SessionError, StaleBatchError

from .config import Settings
from .datasets import DatasetError, DatasetStore, public_info
from .schemas import (
    ClientMessage,
    DatasetInfo,
    DatasetList,
    DatasetRegisterRequest,
    DecisionList,
    ErrorMessage,
    ExtendRounds,
    GetState,
    Ping,
    Pong,
    RequestValidation,
    ServerMessage,
    SessionCreateRequest,
    SessionState,
    SubmitLabels,
    SubmitValidation,
    WebSocketProtocol,
    client_message_adapter,
    ws_message_schemas,
)
from .sessions import InvalidLabels, LiveSession, NotAllowed, RestoreError, SessionService
from .storage import S3ImageCache, Storage, StorageError, is_s3

log = logging.getLogger("triage_service")
ws_log = logging.getLogger("triage_service.ws")


class RedactTokens(logging.Filter):
    """Mask ``token=...`` in uvicorn's access and WebSocket lines, which print full URLs
    (crop URLs and WebSockets carry the token in the query string)."""

    pattern = re.compile(r"(token=)[^&\s\"']+")

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self.pattern.sub(r"\1***", record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(self.pattern.sub(r"\1***", a) if isinstance(a, str) else a
                                for a in record.args)
        return True


def setup_logging(level: str) -> None:
    """Make the service's own logs visible. uvicorn configures only its own loggers, so
    without a handler here everything below WARNING would be dropped."""
    for name in ("uvicorn.access", "uvicorn.error"):
        target = logging.getLogger(name)
        if not any(isinstance(f, RedactTokens) for f in target.filters):
            target.addFilter(RedactTokens())
    log.setLevel(level)
    if not log.handlers and not logging.getLogger().handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s",
                                               "%Y-%m-%d %H:%M:%S"))
        log.addHandler(handler)

API_VERSION = "1.0.0"
DESCRIPTION = """
Human-in-the-loop **Resolve / Clear / Defer** triage of SAM3 proposals, using ProtoRCD's
frozen `split_no_veto` protocol (DINOv3 = background evidence, BioCLIP = species evidence).

### Workflow
1. **Register a dataset**: the stage-1 `proposals.coco.json` plus the stage-2
   `dinov3_box.npz` and `bioclip_box.npz` (upload with `POST /datasets`, or reference S3 /
   allowed local paths with `POST /datasets/register`). The files must come from the same
   COCO file (checked by sha256), and are joined on annotation id.
2. **Create a session** with `POST /sessions` (seed, batch size, calibration size, `max_rounds`).
3. **Open the WebSocket** at `websocket_path` (`/ws/sessions/{session_id}`) and loop:
   receive `batch` → show crops → send `submit_labels` → receive `calibrated` / `round_result`
   and the next `batch`, until `finished`.
4. **Validate**: send `request_validation`, label the (blind) sample, send
   `submit_validation`; the reply estimates the accuracy of the auto-decisions. Not happy?
   send `extend_rounds` and keep labelling.
5. **Export** the labels with `GET /sessions/{id}/export`.

### WebSocket protocol
JSON text frames, each an object with a `type`. Client → server: `submit_labels`,
`get_state`, `extend_rounds`, `request_validation`, `submit_validation`, `ping`.
Server → client: `state`, `batch`, `calibrated`, `round_result`, `finished`,
`validation_batch`, `validation_result`, `error`, `pong`. On connect the server sends
`state`, then the pending `batch` and pending `validation_batch` if any, so reconnecting
resumes where the reviewer left off. Results are broadcast to every client of the
session; `error` and `pong` go to the sender only. Full schemas: `GET /ws-protocol`, and
`WsClientMessage` / `WsServerMessage` under *Schemas* below.

Labels: `0` = background, positive ids = classes (validated against the dataset taxonomy
when one is set). Batches must be answered completely, echoing their `batch_id`; a stale
id is rejected without consuming labels.

### Auth
If the server sets `TRIAGE_API_TOKEN`, send `Authorization: Bearer <token>` on HTTP calls,
or `?token=<token>` (needed for `<img src>` crop URLs). A backend holds that service token;
a reviewer's browser should get only the `session_token` returned by `POST /sessions`,
which opens that one session's WebSocket (`/ws/sessions/{id}?token=<session_token>`).
"""

TAGS = [
    {"name": "datasets", "description": "Proposals + embeddings registered for triage"},
    {"name": "sessions", "description": "Triage sessions (the label loop itself runs over the WebSocket)"},
    {"name": "websocket", "description": "WebSocket protocol reference"},
    {"name": "health", "description": "Liveness"},
]


class SessionHub:
    """WebSocket connections per session, for broadcasting session events."""

    def __init__(self) -> None:
        self._clients: Dict[str, Set[WebSocket]] = {}

    def add(self, session_id: str, ws: WebSocket) -> int:
        clients = self._clients.setdefault(session_id, set())
        clients.add(ws)
        return len(clients)

    def remove(self, session_id: str, ws: WebSocket) -> None:
        self._clients.get(session_id, set()).discard(ws)

    async def broadcast(self, session_id: str, events: List[dict]) -> None:
        clients = list(self._clients.get(session_id, ()))
        ws_log.debug("session %s: broadcasting %s to %d client(s)", session_id,
                     [e.get("type") for e in events], len(clients))
        for ws in clients:
            try:
                for event in events:
                    await ws.send_json(event)
            except Exception as exc:
                ws_log.info("session %s: dropping client %s after a failed send (%s)",
                            session_id, _peer(ws), type(exc).__name__)
                self.remove(session_id, ws)

    async def close_session(self, session_id: str) -> None:
        clients = list(self._clients.pop(session_id, ()))
        if clients:
            ws_log.info("session %s deleted: closing %d WebSocket(s)", session_id, len(clients))
        for ws in clients:
            try:
                await ws.close(code=4404, reason="session deleted")
            except Exception:
                pass


def _token_ok(settings: Settings, token: Optional[str]) -> bool:
    if not settings.api_token:
        return True
    return token is not None and secrets.compare_digest(token, settings.api_token)


def _peer(conn) -> str:
    client = getattr(conn, "client", None)
    return f"{client.host}:{client.port}" if client else "?"


def _bearer(header: Optional[str]) -> Optional[str]:
    if header and header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings()
    setup_logging(settings.log_level)
    settings.ensure_dirs()
    storage = Storage(settings)
    datasets = DatasetStore(settings, storage)
    sessions = SessionService(settings, datasets)
    images = S3ImageCache(storage, settings.image_cache_dir, settings.image_cache_mb * 1024 * 1024)
    hub = SessionHub()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        log.info("ProtoRCD triage service %s starting: data_dir=%s, auth=%s, cors=%s, "
                 "local roots=%s, s3 endpoint=%s, pool cache=%d, image cache=%d MB",
                 API_VERSION, settings.data_dir.resolve(), "token" if settings.api_token else "OFF",
                 settings.cors_origins or "none", [str(r) for r in settings.allowed_local_roots] or "disabled",
                 settings.s3_endpoint_url or "(AWS default)", settings.pool_cache_size, settings.image_cache_mb)
        if not settings.api_token:
            log.warning("TRIAGE_API_TOKEN is unset: every HTTP call and WebSocket is open to anyone")
        log.info("%d stored datasets, %d stored sessions", len(datasets.list()), len(sessions.journals()))
        yield
        log.info("Shutting down: closing %d loaded session(s)", sessions.loaded_count())
        sessions.close_all()

    app = FastAPI(title="ProtoRCD Triage Service", version=API_VERSION, description=DESCRIPTION,
                  openapi_tags=TAGS, lifespan=lifespan)
    app.state.settings = settings
    app.state.sessions = sessions
    app.state.datasets = datasets
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                           allow_methods=["*"], allow_headers=["*"])

    async def require_token(request: Request) -> None:
        token = _bearer(request.headers.get("authorization")) or request.query_params.get("token")
        if not _token_ok(settings, token):
            log.warning("401 %s %s from %s: %s token", request.method, request.url.path, _peer(request),
                        "missing" if token is None else "invalid")
            raise HTTPException(401, "missing or invalid token")

    api = APIRouter(dependencies=[Depends(require_token)])

    # ---- error mapping ---------------------------------------------------- #
    @app.exception_handler(KeyError)
    async def _not_found(request: Request, exc: KeyError):
        log.info("404 %s %s: not found %s", request.method, request.url.path, exc.args[0] if exc.args else "")
        return JSONResponse({"detail": f"not found: {exc.args[0] if exc.args else ''}"}, status_code=404)

    @app.exception_handler(DatasetError)
    @app.exception_handler(StorageError)
    @app.exception_handler(InvalidLabels)
    async def _bad_request(request: Request, exc: Exception):
        log.warning("400 %s %s: %s: %s", request.method, request.url.path, type(exc).__name__, exc)
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(NotAllowed)
    @app.exception_handler(StaleBatchError)
    async def _conflict(request: Request, exc: Exception):
        log.info("409 %s %s: %s", request.method, request.url.path, exc)
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(SessionError)
    @app.exception_handler(RestoreError)
    async def _session_failed(request: Request, exc: Exception):
        log.error("500 %s %s: session error", request.method, request.url.path, exc_info=exc)
        return JSONResponse({"detail": f"session unavailable ({type(exc).__name__})"}, status_code=500)

    # ---- health ----------------------------------------------------------- #
    @app.get("/healthz", tags=["health"])
    async def healthz() -> dict:
        return {"status": "ok"}

    # ---- datasets --------------------------------------------------------- #
    @api.get("/datasets", response_model=DatasetList, tags=["datasets"])
    async def list_datasets():
        return {"datasets": [public_info(i) for i in datasets.list()]}

    @api.post("/datasets", response_model=DatasetInfo, status_code=201, tags=["datasets"],
              summary="Upload a dataset (COCO + two .npz files)")
    async def upload_dataset(
        name: str = Form(..., description="Display name"),
        coco: UploadFile = File(..., description="Stage-1 proposals.coco.json"),
        dinov3: UploadFile = File(..., description="Stage-2 dinov3_<region>.npz"),
        bioclip: UploadFile = File(..., description="Stage-2 bioclip_<region>.npz"),
        image_root: Optional[str] = Form(None, description="s3://bucket/prefix or an allowed local dir"),
        labels: Optional[str] = Form(None, description='Taxonomy JSON, e.g. {"1": "deer", "2": "fox"}'),
    ):
        taxonomy = None
        if labels:
            try:
                taxonomy = TypeAdapter(Dict[int, str]).validate_json(labels)
            except ValidationError as exc:
                log.warning("dataset upload %r rejected: bad labels JSON", name)
                raise HTTPException(400, f"labels must be a JSON object of id -> name: {exc.errors()[0]['msg']}")
        info = await run_in_threadpool(datasets.register_upload, name, coco.file, dinov3.file,
                                       bioclip.file, image_root, taxonomy)
        return public_info(info)

    @api.post("/datasets/register", response_model=DatasetInfo, status_code=201, tags=["datasets"],
              summary="Register a dataset from S3 or allowed local paths")
    async def register_dataset(req: DatasetRegisterRequest):
        info = await run_in_threadpool(datasets.register_uris, req.name, req.coco_uri, req.dinov3_uri,
                                       req.bioclip_uri, req.image_root, req.labels)
        return public_info(info)

    @api.get("/datasets/{dataset_id}", response_model=DatasetInfo, tags=["datasets"])
    async def get_dataset(dataset_id: str):
        return public_info(datasets.get_info(dataset_id))

    @api.delete("/datasets/{dataset_id}", tags=["datasets"],
                responses={409: {"description": "Sessions still use this dataset"}})
    async def delete_dataset(dataset_id: str) -> dict:
        datasets.get_info(dataset_id)
        users = sessions.sessions_for_dataset(dataset_id)
        if users:
            log.info("refusing to delete dataset %s: %d session(s) still use it", dataset_id, len(users))
            raise HTTPException(409, f"delete its sessions first: {users[:5]}")
        datasets.delete(dataset_id)
        return {"deleted": dataset_id}

    @api.get("/datasets/{dataset_id}/crops/{proposal_id}", tags=["datasets"],
             response_class=Response,
             responses={200: {"content": {"image/jpeg": {}}, "description": "JPEG crop"},
                        404: {"description": "Unknown proposal, or no image root / image missing"}})
    async def get_crop(
        dataset_id: str,
        proposal_id: int,
        padding: float = Query(0.0, ge=0.0, le=1.0, description="Context around the box, as a fraction of its size"),
        max_side: int = Query(512, ge=32, le=4096, description="Downscale the longer edge to at most this"),
    ):
        def crop() -> bytes:
            loaded = datasets.load(dataset_id)
            root = loaded.info.get("_image_root")
            if not root:
                raise KeyError("this dataset has no image root")
            pool = loaded.pool
            if proposal_id not in pool.id_to_index:
                raise KeyError(proposal_id)
            if is_s3(root):
                meta = pool.metadata[pool.id_to_index[proposal_id]]
                root = images.ensure(dataset_id, root, meta["file_name"])
            try:
                return CropService(pool, root, padding=padding, max_side=max_side).crop_bytes(proposal_id)
            except FileNotFoundError as exc:
                log.warning("crop source missing: %s", exc)
                raise KeyError("source image not available") from exc

        data = await run_in_threadpool(crop)
        return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})

    # ---- sessions --------------------------------------------------------- #
    @api.post("/sessions", response_model=SessionState, status_code=201, tags=["sessions"],
              summary="Create a session; returns once the calibration batch is ready")
    async def create_session(req: SessionCreateRequest):
        live = await sessions.create(req)
        return {**live.state(), "session_token": live.journal.get("session_token")}

    @api.get("/sessions", tags=["sessions"], summary="Stored sessions (lightweight, from journals)")
    async def list_sessions() -> dict:
        out = []
        for j in sessions.journals():
            live = sessions.loaded(j["session_id"])
            out.append({
                "session_id": j["session_id"],
                "dataset_id": j["dataset_id"],
                "created": j["created"],
                "config": j["config"],
                "batches_answered": len(j["submissions"]),
                "rounds_completed": len(j["rounds"]),
                "loaded": live is not None,
                "status": live.state()["status"] if live is not None else None,
            })
        return {"sessions": out}

    @api.get("/sessions/{session_id}", response_model=SessionState, tags=["sessions"])
    async def get_session(session_id: str):
        live = await sessions.get(session_id)
        return {**live.state(), "session_token": live.journal.get("session_token")}

    @api.delete("/sessions/{session_id}", tags=["sessions"])
    async def delete_session(session_id: str) -> dict:
        sessions.delete(session_id)
        await hub.close_session(session_id)
        return {"deleted": session_id}

    @api.get("/sessions/{session_id}/decisions", response_model=DecisionList, tags=["sessions"],
             summary="Per-proposal status and final label, plus per-round history")
    async def get_decisions(session_id: str):
        live = await sessions.get(session_id)
        async with live.lock:
            rows = await run_in_threadpool(live.decisions)
        return {"session_id": session_id, "counts": live.decision_counts(rows),
                "rounds": live.journal["rounds"], "decisions": rows}

    @api.get("/sessions/{session_id}/export", tags=["sessions"],
             summary="COCO file of the final labels (human > validation > auto)")
    async def export_session(
        session_id: str,
        include_background: bool = Query(False, description="Also export background (label 0) proposals"),
    ):
        live = await sessions.get(session_id)
        async with live.lock:
            coco = await run_in_threadpool(live.export_coco, include_background)
        log.info("session %s exported: %d annotations (include_background=%s), counts %s", session_id,
                 len(coco["annotations"]), include_background, coco["info"]["counts"])
        return JSONResponse(coco, headers={
            "Content-Disposition": f'attachment; filename="triage_{session_id}.coco.json"'})

    @api.get("/ws-protocol", response_model=WebSocketProtocol, tags=["websocket"],
             summary="JSON schemas of the WebSocket messages")
    async def ws_protocol():
        return {
            "auth": "?token=<token> or Authorization: Bearer, with either the service token "
                    "(TRIAGE_API_TOKEN, any session) or the session_token from POST/GET /sessions "
                    "(that session only). With no TRIAGE_API_TOKEN set, no token is needed.",
            **ws_message_schemas(),
        }

    app.include_router(api)

    # ---- websocket -------------------------------------------------------- #
    async def handle(live: LiveSession, msg) -> tuple[List[dict], bool]:
        """Run one client message. Returns (events, broadcast?)."""
        ws_log.debug("session %s: received %s", live.session_id, msg.type)
        if isinstance(msg, Ping):
            return [Pong().model_dump()], False
        if isinstance(msg, GetState):
            return [live.state_message()], False
        async with live.lock:
            if isinstance(msg, SubmitLabels):
                pending, clean = live.check_submission(msg.batch_id, dict(msg.labels))
                await hub.broadcast(live.session_id, [live.state_message(status="advancing", pending_batch=None)])
                events = await run_in_threadpool(live.submit_labels, pending, clean)
            elif isinstance(msg, ExtendRounds):
                events = await run_in_threadpool(live.extend_rounds, msg.additional_rounds)
            elif isinstance(msg, RequestValidation):
                events = await run_in_threadpool(live.request_validation, msg.sample_size)
            elif isinstance(msg, SubmitValidation):
                events = await run_in_threadpool(live.submit_validation, msg.validation_id, dict(msg.labels))
            else:  # pragma: no cover - the discriminated union is exhaustive
                raise NotAllowed(f"unsupported message {msg!r}")
        return events, True

    def error_event(code: str, message: str, request_type: Optional[str] = None) -> dict:
        return ErrorMessage(code=code, message=message, request_type=request_type).model_dump()

    @app.websocket("/ws/sessions/{session_id}")
    async def session_socket(websocket: WebSocket, session_id: str):
        token = _bearer(websocket.headers.get("authorization")) or websocket.query_params.get("token")
        peer = _peer(websocket)
        await websocket.accept()
        try:
            session_token = sessions.session_token(session_id)
        except KeyError:
            session_token = None
            known = False
        else:
            known = True
        # The service token opens any session; a session token opens only its own.
        allowed = _token_ok(settings, token) or (
            known and session_token is not None and token is not None
            and secrets.compare_digest(token, session_token)
        )
        if not allowed:
            ws_log.warning("session %s: rejected WebSocket from %s (%s token)", session_id, peer,
                           "missing" if token is None else "invalid")
            await websocket.send_json(error_event("not_allowed", "missing or invalid token"))
            await websocket.close(code=4401)
            return
        if not known:
            ws_log.info("session %s: WebSocket from %s for an unknown session", session_id, peer)
            await websocket.send_json(error_event("not_found", f"unknown session {session_id}"))
            await websocket.close(code=4404)
            return
        if not settings.api_token:
            auth = "no token (auth off)"
        else:
            auth = "service token" if _token_ok(settings, token) else "session token"
        try:
            live = await sessions.get(session_id)
        except KeyError:
            ws_log.info("session %s: deleted while %s was connecting", session_id, peer)
            await websocket.send_json(error_event("not_found", f"unknown session {session_id}"))
            await websocket.close(code=4404)
            return
        except Exception as exc:
            log.exception("restore failed for %s", session_id)
            await websocket.send_json(error_event("session_failed", f"could not restore session ({type(exc).__name__})"))
            await websocket.close(code=1011)
            return

        clients = hub.add(session_id, websocket)
        connected = time.time()
        messages = 0
        close_code = None
        ws_log.info("session %s: client %s connected with the %s (%d client(s) now)",
                    session_id, peer, auth, clients)
        try:
            async with live.lock:
                initial = [live.state_message()]
                try:
                    batch = live.batch_message()
                except SessionError:
                    batch = None
                for event in (batch, live.pending_validation_message()):
                    if event is not None:
                        initial.append(event)
            for event in initial:
                await websocket.send_json(event)
            ws_log.info("session %s: sent %s to %s (status %s, pending batch %s)", session_id,
                        [e["type"] for e in initial], peer, initial[0]["state"]["status"],
                        batch["batch_id"] if batch else None)

            while True:
                raw = await websocket.receive_text()
                messages += 1
                request_type = None
                try:
                    payload = json.loads(raw)
                    request_type = payload.get("type") if isinstance(payload, dict) else None
                    msg = client_message_adapter.validate_python(payload)
                except (ValueError, ValidationError) as exc:
                    detail = exc.errors()[0]["msg"] if isinstance(exc, ValidationError) else "invalid JSON"
                    ws_log.warning("session %s: invalid %s message from %s: %s", session_id,
                                   request_type or "untyped", peer, detail)
                    await websocket.send_json(error_event("invalid_message", detail, request_type))
                    continue
                try:
                    events, broadcast = await handle(live, msg)
                except StaleBatchError as exc:
                    ws_log.info("session %s: %s from %s rejected as stale: %s", session_id, msg.type, peer, exc)
                    await websocket.send_json(error_event("stale_batch", str(exc), msg.type))
                    continue
                except InvalidLabels as exc:
                    ws_log.info("session %s: %s from %s rejected: %s", session_id, msg.type, peer, exc)
                    await websocket.send_json(error_event("invalid_labels", str(exc), msg.type))
                    continue
                except NotAllowed as exc:
                    ws_log.info("session %s: %s from %s not allowed: %s", session_id, msg.type, peer, exc)
                    await websocket.send_json(error_event("not_allowed", str(exc), msg.type))
                    continue
                except (SessionError, RestoreError) as exc:
                    log.exception("session %s failed while handling %s", session_id, msg.type)
                    await hub.broadcast(session_id, [
                        error_event("session_failed", f"session failed ({type(exc.__cause__ or exc).__name__})", msg.type),
                        live.state_message(),
                    ])
                    continue
                except Exception:
                    log.exception("unhandled error in session %s while handling %s", session_id, msg.type)
                    await websocket.send_json(error_event("internal", "internal error", msg.type))
                    continue
                if broadcast:
                    await hub.broadcast(session_id, events)
                else:
                    for event in events:
                        await websocket.send_json(event)
        except WebSocketDisconnect as exc:
            close_code = exc.code
        finally:
            hub.remove(session_id, websocket)
            ws_log.info("session %s: client %s disconnected (code %s) after %.0fs and %d message(s)",
                        session_id, peer, close_code, time.time() - connected, messages)

    # ---- OpenAPI: include the WebSocket message schemas -------------------- #
    def custom_openapi() -> dict:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, description=app.description,
                             routes=app.routes, tags=TAGS)
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        for name, tp in (("WsClientMessage", ClientMessage), ("WsServerMessage", ServerMessage)):
            js = TypeAdapter(tp).json_schema(ref_template="#/components/schemas/{model}")
            for key, value in js.pop("$defs", {}).items():
                components.setdefault(key, value)
            components[name] = js
        if settings.api_token:
            components_root = schema["components"]
            components_root["securitySchemes"] = {"bearer": {"type": "http", "scheme": "bearer"}}
            schema["security"] = [{"bearer": []}]
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi
    return app


app = create_app()
