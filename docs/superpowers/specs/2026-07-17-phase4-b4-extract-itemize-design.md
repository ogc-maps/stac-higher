# Phase 4 · Slice B4 — EXTRACT + ITEMIZE (design)

Date: 2026-07-17 · Status: proposed (awaiting review) · ROADMAP §6.1, §5.1

## 1. Goal

Close the last functional gap in Phase 4's ingest chain. Today the pipeline runs
poll → **DISCOVER** → **GROUP** → **FETCH** and stops at ledger status `stored`
(bytes copied into canonical storage). Slice B4 adds the tail of §6.1 —
**EXTRACT → ITEMIZE → post-ingest** — so a source file becomes a queryable STAC
item in the built-in catalog within one poll cycle, idempotently, and a changed
source file produces an updated item.

**Phase 4 done-when this slice satisfies:** "files dropped on a source connection
appear as STAC items with assets in object storage within one poll cycle,
idempotently across restarts and re-polls; a changed source file produces an
updated item."

## 2. Scope

**In:**
- EXTRACT stage — all three `metadata.strategy` modes: `raster_auto`,
  `sidecar`, `defaults_only` (§5.1 contract).
- ITEMIZE stage — build STAC item, stac-pydantic validation gate, pypgstac
  upsert, ledger `stored → itemized`.
- post-ingest source action — `leave` | `delete` | `move:<path>`.
- New deps (rio-stac/pystac/rasterio/stac-pydantic/pypgstac) + `[tool.uv]`
  wheel guardrail + pgstac image version pin + a new ADR.
- Unit tests (fake repo + fake pgstac writer + fixture rasters/sidecars),
  DB integration test (real pypgstac upsert → queryable item), and the live
  end-to-end assertion that closes the B5 gap.

**Out (unchanged deferrals):**
- `storage_mode: reference` (Slice C) — EXTRACT/ITEMIZE only run for `copy`
  associations; reference groups already stop earlier in the chain.
- Delivery / `on_update` redelivery (Phase 5).
- `flow_stats` telemetry writes, alerts, retention (Phase 6).
- `ingest_files` time-partitioning (Phase 6).
- Streaming/multipart fetch (ISSUES I-19) — bytes remain buffered in memory.

## 3. Locked decisions (this slice)

| Decision | Choice |
|---|---|
| Metadata strategies | All three (`raster_auto`, `sidecar`, `defaults_only`) land together. |
| post_ingest | Implement `leave` / `delete` / `move:<path>`; source-mutating, non-fatal on error (item is already catalogued). |
| Validation gate | **stac-pydantic only** in the hot path (offline, fast). `stac-validator` / `validate_extensions` (network schema fetch) are NOT run per-ingest; reserved for backfill/QA. |
| Upsert library | **pypgstac** `Loader.load_items(..., Methods.upsert)` — locked by ROADMAP; respects ADR 0001 (data only, no DDL). |
| GDAL packaging | Self-contained rasterio manylinux/macOS wheels; **no system GDAL, no Dockerfile apt change.** |

## 4. Dependencies, Docker, pgstac pin, ADR

**New `services/pipeline/pyproject.toml` dependencies** (versions verified on PyPI, 2026-07, all Python 3.12-clean, agree on pystac 1.x / pydantic 2.x; no conflict with the existing `psycopg 3.3.4` / `procrastinate 3.9.0`):

```toml
"rio-stac==0.12.0",
"pystac==1.15.1",
"rasterio>=1.5,<2",
"stac-pydantic==3.6.0",
"pypgstac[psycopg]==0.9.11",
```

Plus a wheel-only guardrail so a transient wheel-availability blip can never
trigger a source build that would fail for lack of system GDAL:

```toml
[tool.uv]
no-build-package = ["rasterio"]
```

Then `uv lock`. `pyproj` is **not** added (rasterio's bundled GDAL already ships
PROJ; sidecar XML parsing uses `defusedxml`, JSON uses stdlib).

**Dockerfile:** no changes. rasterio 1.5 wheels bundle GDAL 3.12.1 + its full
dep stack into `rasterio.libs/` inside the `.venv`; `UV_LINK_MODE=copy` means the
`.venv` holds real files, so `COPY --from=builder /app/.venv` transports them
intact to `python:3.12-slim-bookworm` (glibc 2.36 ≥ the wheels' `manylinux_2_28`
floor). Image grows ~180–230 MB (accepted). macOS arm64 wheels exist, so local
`pytest` keeps working with no Homebrew GDAL.

