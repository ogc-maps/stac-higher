import pytest

from _delivery_fake import FakeDeliveryRepo

pytestmark = pytest.mark.asyncio


async def test_upsert_pending_is_idempotent_per_association_item():
    repo = FakeDeliveryRepo()
    r1 = await repo.upsert_pending("a1", "i1", "2026-01-01T00:00:00+00:00")
    r2 = await repo.upsert_pending("a1", "i1", "2026-01-02T00:00:00+00:00")
    assert r1 == r2  # same (association, item) → same row
    assert repo.rows[r1]["status"] == "pending"
    # a different item gets its own row
    r3 = await repo.upsert_pending("a1", "i2", None)
    assert r3 != r1


async def test_mark_transitions_and_bytes():
    repo = FakeDeliveryRepo()
    rid = await repo.upsert_pending("a1", "i1", None)
    await repo.mark_delivering(rid)
    assert repo.rows[rid]["status"] == "delivering"
    assert repo.rows[rid]["attempts"] == 1
    await repo.mark_delivered(rid, 2048)
    assert repo.rows[rid]["status"] == "delivered"
    assert repo.rows[rid]["bytes"] == 2048


async def test_mark_failed_records_error():
    repo = FakeDeliveryRepo()
    rid = await repo.upsert_pending("a1", "i1", None)
    await repo.mark_failed(rid, "boom")
    assert repo.rows[rid]["status"] == "failed"
    assert repo.rows[rid]["error"] == "boom"


async def test_upsert_pending_resets_attempts_on_redelivery():
    repo = FakeDeliveryRepo()
    rid = await repo.upsert_pending("a1", "scene", None)
    await repo.mark_delivering(rid)
    await repo.mark_delivered(
        rid, 3, {"data": {"fingerprint": "sha256:x", "size": 3, "filename": "a.tif"}}
    )
    # A new event for the same (association, item) starts a fresh attempt cycle.
    rid2 = await repo.upsert_pending("a1", "scene", None)
    assert rid2 == rid
    assert repo.rows[rid]["attempts"] == 0
    assert repo.rows[rid]["status"] == "pending"


async def test_get_row_returns_prior_state():
    repo = FakeDeliveryRepo()
    assert await repo.get_row("a1", "scene") is None
    rid = await repo.upsert_pending("a1", "scene", None)
    await repo.mark_delivering(rid)
    delivered = {"data": {"fingerprint": "sha256:abc", "size": 7, "filename": "a.tif"}}
    await repo.mark_delivered(rid, 7, delivered)
    row = await repo.get_row("a1", "scene")
    assert row is not None
    assert row.status == "delivered"
    assert row.delivered_assets == delivered


async def test_load_reference_sources_filters_by_item():
    from pipeline.delivery.repo import ReferenceSource

    src = ReferenceSource(filename="a.tif", fetch_path="incoming/a.tif", connection=None)
    repo = FakeDeliveryRepo(reference_sources={"scene": [src]})
    assert await repo.load_reference_sources("scene") == [src]
    assert await repo.load_reference_sources("other") == []
