"""StorageAdapter ABC and the shared TestResult shape.

Every protocol adapter opens outbound connections only after passing its config
host through the egress policy. ``test()`` returns a JSON-serializable dict that
the drain/health-sweep jobs persist into ``connection_checks.result`` and the
parent connection's health columns.
"""

from __future__ import annotations

import abc
from typing import TypedDict


class TestResult(TypedDict, total=False):
    ok: bool
    message: str
    #: SSH-family only: the observed server host key (stable string form). The
    #: app never sees this — it is consumed by TOFU and surfaced only as a
    #: fingerprint on the connection resource.
    host_key: str
    latency_ms: int


class StorageAdapter(abc.ABC):
    """Uniform async surface over S3/SFTP/FTP/FTPS endpoints."""

    #: protocol identifier this adapter serves ("s3", "sftp", ...)
    protocol: str

    @abc.abstractmethod
    async def test(self) -> TestResult:
        """Probe connectivity + auth. Never raises for an expected failure —
        returns ``{ok: False, message}``; only truly unexpected bugs propagate.
        """

    @abc.abstractmethod
    async def list(self, prefix: str = "") -> list[str]:
        """List object/entry names under ``prefix`` (relative to root)."""

    @abc.abstractmethod
    async def get(self, path: str) -> bytes:
        """Fetch the bytes at ``path``."""

    @abc.abstractmethod
    async def put(self, path: str, data: bytes) -> None:
        """Write ``data`` to ``path``."""

    @abc.abstractmethod
    async def delete(self, path: str) -> None:
        """Delete the object/entry at ``path``."""
