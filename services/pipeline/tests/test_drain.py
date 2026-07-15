"""Drain job claim/transition logic against the in-memory repo seam."""

from __future__ import annotations

from _repo_fake import FakeRepo
from pipeline.connections.probe import ProbeOutcome
from pipeline.connections.repo import ClaimedCheck, ConnectionRow
from pipeline.jobs import drain as drain_mod
from pipeline.jobs.drain import drain_tick

KEY = b"\x00" * 32


def _claim(check_id: str, protocol: str = "sftp", host_key: str | None = None) -> ClaimedCheck:
    conn = ConnectionRow(
        id=f"conn-{check_id}",
        name="n",
        protocol=protocol,
        config={"host": "h"},
        credentials=b"envelope",
        host_key=host_key,
    )
    return ClaimedCheck(check_id=check_id, connection=conn)


def _patch_probe(monkeypatch, outcomes: dict[str, ProbeOutcome]):
    async def _fake_probe(connection, master_key, allow_hosts):
        return outcomes[connection.id]

    monkeypatch.setattr(drain_mod, "probe_connection", _fake_probe)


async def test_drain_marks_done_and_updates_health(monkeypatch):
    repo = FakeRepo(claim_batches=[[_claim("chk1", protocol="s3")]])
    _patch_probe(
        monkeypatch,
        {
            "conn-chk1": ProbeOutcome(
                ok=True,
                connection_status="ok",
                last_error=None,
                host_key_to_pin=None,
                result={"ok": True, "message": "reachable", "latency_ms": 5},
            )
        },
    )

    processed = await drain_tick(repo, KEY, frozenset())

    assert processed == 1
    assert repo.recorded[0].status == "done"
    assert repo.recorded[0].result["ok"] is True
    assert repo.health_updates[0].status == "ok"
    assert repo.health_updates[0].last_error is None
    assert repo.health_updates[0].host_key_to_pin is None


async def test_drain_first_pin_writes_host_key(monkeypatch):
    repo = FakeRepo(claim_batches=[[_claim("chk1", protocol="sftp", host_key=None)]])
    _patch_probe(
        monkeypatch,
        {
            "conn-chk1": ProbeOutcome(
                ok=True,
                connection_status="ok",
                last_error=None,
                host_key_to_pin="ssh-ed25519 KEYA",
                result={"ok": True, "message": "ok", "host_key": "ssh-ed25519 KEYA"},
            )
        },
    )

    await drain_tick(repo, KEY, frozenset())

    assert repo.health_updates[0].host_key_to_pin == "ssh-ed25519 KEYA"
    assert repo.recorded[0].status == "done"


async def test_drain_failed_check_marks_error(monkeypatch):
    repo = FakeRepo(claim_batches=[[_claim("chk1", protocol="sftp", host_key="ssh-ed25519 KEYA")]])
    _patch_probe(
        monkeypatch,
        {
            "conn-chk1": ProbeOutcome(
                ok=False,
                connection_status="error",
                last_error="host key mismatch",
                host_key_to_pin=None,
                result={"ok": False, "message": "host key mismatch"},
            )
        },
    )

    await drain_tick(repo, KEY, frozenset())

    assert repo.recorded[0].status == "failed"
    assert repo.health_updates[0].status == "error"
    assert repo.health_updates[0].last_error == "host key mismatch"
    assert repo.health_updates[0].host_key_to_pin is None


async def test_drain_loops_until_empty(monkeypatch):
    # two batches then empty; both should be processed in one tick.
    repo = FakeRepo(
        claim_batches=[
            [_claim("a", protocol="s3"), _claim("b", protocol="s3")],
            [_claim("c", protocol="s3")],
        ]
    )
    ok = lambda: ProbeOutcome(True, "ok", None, None, {"ok": True, "message": "x"})  # noqa: E731
    _patch_probe(monkeypatch, {"conn-a": ok(), "conn-b": ok(), "conn-c": ok()})

    processed = await drain_tick(repo, KEY, frozenset())

    assert processed == 3
    assert [r.check_id for r in repo.recorded] == ["a", "b", "c"]


async def test_drain_empty_is_noop(monkeypatch):
    repo = FakeRepo(claim_batches=[])
    _patch_probe(monkeypatch, {})
    assert await drain_tick(repo, KEY, frozenset()) == 0
    assert repo.recorded == []
    assert repo.health_updates == []


async def test_register_missing_key_skips_without_crashing(monkeypatch):
    """A drain tick with no master key logs+returns rather than raising."""
    from pipeline.config import Settings
    from pipeline.queue.memory import InMemoryQueue

    queue = InMemoryQueue()
    settings = Settings.from_env(env={})  # no CREDENTIALS_MASTER_KEY
    drain_mod.register(queue, settings)
    # tick should not raise even though the key is absent
    await queue.run_periodic(drain_mod.JOB_NAME, timestamp=0)
