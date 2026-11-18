#!/usr/bin/env python3
"""Stage 2: embed every proposal in a stage-1 COCO file with DINOv3 and/or BioCLIP.

    python jobs/protorcd/embed/run_embed.py --coco out/proposals.coco.json \
        --image_dir IMAGES --output_dir out/embeddings --models dinov3 bioclip

Writes one ``<model>_<region>.npz`` per model (see ``jobs/protorcd/README.md``):

    embeddings               (N, D) float32 (or float16 with --dtype float16), L2-normalized
    annotation_ids           (N,)   int64  -- COCO annotation id of each row
    skipped_annotation_ids   (M,)   int64  -- proposals with no usable crop (e.g. empty mask)
    meta                     JSON string: model, crop region, weights, COCO sha256, ...

The crop and encoder code is ProtoRCD's, unchanged (``crops.py``, ``masks.py``,
``dinov3.py``, ``insid3_debias.py``, ``bioclip.py``); only the loader differs: proposals
come from the COCO file and are keyed by annotation id instead of
``"{image_id}:{index}"`` + row order.

Logs go to stderr with timestamps (``--log_level DEBUG`` for per-image detail). The tqdm
bar shows only on a terminal; batch jobs get a progress line every minute instead.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import logging
import os
import sys
import time
from collections import defaultdict
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image
from tqdm import tqdm

if __package__ in (None, ""):
    # invoked as a bare script: make the sibling `embed` package importable.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from embed.crops import proposal_crop
from embed.proposals import Proposal

SCHEMA = "protorcd.embeddings/v1"
SOURCE_COMMIT = "accd349"
MODELS = ("dinov3", "bioclip", "dinov3_debiased")
PROGRESS_EVERY_S = 60
MISSING_IMAGES_LOGGED = 10

log = logging.getLogger("protorcd.embed")


def setup_logging(level: str = "INFO") -> None:
    """Timestamped logs on stderr, readable in a Tapis job's output file."""
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
                        datefmt="%Y-%m-%d %H:%M:%S")


def format_duration(seconds: float) -> str:
    seconds = int(max(seconds, 0))
    hours, rest = divmod(seconds, 3600)
    return f"{hours}h{rest // 60:02d}m{rest % 60:02d}s" if hours else f"{rest // 60}m{rest % 60:02d}s"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def resolve_image_path(images_dir: Path, file_name: str) -> Path | None:
    # Same lookup as ProtoRCD features/extract.py:resolve_image_path.
    path = images_dir / file_name
    if path.exists():
        return path
    parts = Path(file_name).parts
    if parts and parts[0] == "images":
        stripped = images_dir / Path(*parts[1:])
        if stripped.exists():
            return stripped
    fallback = images_dir / Path(file_name).name
    if fallback.exists():
        return fallback
    return None


def load_proposals_by_image(coco: dict) -> list[tuple[str, list[Proposal]]]:
    """Group COCO annotations into ProtoRCD ``Proposal``s per image file.

    ``proposal_index`` carries the COCO annotation id; that is the key written out.
    """
    file_names = {img["id"]: img["file_name"] for img in coco["images"]}
    grouped: dict[str, list[Proposal]] = defaultdict(list)
    for ann in coco["annotations"]:
        file_name = file_names[ann["image_id"]]
        grouped[file_name].append(
            Proposal(
                image_id=ann["image_id"],
                file_name=file_name,
                detection_file="",
                proposal_index=int(ann["id"]),
                bbox_xywh=tuple(float(v) for v in ann["bbox"]),
                score=float(ann.get("score", 1.0)),
                segmentation=ann.get("segmentation"),
            )
        )
    return sorted(grouped.items())


