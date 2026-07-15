"""Environment-driven settings.

Env contract (documented in README.md):

- ``DATABASE_URL``  — Postgres DSN for the job queue.
  Default targets the compose-exposed pgstac instance from the host.
- ``HEALTH_PORT``   — port for the /health HTTP server.
- ``QUEUE_SCHEMA``  — PostgreSQL schema owned by Procrastinate.
- ``LOG_LEVEL``     — root log level.
- ``CREDENTIALS_MASTER_KEY`` — base64-encoded 32-byte AES-256-GCM key, shared
  with the app. Only the connection drain/health-sweep jobs need it; absence is
  tolerated at startup (those ticks fail loudly instead of killing the process).
- ``EGRESS_ALLOW_HOSTS`` — comma-separated allowlist of hostnames the egress
  policy permits even when they resolve to private/loopback addresses (e.g. the
  compose-internal test servers). Matched case-insensitively.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_DATABASE_URL = "postgresql://username:password@localhost:5433/postgis"
DEFAULT_HEALTH_PORT = 8083
DEFAULT_QUEUE_SCHEMA = "procrastinate"


def _parse_allow_hosts(raw: str | None) -> frozenset[str]:
    """Split a comma-separated host list into a lowercased set (empties dropped)."""
    if not raw:
        return frozenset()
    return frozenset(h.strip().lower() for h in raw.split(",") if h.strip())


@dataclass(frozen=True)
class Settings:
    database_url: str = DEFAULT_DATABASE_URL
    health_port: int = DEFAULT_HEALTH_PORT
    queue_schema: str = DEFAULT_QUEUE_SCHEMA
    log_level: str = "INFO"
    #: None when unset — the drain/sweep jobs raise a clear error on their tick.
    credentials_master_key: str | None = None
    egress_allow_hosts: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        return cls(
            database_url=env.get("DATABASE_URL", DEFAULT_DATABASE_URL),
            health_port=int(env.get("HEALTH_PORT", str(DEFAULT_HEALTH_PORT))),
            queue_schema=env.get("QUEUE_SCHEMA", DEFAULT_QUEUE_SCHEMA),
            log_level=env.get("LOG_LEVEL", "INFO").upper(),
            credentials_master_key=env.get("CREDENTIALS_MASTER_KEY") or None,
            egress_allow_hosts=_parse_allow_hosts(env.get("EGRESS_ALLOW_HOSTS")),
        )
