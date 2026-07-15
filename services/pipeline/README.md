# stac-higher-pipeline

The data-plane pipeline service for STAC Higher (ROADMAP §3). Phase 0 scope:
package skeleton, a queue interface with a Procrastinate (PostgreSQL) backend,
a no-op scheduled heartbeat job, and a `/health` endpoint.

Later phases add the ingest scheduler/workers, delivery workers, retention GC,
and the flow monitor behind the same queue interface.

## Layout

```
src/pipeline/
  config.py                    # env-driven settings (see contract below)
  log.py                       # structured JSON logging (stdlib only)
  health.py                    # FastAPI /health app factory
  main.py                      # entrypoint: schema setup + worker + health server
  queue/
    interface.py               # QueueBackend ABC — business logic depends on this
    memory.py                  # in-memory backend for unit tests
    procrastinate_backend.py   # Procrastinate (LISTEN/NOTIFY) backend
  jobs/
    heartbeat.py               # periodic no-op heartbeat job
```

## Queue interface

Business logic never imports Procrastinate. It registers handlers and enqueues
work through `pipeline.queue.interface.QueueBackend`:

- `register_task(func, name=...)` / `register_periodic(func, name=..., cron=...)`
- `enqueue(job_name, payload)` / `enqueue_batch(job_name, payloads)` — jobs are
  batch-oriented (one job = N files/items) per the roadmap's topology decision
- `setup()` — idempotent one-time infrastructure prep (Procrastinate: apply its
  schema; SQS in Phase 8: validate queues)
- `run_worker()` — consume and execute jobs
- `check_connection()` — raises `QueueConnectionError` when the backend is down

The Procrastinate backend installs its objects into a dedicated `procrastinate`
PostgreSQL schema (see `docs/decisions/0001-migration-ownership.md`). An SQS
backend lands in Phase 8 as a second implementation of the same ABC.

## Environment contract

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://username:password@localhost:5433/postgis` | Postgres for the job queue **and** `stac_higher.connections`/`connection_checks` (compose-internal value: `postgresql://username:password@database:5432/postgis`) |
| `HEALTH_PORT` | `8083` | Port for the `/health` HTTP server |
| `QUEUE_SCHEMA` | `procrastinate` | PostgreSQL schema owned by Procrastinate |
| `LOG_LEVEL` | `INFO` | Root log level |
| `CREDENTIALS_MASTER_KEY` | _(unset)_ | base64-encoded 32-byte AES-256-GCM key, **identical to the app's**. Decrypts connection credentials. Absent at startup is tolerated — the connection drain/health-sweep ticks fail loudly (logged) instead of killing the process. |
| `EGRESS_ALLOW_HOSTS` | _(empty)_ | Comma-separated hostnames the egress policy permits even when they resolve to private/loopback addresses (e.g. the compose-internal test servers). Matched case-insensitively. |

## Connections (Phase 2)

The pipeline is the only runtime that decrypts connection credentials and the
only one with the protocol adapters + egress policy (ROADMAP §5.2, ADR 0004).
All of this lives under `src/pipeline/connections/`:

- **`envelope.py`** — decrypt/seal the credential envelope (`0x01` version ‖
  12-byte nonce ‖ AES-256-GCM ciphertext+tag), byte-for-byte compatible with
  the app's `crypto.ts`. A cross-runtime known-answer test locks the format.
- **`egress.py`** — deny-by-default SSRF guard: resolves the target host and
  blocks loopback/private/link-local/unique-local/multicast/reserved and the
  cloud metadata IP (v4 + v6, incl. IPv4-mapped forms). `EGRESS_ALLOW_HOSTS`
  is the only escape hatch. Every adapter calls it before opening a socket.
- **`adapters/`** — `StorageAdapter` ABC (`test/list/get/put/delete`) with
  `S3Adapter` (boto3), `SftpAdapter` (asyncssh; serves `ssh` + `sftp`, exposes
  the server host key), `FtpAdapter` / `FtpsAdapter` (aioftp; FTPS does
  implicit or explicit TLS). `adapter_for(row, credentials)` is the factory;
  `stac-api` raises `NotImplementedError`.
- **`adapters/tofu.py`** — pure trust-on-first-use decision: first-pin when no
  key is stored, match, or a hard-fail mismatch.
- **`repo.py`** / **`probe.py`** — the DB seam over the two tables and the
  decrypt→adapter→TOFU pipeline both jobs share.

### Jobs

| Job (periodic name) | Cron | What it does |
|---|---|---|
| `pipeline.connection_check_drain` | `* * * * *` | Drains **all** pending `connection_checks` rows (`FOR UPDATE SKIP LOCKED`), runs `adapter.test()`, writes the check `result` + updates the parent connection's health and TOFU pin. |
| `pipeline.connection_health_sweep` | `*/5 * * * *` | Tests every enabled connection and updates its health columns (no `connection_checks` rows). |

Both jobs only UPDATE `status`/`last_checked_at`/`last_error`/`host_key`/
`host_key_pinned_at` — **never `connections.updated_at`** (that means "user last
edited") — and never create the tables (ADR 0001).

**Drain cadence (accepted deviation):** Procrastinate's periodic scheduler is
1-minute-granular, so ADR 0004's "~10 s" drain target is approximated by a
1-minute tick that clears the whole pending backlog at once. True sub-minute
latency needs a NOTIFY-woken drain — flagged in ADR 0004 "Revisit", not built in
Phase 2.

### Integration test servers

`infra/compose.test-servers.yml` (repo root) stands up throwaway SFTP/FTP/FTPS
servers on the compose network for the **lead** to run adapter integration
against (S3 reuses MinIO). Unit tests here mock every external client and DNS —
no live servers, no Docker.

## Develop

Requires [uv](https://docs.astral.sh/uv/) (falls back to `python3 -m venv` +
`pip install -e ".[dev]"`).

```sh
cd services/pipeline
uv sync --extra dev      # create .venv and install
uv run pytest            # unit tests (no database needed)
uv run ruff check .      # lint
uv run pipeline          # run the service (needs Postgres per DATABASE_URL)
```

DB-integration tests auto-skip unless `DATABASE_URL` is set:

```sh
DATABASE_URL=postgresql://username:password@localhost:5433/postgis uv run pytest
```

## Health endpoint

`GET /health` on `HEALTH_PORT` returns `200` when the queue backend is
reachable, `503` otherwise:

```json
{
  "service": "pipeline",
  "status": "ok",
  "queue": { "backend": "procrastinate", "reachable": true, "error": null },
  "heartbeat": { "count": 3, "last_run_at": "2026-07-14T12:00:00+00:00" }
}
```

## Docker

The `Dockerfile` builds a multi-stage image whose entrypoint applies the
Procrastinate schema idempotently, then runs the worker (with the periodic
heartbeat) and the health server in one process. The compose service is owned
by the docker-compose workstream; this package only ships the image.
