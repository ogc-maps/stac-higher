/**
 * POST /api/connections/[id]/host-key/reset — the §5.2 "re-verify" action.
 *
 * Clears the TOFU-pinned host key (and drops status to `unverified`) so the
 * NEXT successful test re-captures and re-pins the server key. This is the
 * explicit human step after a host-key mismatch hard-fails jobs — the pin is
 * never silently replaced.
 *
 * Access: operator+ of the owning group, or admin. Only meaningful for the
 * SSH family (ssh/sftp) — 400 otherwise. Audited by the middleware guard as
 * an "update" on the connection; the request path in the audit detail
 * distinguishes it from a config edit.
 */
import type { APIRoute } from "astro";
import {
  jsonResponse,
  loadVisibleConnection,
  notFound,
} from "@/lib/connections/access";
import { isSshFamily } from "@/lib/connections/schemas";
import { resetHostKey } from "@/lib/connections/storage";

export const POST: APIRoute = async ({ params, locals }) => {
  try {
    const loaded = await loadVisibleConnection(locals.auth, params.id, true);
    if ("response" in loaded) return loaded.response;
    if (!isSshFamily(loaded.connection.protocol)) {
      return jsonResponse(400, {
        error: "Host keys apply only to ssh/sftp connections",
      });
    }
    const connection = await resetHostKey(loaded.connection.id);
    if (!connection) return notFound();
    return jsonResponse(200, connection);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(500, { error: message });
  }
};