**pgstac version pin:** `docker-compose.yml` currently runs
`ghcr.io/stac-utils/pgstac:latest`. pypgstac's client minor must match the
pgstac **schema** minor (both 0.9.x), or upsert can hit partition/base-item shape
mismatches. Pin the image to an explicit `ghcr.io/stac-utils/pgstac:v0.9.x` tag
(matching pypgstac 0.9.11) as part of this slice. (Risk §10 in the ROADMAP —
pgstac trigger/version restructuring — makes an explicit pin the right call
anyway.)

**ADR 0006 (new):** "Ingest metadata extraction & pgstac upsert." Records: the rio-stac/pystac/stac-pydantic/pypgstac library
choices and pins; the self-contained-wheel GDAL packaging decision (no system
GDAL); the pgstac image pin; and the ADR-0001 reconciliation (pypgstac
`Methods.upsert` writes item **data** only — verified it creates only
`ON COMMIT DROP` temp staging tables and calls pgstac's own `upsert_item`
functions, runs no migrations/DDL — so the data plane writing items respects
"pgstac DDL is image-owned").

## 5. Architecture — chain extension

FETCH currently is terminal. It gains one line: after a group's members reach
`stored`, enqueue a new **`pipeline.ingest_itemize`** job carrying the same
primitives the other stages cross the queue with — `(association_id, item_id,
source_paths)`. One itemize job per ready group folds EXTRACT + ITEMIZE +
post-ingest (mirroring how DISCOVER bundles sub-steps), keeping a single
association's flow a handful of batch jobs regardless of file count.

```
poll → DISCOVER → GROUP → FETCH → ITEMIZE(=EXTRACT + build/validate/upsert + post-ingest)
        (existing, unchanged)      (new: pipeline.ingest_itemize)
```

New modules under `services/pipeline/src/pipeline/`:
- `ingest/extract.py` — build a `pystac.Item` (or a hand-built dict for
  `defaults_only`) from a group's stored members. Pure, testable.
- `ingest/itemize.py` — validate + upsert + drive ledger transitions +
  post-ingest. Depends on the `IngestRepo` seam and a new `PgstacWriter` seam.
- `stac/pgstac_writer.py` (or `ingest/pgstac_writer.py`) — the pypgstac seam:
  a `PgstacWriter` ABC (`upsert_items(items)`), a `PgPgstacWriter` psycopg-DSN
  impl (`# pragma: no cover`, exercised by the DB integration test), and a fake
  for unit tests.
- Wiring in `jobs/ingest.py` — register `pipeline.ingest_itemize`; FETCH
  enqueues it.

## 6. EXTRACT (`ingest/extract.py`)

Signature (sketch): given `collection_id`, `item_id`, the group's stored
`LedgerEntry` members, the parsed `IngestConfig.metadata`, and the platform S3
client + bucket → return a STAC item **dict** ready for validation, or raise a
typed `ExtractError` (→ group marked `failed`).

**Reading bytes:** members are already in canonical storage post-FETCH. EXTRACT
`get_object`s each member it needs and, for rasters, wraps the bytes in
`rasterio.io.MemoryFile(data)` → `create_stac_item(src, ...)`. This avoids all
GDAL `/vsis3` + MinIO endpoint configuration (no `AWS_S3_ENDPOINT`/
`AWS_VIRTUAL_HOSTING` env dance) — we already hold the bytes.

**Strategy dispatch:**
- **`raster_auto`** — pick the primary raster member (first member matching a
  raster extension: `.tif/.tiff/.jp2/...`; if none, fall through to
  `defaults_only` behavior with a logged note). Call
  `create_stac_item(memfile, id=item_id, collection=collection_id,
  input_datetime=<resolved>, asset_name="data", asset_href=<api href>,
  asset_roles=["data"], asset_media_type=<by ext>, with_proj=True,
  with_raster=True)`. Additional group members become extra assets (keyed by
  filename stem, `roles=["metadata"]` for sidecars) with their own `/api/assets`
  hrefs.
- **`sidecar`** — locate the sidecar member by `metadata.sidecar.pattern`
  (e.g. `{basename}.xml`) relative to the primary; parse with the configured
  `parser`: `generic_xml` via **`defusedxml`** (hardened against XXE *and*
  entity-expansion DoS — stdlib `xml.etree` fully defends against neither;
  required by the FISMA-High posture), `json` via stdlib `json`. Extract
  datetime/geometry/select properties (a documented, minimal field set for the
  MVP — datetime is the required one; geometry optional). Assets for all
  members. If both a raster and a sidecar are present, `sidecar` values take
  precedence over raster-derived ones for the fields it provides.
- **`defaults_only`** — no extraction. Build the item dict directly with
  `geometry: null`, `bbox` omitted (STAC allows null geometry iff bbox is
  absent), assets for all members, and datetime from `metadata.defaults`.

