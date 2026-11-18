# ProtoRCD jobs — proposals and embeddings for triage

The [ProtoRCD](https://github.com/OSU-SAI-Lab/ProtoRCD/tree/main/protorcd_pipeline)
pipeline. Stages 1 and 2 run either as a Tapis job or from an Apptainer image on a user's
own node; stage 3 is a WebSocket service for NRP. The two stages are independent: each reads files and writes files, and
the only link between them is the COCO **annotation id**.

```
images ─► detect ─► proposals.coco.json ─► embed ─► dinov3_box.npz + bioclip_box.npz ─► triage server (NRP)
```

The model code is copied unchanged from ProtoRCD commit `accd349` (each file says so in
its first line; license in [LICENSE](LICENSE)). Only the runners and the file formats are
ours:

| Folder | From ProtoRCD (unchanged) | Ours |
|---|---|---|
| [detect/](detect/) | `detector.py`, `sahi_utils.py`, `utils.py` (`detect/sam3_text/`) | `run_detect.py`, `export_coco.py`, `detect.def` |
| [embed/](embed/) | `dinov3.py`, `bioclip.py`, `crops.py`, `masks.py`, `insid3_debias.py`, `proposals.py` (`features/`) | `run_embed.py`, `embed.def` |
| [triage/](triage/) | `protorcd_pipeline/triage/*`, `serving/session_manager.py`, `serving/crops.py` | `triage_service/`, `Dockerfile`, `k8s/` |

## Stage 1 — detect

```bash
python jobs/protorcd/detect/run_detect.py \
    --image_dir /data/images --output /data/out/proposals.coco.json [--use_sahi]
```

- SAM3 with the text prompt `visual` (broad objectness), ProtoRCD defaults: confidence
  0.2, NMS 0.4, SAHI crop 1008 / overlap 0.25 with containment suppression.
- Proposals scoring below `--score_threshold` (default **0.4**, ProtoRCD's feature-stage
  default) are not exported. This is the only score filter in the pipeline.
- Resumable: progress goes to `<output>.partial.jsonl`; re-run the same command after a
  timeout. Use `--overwrite` to start fresh (required if you change detector settings).
- Needs the gated SAM3 checkpoint from Hugging Face (`HF_TOKEN` or a warm `HF_HOME`).
- Already have ProtoRCD `*_detections.json` output? Convert it instead of re-running:
  `python jobs/protorcd/detect/export_coco.py --detections_dir DIR --images_dir IMAGES --output proposals.coco.json`

### Output: `proposals.coco.json`

Standard COCO, with ids that never change once written:

```jsonc
{
  "info": {
    "schema": "protorcd.proposals.coco/v1",
    "source_commit": "accd349",
    "score_threshold": 0.4,
    "num_images": 2, "num_proposals": 3, "num_dropped": 5,
    "detector": { "text_prompt": "visual", "confidence_threshold": 0.2, "use_sahi": false, "...": "..." }
  },
  "images": [
    { "id": 1, "file_name": "site_a/IMG_0001.jpg", "width": 4000, "height": 3000 }
  ],
  "annotations": [
    { "id": 1, "image_id": 1, "category_id": 1, "bbox": [812, 455, 230, 160],
      "area": 36800.0, "iscrowd": 0, "score": 0.83,
      "segmentation": { "size": [3000, 4000], "counts": "..." }   // only with --return_masks
    }
  ],
  "categories": [ { "id": 1, "name": "proposal", "supercategory": "object" } ]
}
```

- `file_name` is relative to `--image_dir`, using forward slashes.
- `bbox` is `[x, y, w, h]` in integer pixels, rounded exactly as ProtoRCD does.
- Every proposal is `category_id: 1` (`proposal`). Species and background labels come
  from triage, where background is class `0`.

## Stage 2 — embed

```bash
python jobs/protorcd/embed/run_embed.py \
    --coco /data/out/proposals.coco.json --image_dir /data/images \
    --output_dir /data/out/embeddings --models dinov3 bioclip \
    --dinov3_weights /weights/dinov3_vith16plus_pretrain_lvd1689m-7c1da9a5.pth
```

- **DINOv3** (background evidence): `dinov3_vith16plus`, crop resized to 1024×1024, mean
  of last-layer patch features, L2-normalized. Weights are gated. On OSC the default path
  baked into ProtoRCD's `dinov3.py` works; elsewhere pass `--dinov3_weights`.
- **BioCLIP** (species evidence): `pybioclip` `BaseClassifier` image features,
  L2-normalized. The exact model and `pybioclip` version are recorded in `meta`.
- Every annotation in the COCO file is embedded. A proposal is skipped (and listed)
  only if its crop is empty, or its image is missing.
- Re-running skips models whose output already exists (`--overwrite` to redo).

### Output: `<model>_<region>.npz` (e.g. `dinov3_box.npz`, `bioclip_box.npz`)

| Key | Shape / type | Meaning |
|---|---|---|
| `embeddings` | `(N, D)` float32 (float16 with `--dtype float16`) | one L2-normalized row per proposal |
| `annotation_ids` | `(N,)` int64 | COCO `annotations[].id` of each row, which is **the join key** |
| `skipped_annotation_ids` | `(M,)` int64 | proposals with no usable crop |
| `meta` | 0-d string (JSON) | see below |

`meta` fields: `schema` (`protorcd.embeddings/v1`), `model`, `region`, `embedding_dim`,
`dtype`, `normalized`, `coco_file`, **`coco_sha256`**, `num_annotations`,
`num_embedded`, `num_skipped`, `num_missing_images`, `source_commit`, `torch_version`,
plus model provenance (`dinov3_model_size`, `dinov3_image_size`, `dinov3_weights` /
`bioclip_model`, `pybioclip_version`).

Read it without pickle:

```python
z = np.load("dinov3_box.npz")
meta = json.loads(str(z["meta"]))
```

## Stage 3 — the triage service

[triage/](triage/) is the WebSocket service that runs the human-in-the-loop loop on these
files; see [triage/README.md](triage/README.md). When it loads a dataset it:

1. Checks that both `.npz` `meta.coco_sha256` values equal the sha256 of the COCO file,
   and rejects the dataset otherwise.
2. Joins on `annotation_ids`, never on row order. Only ids present in **both** files enter
   the pool (a proposal skipped by either model is reported as `not_embedded`).
3. Builds ProtoRCD's `ProposalPool` directly; no feature-store directory is needed:

```python
ids = np.intersect1d(dino["annotation_ids"], bioclip["annotation_ids"])  # sorted
bg = dino["embeddings"][index_of(dino["annotation_ids"], ids)].astype(np.float32)
fg = bioclip["embeddings"][index_of(bioclip["annotation_ids"], ids)].astype(np.float32)
pool = ProposalPool(bg_x=l2_normalize(bg), fg_x=l2_normalize(fg),
                    proposal_ids=ids.tolist(), metadata=[coco_row[i] for i in ids])
```

Each `metadata` row carries `image_id`, `file_name` and `bbox_xywh` from the COCO file,
so crops can be shown to the reviewer.

## Running it from Smart Labeler

In the dashboard, **New Pipeline → Detection approach → ProtoRCD** creates a pipeline
with two steps:

1. **Configure jobs** (`/protorcd/configure/:id`). One form per Tapis job: the proposal
   job (image directory → `proposals.coco.json`), then the embedding job, which is
   pre-filled from it. Both show live Tapis status and logs.
2. **Human in the loop** (`/protorcd/triage/:id`). Enter the classes and the triage
   settings (rounds, batch size, calibration size, seed), then start or resume a session.
   - **Labelling:** batches arrive over the WebSocket. Pick a class in the palette (or
     press 0–9) and click crops to label them.
   - **When the rounds are done:** draw a blind spot-check sample, run more rounds if
     the accuracy is too low, then download the COCO export or save it next to the
     embeddings on HPC.

The backend (`server/protorcd.py`, routes under `/protorcd/…`) does three things:
- submits both jobs;
- copies the embed job's outputs from the HPC system to the triage service;
- hands the browser a WebSocket URL carrying a token for that one session.

The service-wide `TRIAGE_API_TOKEN` stays on the server. Crops are cut in the browser
from the original images, which are fetched through Tapis, so the triage service needs
no access to the images.

Deployment settings are listed in `server/.env.example` and `k8s/server-deployment.yaml`:
- `SMART_LABELER_PROTORCD_{DETECT,EMBED}_IMAGE`
- `PROTORCD_{DETECT,EMBED}_APP_ID`
- `TRIAGE_SERVICE_URL`, `TRIAGE_PUBLIC_URL`, `TRIAGE_API_TOKEN`

The two Tapis apps must be registered under those ids, in the same shape as the existing
Smart Labeler job apps: a container SIF in `sifpath`, with inputs bind-mounted.

## Running as a Tapis job or on your own node

```bash
cd jobs/protorcd/detect && apptainer build protorcd_detect.sif detect.def
cd jobs/protorcd/embed  && apptainer build protorcd_embed.sif  embed.def

apptainer run --nv --env HF_TOKEN=$HF_TOKEN --bind /data protorcd_detect.sif \
    --image_dir /data/images --output /data/out/proposals.coco.json
apptainer run --nv --bind /data,/weights protorcd_embed.sif \
    --coco /data/out/proposals.coco.json --image_dir /data/images \
    --output_dir /data/out/embeddings --dinov3_weights /weights/<dinov3 checkpoint>.pth
```

A Tapis app is a thin wrapper around the same `.sif` and the same arguments, so a Tapis
run and a local run produce the same files.

Both stages log to stderr with timestamps: settings, GPU and Hugging Face status, a
progress line with an ETA every minute, and a summary of what was written. Add
`--log_level DEBUG` (or set `PROTORCD_LOG_LEVEL`) for per-image detail. The tqdm bar only
appears on a terminal, so Tapis output files stay readable.
