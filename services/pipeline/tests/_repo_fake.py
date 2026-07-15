"""In-memory ConnectionsRepo for job unit tests (no live DB)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pipeline.connections.repo import ClaimedCheck, ConnectionRow, ConnectionsRepo


@dataclass
class RecordedCheck:
    check_id: str
    status: str
    result: dict[str, Any]


@dataclass
class HealthUpdate:
    connection_id: str
    status: str
    last_error: str | None
    host_key_to_pin: str | None


@dataclass
class FakeRepo(ConnectionsRepo):
    """Deterministic repo: claim pops from a queued list of batches."""

    #: successive return values for claim_pending (each a list of ClaimedCheck)
    claim_batches: list[list[ClaimedCheck]] = field(default_factory=list)
    enabled: list[ConnectionRow] = field(default_factory=list)

    recorded: list[RecordedCheck] = field(default_factory=list)
    health_updates: list[HealthUpdate] = field(default_factory=list)
    _claim_index: int = 0

    async def claim_pending(self, limit: int) -> list[ClaimedCheck]:
        if self._claim_index >= len(self.claim_batches):
            return []
        batch = self.claim_batches[self._claim_index]
        self._claim_index += 1
        return batch

    async def record_check(self, check_id, status, result):
        self.recorded.append(RecordedCheck(check_id, status, dict(result)))

    async def update_connection_health(self, connection_id, *, status, last_error, host_key_to_pin):
        self.health_updates.append(HealthUpdate(connection_id, status, last_error, host_key_to_pin))

    async def list_enabled_connections(self) -> list[ConnectionRow]:
        return list(self.enabled)
