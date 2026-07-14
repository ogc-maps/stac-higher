"""Health endpoint with the queue check stubbed via the in-memory backend."""

from fastapi.testclient import TestClient

from pipeline.health import create_health_app
from pipeline.jobs.heartbeat import HeartbeatState
from pipeline.queue.memory import InMemoryQueue


def make_client(queue: InMemoryQueue, state: HeartbeatState) -> TestClient:
    return TestClient(create_health_app(queue, heartbeat_state=state))


def test_health_ok():
    client = make_client(InMemoryQueue(), HeartbeatState())
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "pipeline"
    assert body["status"] == "ok"
    assert body["queue"] == {"backend": "memory", "reachable": True, "error": None}
    assert body["heartbeat"]["count"] == 0


def test_health_degraded_when_queue_unreachable():
    queue = InMemoryQueue(connected=False)
    client = make_client(queue, HeartbeatState())
    response = client.get("/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["queue"]["reachable"] is False
    assert "disconnected" in body["queue"]["error"]


def test_health_reports_heartbeat_state():
    state = HeartbeatState(count=7, last_timestamp=1_700_000_000, last_run_at="t")
    client = make_client(InMemoryQueue(), state)
    body = client.get("/health").json()
    assert body["heartbeat"] == {
        "count": 7,
        "last_timestamp": 1_700_000_000,
        "last_run_at": "t",
    }


async def test_heartbeat_updates_state_and_health():
    from pipeline.jobs import heartbeat

    queue = InMemoryQueue()
    state = HeartbeatState()
    heartbeat.register(queue, state=state)
    await queue.run_periodic(heartbeat.JOB_NAME, timestamp=1_700_000_000)

    body = make_client(queue, state).get("/health").json()
    assert body["heartbeat"]["count"] == 1
    assert body["heartbeat"]["last_timestamp"] == 1_700_000_000
    assert body["heartbeat"]["last_run_at"] is not None
