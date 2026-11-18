"""Assemble SAM3 detections into the stage-1 output: one COCO file of proposals.

This is the contract the embed stage and the triage server read (see
``jobs/protorcd/README.md``). Every annotation gets a globally unique, stable integer
``id``; the embed stage keys its embeddings by that id, so the two stages never depend
on file or row order.

Also usable as a CLI to convert an existing ProtoRCD detections directory
(``<stem>_detections.json`` per image, as written by ProtoRCD's own
``run_sam3_text_detection --batch``) into the same COCO file:

    python -m detect.export_coco --detections_dir DIR --images_dir IMAGES --output proposals.coco.json
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any, Iterable

import numpy as np

SCHEMA = "protorcd.proposals.coco/v1"
SOURCE_COMMIT = "accd349"
PROPOSAL_CATEGORY = {"id": 1, "name": "proposal", "supercategory": "object"}


def encode_mask(mask: Any) -> dict:
    """RLE-encode one boolean mask (COCO compressed RLE with str counts)."""
    from pycocotools import mask as mask_util

    arr = np.asarray(mask)
    # The SAHI two-pass mask head returns logits; threshold at 0 (== sigmoid 0.5),
    # matching the full-image path, which already thresholds to bool.
    binary = arr > 0 if arr.dtype.kind == "f" else arr.astype(bool)
    rle = mask_util.encode(np.asfortranarray(binary.astype(np.uint8)))
    rle["counts"] = rle["counts"].decode("utf-8")
    return rle


def detections_to_records(detections: dict) -> list[dict]:
    """Convert a ``SAM3Detector`` result dict into JSON-safe per-proposal records.

    Boxes are rounded exactly like ProtoRCD's ``save_detection_json`` (int x, y, w, h),
    so crops -- and therefore embeddings -- match the upstream pipeline.
    """
    masks = detections.get("masks")
    label_names = detections.get("label_names")
    records = []
    for i, ((x1, y1, x2, y2), score) in enumerate(zip(detections["boxes"], detections["scores"])):
        rec = {
            "bbox": [int(x1), int(y1), int(x2 - x1), int(y2 - y1)],
            "score": float(score),
        }
        if label_names is not None and i < len(label_names):
            rec["prompt"] = str(label_names[i])
        if masks is not None and i < len(masks) and not isinstance(masks[i], dict):
            rec["segmentation"] = encode_mask(masks[i])
        records.append(rec)
    return records


def build_coco(
    images: Iterable[dict],
    records_by_file: dict[str, list[dict]],
    score_threshold: float,
    info: dict | None = None,
) -> dict:
    """Build the stage-1 COCO dict.

    ``images`` are ``{"file_name", "width", "height"}`` dicts; image ids are assigned
    1..N in ``file_name`` order and annotation ids 1..M in (image, detector) order.
    Proposals with ``score < score_threshold`` are dropped here, once, so the COCO file
    is exactly the pool the embed stage embeds and triage reviews.
    """
    coco_images = []
    annotations = []
    dropped = 0
    for image_id, img in enumerate(sorted(images, key=lambda r: r["file_name"]), start=1):
        coco_images.append({
            "id": image_id,
            "file_name": img["file_name"],
            "width": int(img["width"]),
            "height": int(img["height"]),
        })
        for rec in records_by_file.get(img["file_name"], []):
            if rec["score"] < score_threshold:
                dropped += 1
                continue
            x, y, w, h = rec["bbox"]
            if w <= 0 or h <= 0:
                dropped += 1
                continue
            ann = {
                "id": len(annotations) + 1,
                "image_id": image_id,
                "category_id": PROPOSAL_CATEGORY["id"],
                "bbox": [x, y, w, h],
                "area": float(w * h),
                "iscrowd": 0,
                "score": rec["score"],
            }
            for key in ("segmentation", "prompt"):
                if key in rec:
                    ann[key] = rec[key]
            annotations.append(ann)

    return {
        "info": {
            "schema": SCHEMA,
            "source_commit": SOURCE_COMMIT,
            "date_created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "score_threshold": float(score_threshold),
            "num_images": len(coco_images),
            "num_proposals": len(annotations),
            "num_dropped": dropped,
            **(info or {}),
        },
        "images": coco_images,
        "annotations": annotations,
        "categories": [PROPOSAL_CATEGORY],
    }


def write_coco(coco: dict, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(output.suffix + ".tmp")
    with tmp.open("w") as f:
        json.dump(coco, f)
    tmp.replace(output)


def records_from_detections_dir(detections_dir: Path, images_dir: Path) -> tuple[list[dict], dict]:
    """Read ProtoRCD ``*_detections.json`` files (one per image) into images + records."""
    from PIL import Image

    images = []
    records_by_file: dict[str, list[dict]] = {}
    for det_path in sorted(detections_dir.rglob("*_detections.json")):
        if det_path.stat().st_size == 0:
            continue
        det = json.loads(det_path.read_text())
        file_name = det.get("file_name")
        if file_name is None:
            rel = det_path.relative_to(detections_dir)
            file_name = str(rel.parent / f"{rel.stem[: -len('_detections')]}.jpg")
        width, height = det.get("image_width"), det.get("image_height")
        if not width or not height:
            with Image.open(images_dir / file_name) as im:
                width, height = im.size
        images.append({"file_name": file_name, "width": width, "height": height})
        records_by_file[file_name] = [
            {k: v for k, v in ann.items() if k in ("bbox", "score", "segmentation")}
            for ann in det.get("annotations", [])
        ]
    return images, records_by_file


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convert a ProtoRCD SAM3 detections directory into a stage-1 COCO file"
    )
    parser.add_argument("--detections_dir", type=Path, required=True)
    parser.add_argument("--images_dir", type=Path, required=True,
                        help="Image root; only read when a detections file lacks image size")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--score_threshold", type=float, default=0.4,
                        help="Drop proposals below this score (default: 0.4, ProtoRCD's feature-stage default)")
    args = parser.parse_args(argv)

    images, records = records_from_detections_dir(args.detections_dir, args.images_dir)
    coco = build_coco(images, records, args.score_threshold,
                      info={"converted_from": str(args.detections_dir)})
    write_coco(coco, args.output)
    print(f"{coco['info']['num_proposals']} proposals over {len(images)} images -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
