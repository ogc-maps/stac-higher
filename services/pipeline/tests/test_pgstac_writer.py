import pytest

from pipeline.stac.pgstac_writer import CollectionMissing, PgPgstacWriter, PgstacWriter


def test_pgpgstac_writer_is_a_writer():
    assert issubclass(PgPgstacWriter, PgstacWriter)


async def test_upsert_translates_collection_missing(monkeypatch):
    writer = PgPgstacWriter(dsn="postgresql://ignored")

    def _boom(items):
        raise Exception("Collection foo is not present in the database")

    monkeypatch.setattr(writer, "_upsert_sync", _boom)
    with pytest.raises(CollectionMissing):
        await writer.upsert_items([{"id": "x", "collection": "foo"}])


async def test_upsert_reraises_other_errors(monkeypatch):
    writer = PgPgstacWriter(dsn="postgresql://ignored")

    def _boom(items):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(writer, "_upsert_sync", _boom)
    with pytest.raises(RuntimeError):
        await writer.upsert_items([{"id": "x", "collection": "foo"}])
