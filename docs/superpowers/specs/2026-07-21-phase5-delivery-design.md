# Phase 5 — Delivery Pipeline · Design

**Date:** 2026-07-21
**Status:** Approved for Slice A implementation (full-phase design; sliced A→B→C→D)
**ROADMAP refs:** §5.4 (event outbox), §6.4 (delivery flow), §5.1 (delivery `config`), §5.3 (object-store layout), §7 (access control), §10 (risks)

---

## 1. Goal & done-when

An item created by **ingest, the UI, or a direct API write** lands on a delivery
destination within **single-digit seconds** (measured in `delivery_log`), an
**updated item redelivers only changed assets**, and a **dead destination
produces a dead-letter + manual-redeliver path**, never a stuck queue.

Delivery is **assets only**, laid out by a per-association path template, with a
configurable payload (bare files / + STAC item JSON / + checksums / + completion
marker). Item updates honor `on_update: redeliver | ignore`. **Deletions never
propagate** — destination drift is accepted by design.

## 2. Architecture

Three new moving parts, each behind an existing seam:

### 2.1 Event outbox (catalog plane → data plane bridge, §5.4)
A **vendored statement-level trigger** on `pgstac.items` inserts **one row per
item** into `stac_higher.item_events` (never a `pg_notify` payload — that caps at
~8 KB and would abort bulk-upsert transactions). A separate **payload-less
`pg_notify`** wakes the dispatcher. Restarts lose nothing; bulk loads of any size
are safe.

### 2.2 Dispatcher (new pipeline co-process)
A long-running task added to `main.py`'s `asyncio.gather` **alongside** the
Procrastinate worker (not a queue job — the queue interface has no wake
primitive, and delivery latency cannot tolerate the 1-minute periodic
granularity that produced I-3). It:
1. Consumes pending `item_events` **in `id` order** (`FOR UPDATE SKIP LOCKED`).
2. Matches each event against enabled `direction='deliver'` associations for its
   `collection_id`.
3. Applies `item_filter` (CQL2, via cql2-rs Python bindings) and `asset_keys`.
4. **Enqueues batched delivery jobs** into the existing queue, then marks the
   outbox rows `processed_at`.

Poll-driven first (Slice A), `LISTEN`-woken later (Slice C).

### 2.3 Delivery workers (ordinary queue tasks)
Mirror the ingest stage chain (`jobs/ingest.py` pattern). Per job: render the
path template, transfer (S3→S3 `copy_object` when both ends are object storage,
else stream `adapter.get` → `adapter.put`), `.part` → rename for atomic
visibility, write payload sidecars (completion marker **last**), honor
`on_update`/`overwrite`, cap concurrency per connection, retry→dead-letter, and
record `delivery_log`.

### 2.4 Plane & ownership boundaries (unchanged invariants)
- The **app** owns all `stac_higher` DDL and now, per **ADR 0007**, also owns the
  trigger attached to `pgstac.items` (see §5). The app never decrypts
  credentials and never moves bytes.
- The **pipeline** is the only component that decrypts credentials and opens
  destination sessions, through the existing `StorageAdapter` interface
  (`list/get/put/delete/test`) and `build_adapter` seam.
- **Batch-oriented jobs**: one delivery job carries N assets for one
  (item, association), keeping job rate low at envelope scale.

## 3. Data model (new)

### 3.1 `stac_higher.item_events` (migration 007)
Durable outbox, monotonic `bigint id`:

| column | type | notes |
|---|---|---|
| `id` | `BIGSERIAL PK` | monotonic ordering key the dispatcher consumes by |
| `collection_id` | `text` | from the changed pgstac row |
| `item_id` | `text` | |
| `op` | `text CHECK IN ('insert','update','delete')` | |
| `occurred_at` | `timestamptz DEFAULT now()` | |
| `processed_at` | `timestamptz` | `NULL` = pending |

