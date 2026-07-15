"""FTP adapter — aioftp driven (plaintext control + data channels).

FTPS extends this in ``ftps.py``. ``root_path`` scopes every path; the egress
policy vets the host before any socket opens.
"""

from __future__ import annotations

import posixpath
import time
from typing import Any

import aioftp

from pipeline.connections.adapters.base import StorageAdapter, TestResult
from pipeline.connections.egress import EgressBlocked, enforce


class FtpAdapter(StorageAdapter):
    protocol = "ftp"
    default_port = 21

    def __init__(
        self,
        config: dict[str, Any],
        credentials: dict[str, Any],
        allow_hosts: frozenset[str] = frozenset(),
    ) -> None:
        self._host = config["host"]
        self._port = int(config.get("port", self.default_port))
        self._root = config.get("root_path", "/") or "/"
        self._creds = credentials
        self._allow_hosts = allow_hosts

    def _resolve(self, path: str) -> str:
        return posixpath.normpath(posixpath.join(self._root, path.lstrip("/")))

    def _make_client(self) -> aioftp.Client:
        """Plain client. FTPS overrides to supply a TLS context / upgrade."""
        return aioftp.Client(socket_timeout=15, connection_timeout=15)

    async def _open(self) -> aioftp.Client:
        """Egress-check, connect, and log in; caller must ``quit()``/``close()``."""
        enforce(self._host, self._allow_hosts)
        client = self._make_client()
        await client.connect(self._host, self._port)
        await self._authenticate(client)
        return client

    async def _authenticate(self, client: aioftp.Client) -> None:
        await client.login(
            user=self._creds.get("username", "anonymous"),
            password=self._creds.get("password", ""),
        )

    async def test(self) -> TestResult:
        started = time.monotonic()
        try:
            enforce(self._host, self._allow_hosts)
        except EgressBlocked as exc:
            return {"ok": False, "message": str(exc)}
        client = self._make_client()
        try:
            await client.connect(self._host, self._port)
            await self._authenticate(client)
            # prove the root is listable (reachability + auth + path).
            await client.list(self._root)
        except (OSError, aioftp.AIOFTPException) as exc:
            return {"ok": False, "message": f"{self.protocol.upper()} test failed: {exc}"}
        finally:
            await _safe_quit(client)
        latency_ms = int((time.monotonic() - started) * 1000)
        return {
            "ok": True,
            "message": f"{self.protocol} endpoint reachable",
            "latency_ms": latency_ms,
        }

    async def list(self, prefix: str = "") -> list[str]:
        client = await self._open()
        try:
            target = self._resolve(prefix)
            return [str(path) for path, _info in await client.list(target)]
        finally:
            await _safe_quit(client)

    async def get(self, path: str) -> bytes:
        client = await self._open()
        try:
            async with client.download_stream(self._resolve(path)) as stream:
                return await stream.read()
        finally:
            await _safe_quit(client)

    async def put(self, path: str, data: bytes) -> None:
        client = await self._open()
        try:
            async with client.upload_stream(self._resolve(path)) as stream:
                await stream.write(data)
        finally:
            await _safe_quit(client)

    async def delete(self, path: str) -> None:
        client = await self._open()
        try:
            await client.remove_file(self._resolve(path))
        finally:
            await _safe_quit(client)


async def _safe_quit(client: aioftp.Client) -> None:
    """Best-effort graceful close; never raise from cleanup."""
    try:
        await client.quit()
    except (OSError, aioftp.AIOFTPException):
        client.close()
