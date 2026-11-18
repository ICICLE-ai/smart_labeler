#!/usr/bin/env python3
"""Stage 1: run ProtoRCD's SAM3 text-prompt detector over an image folder -> COCO file.

    python jobs/protorcd/detect/run_detect.py --image_dir IMAGES --output out/proposals.coco.json

Uses ProtoRCD's ``SAM3Detector`` unchanged (``detector.py``, ``sahi_utils.py``,
``utils.py`` in this folder). What differs from ProtoRCD's own runner:

  * input is a plain image folder (searched recursively), not a COCO image list;
  * output is ONE COCO file with global annotation ids (``export_coco.py``), not one
    ``*_detections.json`` per image;
  * progress is checkpointed to ``<output>.partial.jsonl``; re-running the same command
    resumes, so a Tapis job that hits its wall time can simply be resubmitted.

The SAM3 checkpoint is downloaded from Hugging Face on first use (gated): set
``HF_TOKEN`` or point ``HF_HOME`` at a cache that already holds it.

Logs go to stderr with timestamps (``--log_level DEBUG`` for per-image detail). The tqdm
bar shows only on a terminal; batch jobs get a progress line every minute instead.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

from tqdm import tqdm

if __package__ in (None, ""):
    # invoked as a bare script: make the sibling `detect` package importable.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from detect.export_coco import build_coco, detections_to_records, format_duration, setup_logging, write_coco

log = logging.getLogger("protorcd.detect")

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
PROGRESS_EVERY_S = 60


def discover_images(image_dir: Path) -> list[dict]:
    """Recursively list images as ``{"file_name" (relative, posix), "width", "height"}``."""
    from PIL import Image

    log.info("Scanning %s for images (%s)", image_dir, ", ".join(sorted(IMAGE_EXTENSIONS)))
    started = time.time()
    images = []
    unreadable = ignored = 0
    for path in sorted(image_dir.rglob("*")):
        rel = path.relative_to(image_dir)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            if path.is_file():
                ignored += 1
            continue
        try:
            with Image.open(path) as im:
                width, height = im.size
        except OSError as exc:
            unreadable += 1
            log.warning("Skipping unreadable image %s: %s", rel, exc)
            continue
        images.append({"file_name": rel.as_posix(), "width": width, "height": height})
    log.info("Found %d images in %.1fs (%d unreadable skipped, %d non-image files ignored)",
             len(images), time.time() - started, unreadable, ignored)
    return images


def load_checkpoint(partial_path: Path) -> dict[str, list[dict]]:
    """Read finished images from the checkpoint, truncating a torn last line (killed job)
    so rows appended on resume stay readable."""
    done: dict[str, list[dict]] = {}
    if not partial_path.exists():
        log.info("No checkpoint at %s; starting from the first image", partial_path)
        return done
    good_bytes = 0
    with partial_path.open("rb") as f:
        for line in f:
            if not line.endswith(b"\n"):
                break
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                break
            done[row["file_name"]] = row["records"]
            good_bytes += len(line)
    size = partial_path.stat().st_size
    if good_bytes < size:
        log.warning("Checkpoint %s ends in a partial line (job killed mid-write); "
                    "dropping its last %d bytes", partial_path, size - good_bytes)
        os.truncate(partial_path, good_bytes)
    log.info("Resuming from checkpoint %s: %d images already done", partial_path, len(done))
    return done


def build_config(args: argparse.Namespace):
    from detect.utils import Config, load_config

    if args.config is not None:
        log.info("Loading detector config from %s", args.config)
    config = load_config(str(args.config)) if args.config is not None else Config()
    if args.use_sahi:
        config.use_sahi = True
    for name in ("confidence_threshold", "nms_iou_threshold", "batch_size", "crop_size",
                 "overlap_h", "overlap_w", "min_box_size", "max_box_size",
                 "containment_thresh", "area_ratio_thresh"):
        value = getattr(args, name)
        if value is not None:
            log.debug("Override %s=%s", name, value)
            setattr(config, name, value)
    if args.text_prompt:
        config.text_prompt = args.text_prompt[0] if len(args.text_prompt) == 1 else args.text_prompt
    if args.return_masks:
        config.return_masks = True
    if args.compile_model:
        config.compile_model = True
    return config


def log_environment() -> None:
    """GPU and Hugging Face settings: the two usual reasons a detect job fails or crawls."""
    try:
        import torch
    except ImportError:
        log.error("torch is not importable; is this the protorcd_detect image?")
        return
    if torch.cuda.is_available():
        log.info("torch %s, CUDA %s, %d GPU(s): %s", torch.__version__, torch.version.cuda,
                 torch.cuda.device_count(), torch.cuda.get_device_name(0))
    else:
        log.warning("torch %s sees no CUDA device; SAM3 will run on the CPU and be very slow "
                    "(under Apptainer, pass --nv)", torch.__version__)
    log.info("HF_HOME=%s, HF_TOKEN %s", os.environ.get("HF_HOME", "(default ~/.cache/huggingface)"),
             "set" if os.environ.get("HF_TOKEN") else "not set (fine only if the SAM3 checkpoint is cached)")


def run(args: argparse.Namespace) -> int:
    started = time.time()
    log.info("Detect stage: image_dir=%s output=%s score_threshold=%s use_sahi=%s",
             args.image_dir, args.output, args.score_threshold, args.use_sahi)
    if args.sam3_source_root is not None:
        log.info("Using SAM3 source from %s", args.sam3_source_root)
        sys.path.insert(0, str(Path(args.sam3_source_root).expanduser().resolve()))
    from detect.detector import SAM3Detector
    from detect.utils import load_image

    if not args.image_dir.is_dir():
        log.error("Image directory %s does not exist or is not a directory", args.image_dir)
        return 1
    images = discover_images(args.image_dir)
    if not images:
        log.error("No images found under %s", args.image_dir)
        return 1

    output = args.output
    partial_path = output.with_name(output.name + ".partial.jsonl")
    if args.overwrite and partial_path.exists():
        log.info("--overwrite: removing checkpoint %s", partial_path)
        partial_path.unlink()
    done = load_checkpoint(partial_path)
    stale = len(set(done) - {img["file_name"] for img in images})
    if stale:
        log.warning("%d checkpointed images are no longer in %s; they will not be exported",
                    stale, args.image_dir)
    pending = [img for img in images if img["file_name"] not in done]
    log.info("Images: %d total, %d already done, %d pending", len(images), len(done), len(pending))

    config = build_config(args)
    detector_info = {
        k: v for k, v in config.__dict__.items()
        if k not in ("coco_json", "images_dir", "output_base", "vis_save_every_n", "max_proposals")
    }
    log.info("Detector config: %s", json.dumps(detector_info, default=str, sort_keys=True))
    if pending:
        log_environment()
        loading = time.time()
        log.info("Loading SAM3 (first run downloads the checkpoint from Hugging Face)")
        detector = SAM3Detector(config)
        log.info("SAM3 loaded on %s in %.1fs", getattr(detector, "device", "?"), time.time() - loading)
        output.parent.mkdir(parents=True, exist_ok=True)
        # SAHI runs one image at a time (the detector batches crops internally);
        # full-image mode batches whole images.
        step = 1 if config.use_sahi else config.batch_size
        log.info("Running SAM3 over %d images, %d per batch", len(pending), step)
        loop_start = last_log = time.time()
        images_done = raw_detections = 0
        with partial_path.open("a") as ckpt:
            for start in tqdm(range(0, len(pending), step), desc="SAM3", unit="batch", disable=None):
                batch = pending[start : start + step]
                names = [img["file_name"] for img in batch]
                try:
                    arrays = [load_image(str(args.image_dir / name)) for name in names]
                    if config.use_sahi:
                        results = [detector.detect(arrays[0])]
                    else:
                        results = detector.detect_batch(arrays)
                except Exception:
                    log.exception("SAM3 failed on %s; %d images finished so far are checkpointed, "
                                  "re-run the same command to resume", names, len(done))
                    raise
                for img, det in zip(batch, results):
                    records = detections_to_records(det)
                    done[img["file_name"]] = records
                    raw_detections += len(records)
                    log.debug("%s: %d detections", img["file_name"], len(records))
                    ckpt.write(json.dumps({"file_name": img["file_name"], "records": records}) + "\n")
                ckpt.flush()

                images_done += len(batch)
                now = time.time()
                if now - last_log >= PROGRESS_EVERY_S or images_done == len(pending):
                    rate = images_done / max(now - loop_start, 1e-9)
                    log.info("Progress: %d/%d images (%.1f%%), %.2f images/s, ETA %s, "
                             "%d raw detections so far",
                             images_done, len(pending), 100.0 * images_done / len(pending), rate,
                             format_duration((len(pending) - images_done) / rate), raw_detections)
                    last_log = now
        log.info("SAM3 done: %d images in %s", images_done, format_duration(time.time() - loop_start))
    else:
        log.info("Every image is already in the checkpoint; skipping SAM3")

    info = {
        "stage": "detect",
        "image_dir": str(args.image_dir),
        "detector": detector_info,
    }
    coco = build_coco(images, done, args.score_threshold, info=info)
    write_coco(coco, output)
    if args.keep_partial:
        log.info("Keeping checkpoint %s (--keep_partial)", partial_path)
    else:
        partial_path.unlink(missing_ok=True)
    log.info("Detect stage finished in %s -> %s", format_duration(time.time() - started), output)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ProtoRCD SAM3 proposals -> COCO (stage 1)")
    parser.add_argument("--image_dir", type=Path, required=True,
                        help="Image root, searched recursively; COCO file_names are relative to it")
    parser.add_argument("--output", type=Path, required=True, help="Output COCO JSON path")
    parser.add_argument("--score_threshold", type=float, default=0.4,
                        help="Proposals below this score are not exported (default: 0.4, "
                             "ProtoRCD's feature-stage default)")
    parser.add_argument("--config", type=Path, default=None,
                        help="Optional ProtoRCD SAM3 YAML config; flags below override it")
    parser.add_argument("--sam3_source_root", type=Path,
                        default=os.environ.get("PROTORCD_SAM3_SOURCE_ROOT"),
                        help="Source checkout containing the `sam3` package, if not pip-installed")
    parser.add_argument("--text_prompt", action="append", default=None,
                        help="SAM3 text prompt (default: `visual`, broad objectness). Repeatable.")
    parser.add_argument("--use_sahi", action="store_true", help="Enable SAHI slicing for large images")
    parser.add_argument("--confidence_threshold", type=float,
                        help="Detector confidence floor (ProtoRCD default: 0.2)")
    parser.add_argument("--nms_iou_threshold", type=float)
    parser.add_argument("--batch_size", type=int)
    parser.add_argument("--crop_size", type=int)
    parser.add_argument("--overlap_h", type=float)
    parser.add_argument("--overlap_w", type=float)
    parser.add_argument("--min_box_size", type=int)
    parser.add_argument("--max_box_size", type=int)
    parser.add_argument("--containment_thresh", type=float)
    parser.add_argument("--area_ratio_thresh", type=float)
    parser.add_argument("--return_masks", action="store_true", help="Also export RLE masks")
    parser.add_argument("--compile_model", action="store_true")
    parser.add_argument("--overwrite", action="store_true", help="Ignore an existing checkpoint")
    parser.add_argument("--keep_partial", action="store_true",
                        help="Keep the checkpoint file after the COCO file is written")
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
