import type { APIRoute } from "astro";
import {
  getExtension,
  updateExtension,
  deleteExtension,
} from "@/lib/extensions/storage";
import {
  extensionFormSchema,
  formToExtensionSchema,
} from "@/lib/extensions/schemas";

export const GET: APIRoute = async ({ params }) => {
  try {
    const extension = await getExtension(params.id!);
    if (!extension) {
      return new Response(JSON.stringify({ error: "Extension not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(extension), {
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

export const PUT: APIRoute = async ({ params, request, url }) => {
  try {
    const existing = await getExtension(params.id!);
    if (!existing) {
      return new Response(JSON.stringify({ error: "Extension not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

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
    const schemaUrl = `${url.origin}/api/extensions/${params.id}/schema`;
    const schema = formToExtensionSchema(data, schemaUrl);

    const updated = await updateExtension(params.id!, {
      name: data.name,
      prefix: data.prefix,
      version: data.version,
      description: data.description,
      schema,
    });

    return new Response(JSON.stringify(updated), {
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

export const DELETE: APIRoute = async ({ params }) => {
  try {
    const existing = await getExtension(params.id!);
    if (!existing) {
      return new Response(JSON.stringify({ error: "Extension not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    await deleteExtension(params.id!);
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
