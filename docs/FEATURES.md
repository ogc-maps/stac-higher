# Feature catalog

What's built, grouped by delivery phase. Status legend: ✅ done · 🚧 in progress · ⬜ not started. Each area links its detailed reference doc and the ADRs that shaped it. See [`../ROADMAP.md`](../ROADMAP.md) for the plan and [`ISSUES.md`](ISSUES.md) for known gaps.

---

## STAC client application (baseline)

The Astro 6 (SSR) + React 19 STAC client that predates the platform phases.

| Feature | Status | Entry points |
|---|---|---|
| Collections & Items CRUD | ✅ | `app/src/pages/{collections,items}*`, forms via React Hook Form + Zod (`app/src/lib/stac-api/schemas.ts`) |
| STAC search | ✅ | `app/src/pages/search.astro` |
| Map layers | ✅ | `StacMap`, `FootprintLayer`, `ExtentLayer`, `ItemGeometryEditor` (MapLibre GL via `packages/shared/src/lib/map/`) |
| Multi-catalog management | ✅ | `app/src/pages/catalogs.astro`, `app/src/stores/catalogStore.ts` (localStorage; built-in catalog is undeletable) |
| Custom STAC extensions | ✅ | `/api/extensions*` routes, RJSF theme in `packages/shared`; import/preview external JSON Schemas |
| CORS proxy | ✅ | `/api/proxy` (`X-Proxy-Target` + `X-Proxy-Endpoint`; rejects cross-site; optional `PROXY_AUTH_TOKEN`) |

State model: Nanostores (cross-island) · TanStack Query (server state, key factory `app/src/lib/query/keys.ts`) · React Hook Form + Zod (forms). See the `project-conventions` skill.

---

## Phase 0 — Foundations ✅

Local-first platform substrate; everything runs under `docker compose up`.

| Feature | Status | Entry points |
|---|---|---|
| npm-workspaces monorepo | ✅ | `app/`, `packages/shared/` (`@stac-higher/shared`), `services/pipeline/` |
| Full local stack | ✅ | `docker-compose.yml`: pgstac (:5433), stac-fastapi (:8082), stac-auth-proxy (:8081), Keycloak (:8180), MinIO (:9000/:9001), pipeline (:8083) |
| Pipeline service | ✅ | `services/pipeline/` — worker + scheduler + `/health` in one process; backend-agnostic `QueueBackend` (Procrastinate default, SQS reserved for Phase 8); no-op heartbeat proves the periodic path |
| Extension storage + migrations | ✅ | `stac_higher.*` schema in pgstac's Postgres; app-owned migrations run via middleware on first request |
| Built-in catalog | ✅ | seeded, undeletable entry pointing at the auth-proxy (`PUBLIC_BUILTIN_CATALOG_URL`) |

Decisions: [ADR 0001 — migration ownership](decisions/0001-migration-ownership.md).

---

## Phase 1 — Auth, RBAC & audit ✅

| Feature | Status | Entry points |
|---|---|---|
| OIDC login (PKCE) + claims mapping | ✅ | `app/src/lib/auth/*`, `/api/auth/{login,callback,logout,me}`; encrypted chunked session cookie |
| Dev-bypass identity | ✅ | `AUTH_MODE=bypass` (default in dev): static operator in `earth-observation` — unit tests / e2e need no IdP |
| RBAC permission guard | ✅ | `app/src/lib/authz/{permissions,guard}.ts`, wired in `src/middleware.ts`; operator/admin required for API mutations, reads stay open |
| Append-only audit log | ✅ | `stac_higher.audit_log` (trigger-enforced no UPDATE/DELETE/TRUNCATE), `app/src/lib/audit/log.ts` (redacts secrets); `/api/audit` (own-groups / admin-all) |
| Collection ownership/exposure settings | ✅ | `stac_higher.collection_settings` (sparse; unowned+public default), `app/src/lib/collections/settings.ts` |
| Auth-proxy enforcement (opt-in) | ✅ | `infra/compose.auth-enforced.yml` — authenticated transactions + audience check, reads public |

Reference: [`auth.md`](auth.md). Decisions: [ADR 0002 — proxy enforcement scope](decisions/0002-auth-proxy-enforcement.md), [ADR 0003 — pre-existing collection ownership](decisions/0003-preexisting-collections.md). Carried-forward item in [`ISSUES.md`](ISSUES.md).

---

## Phase 2 — Connections ✅

Group-owned ingest/delivery endpoints the pipeline reads from and writes to. Live-verified end-to-end (SFTP/FTP/S3 test-connections, egress block, TOFU mismatch) on 2026-07-16.

| Feature | Status | Entry points |
|---|---|---|
| Connections CRUD + Zod schemas | ✅ | `stac_higher.connections` (migration 004), `app/src/lib/connections/*`, `/api/connections*` |
| Write-only credential envelope | ✅ | `0x01 ‖ 12B nonce ‖ AES-256-GCM(ct+tag)` of UTF-8 JSON; `CREDENTIALS_MASTER_KEY` (base64 32B, shared app↔pipeline). App encrypts (`crypto.ts`), pipeline decrypts (`envelope.py`); API returns only `credentials_set` |
| Protocol adapters | ✅ | `services/pipeline/.../adapters/`: s3 (boto3), sftp/ssh (asyncssh), ftp/ftps (aioftp); `StorageAdapter` ABC (`test/list/get/put/delete`); `stac-api` reserved |
| Egress SSRF policy | ✅ | `egress.py`: deny private/loopback/link-local/metadata + `EGRESS_ALLOW_HOSTS`; IP-pinning (DNS-rebind defence) + FTP PASV data-channel forced to control host |
| TOFU host-key pinning | ✅ | `adapters/tofu.py`: first-pin on success, hard-fail on mismatch; reset via `/api/connections/[id]/host-key/reset` |
| Test-connection bridge + health checks | ✅ | app inserts `connection_checks` → pipeline drain job (`* * * * *`) runs `test`; health sweep (`*/5`). Neither touches `connections.updated_at` |
| `/connections` UI | ✅ | `app/src/pages/connections.astro`, `app/src/components/connections/*`: badges, per-protocol wizard, test+poll, host-key reset |

Reference: [`connections.md`](connections.md). Decisions: [ADR 0001 — migration ownership](decisions/0001-migration-ownership.md), [ADR 0004 — app→pipeline bridge](decisions/0004-app-pipeline-bridge.md). Residuals/caveats in [`ISSUES.md`](ISSUES.md).

---

## Phases 3–8 — Not started ⬜

Object storage & asset service, ingestion, delivery, retention/GC, observability, cloud/scale. See [`../ROADMAP.md`](../ROADMAP.md). Phase 3 builds directly on the Phase 2 adapter interface, connection tables, and credential envelope.