**Datetime resolution (shared fallback chain):** strategy-extracted datetime →
`metadata.defaults.datetime`. The default supports a literal RFC3339 string or
the sentinel `"file_mtime"`. **`file_mtime` limitation:** the ledger stores a
`fingerprint` (etag, or `{size}:{mtime}`), not a durable source mtime column, so
a true source mtime is not reliably available (etag-only protocols have none). We
approximate `file_mtime` with the ledger row's observed settle time
(`updated_at`) — documented in ISSUES; a true-mtime column would be an
app-owned migration, out of scope here. A still-missing datetime after the chain
→ `ExtractError` (group `failed`), never a bad item. All datetimes are emitted
tz-aware UTC (RFC3339 `...Z`).

**Asset hrefs:** must mirror the app's existing convention exactly —
`app/src/lib/storage/keys.ts::assetHref` emits a **root-relative**,
URL-encoded-per-segment `/api/assets/{collection}/{item_id}/{filename}` (Phase 3,
what the manual-upload path already writes). The pipeline adds the analog to its
existing `storage/keys.py`: an `asset_href(collection, item_id, filename)`
function with the same URL-encoding, prefixed by a new `ASSET_HREF_BASE` setting
(default `/api/assets`). Root-relative is deliberate and already established — the
app's asset route resolves it. Media type by extension via a small explicit map
(pystac has no built-in ext→type map); unknown → `create_stac_item`'s `"auto"`
for the raster, `application/octet-stream` otherwise.

**Serialization:** `item.to_dict(include_self_link=False, transform_hrefs=False)`
so pystac never rewrites our relative `/api/assets/...` hrefs against a
nonexistent self link.

## 7. ITEMIZE (`ingest/itemize.py`)

Given the built item dict for a group:
1. **Validate** — `stac_pydantic.api.Item.model_validate(item_dict)`. On
   `pydantic.ValidationError`: log the errors, mark every group member `failed`,
   return (no upsert). This is the gate.
2. **Upsert** — `await pgstac_writer.upsert_items([item_dict])` →
   `asyncio.to_thread` around `Loader(db=PgstacDB(dsn)).load_items([dict],
   insert_mode=Methods.upsert)`. Same `item_id` replaces the existing item
   (re-ingest path). Per-job fresh `PgstacDB(dsn)`; optimize to a shared pool
   only if profiling later demands it.
3. **Ledger** — on success, `set_ledger_fields(member.id, status="itemized",
   item_id=item_id)` for every member. Idempotent: re-running the job re-upserts
   the identical item and re-sets `itemized` (a no-op transition).
4. **Collection-missing handling** — pypgstac raises
   `Collection {id} is not present in the database` if the collection doesn't
   exist. Associations attach only to built-in-catalog collections that already
   exist, so this is an edge case; catch it and surface a clear job error +
   mark members `failed` (do not crash the worker).

**Idempotency / restart safety:** the guard is the ledger — ITEMIZE only acts on
members whose latest row is `stored` (re-reads latest per the FETCH pattern);
a member already `itemized` is skipped. A crash mid-upsert leaves members
`stored`; the re-enqueued job re-upserts (upsert is idempotent) and advances the
ledger. No double-catalog, no stuck state.

## 8. post-ingest (`leave` | `delete` | `move:<path>`)

After a group is successfully itemized, apply `config.post_ingest` to the
**source** files (via the connection adapter):
- `leave` — no-op (default).
- `delete` — `adapter.delete(source_fetch_path(...))` per member.
- `move:<path>` — copy to the target prefix then delete
  (`adapter.get` → `adapter.put` at `<path>/<filename>` → `adapter.delete`), or
  an adapter-native move where available.

Errors here are **non-fatal**: the item is already catalogued, so a failed
source cleanup is logged (and eligible for a Phase 6 alert) but does not fail the
job or revert the ledger. post-ingest runs only once per successful itemize; a
re-poll of an already-`itemized`, already-moved/deleted file finds nothing new in
DISCOVER, so it does not re-trigger.

## 9. Job wiring (`jobs/ingest.py`)

- Register `pipeline.ingest_itemize` via `queue.register_task`.
- FETCH handler: after `fetch_stage`, `enqueue(JOB_ITEMIZE, {association_id,
  item_id, source_paths})` for the group (only when copy-mode and something was
  stored).
- ITEMIZE handler: `load_key_or_skip` (needs the master key for the adapter used
  by post-ingest) → `_load_association` (no-op if the association was
  disabled/deleted) → build adapter + platform client + pgstac writer → run
  EXTRACT, then ITEMIZE, then post-ingest. Mirrors the existing per-stage handler
  shape.

