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
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from tqdm import tqdm

if __package__ in (None, ""):
    # invoked as a bare script: make the sibling `detect` package importable.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from detect.export_coco import build_coco, detections_to_records, write_coco

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}


def discover_images(image_dir: Path) -> list[dict]:
    """Recursively list images as ``{"file_name" (relative, posix), "width", "height"}``."""
    from PIL import Image

    images = []
    for path in sorted(image_dir.rglob("*")):
        rel = path.relative_to(image_dir)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        try:
            with Image.open(path) as im:
                width, height = im.size
        except OSError:
            print(f"Skipping unreadable image: {rel}")
            continue
        images.append({"file_name": rel.as_posix(), "width": width, "height": height})
    return images


def load_checkpoint(partial_path: Path) -> dict[str, list[dict]]:
    """Read finished images from the checkpoint, truncating a torn last line (killed job)
    so rows appended on resume stay readable."""
    done: dict[str, list[dict]] = {}
    if not partial_path.exists():
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
    if good_bytes < partial_path.stat().st_size:
        os.truncate(partial_path, good_bytes)
    return done


def build_config(args: argparse.Namespace):
    from detect.utils import Config, load_config

    config = load_config(str(args.config)) if args.config is not None else Config()
    if args.use_sahi:
        config.use_sahi = True
    for name in ("confidence_threshold", "nms_iou_threshold", "batch_size", "crop_size",
                 "overlap_h", "overlap_w", "min_box_size", "max_box_size",
                 "containment_thresh", "area_ratio_thresh"):
        value = getattr(args, name)
        if value is not None:
            setattr(config, name, value)
    if args.text_prompt:
        config.text_prompt = args.text_prompt[0] if len(args.text_prompt) == 1 else args.text_prompt
    if args.return_masks:
        config.return_masks = True
    if args.compile_model:
        config.compile_model = True
    return config


def run(args: argparse.Namespace) -> int:
    if args.sam3_source_root is not None:
        sys.path.insert(0, str(Path(args.sam3_source_root).expanduser().resolve()))
    from detect.detector import SAM3Detector
    from detect.utils import load_image

    images = discover_images(args.image_dir)
    if not images:
        print(f"No images found under {args.image_dir}")
        return 1

    output = args.output
    partial_path = output.with_name(output.name + ".partial.jsonl")
    if args.overwrite and partial_path.exists():
        partial_path.unlink()
    done = load_checkpoint(partial_path)
    pending = [img for img in images if img["file_name"] not in done]
    print(f"Images: {len(images)} total, {len(done)} already done, {len(pending)} pending")

    config = build_config(args)
    if pending:
        detector = SAM3Detector(config)
        output.parent.mkdir(parents=True, exist_ok=True)
        # SAHI runs one image at a time (the detector batches crops internally);
        # full-image mode batches whole images.
        step = 1 if config.use_sahi else config.batch_size
        with partial_path.open("a") as ckpt:
            for start in tqdm(range(0, len(pending), step), desc="SAM3", unit="batch"):
                batch = pending[start : start + step]
                arrays = [load_image(str(args.image_dir / img["file_name"])) for img in batch]
                if config.use_sahi:
                    results = [detector.detect(arrays[0])]
                else:
                    results = detector.detect_batch(arrays)
                for img, det in zip(batch, results):
                    records = detections_to_records(det)
                    done[img["file_name"]] = records
                    ckpt.write(json.dumps({"file_name": img["file_name"], "records": records}) + "\n")
                ckpt.flush()

    info = {
        "stage": "detect",
        "image_dir": str(args.image_dir),
        "detector": {
            k: v for k, v in config.__dict__.items()
            if k not in ("coco_json", "images_dir", "output_base", "vis_save_every_n", "max_proposals")
        },
    }
    coco = build_coco(images, done, args.score_threshold, info=info)
    write_coco(coco, output)
    if not args.keep_partial:
        partial_path.unlink(missing_ok=True)
    print(f"{coco['info']['num_proposals']} proposals over {len(images)} images -> {output}")
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
    return parser


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
