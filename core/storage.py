"""
MinIO object storage client.

Usage:
    from core.storage import storage
    key = storage.upload("partners/42/docs/123_brief.pdf", data, "application/pdf")
    data = storage.download(key)
    storage.delete(key)

Environment variables (all have local-dev defaults):
    MINIO_ENDPOINT     — host:port, default "localhost:9000"
    MINIO_ACCESS_KEY   — default "platform"
    MINIO_SECRET_KEY   — default "platform_local"
    MINIO_BUCKET       — default "platform-documents"
    MINIO_SECURE       — "true" for HTTPS, default "false"
"""

import io
import os

from minio import Minio
from minio.error import S3Error

_ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "localhost:9000")
_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "platform")
_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "platform_local")
_BUCKET     = os.getenv("MINIO_BUCKET",     "platform-documents")
_SECURE     = os.getenv("MINIO_SECURE",     "false").lower() == "true"


class _StorageClient:
    """Lazy-initialised MinIO wrapper. Client and bucket are created on first use."""

    def __init__(self):
        self._client: Minio | None = None

    def _get(self) -> Minio:
        if self._client is None:
            self._client = Minio(_ENDPOINT, access_key=_ACCESS_KEY, secret_key=_SECRET_KEY, secure=_SECURE)
            if not self._client.bucket_exists(_BUCKET):
                self._client.make_bucket(_BUCKET)
        return self._client

    def upload(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        """Store bytes under the given key. Returns the key."""
        self._get().put_object(
            _BUCKET, key, io.BytesIO(data), length=len(data), content_type=content_type,
        )
        return key

    def download(self, key: str) -> bytes:
        """Fetch object bytes. Raises S3Error if the key does not exist."""
        resp = self._get().get_object(_BUCKET, key)
        try:
            return resp.read()
        finally:
            resp.close()
            resp.release_conn()

    def delete(self, key: str) -> None:
        """Delete an object. Silent no-op if the key does not exist."""
        try:
            self._get().remove_object(_BUCKET, key)
        except S3Error:
            pass

    @property
    def available(self) -> bool:
        """True if MinIO is reachable. Used for health checks and graceful fallback."""
        try:
            self._get()
            return True
        except Exception:
            return False


storage = _StorageClient()
