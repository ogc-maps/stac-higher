"""Periodic health sweep of all enabled connections (ADR 0004).

Every ~5 minutes, test each enabled connection and update its health columns
(status, last_checked_at, last_error) plus the TOFU host-key pin on a first
successful SSH-family test. No ``connection_checks`` rows are involved — this is
background monitoring, not a user-requested test. ``connections.updated_at`` is
never touched.
"""

from __future__ import annotations

import logging

from pipeline.config import Settings
from pipeline.connections.envelope import CredentialKeyError, load_master_key
from pipeline.connections.probe import probe_connection
from pipeline.connections.repo import ConnectionsRepo, PgConnectionsRepo
from pipeline.queue.interface import QueueBackend

logger = logging.getLogger(__name__)

JOB_NAME = "pipeline.connection_health_sweep"
CRON = "*/5 * * * *"


async def sweep_tick(
    repo: ConnectionsRepo,
    master_key: bytes,
    allow_hosts: frozenset[str],
) -> int:
    """Test every enabled connection and update its health. Returns the count
    swept.
    """
    connections = await repo.list_enabled_connections()
    for connection in connections:
        outcome = await probe_connection(connection, master_key, allow_hosts)
        await repo.update_connection_health(
            connection.id,
            status=outcome.connection_status,
            last_error=outcome.last_error,
            host_key_to_pin=outcome.host_key_to_pin,
        )
        logger.info(
            "connection health checked",
            extra={
                "connection_id": connection.id,
                "protocol": connection.protocol,
                "ok": outcome.ok,
            },
        )
    return len(connections)


def register(queue: QueueBackend, settings: Settings) -> None:
    async def sweep(timestamp: int) -> None:
        try:
            master_key = load_master_key(
                {"CREDENTIALS_MASTER_KEY": settings.credentials_master_key}
            )
        except CredentialKeyError as exc:
            logger.error("connection health sweep skipped: %s", exc, extra={"job": JOB_NAME})
            return
        repo = PgConnectionsRepo(settings.database_url)
        count = await sweep_tick(repo, master_key, settings.egress_allow_hosts)
        logger.info(
            "connection health sweep done",
            extra={"swept": count, "scheduled_timestamp": timestamp},
        )

    queue.register_periodic(sweep, name=JOB_NAME, cron=CRON)