Index: partial on `(id) WHERE processed_at IS NULL` for the dispatcher scan.
**Not partitioned now** — Phase 6 time-partitions it with the other high-volume
tables (mirrors I-11).

### 3.2 `stac_higher.delivery_log` (migration 008, Slice B)
Per (association, item) delivery record (§5 ERD):

| column | type | notes |
|---|---|---|
| `id` | `uuid PK` | |
| `association_id` | `uuid FK → collection_connections` | `ON DELETE CASCADE` |
| `item_id` | `text` | |
| `status` | `text CHECK IN ('pending','delivering','delivered','failed','dead')` | |
| `attempts` | `int DEFAULT 0` | |
| `bytes` | `bigint` | |
| `item_created_at` | `timestamptz` | |
| `delivered_at` | `timestamptz` | latency = `delivered_at − item_created_at` |

**Plain table now**; Phase 6 partitions it (mirrors I-11).

### 3.3 Delivery association `config` (§5.1)
Stored in the existing `collection_connections.config` jsonb (`direction='deliver'`).
Validated app-side by a new Zod schema and mirrored in a Python `delivery/config.py`
(the cross-runtime contract, exactly as ingest does it):

```jsonc
{
  "path_template": "{collection}/{yyyy}/{mm}/{dd}/{item_id}/{filename}",
  "item_filter": null,            // optional CQL2 subset
  "asset_keys": null,             // null = all assets
  "payload": { "item_json": true, "checksums": "sha256", "completion_marker": true },
  "on_update": "redeliver",       // redeliver | ignore
  "overwrite": "if_newer",        // never | always | if_newer
  "retry": { "max_attempts": 5, "backoff": "exponential" },
  "max_concurrent_transfers": 4
}
```

## 4. Slices (each verify-gated on its own worktree off `ai/main`)

### Slice A — Event outbox + dispatcher skeleton (poll-driven) — THIS SESSION
- **Task A0 — trigger spike (first; gates the rest).** `pgstac.items` is
  partitioned by collection. Statement-level triggers with transition tables
  (`REFERENCING NEW/OLD TABLE`) have known limitations on partitioned parents.
  Determine empirically whether the trigger fires on the parent, must attach
  per-partition, or should instead poll pgstac's `pgstac_updated_at` /
  `items_deleted_log` change feed (§10). **Pin the pgstac version.** The outcome
  selects the mechanism; fallback is a row-level trigger cascading to partitions.
  Deliverable: a short spike note appended to ADR 0007.
- Migration **007** + **ADR 0007** (extends ADR 0001: "the app may attach
  triggers to pgstac tables it does not own"). `item_events` table + trigger
  function (`stac_higher`-namespaced) + payload-less `pg_notify`. Guarded
  `IF EXISTS` on `pgstac.items` so a pgstac-less DB still migrates.
- Pipeline `dispatcher/` module: outbox consumer (ordered, `SKIP LOCKED`,
  idempotent via `processed_at`), association matcher, `item_filter` eval via
  **cql2** (new dep: cql2 Python bindings), `asset_keys` filter. **Skeleton logs
  matched (item × association) pairs and marks rows processed — no transfer.**
- **Delivery config Zod schema** (`associations/schemas.ts`, §5.1 delivery shape)
  + Python mirror (`delivery/config.py`). Lift the `direction:'deliver'`
  rejection in the association create schema.
- **Verify:** unit tests (matcher, CQL2/asset filters, outbox ordering +
  once-only consumption) + live check that a real pgstac upsert produces exactly
  one ordered `item_events` row, consumed once. `npm run verify` +
  pipeline pytest.

### Slice B — Delivery workers + `delivery_log` + retry/dead-letter
- Migration **008** (`delivery_log`, plain table).
- `delivery/` stages: path-template renderer, transfer (S3→S3 copy vs stream),
  `.part`→rename, payload writer (item JSON / checksums / completion-marker-last),
  `on_update: redeliver` (changed-checksum assets only) + `overwrite: if_newer`,
  per-connection `max_concurrent_transfers`.
- Retry-with-backoff → dead-letter row + Phase-6-ready alert seam.
- **Verify (IN SCOPE):** live S3/MinIO **and SFTP + FTP** destinations via
  `compose.test-servers.yml` — closes the `put()` side of I-4. FTPS stays
  unit-only (I-6, arm64).

### Slice C — NOTIFY-woken low-latency + user-initiated backfill
- Replace the dispatcher's poll with a `LISTEN item_events` loop (wake-on-notify,
  interval poll as fallback) → single-digit-second latency. Document the
  singleton/HA caveat as deferred-to-Phase-8 (§10 scheduler-HA), not solved.
