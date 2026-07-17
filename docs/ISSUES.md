# Outstanding issues

Known gaps, residual risk, and deferrals — tracked honestly so they aren't mistaken for "done." Status: 🔴 open · 🟡 accepted/mitigated · 🟢 resolved · ⚪ deferred-by-design.

Each entry: what it is, why it exists, and where it's tracked. Close an entry by moving it to 🟢 with the resolving commit/PR, or delete it once shipped and documented elsewhere.

---

## Carried-forward work (committed, not yet done)

### I-1 · Per-collection read-visibility at the proxy 🔴
Phase 1 delivered authenticated transactions + audience validation, but **read-visibility filtering** (different groups see different collections) cannot be done with auth-proxy config alone — it needs OPA or a custom filter factory. Deferred out of Phase 1.
- Tracked in: [ADR 0002](decisions/0002-auth-proxy-enforcement.md); Phase 1 note in [`../ROADMAP.md`](../ROADMAP.md).
- Blocks: fully multi-tenant read isolation.

---

## Known limitations / residual risk (accepted, mitigated)

### I-2 · DNS-rebind residual for TLS endpoints 🟡
SFTP, plain FTP, and S3-over-http pin the resolved IP (rebind-proof). **FTPS control channels and S3-https keep the hostname** so TLS cert validation / SNI works, leaving a narrow DNS-rebind window between the egress check and the TLS connect. Mitigated by a fail-closed `resolve_pinned` recheck immediately before connect; the FTP PASV data-channel redirect is fully closed regardless.
- Tracked in: comments in `services/pipeline/.../adapters/{ftps,s3}.py`; found in the Phase 2 adversarial review.

### I-3 · Drain latency is ~1 minute, not ~10s 🟡
ADR 0004 targets a ~10s test-connection turnaround, but Procrastinate's periodic scheduler is **1-minute-granular**. The drain runs every minute and clears the whole pending backlog each tick, so worst-case start latency is ~60s. A true sub-minute drain needs a NOTIFY-woken consumer.
- Tracked in: [ADR 0004](decisions/0004-app-pipeline-bridge.md) "Revisit"; comment in `services/pipeline/.../jobs/drain.py`.

### I-4 · Adapter `list/get` live-verified for S3; SFTP/FTP still mock-only 🟡
The full `StorageAdapter` interface is implemented. `test()` is exercised live via the drain job, and **the S3 adapter's `list`/`get` are now live-verified** by the Phase 4 ingest e2e (2026-07-16): a file dropped in MinIO flowed poll → DISCOVER → GROUP → FETCH into canonical storage, byte-identical. The **SFTP/FTP** `list`/`get` and all adapters' `put`/`delete` remain covered only by unit tests with mocked clients — no live-server integration yet (SFTP/FTP live-exercise is a Slice B5 follow-up; FTPS blocked on arm64, I-6).
- Tracked in: here; `services/pipeline/tests/test_adapters.py`.

### I-5 · Zod v4 ↔ zodResolver `as any` cast 🟡
Form resolvers use an `as any` cast due to a Zod v4 / `@hookform/resolvers` type-inference mismatch. Known pattern, not a bug — don't "fix."
- Tracked in: `AGENTS.md` "Gotchas"; `project-conventions` skill.

---

## Test & infra gaps

### I-6 · FTPS not live-testable on arm64 🟡
The `ftps-test` server (`fauria/vsftpd`) is amd64-only and crashes under Rosetta on Apple Silicon. FTPS shares the `FtpAdapter` code path (only the TLS upgrade differs), which the live FTP test exercises, and is unit-tested — but FTPS-specific live validation needs an amd64 host.
- Tracked in: header comment in `infra/compose.test-servers.yml`; Phase 2 note in [`../ROADMAP.md`](../ROADMAP.md).

### I-7 · Pipeline jobs error noisily before tables exist ⚪
On a fresh DB the drain/health-sweep jobs log `UndefinedTable` each tick until the app's migration middleware creates `stac_higher.connections`/`connection_checks`. Harmless (they recover once tables exist) and correct per ADR 0001 (pipeline never creates tables), but noisy in a pipeline-first startup.
- Tracked in: here. Workaround for local pipeline-only testing: apply migration 004 first.

### I-8 · Full-project `npx astro check` OOMs 🟡
A pre-existing Vite/rolldown plugin type conflict between the repo root and `app/node_modules` OOMs a full-project `astro check`. Rely on `npm run verify` (build + vitest) and the scoped PostToolUse `astro check` hook instead.
- Tracked in: `AGENTS.md` "Gotchas".

---

## Deferred by design (later phases)

### I-9 · KMS credential provider ⚪
Credentials use a local `CREDENTIALS_MASTER_KEY` behind an `EncryptionProvider` seam. A KMS-backed provider arrives in Phase 8. — `app/src/lib/connections/crypto.ts`.

