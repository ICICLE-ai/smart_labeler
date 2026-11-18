"""Service settings, read from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _split(value: str | None, sep: str) -> list[str]:
    return [v.strip() for v in (value or "").split(sep) if v.strip()]


@dataclass
class Settings:
    # Root for datasets/, sessions/ (journals) and image_cache/. Mount a PVC here on NRP.
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("TRIAGE_DATA_DIR", "./triage_data")))
    # Directories a dataset may reference in place (colon-separated). Empty disables
    # local-path registration, so a client can never make the server read arbitrary files.
    allowed_local_roots: list[Path] = field(
        default_factory=lambda: [Path(p).resolve() for p in _split(os.environ.get("TRIAGE_ALLOWED_LOCAL_ROOTS"), ":")]
    )
    # Optional shared bearer token. When set, every HTTP call and WebSocket must present it.
    api_token: str | None = field(default_factory=lambda: os.environ.get("TRIAGE_API_TOKEN") or None)
    cors_origins: list[str] = field(default_factory=lambda: _split(os.environ.get("TRIAGE_CORS_ORIGINS"), ","))
    # S3-compatible object store (e.g. NRP Ceph). Credentials come from the standard
    # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY variables.
    s3_endpoint_url: str | None = field(default_factory=lambda: os.environ.get("S3_ENDPOINT_URL") or None)
    image_cache_mb: int = field(default_factory=lambda: int(os.environ.get("TRIAGE_IMAGE_CACHE_MB", "2048")))
    # Loaded pools kept in memory (each is ~N x (D_dino + D_bioclip) x 4 bytes).
    pool_cache_size: int = field(default_factory=lambda: int(os.environ.get("TRIAGE_POOL_CACHE_SIZE", "2")))
    # DEBUG adds every WebSocket message and cache hit; INFO is one line per event.
    log_level: str = field(default_factory=lambda: os.environ.get("TRIAGE_LOG_LEVEL", "INFO").upper())

    @property
    def datasets_dir(self) -> Path:
        return self.data_dir / "datasets"

    @property
    def sessions_dir(self) -> Path:
        return self.data_dir / "sessions"

    @property
    def image_cache_dir(self) -> Path:
        return self.data_dir / "image_cache"

    def ensure_dirs(self) -> None:
        for d in (self.datasets_dir, self.sessions_dir, self.image_cache_dir):
            d.mkdir(parents=True, exist_ok=True)
