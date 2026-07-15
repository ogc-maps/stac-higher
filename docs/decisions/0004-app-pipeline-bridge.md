# ADR 0004 — App→pipeline bridge for test-connection: a request table

- **Status:** accepted (Phase 2)
- **Owners:** connections API (app) + pipeline drain job
- **Related:** ROADMAP §5.2, §5.5, Phase 2; ADR 0001 (migration ownership)

## Context

"Test connection" starts in the Astro app (the user clicks *Test*) but must
execute in the Python pipeline service — that is the only place credentials
are ever decrypted (ROADMAP §5.2) and the only runtime with the protocol
adapters and the egress policy. The two runtimes share exactly one durable
medium today: Postgres.

The pipeline's job queue sits behind a `QueueBackend` interface with
Procrastinate (LISTEN/NOTIFY) as the default backend and SQS planned for AWS
deployments. Having the TypeScript app enqueue jobs directly would mean
either speaking Procrastinate's internal table format from Node (coupling us
to a Python library's private schema, and breaking the moment a deployment
selects the SQS backend) or standing up an HTTP control surface on the
pipeline for a Phase 2 feature that needs none.

## Decision

A **request table**, owned by the app's migrations (ADR 0001): the app
INSERTs a `pending` row into `stac_higher.connection_checks` and polls it;
the pipeline drains it.

- **App (writer/poller):** `POST /api/connections/[id]/test` inserts
  `{connection_id, requested_by, status: 'pending'}` and returns the row
  (202). `GET /api/connections/[id]/checks/[checkId]` polls it. The write is
  audited with action `test`.
- **Pipeline (drainer):** a periodic drain job (~every 10 s, registered
  through the existing `QueueBackend` interface) claims pending rows with
  `FOR UPDATE SKIP LOCKED`, sets `status='running'`, runs `adapter.test`,
  writes `result` jsonb `{ok, message, host_key?, latency_ms?}`, sets
  `status='done'|'failed'` + `finished_at`, and updates the parent
  connection row (`status` ok|error, `last_checked_at`, `last_error`, and
  `host_key`/`host_key_pinned_at` on the first successful SSH-family test).
- **Health sweep:** a separate periodic job (~every 5 min) tests all enabled
  connections and updates the same connection fields — no
  `connection_checks` rows involved.

## Consequences

- No coupling from TypeScript to Procrastinate internals; the bridge is
  backend-agnostic (a deployment on SQS drains the same table).
- Postgres stays the single source of record; the row doubles as the
  test-result history.
- Latency is bounded by the drain interval (~10 s worst case before a test
  starts). Acceptable for a human-driven "Test" button with a polling UI.
- The app never learns raw host keys or credentials from the bridge: the
  poll endpoint strips `result.host_key` (pins surface as fingerprints on
  the connection resource), and the app never decrypts `credentials`.

## Revisit

When Phase 5 needs backfill/redeliver **triggers** from the app, this
"insert a request row + periodic drain" pattern is too slow/loose — revisit
with a proper enqueue seam (e.g. a NOTIFY-woken drain, or a thin pipeline
control endpoint) rather than multiplying request tables.
