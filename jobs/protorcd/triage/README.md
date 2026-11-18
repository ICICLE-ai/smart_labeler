# ProtoRCD triage service

Stage 3: the human-in-the-loop **Resolve / Clear / Defer** loop as a WebSocket service,
meant to run on NRP. It takes the stage-1 COCO file and the two stage-2 `.npz` files
(see [../README.md](../README.md)), runs ProtoRCD's `split_no_veto` protocol, and sends
batches of proposals to the reviewer until the round budget is spent.

| Path | What |
|---|---|
| `protorcd_pipeline/triage/` | ProtoRCD triage core, copied unchanged (`accd349`). Pure numpy + scikit-learn. |
| `serving/` | ProtoRCD `session_manager.py` (worker thread + label queue) and `crops.py`, copied unchanged |
| `triage_service/` | Ours: FastAPI app, WebSocket protocol, datasets, journals, validation, export |
| `tests/` | End-to-end tests over synthetic stage-1/2 files |
| `Dockerfile`, `k8s/triage-service.yaml` | Container and an NRP deployment template |

## Run it

```bash
cd jobs/protorcd/triage
pip install -r requirements.txt
uvicorn triage_service.app:app --host 0.0.0.0 --port 8000 --workers 1
# or
docker build -t protorcd-triage . && docker run -p 8000:8000 -v $PWD/triage_data:/data protorcd-triage
```

API docs: **`/docs`** (Swagger UI), `/redoc`, `/openapi.json`. The WebSocket messages
are listed there as `WsClientMessage` / `WsServerMessage` schemas, and at `GET /ws-protocol`.

Tests: `pip install -r requirements-dev.txt && pytest`

### Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `TRIAGE_DATA_DIR` | `./triage_data` (`/data` in the image) | Datasets, session journals, image cache. Use a persistent volume. |
| `TRIAGE_API_TOKEN` | unset | Shared token. When set, every call needs `Authorization: Bearer …` or `?token=…`. |
| `TRIAGE_ALLOWED_LOCAL_ROOTS` | unset (disabled) | Colon-separated dirs that `POST /datasets/register` may read in place |
| `S3_ENDPOINT_URL` + `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | unset | S3-compatible store (e.g. NRP Ceph) for `s3://` datasets and image roots |
| `TRIAGE_CORS_ORIGINS` | unset | Comma-separated browser origins (the Smart Labeler client) |
| `TRIAGE_IMAGE_CACHE_MB` | 2048 | Local cache for images fetched from S3 for crops |
| `TRIAGE_POOL_CACHE_SIZE` | 2 | Datasets kept loaded in memory |
| `TRIAGE_LOG_LEVEL` | INFO | `DEBUG` adds every WebSocket message and cache hit. Tokens in URLs are masked in uvicorn's access log |

**Run exactly one worker and one replica.** Live sessions are in the process's memory.
Restarts are still safe, because every accepted batch of labels is journalled and the
session is rebuilt by replaying them (the triage is deterministic). The first request
after a restart pays that replay cost.

## Workflow

1. **Register a dataset.** Either:
   - `POST /datasets` as multipart: `name`, `coco`, `dinov3`, `bioclip` files, plus
     optional `image_root` and `labels` (taxonomy JSON such as `{"1": "deer", "2": "fox"}`).
   - `POST /datasets/register` with JSON: `s3://` URIs or allowed local paths.

   The server checks that both `.npz` files name the COCO file's sha256, joins them on
   annotation id, and keeps proposals embedded by both models. With an `image_root`, every
   proposal gets a `crop_url` (`GET /datasets/{id}/crops/{proposal_id}` → JPEG).
2. **Create a session**: `POST /sessions {"dataset_id", "seed", "batch_size",
   "calibration_size", "max_rounds"}`. It returns once the calibration batch is ready, with
   `websocket_path`.
3. **Label over the WebSocket** `/ws/sessions/{session_id}` (add `?token=…` if auth is on).

## WebSocket protocol

JSON text frames, each with a `type`.

