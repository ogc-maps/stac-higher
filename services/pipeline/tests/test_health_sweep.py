"""Health sweep: tests all enabled connections, updates health, no checks rows."""

from __future__ import annotations

from _repo_fake import FakeRepo
from pipeline.connections.probe import ProbeOutcome
from pipeline.connections.repo import ConnectionRow
from pipeline.jobs import health_sweep as sweep_mod
from pipeline.jobs.health_sweep import sweep_tick

KEY = b"\x00" * 32


def _conn(cid: str, protocol: str = "s3", host_key: str | None = None) -> ConnectionRow:
    return ConnectionRow(
        id=cid,
        name=cid,
        protocol=protocol,
        config={"host": "h"},
        credentials=b"e",
        host_key=host_key,
    )


async def test_sweep_updates_all_enabled(monkeypatch):
    repo = FakeRepo(enabled=[_conn("a"), _conn("b", protocol="sftp")])

    outcomes = {
        "a": ProbeOutcome(True, "ok", None, None, {"ok": True, "message": "x"}),
        "b": ProbeOutcome(
            True,
            "ok",
            None,
            "ssh-ed25519 KEYB",
            {"ok": True, "message": "x", "host_key": "ssh-ed25519 KEYB"},
        ),
    }

    async def _fake_probe(connection, master_key, allow_hosts):
        return outcomes[connection.id]

    monkeypatch.setattr(sweep_mod, "probe_connection", _fake_probe)

    swept = await sweep_tick(repo, KEY, frozenset())

    assert swept == 2
    # no connection_checks rows touched by the sweep.
    assert repo.recorded == []
    by_id = {u.connection_id: u for u in repo.health_updates}
    assert by_id["a"].status == "ok" and by_id["a"].host_key_to_pin is None
    assert by_id["b"].host_key_to_pin == "ssh-ed25519 KEYB"


async def test_sweep_error_records_last_error(monkeypatch):
    repo = FakeRepo(enabled=[_conn("a", protocol="ftp")])

    async def _fake_probe(connection, master_key, allow_hosts):
        return ProbeOutcome(
            False, "error", "auth failed", None, {"ok": False, "message": "auth failed"}
        )

    monkeypatch.setattr(sweep_mod, "probe_connection", _fake_probe)

    await sweep_tick(repo, KEY, frozenset())

    assert repo.health_updates[0].status == "error"
    assert repo.health_updates[0].last_error == "auth failed"


async def test_sweep_empty(monkeypatch):
    repo = FakeRepo(enabled=[])
    assert await sweep_tick(repo, KEY, frozenset()) == 0


async def test_register_missing_key_skips(monkeypatch):
    from pipeline.config import Settings
    from pipeline.queue.memory import InMemoryQueue

    queue = InMemoryQueue()
    settings = Settings.from_env(env={})
    sweep_mod.register(queue, settings)
    await queue.run_periodic(sweep_mod.JOB_NAME, timestamp=0)
