import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/pages/api/extensions/preview";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv("SAFE_FETCH_ALLOW_HOSTS", "example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:4321/api/extensions/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeContext(request: Request) {
  return { request } as Parameters<typeof POST>[0];
}

describe("extension preview API route", () => {
  it("returns 400 for an invalid URL", async () => {
    const res = await POST(makeContext(makeRequest({ url: "not-a-url" })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Validation failed/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 403 for a loopback target (SSRF guard)", async () => {
    const res = await POST(
      makeContext(makeRequest({ url: "http://127.0.0.1:9999/schema.json" })),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/private|loopback/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 403 for a private-range target (SSRF guard)", async () => {
    const res = await POST(
      makeContext(makeRequest({ url: "http://10.0.0.1/schema.json" })),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/private|loopback/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns extracted metadata for a valid schema", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Test Extension",
          description: "A test extension schema",
          type: "object",
          properties: { "test:field": { type: "string" } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await POST(
      makeContext(
        makeRequest({ url: "http://example.com/schemas/v1.2.3/schema.json" }),
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      name: "Test",
      prefix: "test",
      version: "1.2.3",
      description: "A test extension schema",
      propertyCount: 1,
    });
  });

  it("returns 502 when the upstream responds non-2xx", async () => {
    mockFetch.mockResolvedValue(
      new Response("not found", { status: 404 }),
    );

    const res = await POST(
      makeContext(makeRequest({ url: "http://example.com/schema.json" })),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Failed to fetch schema: 404/);
  });

  it("returns 400 when the document is not a JSON Schema", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ foo: "bar" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await POST(
      makeContext(makeRequest({ url: "http://example.com/schema.json" })),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not appear to be a valid JSON Schema/);
  });
});
