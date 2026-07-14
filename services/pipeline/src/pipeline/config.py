"""Environment-driven settings.

Env contract (documented in README.md):

- ``DATABASE_URL``  — Postgres DSN for the job queue.
  Default targets the compose-exposed pgstac instance from the host.
- ``HEALTH_PORT``   — port for the /health HTTP server.
- ``QUEUE_SCHEMA``  — PostgreSQL schema owned by Procrastinate.
- ``LOG_LEVEL``     — root log level.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_DATABASE_URL = "postgresql://username:password@localhost:5433/postgis"
DEFAULT_HEALTH_PORT = 8083
DEFAULT_QUEUE_SCHEMA = "procrastinate"


@dataclass(frozen=True)
class Settings:
    database_url: str = DEFAULT_DATABASE_URL
    health_port: int = DEFAULT_HEALTH_PORT
    queue_schema: str = DEFAULT_QUEUE_SCHEMA
    log_level: str = "INFO"

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        return cls(
            database_url=env.get("DATABASE_URL", DEFAULT_DATABASE_URL),
            health_port=int(env.get("HEALTH_PORT", str(DEFAULT_HEALTH_PORT))),
            queue_schema=env.get("QUEUE_SCHEMA", DEFAULT_QUEUE_SCHEMA),
            log_level=env.get("LOG_LEVEL", "INFO").upper(),
        )
