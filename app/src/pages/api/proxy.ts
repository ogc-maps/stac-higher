import type { APIRoute } from "astro";

const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "authorization"];
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
];

export const ALL: APIRoute = async ({ request }) => {
  const targetUrl = request.headers.get("X-Proxy-Target");
  if (!targetUrl) {
    return new Response(
      JSON.stringify({ error: "Missing X-Proxy-Target header" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const endpointBase = request.headers.get("X-Proxy-Endpoint");
  if (!endpointBase) {
    return new Response(
      JSON.stringify({ error: "Missing X-Proxy-Endpoint header" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid target URL" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return new Response(
      JSON.stringify({ error: "Target URL must use http or https" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const normalizedTarget = targetUrl.replace(/\/+$/, "");
  const normalizedBase = endpointBase.replace(/\/+$/, "");
  if (!normalizedTarget.startsWith(normalizedBase)) {
    return new Response(
      JSON.stringify({
        error: "Target URL does not match the declared endpoint",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers[name] = value;
    }
  }

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: `Upstream request failed: ${message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
};