def embed_proposals(
    image_items: list[tuple[str, list[Proposal]]],
    image_dir: Path,
    encode_crops: Callable[[list[Image.Image], int], np.ndarray],
    region: str,
    batch_size: int,
    mask_background: tuple[int, int, int] = (0, 0, 0),
    description: str = "embed",
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Crop and encode every proposal, one image at a time (as ProtoRCD does).

    Returns ``(embeddings, annotation_ids, skipped_annotation_ids, missing_images)``.
    """
    chunks: list[np.ndarray] = []
    ids: list[int] = []
    skipped: list[int] = []
    missing_images: list[str] = []
    total_proposals = sum(len(props) for _, props in image_items)
    loop_start = last_log = time.time()
    proposals_seen = 0
    for n, (file_name, props) in enumerate(
        tqdm(image_items, desc=description, unit="image", dynamic_ncols=True, disable=None), start=1
    ):
        proposals_seen += len(props)
        image_path = resolve_image_path(image_dir, file_name)
        if image_path is None:
            missing_images.append(file_name)
            skipped.extend(p.proposal_index for p in props)
            if len(missing_images) <= MISSING_IMAGES_LOGGED:
                log.warning("%s: image %s not found under %s; skipping its %d proposals",
                            description, file_name, image_dir, len(props))
            elif len(missing_images) == MISSING_IMAGES_LOGGED + 1:
                log.warning("%s: more images missing; not logging each one (count in the summary)",
                            description)
        else:
            try:
                image = Image.open(image_path).convert("RGB")
                crops = []
                for proposal in props:
                    crop = proposal_crop(image, proposal, region=region, mask_background=mask_background)
                    if crop is None:
                        log.debug("%s: annotation %d has an empty crop; skipped",
                                  file_name, proposal.proposal_index)
                        skipped.append(proposal.proposal_index)
                        continue
                    crops.append(crop)
                    ids.append(proposal.proposal_index)
                if crops:
                    chunks.append(encode_crops(crops, batch_size=batch_size))
            except Exception:
                log.exception("%s: failed on image %s (%d proposals)", description, file_name, len(props))
                raise
            log.debug("%s: %d crops encoded", file_name, len(crops))

        now = time.time()
        if now - last_log >= PROGRESS_EVERY_S or n == len(image_items):
            rate = n / max(now - loop_start, 1e-9)
            log.info("%s progress: %d/%d images (%.1f%%), %d/%d proposals, %.2f images/s, ETA %s",
                     description, n, len(image_items), 100.0 * n / len(image_items), proposals_seen,
                     total_proposals, rate, format_duration((len(image_items) - n) / rate))
            last_log = now

    embeddings = np.vstack(chunks).astype(np.float32) if chunks else np.zeros((0, 0), np.float32)
    return (
        embeddings,
        np.asarray(ids, dtype=np.int64),
        np.asarray(skipped, dtype=np.int64),
        missing_images,
    )


def package_version(name: str) -> str | None:
    try:
        return importlib_metadata.version(name)
    except importlib_metadata.PackageNotFoundError:
        return None


def load_encoder(model_name: str, args: argparse.Namespace) -> tuple[object, dict]:
    """Instantiate a ProtoRCD encoder; returns (model, provenance dict for ``meta``)."""
    if model_name != "bioclip":
        log.info("%s: model_size=%s image_size=%d repo=%s weights=%s", model_name, args.dinov3_model_size,
                 args.dinov3_image_size, args.dinov3_repo, args.dinov3_weights or "(ProtoRCD default path)")
        if args.dinov3_weights and "://" not in str(args.dinov3_weights) and not Path(args.dinov3_weights).exists():
            log.warning("DINOv3 weights %s do not exist (inside a container, is the folder bound?)",
                        args.dinov3_weights)
    if model_name == "bioclip":
        from embed.bioclip import BioCLIPEmbedder

        model = BioCLIPEmbedder(device=args.device, normalize=True)
        return model, {
            "bioclip_model": getattr(model.classifier, "model_str", None),
            "pybioclip_version": package_version("pybioclip"),
        }

    from embed.dinov3 import DINOv3PatchEmbedder

    model = DINOv3PatchEmbedder(
        model_size=args.dinov3_model_size,
        image_size=args.dinov3_image_size,
        device=args.device,
        repo_or_dir=args.dinov3_repo,
        weights=args.dinov3_weights,
        normalize=True,
        debiased=model_name == "dinov3_debiased",
        svd_components=args.svd_components,
    )
    return model, {
        "dinov3_model_size": args.dinov3_model_size,
        "dinov3_image_size": args.dinov3_image_size,
        "dinov3_weights": Path(model.weights).name if model.weights else None,
        "dinov3_pooling": "mean of last-layer patch features",
        "svd_components": args.svd_components if model_name == "dinov3_debiased" else None,
    }


def log_environment(device: str) -> None:
    try:
        import torch
    except ImportError:
        log.error("torch is not importable; is this the protorcd_embed image?")
        return
    if torch.cuda.is_available():
        log.info("torch %s, CUDA %s, %d GPU(s): %s", torch.__version__, torch.version.cuda,
                 torch.cuda.device_count(), torch.cuda.get_device_name(0))
    elif device.startswith("cuda"):
        log.warning("--device %s but torch %s sees no CUDA device; the encoders will fail or crawl "
                    "(under Apptainer, pass --nv)", device, torch.__version__)
    else:
        log.info("torch %s on %s", torch.__version__, device)


def run(args: argparse.Namespace) -> int:
    run_started = time.time()
    log.info("Embed stage: coco=%s image_dir=%s output_dir=%s models=%s region=%s batch_size=%d "
             "device=%s dtype=%s", args.coco, args.image_dir, args.output_dir, " ".join(args.models),
             args.region, args.batch_size, args.device, args.dtype)
    if not args.coco.is_file():
        log.error("COCO file %s does not exist (run the detect stage first)", args.coco)
        return 1
    if not args.image_dir.is_dir():
        log.error("Image directory %s does not exist or is not a directory", args.image_dir)
        return 1
    coco_sha = sha256_file(args.coco)
    coco = json.loads(args.coco.read_text())
    schema = coco.get("info", {}).get("schema")
    if schema is not None and not str(schema).startswith("protorcd.proposals.coco/"):
        log.warning("%s has schema %r, not a ProtoRCD proposals file", args.coco, schema)
    image_items = load_proposals_by_image(coco)
    num_annotations = len(coco["annotations"])
    log.info("%d proposals over %d images (of %d in the COCO file) from %s, sha256 %s",
             num_annotations, len(image_items), len(coco["images"]), args.coco, coco_sha[:12])
    if args.region == "mask":
        with_masks = sum(1 for ann in coco["annotations"] if ann.get("segmentation"))
        if with_masks < num_annotations:
            log.warning("--region mask, but %d of %d proposals have no mask (detect with --return_masks)",
                        num_annotations - with_masks, num_annotations)
    if num_annotations == 0:
        log.warning("The COCO file has no proposals; writing empty embedding files")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    log_environment(args.device)

    for model_name in args.models:
        out_path = args.output_dir / f"{model_name}_{args.region}.npz"
        if out_path.exists() and not args.overwrite:
            log.info("%s exists; skipping %s (use --overwrite to redo)", out_path, model_name)
            continue

        started = time.time()
        log.info("Loading %s encoder", model_name)
        try:
            model, provenance = load_encoder(model_name, args)
        except Exception:
            log.exception("Could not load the %s encoder", model_name)
            raise
        log.info("%s loaded in %.1fs", model_name, time.time() - started)
        embeddings, ids, skipped, missing = embed_proposals(
            image_items,
            args.image_dir,
            model.encode_crops,
            region=args.region,
            batch_size=args.batch_size,
            description=f"{model_name}/{args.region}",
        )
        meta = {
            "schema": SCHEMA,
            "source_commit": SOURCE_COMMIT,
            "model": model_name,
            "region": args.region,
            "embedding_dim": int(embeddings.shape[1]) if embeddings.size else 0,
            "dtype": args.dtype,
            "normalized": True,
            "coco_file": args.coco.name,
            "coco_sha256": coco_sha,
            "num_annotations": num_annotations,
            "num_embedded": int(ids.shape[0]),
            "num_skipped": int(skipped.shape[0]),
            "missing_images": missing[:100],
            "num_missing_images": len(missing),
            "torch_version": package_version("torch"),
            "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "elapsed_seconds": round(time.time() - started, 1),
            **provenance,
        }
        tmp_path = out_path.with_name(out_path.stem + ".tmp.npz")
        np.savez(
            tmp_path,
            embeddings=embeddings.astype(np.float16 if args.dtype == "float16" else np.float32),
            annotation_ids=ids,
            skipped_annotation_ids=skipped,
            meta=np.array(json.dumps(meta)),
        )
        tmp_path.replace(out_path)
        log.info("%s: %d embedded, %d skipped, dim=%d, in %s -> %s (%.1f MB)", model_name,
                 meta["num_embedded"], meta["num_skipped"], meta["embedding_dim"],
                 format_duration(meta["elapsed_seconds"]), out_path, out_path.stat().st_size / 1e6)
        if missing:
            log.warning("%s: %d images not found under %s (first: %s)", model_name, len(missing),
                        args.image_dir, ", ".join(missing[:3]))
        if num_annotations and meta["num_embedded"] == 0:
            log.error("%s embedded no proposals; triage will reject this file", model_name)

        del model
        gc.collect()
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:
            pass
    log.info("Embed stage finished in %s", format_duration(time.time() - run_started))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ProtoRCD proposal embeddings (stage 2)")
    parser.add_argument("--coco", type=Path, required=True, help="Stage-1 proposals COCO file")
    parser.add_argument("--image_dir", type=Path, required=True,
                        help="Image root the COCO file_names are relative to")
    parser.add_argument("--output_dir", type=Path, required=True)
    parser.add_argument("--models", nargs="+", choices=MODELS, default=["dinov3", "bioclip"],
                        help="Encoders to run, one output file each (default: dinov3 bioclip)")
    parser.add_argument("--region", choices=("box", "mask"), default="box",
                        help="Crop the box, or the box with pixels outside the mask blacked "
                             "out (needs stage 1 --return_masks). Default: box")
    parser.add_argument("--batch_size", type=int, default=16)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--dtype", choices=("float32", "float16"), default="float32",
                        help="Stored embedding dtype; float16 halves file size (default: float32)")
    parser.add_argument("--dinov3_model_size", choices=("small", "base", "large", "hugeplus"),
                        default="hugeplus")
    parser.add_argument("--dinov3_image_size", type=int, default=1024)
    parser.add_argument("--dinov3_repo", default=os.environ.get("PROTORCD_DINOV3_REPO",
                                                                "facebookresearch/dinov3"),
                        help="Local dinov3 checkout or GitHub repo for torch.hub")
    parser.add_argument("--dinov3_weights", default=os.environ.get("PROTORCD_DINOV3_WEIGHTS"),
                        help="DINOv3 checkpoint path or URL (default for hugeplus is the OSC path "
                             "hard-coded in ProtoRCD's dinov3.py)")
    parser.add_argument("--svd_components", type=int, default=500)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--log_level", default=os.environ.get("PROTORCD_LOG_LEVEL", "INFO"),
                        choices=("DEBUG", "INFO", "WARNING", "ERROR"), type=str.upper,
                        help="Log verbosity (default: INFO, or $PROTORCD_LOG_LEVEL)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    setup_logging(args.log_level)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
