"""pypgstac upsert integration — auto-skips unless DATABASE_URL is set.

Requires the compose stack (pgstac at :5433) with a test collection present.

    DATABASE_URL=postgresql://username:password@localhost:5433/postgis \
        uv run pytest tests/test_integration_itemize.py

NOTE (assumption flagged for the controller): the collection fixture below
calls `pgstac.create_collection(...)` / `pgstac.delete_collection(...)`.
These names were not verified against a live pgstac instance (no DB
available while writing this test). pgstac v0.9.11 is expected to expose
these, but if the live run errors on either call, check the exact helper
names with `\\df pgstac.*collection*` in psql — they may instead be
`pgstac.upsert_collection` or similarly named depending on version — and
adjust here accordingly.
"""

import json
import os

import psycopg
import pytest

DATABASE_URL = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")

COLLECTION = "b4-itest"


def _item(item_id, dtstr):
    return {
        "type": "Feature", "stac_version": "1.0.0", "stac_extensions": [],
        "id": item_id, "collection": COLLECTION, "geometry": None,
        "properties": {"datetime": dtstr}, "assets": {}, "links": [],
    }


@pytest.fixture
async def collection():
    # Insert a minimal collection via pgstac's create_collection, clean up after.
    coll = {
        "type": "Collection", "stac_version": "1.0.0", "id": COLLECTION,
        "description": "b4 itest", "license": "proprietary",
        "extent": {"spatial": {"bbox": [[-180, -90, 180, 90]]},
                   "temporal": {"interval": [[None, None]]}}, "links": [],
    }
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as conn:
        await conn.execute("SELECT pgstac.create_collection(%s::jsonb)", (json.dumps(coll),))
    yield COLLECTION
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as conn:
        await conn.execute("SELECT pgstac.delete_collection(%s)", (COLLECTION,))


async def test_upsert_then_query_and_update(collection):
    from pipeline.stac.pgstac_writer import PgPgstacWriter

    writer = PgPgstacWriter(DATABASE_URL)
    await writer.upsert_items([_item("scene-1", "2021-01-01T00:00:00Z")])

    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as conn:
        cur = await conn.execute(
            "SELECT content->'properties'->>'datetime' FROM pgstac.items"
            " WHERE id = 'scene-1' AND collection = %s", (COLLECTION,))
        row = await cur.fetchone()
    assert row is not None and row[0].startswith("2021-01-01")

    # Upsert same id with a new datetime → update in place.
    await writer.upsert_items([_item("scene-1", "2022-02-02T00:00:00Z")])
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as conn:
        cur = await conn.execute(
            "SELECT content->'properties'->>'datetime' FROM pgstac.items WHERE id = 'scene-1'")
        row = await cur.fetchone()
    assert row[0].startswith("2022-02-02")
