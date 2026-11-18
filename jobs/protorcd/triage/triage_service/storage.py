"""Where dataset files and images come from: S3-compatible storage or allowed local paths."""
from __future__ import annotations

import threading
import uuid
from collections import OrderedDict
from pathlib import Path, PurePosixPath

from .config import Settings


class StorageError(ValueError):
    """A URI that cannot be used (bad form, outside allowed roots, missing)."""


def is_s3(uri: str) -> bool:
    return uri.startswith("s3://")


def split_s3(uri: str) -> tuple[str, str]:
    bucket, _, key = uri[len("s3://"):].partition("/")
    if not bucket:
        raise StorageError(f"malformed S3 URI: {uri!r}")
    return bucket, key


def safe_relative(file_name: str) -> PurePosixPath:
    """A COCO file_name as a relative path that cannot escape its root."""
    p = PurePosixPath(file_name)
    if p.is_absolute() or ".." in p.parts or not p.parts:
        raise StorageError(f"unsafe image file_name: {file_name!r}")
    return p


class Storage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._s3 = None
        self._s3_lock = threading.Lock()

    def s3(self):
        with self._s3_lock:
            if self._s3 is None:
                try:
                    import boto3
                except ImportError as exc:  # pragma: no cover - boto3 is in requirements
                    raise StorageError("S3 URIs need boto3 installed") from exc
                self._s3 = boto3.client("s3", endpoint_url=self.settings.s3_endpoint_url)
            return self._s3

    def local_path(self, path: str, *, want_dir: bool = False) -> Path:
        """Resolve a local path, which must lie under TRIAGE_ALLOWED_LOCAL_ROOTS."""
        roots = self.settings.allowed_local_roots
        if not roots:
            raise StorageError("local paths are disabled (TRIAGE_ALLOWED_LOCAL_ROOTS is unset)")
        resolved = Path(path).expanduser().resolve()
        if not any(resolved == r or r in resolved.parents for r in roots):
            raise StorageError(f"{path!r} is outside the allowed local roots")
        if want_dir and not resolved.is_dir():
            raise StorageError(f"not a directory: {path!r}")
        if not want_dir and not resolved.is_file():
            raise StorageError(f"not a file: {path!r}")
        return resolved

    def materialize(self, uri: str, dest: Path) -> Path:
        """Return a local path for ``uri``: S3 objects are downloaded to ``dest``; allowed
        local files are used in place."""
        if is_s3(uri):
            bucket, key = split_s3(uri)
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(dest.name + ".part")
            try:
                self.s3().download_file(bucket, key, str(tmp))
            except Exception as exc:
                tmp.unlink(missing_ok=True)
                raise StorageError(f"could not download {uri}: {type(exc).__name__}") from exc
            tmp.replace(dest)
            return dest
        return self.local_path(uri)

    def check_image_root(self, image_root: str) -> str:
        """Validate an image root and return its canonical form."""
        if is_s3(image_root):
            split_s3(image_root)
            return image_root.rstrip("/") + "/"
        return str(self.local_path(image_root, want_dir=True))


class S3ImageCache:
    """Downloads source images from S3 on demand into a size-capped local LRU cache, so
    ProtoRCD's ``CropService`` can cut crops from a plain local directory."""

    def __init__(self, storage: Storage, cache_dir: Path, max_bytes: int) -> None:
        self.storage = storage
        self.cache_dir = cache_dir
        self.max_bytes = max_bytes
        self._lock = threading.Lock()
        self._entries: OrderedDict[Path, int] = OrderedDict()
        self._total = 0

    def ensure(self, dataset_id: str, image_root: str, file_name: str) -> Path:
        """Make ``file_name`` present under ``cache_dir/dataset_id`` and return that root."""
        rel = safe_relative(file_name)
        root = self.cache_dir / dataset_id
        path = root / rel
        with self._lock:
            if path in self._entries:
                self._entries.move_to_end(path)
                return root
        if not path.exists():
            bucket, prefix = split_s3(image_root)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.part")
            try:
                self.storage.s3().download_file(bucket, f"{prefix}{rel.as_posix()}", str(tmp))
            except Exception as exc:
                tmp.unlink(missing_ok=True)
                raise FileNotFoundError(f"image not available: {file_name}") from exc
            tmp.replace(path)
        with self._lock:
            size = path.stat().st_size
            self._total += size - self._entries.get(path, 0)
            self._entries[path] = size
            self._entries.move_to_end(path)
            while self._total > self.max_bytes and len(self._entries) > 1:
                old, old_size = self._entries.popitem(last=False)
                old.unlink(missing_ok=True)
                self._total -= old_size
        return root
