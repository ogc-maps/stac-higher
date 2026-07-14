"""No-op scheduled heartbeat: proves the periodic-job path end to end.

Runs every minute, logs a structured line, and updates in-process state that
the /health endpoint reports (worker and health server share one process in
Phase 0).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from pipeline.queue.interface import QueueBackend

logger = logging.getLogger(__name__)

JOB_NAME = "pipeline.heartbeat"
CRON = "* * * * *"


@dataclass
class HeartbeatState:
    count: int = 0
    last_timestamp: int | None = None
    last_run_at: str | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "count": self.count,
            "last_timestamp": self.last_timestamp,
            "last_run_at": self.last_run_at,
        }


#: process-wide state read by the health endpoint
STATE = HeartbeatState()


def register(queue: QueueBackend, state: HeartbeatState = STATE) -> None:
    async def heartbeat(timestamp: int) -> None:
        state.count += 1
        state.last_timestamp = timestamp
        state.last_run_at = datetime.now(tz=UTC).isoformat()
        logger.info(
            "heartbeat",
            extra={"heartbeat_count": state.count, "scheduled_timestamp": timestamp},
        )

    queue.register_periodic(heartbeat, name=JOB_NAME, cron=CRON)
