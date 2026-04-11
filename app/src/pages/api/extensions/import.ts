import type { APIRoute } from "astro";
import { z } from "zod";
import {
  createExtension,
  getExtensionBySourceUrl,
} from "@/lib/extensions/storage";

const importSchema = z.object({
  url: z.string().url("Must be a valid URL"),
});

function extractPrefix(properties: Record<string, unknown>): string {
  const keys = Object.keys(properties);
  const prefixed = keys.filter((k) => k.includes(":"));
  if (prefixed.length > 0) {
    const prefix = prefixed[0].split(":")[0];
    return prefix.toLowerCase();
  }
  return "ext";
}

function extractVersion(schemaUrl: string): string {
  const match = schemaUrl.match(/\/v?(\d+\.\d+\.\d+)\//);
  return match ? match[1] : "1.0.0";
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: "Validation failed",
          details: parsed.error.issues,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const { url } = parsed.data;

    const existing = await getExtensionBySourceUrl(url);
    if (existing) {
      return new Response(JSON.stringify(existing), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let schema: Record<string, unknown>;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return new Response(
          JSON.stringify({
            error: `Failed to fetch schema: ${res.status} ${res.statusText}`,
          }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }
      schema = await res.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return new Response(
        JSON.stringify({ error: `Failed to fetch schema: ${message}` }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!schema.type && !schema.properties && !schema.allOf && !schema.oneOf) {
      return new Response(
        JSON.stringify({ error: "Document does not appear to be a valid JSON Schema" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const prefix = extractPrefix(properties);
    const version = extractVersion(url);
    const name =
      (schema.title as string)?.replace(/ Extension$/, "") ?? prefix;
    const description = (schema.description as string) ?? "";

    const extension = await createExtension({
      name,
      prefix,
      version,
      description,
      schema,
      source: "external",
      sourceUrl: url,
    });

    return new Response(JSON.stringify(extension), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