### I-10 · `stac-api` connection protocol ⚪
Reserved in the enum; create/update reject it and the adapter factory raises `NotImplementedError("reserved for a future release")`.

### I-11 · Audit-log partitioning & retention ⚪
`stac_higher.audit_log` is append-only and unpartitioned. Phase 6 adds time-partitioning + a compliance-driven retention job (partition maintenance must drop/re-create the append-only triggers per partition). — migration 003 comment.

### I-12 · `connection_checks` accumulation ⚪
Test-result rows are never pruned; a partial index keeps the drain's pending scan cheap, but the table grows. Retention/GC is Phase 6 hygiene.

---

## Phase 3 — asset service

### I-13 · Asset-read authorization is authentication-only 🟡
`GET /api/assets/...` requires an authenticated identity (unauthenticated → 403) but does **not** yet scope reads to the caller's groups / the collection's visibility — that is the same capability deferred as I-1 (read-visibility). Until it lands, any authenticated user can mint a download URL for any asset. In dev-bypass the static operator satisfies the check, so local flows work.
- Tracked in: [ADR 0005](decisions/0005-asset-service.md); depends on I-1 / [ADR 0002](decisions/0002-auth-proxy-enforcement.md).

### I-14 · Manual uploads go direct-to-canonical; no server-side validation ⚪
Item-form uploads presign straight into canonical storage (trusted RBAC'd writer, ADR 0005) — there is **no finalize step** validating/checksumming the bytes, and no staging quarantine. The untrusted external push path (staging → validate → move to canonical) is Phase 7; `stagingKey` + the TTL sweep already exist as its seam.
- Tracked in: [ADR 0005](decisions/0005-asset-service.md); ROADMAP §6.2.

### I-15 · Presign endpoint must be browser-reachable 🟡
The app signs URLs offline, so `S3_ENDPOINT` must be reachable by the **browser** that uses them. On the host, `http://localhost:9000` works. If the app is ever run **inside compose**, `S3_ENDPOINT` must be set to a browser-reachable host — never `http://minio:9000`, which the browser can't resolve. Defaults assume the host-run dev server.
- Tracked in: header comment in `app/src/lib/storage/config.ts`; `.env.example`.

### I-16 · Endpoint-pinning logic duplicated app-side vs. pipeline ⚪
The egress IP-pinning for a custom http (MinIO) endpoint exists twice: `S3Adapter._pinned_endpoint` (per-connection) and `storage/platform._pinned_endpoint_url` (platform bucket). Parallel, small, and independently tested; a shared helper is a possible future refactor, not a bug.
- Tracked in: here.

---

## Phase 4 — ingest pipeline (Slice A + B)

### I-17 · Association `collection_id` not verified against the built-in catalog 🟡
`POST /api/collections/[id]/connections` stores the `collection_id` from the path as-is; it does **not** yet confirm the collection exists in the built-in catalog (ROADMAP §1 "enforced in the API"). The UI only surfaces the Data-flow tab for the built-in catalog, so this isn't reachable through the client, but the API accepts any string. Hardening = a server-side existence check against the built-in catalog (or a FK once collections are registered in `stac_higher`).
- Tracked in: `app/src/pages/api/collections/[id]/connections/index.ts`.

### I-18 · Associating is gated at operator+, not member ⚪
ROADMAP §7 grants "associate connections ↔ collections" to **member**, but the mutation guard (`matchGatedRoute` → `canMutate`) is binary operator|admin, so association create/edit/delete requires operator+. Reads (list/detail) are open to any authenticated caller who can see the row. A per-route role floor (member for associate, operator for connection CRUD) is the eventual refinement.
- Tracked in: `app/src/lib/authz/permissions.ts`, `app/src/lib/associations/access.ts`.

### I-19 · Adapter `get` fully buffers large assets (streaming deferred) ⚪
The list-metadata half is **done (Slice B1)**: `StorageAdapter.list()` now returns `FileEntry` with size/mtime/etag, which the DISCOVER settled-check needs. The remaining gap: `get() -> bytes` buffers the whole object in memory, and copy-mode FETCH (Slice B2+B3) buffers `get → platform.put_object`, so FETCH of multi-GB assets is unsafe at envelope scale. Fine for local/small assets; true streaming (a streaming read + S3 multipart upload) is deferred and logged here.
- Tracked in: here; `services/pipeline/.../adapters/base.py`, `services/pipeline/.../ingest/fetch.py`.

### I-20 · Ingest discovery is non-recursive (one directory level) ⚪
DISCOVER lists `source_path` once. S3's prefix listing is naturally deep (all keys under the prefix), but SFTP/FTP `list()` returns a single directory level, so nested products under an SFTP/FTP source are not discovered. Adequate for the common flat-drop-directory case; a recursive walk (descend into `is_dir` entries, guarding depth/symlink loops) is the follow-up.
- Tracked in: here; `services/pipeline/.../ingest/discover.py`. Also underpins the `StorageAdapter.list()` path-convention divergence surfaced by DISCOVER (S3 full-key vs SFTP/FTP relative-name), which `relative_source_path`/`source_fetch_path` normalize (I-4).

### I-21 · Reference-mode ingest stalls at `settled` until Slice C ⚪
`storage_mode: reference` associations run DISCOVER (files reach `settled`) but GROUP forms no groups and FETCH skips the copy, so nothing advances to `stored`/`itemized`. This is intentional — reference itemization (asset hrefs pointing at the source via `resolveAssetTarget`) is Slice C — but a reference association created now will accumulate `settled` ledger rows that don't progress. Slice C consumes them.
- Tracked in: here; `services/pipeline/.../ingest/group.py`, `services/pipeline/.../ingest/fetch.py`.

---

## Phase 4 — ingest pipeline (Slice B4: EXTRACT + ITEMIZE)

### I-22 · `file_mtime` is a ledger settle-time approximation, not a true source mtime 🟡
`metadata.defaults.datetime: file_mtime` resolves to the `ingest_files` ledger row's `updated_at` (the settle-check timestamp DISCOVER records), not the source file's actual modification time — the ledger has no durable mtime column, and etag-only source protocols (S3) expose no mtime at all to record one from. Adequate for the common case (files settle shortly after they land), but not exact for sources with meaningful clock skew between write and poll. A true source-mtime column would be a future **app-owned** migration (ADR 0001 keeps DDL ownership with the app).
- Tracked in: [ADR 0006](decisions/0006-ingest-metadata-and-upsert.md); `services/pipeline/.../ingest/extract.py` (`resolve_datetime`).

### I-23 · pgstac/pypgstac version lockstep on upgrade 🟡
The pinned `pypgstac[psycopg]` client minor must track the pinned `ghcr.io/stac-utils/pgstac` image minor (both currently `0.9.11`) — pypgstac's upsert path calls pgstac's own SQL functions, and that surface can shift between minor versions. Any future pgstac image bump must bump the `pypgstac` pin in the same change and re-run the upsert path (unit + `test_integration_itemize.py`) before it ships.
- Tracked in: [ADR 0006](decisions/0006-ingest-metadata-and-upsert.md); `services/pipeline/pyproject.toml`, `docker-compose.yml`.

### I-24 · Bundled-GDAL driver subset ⚪
rasterio's `>=1.5,<2` wheels bundle their own GDAL build with a smaller driver set than a full system GDAL install would carry. Sufficient for the ingest media types this platform targets (COG/GeoTIFF and common raster formats); an exotic format outside that subset fails EXTRACT (`ExtractError`) rather than silently degrading. Flag if a source product needs a driver the bundled GDAL omits.
- Tracked in: [ADR 0006](decisions/0006-ingest-metadata-and-upsert.md); `services/pipeline/.../ingest/extract.py`.

### I-25 · Sidecar `generic_xml` parser covers a minimal MVP field set; sidecar file is not a separate asset ⚪
The `sidecar` metadata strategy's `generic_xml` parser looks for a small, namespace-agnostic set of date-ish tags (`datetime`/`acquired`/`date`/`acquisitiondate`/`start_datetime`) and no geometry — richer field mapping is a follow-up, not implemented here. Separately: when a raster and its sidecar share a basename (e.g. `scene.tif` + `scene.xml`), `build_assets`/`build_raster_auto` collapse them to a **single** `data` asset keyed by that stem — the raw sidecar file itself is never exposed as a distinct STAC asset, only the metadata parsed out of it lands in `item.properties`. Flag if a product needs the sidecar file itself downloadable as its own asset.
- Tracked in: [ADR 0006](decisions/0006-ingest-metadata-and-upsert.md); `services/pipeline/.../ingest/extract.py` (`_find_datetime_in_xml`, `build_assets`, `build_raster_auto`).

### I-26 · Memory-buffered raster reads in EXTRACT ⚪
EXTRACT reads a group's primary raster fully into memory (`rasterio.MemoryFile(raster_bytes)`) before handing it to rio-stac — consistent with FETCH's existing buffered `get`/`put_object` (I-19), but compounding the same envelope-scale risk one stage later: a multi-GB scene is fully buffered twice (FETCH, then EXTRACT) before an item exists. True streaming raster reads are deferred alongside I-19's streaming FETCH gap.
- Tracked in: here; I-19 (above); `services/pipeline/.../ingest/extract.py` (`build_item`, `build_raster_auto`).