## 10. Re-ingest / update path

No new machinery. DISCOVER already inserts a new ledger `version` on a
post-`itemized` fingerprint change, and GROUP derives `item_id` from the filename
stem (stable across versions). So a changed source file → new version → FETCH
re-stores → ITEMIZE upserts the **same** `item_id` → the catalog item is updated.
Delivery reaction to the update is Phase 5.

## 11. Config / env / contract

- New setting `ASSET_HREF_BASE` (default `/api/assets`) in
  `pipeline/config.py::Settings`.
- pgstac DSN = `settings.database_url` (PgstacDB sets its own `search_path` to
  include pgstac — no DSN schema config needed).
- No change to the `collection_connections.config` contract — the `metadata`
  block (already carried through untyped in `ingest/config.py`) is now consumed;
  its typed parsing lives in `extract.py`, not `config.py`, to keep the config
  module transport-only.

## 12. Testing plan

**Unit (fake repo + fake pgstac writer, no DB, no network, no GDAL S3):**
- `extract.py`: each strategy — `raster_auto` on a tiny fixture GeoTIFF
  (geometry/bbox/datetime/proj/raster present, correct `/api/assets` hrefs);
  `sidecar` XML + JSON parse (datetime/geometry override); `defaults_only`
  (null geometry, no bbox, datetime from literal + from `file_mtime` proxy);
  fallback chain; missing-datetime → `ExtractError`; multi-member asset mapping;
  XXE-safety of the XML parser.
- `itemize.py`: validation pass → fake writer receives the dict + ledger →
  `itemized`; validation fail → members `failed`, writer not called; idempotency
  (second run re-upserts, members already `itemized` skipped); collection-missing
  → `failed` + clear error, no crash.
- post-ingest: `leave`/`delete`/`move` drive the fake adapter correctly; adapter
  error is swallowed (job still succeeds, ledger stays `itemized`).
- Job wiring: FETCH enqueues ITEMIZE per group; ITEMIZE no-ops on a
  disabled/deleted association; master-key-absent skip.

**DB integration (`test_integration_db.py` pattern — auto-skip unless
`DATABASE_URL` set):** real `PgPgstacWriter` upserts an item into pgstac, then a
STAC search / `pgstac.items` query returns it; a second upsert with the same id
updates it (assert changed field). Requires the compose stack + an existing
collection.

**Live end-to-end (closes the B5 gap):** with the full stack + a MinIO source,
drop a real GeoTIFF → one poll cycle → assert a **queryable STAC item** exists
with assets resolving through `/api/assets/...`; change the file → assert the
item is updated. (SFTP/FTP source run — ISSUES I-4 — remains a follow-up.)

`npm run verify` is app-side; pipeline verification is
`uv run pytest` + `uv run ruff check` in `services/pipeline/`. Both must pass.

## 13. Risks & ISSUES entries to log

- **`file_mtime` approximation** — datetime default `file_mtime` uses the
  ledger settle time, not true source mtime (no durable mtime column). Log in
  ISSUES; a true-mtime column is a future app migration.
- **pgstac version lockstep** — pypgstac client minor must track the pinned
  pgstac image minor; upgrade-test on any pgstac bump (already a ROADMAP §10
  risk). The pin is the mitigation.
- **Bundled-GDAL driver set** — rasterio wheels omit some optional GDAL format
  drivers vs. a full system GDAL; sufficient for COG/GeoTIFF, note the boundary.
- **Memory-buffered reads** — `MemoryFile(full_bytes)` for large rasters shares
  ISSUES I-19 (streaming/multipart deferred); acceptable at NRT-subset volumes.
- **Sidecar field coverage** — the `generic_xml` parser targets a minimal,
  documented field set (datetime + optional geometry) for the MVP; richer
  sidecar mapping is a follow-up, not this slice.

## 14. Definition of done

- All three EXTRACT strategies build valid STAC items; ITEMIZE validates via
  stac-pydantic and upserts via pypgstac; ledger advances `stored → itemized`
  (or `failed` on a validation/extract error).
- post-ingest `leave`/`delete`/`move` work; non-fatal on error.
- A changed source file updates the same catalog item id.
- Idempotent across restarts and re-polls (ledger-guarded).
- Unit + DB-integration tests pass; ruff clean; app `npm run verify` unaffected.
- ADR written; deps + `[tool.uv]` guardrail + pgstac image pin committed;
  Dockerfile unchanged.
- Live end-to-end: a dropped raster becomes a queryable item within one poll
  cycle (B5 gap closed for the raster/copy path).
