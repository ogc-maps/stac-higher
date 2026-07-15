"""FTPS adapter — FTP over TLS via aioftp.

Two TLS modes (``config.implicit``):

- **implicit** (``implicit: true``): the control channel is TLS from the first
  byte — the client connects with a TLS context in place.
- **explicit** (default): connect in plaintext, then ``AUTH TLS`` upgrades the
  control channel before login (aioftp's ``upgrade_to_tls``).
"""

from __future__ import annotations

import ssl
from typing import Any

import aioftp

from pipeline.connections.adapters.ftp import FtpAdapter


class FtpsAdapter(FtpAdapter):
    protocol = "ftps"
    default_port = 21

    def __init__(
        self,
        config: dict[str, Any],
        credentials: dict[str, Any],
        allow_hosts: frozenset[str] = frozenset(),
    ) -> None:
        super().__init__(config, credentials, allow_hosts)
        self._implicit = bool(config.get("implicit", False))
        self._ssl_context = ssl.create_default_context()

    def _make_client(self) -> aioftp.Client:
        # implicit mode wraps the socket in TLS immediately; explicit mode
        # connects plaintext and upgrades in _authenticate().
        ssl_arg: ssl.SSLContext | None = self._ssl_context if self._implicit else None
        return aioftp.Client(
            socket_timeout=15,
            connection_timeout=15,
            ssl=ssl_arg,
        )

    async def _authenticate(self, client: aioftp.Client) -> None:
        if not self._implicit:
            # AUTH TLS on the already-open plaintext control channel.
            await client.upgrade_to_tls(sslcontext=self._ssl_context)
        await client.login(
            user=self._creds.get("username", "anonymous"),
            password=self._creds.get("password", ""),
        )
