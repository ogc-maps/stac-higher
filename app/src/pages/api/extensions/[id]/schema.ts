import type { APIRoute } from "astro";
import { getExtension } from "@/lib/extensions/storage";

export const GET: APIRoute = async ({ params, url }) => {
  try {
    const extension = await getExtension(params.id!);
    if (!extension) {
      return new Response(JSON.stringify({ error: "Extension not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const schema = { ...extension.schema, $id: url.toString() };

    return new Response(JSON.stringify(schema, null, 2), {
      headers: { "Content-Type": "application/schema+json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
