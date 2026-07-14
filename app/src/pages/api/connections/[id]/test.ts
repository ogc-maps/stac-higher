/**
 * POST /api/connections/[id]/test — request a connectivity test.
 *
 * The app half of the app→pipeline bridge (ADR 0004
 * docs/decisions/0004-app-pipeline-bridge.md): INSERT one pending row into
 * stac_higher.connection_checks and return it (202). The pipeline's drain
 * job (~10 s) claims pending rows with FOR UPDATE SKIP LOCKED, runs
 * adapter.test, writes result/finished_at, and updates the parent
 * connection's status/last_checked_at/host_key. Clients poll
 * GET /api/connections/[id]/checks/[checkId].
 *
 * Access: operator+ of the owning group, or admin. The middleware guard
 * audits this route with action "test" (ROADMAP §5.5: every test-connection
 * lands in audit_log).
 */
import type { APIRoute } from "astro";
import {
  jsonResponse,
  loadVisibleConnection,
} from "@/lib/connections/access";
import { insertConnectionCheck } from "@/lib/connections/storage";

export const POST: APIRoute = async ({ params, locals }) => {
  try {
    const loaded = await loadVisibleConnection(locals.auth, params.id, true);
    if ("response" in loaded) return loaded.response;
    // loadVisibleConnection guarantees an authenticated identity here.
    const identity = locals.auth.authenticated ? locals.auth.identity : null;
    const check = await insertConnectionCheck(
      loaded.connection.id,
      identity?.sub ?? "unknown",
    );
    return jsonResponse(202, { check });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(500, { error: message });
  }
};
