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
| `DATABASE_URL` | `postgresql://username:password@localhost:5433/postgis` | Postgres for the job queue (compose-internal value: `postgresql://username:password@database:5432/postgis`) |
| `HEALTH_PORT` | `8083` | Port for the `/health` HTTP server |
| `QUEUE_SCHEMA` | `procrastinate` | PostgreSQL schema owned by Procrastinate |
| `LOG_LEVEL` | `INFO` | Root log level |

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
