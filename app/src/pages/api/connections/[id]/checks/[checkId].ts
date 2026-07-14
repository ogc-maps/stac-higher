/**
 * GET /api/connections/[id]/checks/[checkId] — poll a test-connection
 * request (ADR 0004). Read-only: returns the check row the pipeline updates
 * (pending → running → done|failed, with a {ok, message, latency_ms?}
 * result). The bridge-internal host_key field is stripped — pins surface as
 * fingerprints on the connection resource.
 *
 * Access: member+ of the owning group, or admin (same visibility as reading
 * the connection itself).
 */
import type { APIRoute } from "astro";
import {
  isUuid,
  jsonResponse,
  loadVisibleConnection,
} from "@/lib/connections/access";
import { getConnectionCheck } from "@/lib/connections/storage";

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const loaded = await loadVisibleConnection(locals.auth, params.id, false);
    if ("response" in loaded) return loaded.response;
    if (!isUuid(params.checkId)) {
      return jsonResponse(404, { error: "Check not found" });
    }
    const check = await getConnectionCheck(
      loaded.connection.id,
      params.checkId,
    );
    if (!check) return jsonResponse(404, { error: "Check not found" });
    return jsonResponse(200, { check });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(500, { error: message });
  }
};