- **Backfill (IN SCOPE):** operator-initiated action enqueuing chunked bulk
  delivery jobs for existing items into a late-added association (§6.4), audited.
- **Verify:** measured end-to-end latency in `delivery_log`; backfill of a
  pre-existing collection.

### Slice D — Data-flow tab: delivery half (UI)
- Delivery association create/edit form (path template, filters, payload toggles,
  `on_update`, `overwrite`, retry, expectations), enable/disable, **redeliver**
  button (dead-letter recovery), **backfill** button. Existing Data-flow-tab
  conventions (Astro shell + React island, TanStack Query, shared components).
- Add the delivery branch to `/api/collections/[id]/connections` create/update
  validation and deliver-specific route logic (RBAC: operator+ to mutate,
  group-owned; member+ to view).
- **Verify:** e2e for the delivery config flow; `npm run verify`.

## 5. Ownership decision — ADR 0007 (new)

ADR 0001 established: app-middleware owns `stac_higher` DDL; the pipeline owns
nothing. Phase 5 needs a trigger on `pgstac.items`, which neither runtime owns.
**Decision:** the app (migration 007) attaches and owns this trigger, extending
ADR 0001 to license "the app may attach triggers to pgstac tables it does not
own, provided the trigger writes only into `stac_higher`." Rationale: one
migration owner is preserved; the pipeline stays DDL-free; the boundary crossing
is documented, `IF EXISTS`-guarded, and version-pinned against pgstac. Rejected
alternative: giving the pipeline migration authority for the trigger — splits DDL
ownership across two runtimes, the exact thing ADR 0001 avoided.

## 6. Access control (§7, unchanged model)
- **App API** enforces delivery association CRUD: operator+ to create/edit/
  enable/backfill/redeliver, member+ to view, group ownership in-route. Every
  mutation audited (`backfill`, `redeliver`, `create|update|delete`).
- Delivery is asset egress *from* the platform to a group-owned destination — no
  new proxy policy surface (that is Phase 7's inbound push path).

## 7. Explicitly deferred (log in ISSUES.md)
- **`item_events` / `delivery_log` partitioning** → Phase 6 (mirrors I-11).
- **Finalize-gating seam** (defer items still in staging until finalized) →
  Phase 7; no externally-writable collections exist until then. Dispatcher notes
  the seam in a comment, no code.
- **Deletions never propagate** — by design (§6.4); GC/delete outbox events are
  consumed for bookkeeping only, never dispatched to destinations.
- **FTPS live delivery** → I-6 (arm64 test-server limitation).
- **Dispatcher HA / leader election** → Phase 8 (§10 scheduler-HA); Slice C
  documents the single-instance assumption.

## 8. Risks
- **pgstac trigger on a partitioned table** (§10) — the A0 spike is the mitigation;
  outcome is documented in ADR 0007, pgstac version pinned and upgrade-tested.
- **CQL2 binding maturity** — `item_filter` evaluation depends on cql2 Python
  bindings; validate expression coverage in Slice A unit tests, keep the filter
  optional (null = deliver all).
- **Latency claim** — single-digit seconds is only real once Slice C's
  `LISTEN`-woken loop lands; Slice A/B run poll-driven and do not claim the SLO.