On connect the server sends `state`, then the pending `batch` and any pending
`validation_batch`. Reconnecting therefore resumes exactly where the reviewer was.
Session events are broadcast to every client connected to the session. `error` and
`pong` go only to the sender.

| Client → server | Fields | Effect |
|---|---|---|
| `submit_labels` | `batch_id`, `labels {proposal_id: label}` | Answer the pending batch (all of it). `0` = background. |
| `extend_rounds` | `additional_rounds` | Raise `max_rounds`, while running or after a `max_rounds` stop |
| `request_validation` | `sample_size` | Random blind sample of auto-decided proposals |
| `submit_validation` | `validation_id`, `labels` | Your labels for that sample |
| `get_state` / `ping` | | Reply with `state` / `pong` |

| Server → client | When |
|---|---|
| `state` | On connect, as soon as a submission is accepted (`status: "advancing"`), and after every change |
| `batch` | Proposals to label: `batch_id`, `phase` (`calibration`/`review`), `round`, `proposals[]` with `bbox_xywh`, `file_name`, `crop_url` |
| `calibrated` | The calibration bank is labelled; carries the calibrated rule |
| `round_result` | A review round finished: `acquired`, `retired` (auto-decided this round), `counts`, `remaining` |
| `finished` | `reason`: `max_rounds` (can extend) or `pool_exhausted` |
| `validation_batch` / `validation_result` | Spot-check sample, then agreement, accuracy, a 95% Wilson interval, and a split by Resolve vs Clear |
| `error` | `code`: `stale_batch`, `invalid_labels`, `invalid_message`, `not_allowed`, `session_failed`, `not_found`, `internal` |

A typical loop:

```text
← state, batch(calibration, 100 proposals)
→ submit_labels
← state(advancing), calibrated, batch(review, round 1), state
→ submit_labels
← state(advancing), round_result(round 1), batch(round 2), state
…
← round_result(round N), finished(max_rounds), state
→ request_validation(50)      ← validation_batch
→ submit_validation           ← validation_result (accuracy 0.94, ci95 [0.84, 0.98]), state
→ extend_rounds(3)            ← batch(round N+1), state            (if not satisfied)
```

A rejected submission (stale `batch_id`, missing or extra proposals, a class outside the
taxonomy) returns `error` and consumes nothing.

## How to decide when to stop

The paper's 80% figure came from ground truth, which a live session doesn't have. So
the session runs a **user-chosen `max_rounds`**, and the reviewer then **validates**:

- **Use the validation result, not per-round numbers.** Review batches are drawn only
  from *deferred* proposals, so the rule never auto-decided anything the reviewer labels
  during rounds. The spot check is the only unbiased measure of the auto-decisions.
- **Validation is blind.** Predictions are withheld from `validation_batch`.
- **Validation labels don't change the triage.** They correct the export but are never
  added to the prototype bank, so the triage stays ProtoRCD's algorithm.
- **Not satisfied?** Send `extend_rounds` and keep labelling, then validate again.
  Cumulative accuracy covers every validation so far.

## Results

- `GET /sessions/{id}/decisions`: every proposal's status (`calibration`, `reviewed`,
  `auto_resolve`, `auto_clear`, `deferred`, `not_embedded`), its final label, and the
  per-round history.
- `GET /sessions/{id}/export`: a COCO file of the labelled objects. The final label is
  the human label if there is one, otherwise the validation correction, otherwise the
  auto decision. Each annotation records its `triage.source`.
  - Background is left out unless `?include_background=true`.
  - Deferred proposals are left out.

## Deploying on NRP

Fill in the placeholders in [k8s/triage-service.yaml](k8s/triage-service.yaml): image,
storage class, ingress class and hostname, S3 endpoint, CORS origin. Create the
`protorcd-triage` secret described at its top, then `kubectl apply`.

The manifest uses one replica with the `Recreate` strategy and a persistent volume at
`/data`. Size memory at about 0.8 GB per loaded 100k-proposal dataset.
