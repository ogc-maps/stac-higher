"""FETCH stage: copy a product group's bytes into canonical storage (§6.1).

For each member of a ready group, ``adapter.get`` the source bytes, checksum
them (sha256), and ``put_object`` them into the platform bucket under the
canonical key ``assets/{collection}/{item_id}/{filename}`` (§5.3). The ledger row
moves ``settled → fetching → stored``; EXTRACT + ITEMIZE (Slice B4) build the
STAC item from the ``stored`` rows. Asset hrefs in the eventual item point at
``/api/assets/...`` in both storage modes (the app's asset route resolves the
canonical object offline).

Idempotent: a member is fetched only while its latest ledger row is still
``settled``, so a re-enqueued group (GROUP re-emits until FETCH runs) can't
double-store. The whole object is buffered in memory (ISSUES I-19: streaming +
multipart deferred); ``reference`` mode is skipped (Slice C). A per-member
failure marks only that member ``failed`` — the rest of the group still stores,
and ITEMIZE handles partial products.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging

from pipeline.connections.adapters.base import StorageAdapter
from pipeline.ingest.config import IngestConfig
from pipeline.ingest.discover import source_fetch_path
from pipeline.ingest.repo import (
    STATUS_FAILED,
    STATUS_FETCHING,
    STATUS_SETTLED,
    STATUS_STORED,
    IngestAssociation,
    IngestRepo,
)
from pipeline.storage import platform
from pipeline.storage.keys import canonical_asset_key

logger = logging.getLogger(__name__)


async def fetch_stage(
    repo: IngestRepo,
    association: IngestAssociation,
    config: IngestConfig,
    adapter: StorageAdapter,
    s3_client: platform.S3Like,
    bucket: str,
    item_id: str,
    source_paths: list[str],
) -> int:
    """Copy a group's settled files into canonical storage. Returns count stored.

    Takes the primitives that cross the queue (``item_id`` + source paths) and
    reloads each file's current ledger row itself — the stage is the single
    source of truth for the latest row, so callers need not preload it.
    """
    if config.storage_mode == "reference":
        logger.info(
            "ingest fetch: reference mode deferred to Slice C — skipping copy",
            extra={"association_id": association.id, "item_id": item_id},
        )
        return 0

    stored = 0
    for source_path in source_paths:
        # Re-read: only fetch a row that is still settled (idempotent guard).
        latest = await repo.get_latest_ledger(association.id, source_path)
        if latest is None or latest.status != STATUS_SETTLED:
            continue
        await repo.set_ledger_fields(latest.id, status=STATUS_FETCHING, item_id=item_id)
        try:
            fetch_path = source_fetch_path(config.source_path, source_path)
            data = await adapter.get(fetch_path)
            checksum = hashlib.sha256(data).hexdigest()
            filename = source_path.rsplit("/", 1)[-1]
            key = canonical_asset_key(association.collection_id, item_id, filename)
            await asyncio.to_thread(platform.put_object, s3_client, bucket, key, data)
            await repo.set_ledger_fields(
                latest.id, status=STATUS_STORED, checksum=checksum
            )
            stored += 1
        except Exception:
            await repo.set_ledger_fields(latest.id, status=STATUS_FAILED)
            logger.exception(
                "ingest fetch failed for source file",
                extra={
                    "association_id": association.id,
                    "item_id": item_id,
                    "source_path": source_path,
                },
            )
    logger.info(
        "ingest fetch group done",
        extra={
            "association_id": association.id,
            "item_id": item_id,
            "stored": stored,
            "files": len(source_paths),
        },
    )
    return stored
