"""Database integration tests — auto-skip unless DATABASE_URL is set.

Run locally against the compose Postgres:

    DATABASE_URL=postgresql://username:password@localhost:5433/postgis \
        uv run pytest tests/test_integration_db.py
"""

import os

import pytest

DATABASE_URL = os.environ.get("DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="DATABASE_URL not set — skipping DB integration tests"
)

SCHEMA = "procrastinate_itest"


@pytest.fixture
async def queue():
    import psycopg

    from pipeline.queue.procrastinate_backend import ProcrastinateQueue

    queue = ProcrastinateQueue(DATABASE_URL, schema=SCHEMA)
    yield queue
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as conn:
        await conn.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')


async def test_setup_is_idempotent_and_enqueue_works(queue):
    await queue.setup()
    await queue.setup()  # second run must be a no-op, not an error
    await queue.check_connection()

    async def handler(**kw):
        pass

    queue.register_task(handler, name="jobs.itest")
    job_id = await queue.enqueue("jobs.itest", {"n": 1})
    assert job_id.isdigit()

    batch_ids = await queue.enqueue_batch("jobs.itest", [{"n": 2}, {"n": 3}])
    assert len(batch_ids) == 2
