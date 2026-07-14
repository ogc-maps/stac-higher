/**
 * /api/connections/[id] — get / update / delete (ROADMAP Phase 2, §7).
 *
 * GET    — member+ of the owning group, or admin. No credentials, ever.
 * PUT    — operator+ of the owning group, or admin. Protocol is immutable;
 *          `credentials`, when present, replaces the envelope WHOLESALE
 *          (no merge — the app cannot decrypt, so there is nothing to merge
 *          into). An SSH-family host/port change clears the TOFU pin.
 * DELETE — operator+ of the owning group, or admin.
 *
 * A connection outside the caller's groups is a 404 (existence is
 * group-scoped, §7). Role enforcement + audit live in the middleware guard;
 * roles are re-checked here for defense in depth.
 */
import type { APIRoute } from "astro";
import { authzError } from "@/lib/authz/guard";
import {
  canAccessGroup,
  jsonResponse,
  loadVisibleConnection,
  notFound,
} from "@/lib/connections/access";
import { getEncryptionProvider, CredentialKeyError } from "@/lib/connections/crypto";
import { parseConnectionUpdate } from "@/lib/connections/schemas";
import {
  deleteConnection,
  shouldClearHostKey,
  updateConnection,
} from "@/lib/connections/storage";

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const loaded = await loadVisibleConnection(locals.auth, params.id, false);
    if ("response" in loaded) return loaded.response;
    return jsonResponse(200, loaded.connection);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(500, { error: message });
  }
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  try {
    const loaded = await loadVisibleConnection(locals.auth, params.id, true);
    if ("response" in loaded) return loaded.response;
    const existing = loaded.connection;
    const auth = locals.auth;

    const body = await request.json().catch(() => null);
    const parsed = parseConnectionUpdate(body, existing.protocol);
    if (!parsed.success) {
      return jsonResponse(400, {
        error: "Validation failed",
        details: parsed.error.issues,
      });
    }
    const data = parsed.data;

    // Moving a connection into a group the caller does not belong to would
    // let an operator launder resources across group boundaries (§7).
    if (
      data.group_id !== undefined &&
      auth.authenticated &&
      !canAccessGroup(auth.identity, data.group_id)
    ) {
      return authzError(
        403,
        "forbidden",
        "group_id must be one of your groups",
      );
    }

    const encryptedCredentials =
      data.credentials !== undefined
        ? getEncryptionProvider().encrypt(JSON.stringify(data.credentials))
        : undefined;

    const updated = await updateConnection(existing.id, {
      name: data.name,
      description: data.description,
      groupId: data.group_id,
      enabled: data.enabled,
      config: data.config,
      encryptedCredentials,
      clearHostKey: shouldClearHostKey(
        existing.protocol,
        existing.config,
        data.config,
      ),
    });
    if (!updated) return notFound();
    return jsonResponse(200, updated);
  } catch (err) {
    if (err instanceof CredentialKeyError) {
      return jsonResponse(500, { error: err.message });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(500, { error: message });
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  try {
    const loaded = await loadVisibleConnection(locals.auth, params.id, true);
    if ("response" in loaded) return loaded.response;
    await deleteConnection(loaded.connection.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(500, { error: message });
  }
};
