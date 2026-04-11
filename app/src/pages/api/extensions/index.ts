import type { APIRoute } from "astro";
import { listExtensions, createExtension } from "@/lib/extensions/storage";
import {
  extensionFormSchema,
  formToExtensionSchema,
} from "@/lib/extensions/schemas";

export const GET: APIRoute = async () => {
  try {
    const extensions = await listExtensions();
    return new Response(JSON.stringify({ extensions }), {
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

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const body = await request.json();
    const parsed = extensionFormSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: "Validation failed",
          details: parsed.error.issues,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const data = parsed.data;
    const schema = formToExtensionSchema(data);

    const extension = await createExtension({
      name: data.name,
      prefix: data.prefix,
      version: data.version,
      description: data.description,
      schema,
      source: "local",
    });

    const schemaUrl = `${url.origin}/api/extensions/${extension.id}/schema`;
    schema.$id = schemaUrl;
    const { updateExtension } = await import("@/lib/extensions/storage");
    await updateExtension(extension.id, { schema });

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
