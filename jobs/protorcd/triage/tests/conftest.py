"""Synthetic stage-1/stage-2 files shaped exactly like jobs/protorcd/{detect,embed} output."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

# triage_service.app builds a module-level app on import; keep it out of the repo.
os.environ.setdefault("TRIAGE_DATA_DIR", tempfile.mkdtemp(prefix="triage_import_"))

from triage_service.app import create_app  # noqa: E402
from triage_service.config import Settings  # noqa: E402

TAXONOMY = {1: "deer", 2: "fox", 3: "heron"}


def _npz(path: Path, model: str, emb: np.ndarray, ids: np.ndarray, coco_sha: str) -> None:
    meta = {"schema": "protorcd.embeddings/v1", "model": model, "region": "box",
            "embedding_dim": emb.shape[1], "dtype": "float32", "coco_sha256": coco_sha,
            "coco_file": "proposals.coco.json", "num_embedded": int(ids.size), "num_skipped": 0}
    np.savez(path, embeddings=emb.astype(np.float32), annotation_ids=ids.astype(np.int64),
             skipped_annotation_ids=np.zeros(0, np.int64), meta=np.array(json.dumps(meta)))


def make_dataset(root: Path, n_per_class: int = 120, n_images: int = 16, seed: int = 0) -> dict:
    """Four well-separated groups (background + 3 species) so triage auto-decides plenty."""
    rng = np.random.default_rng(seed)
    images_dir = root / "images"
    images_dir.mkdir(parents=True)
    images = []
    for i in range(n_images):
        rel = f"cam{i % 2}/img_{i:03d}.jpg"
        (images_dir / rel).parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rng.integers(0, 255, (120, 160, 3), dtype=np.uint8)).save(images_dir / rel)
        images.append({"id": i + 1, "file_name": rel, "width": 160, "height": 120})

    labels = np.repeat(np.arange(4), n_per_class)
    rng.shuffle(labels)
    anns = []
    for idx in range(labels.size):
        x, y = int(rng.integers(0, 120)), int(rng.integers(0, 80))
        anns.append({"id": idx + 1, "image_id": int(idx % n_images) + 1, "category_id": 1,
                     "bbox": [x, y, 30, 30], "area": 900.0, "iscrowd": 0,
                     "score": float(rng.uniform(0.4, 1.0))})
    coco = {"info": {"schema": "protorcd.proposals.coco/v1"}, "images": images,
            "annotations": anns, "categories": [{"id": 1, "name": "proposal"}]}
    coco_path = root / "proposals.coco.json"
    coco_path.write_text(json.dumps(coco))
    sha = hashlib.sha256(coco_path.read_bytes()).hexdigest()

    bg_centers = rng.normal(size=(4, 24))
    fg_centers = rng.normal(size=(4, 16)) * 3
    dino = bg_centers[labels] + 0.15 * rng.normal(size=(labels.size, 24))
    bioclip = fg_centers[labels] + 0.15 * rng.normal(size=(labels.size, 16))
    ids = np.arange(1, labels.size + 1)
    # Row order differs between files and one id is missing from BioCLIP:
    # the service must join on annotation id, not on row position.
    perm = rng.permutation(labels.size)
    _npz(root / "dinov3_box.npz", "dinov3", dino[perm], ids[perm], sha)
    keep = ids != 7
    _npz(root / "bioclip_box.npz", "bioclip", bioclip[keep], ids[keep], sha)
    gt = {int(a): int(lab) for a, lab in zip(ids, labels)}
    return {"root": root, "images_dir": images_dir, "coco": coco_path,
            "dinov3": root / "dinov3_box.npz", "bioclip": root / "bioclip_box.npz", "gt": gt}


@pytest.fixture
def data(tmp_path):
    return make_dataset(tmp_path / "data")


@pytest.fixture
def settings(tmp_path, data):
    return Settings(data_dir=tmp_path / "service", allowed_local_roots=[data["root"].resolve()],
                    api_token=None, cors_origins=[], s3_endpoint_url=None,
                    image_cache_mb=64, pool_cache_size=2)


@pytest.fixture
def make_client(settings):
    from fastapi.testclient import TestClient

    clients = []

    def _make(s: Settings | None = None):
        client = TestClient(create_app(s or settings))
        client.__enter__()
        clients.append(client)
        return client

    yield _make
    for c in clients:
        c.__exit__(None, None, None)
