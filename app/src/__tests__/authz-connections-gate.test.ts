// @vitest-environment node
// (pure policy table — no DOM involved)
import { describe, it, expect } from "vitest";
import { matchGatedRoute } from "@/lib/authz/permissions";

const ID = "3a9f1c2e-0000-4000-8000-000000000001";

describe("matchGatedRoute — /api/connections (Phase 2)", () => {
  it("gates POST /api/connections as a connection create", () => {
    expect(matchGatedRoute("POST", "/api/connections")).toEqual({
      action: "create",
      resourceType: "connection",
      resourceId: null,
    });
  });

  it("gates PUT/PATCH/DELETE /api/connections/[id]", () => {
    expect(matchGatedRoute("PUT", `/api/connections/${ID}`)).toEqual({
      action: "update",
      resourceType: "connection",
      resourceId: ID,
    });
    expect(matchGatedRoute("PATCH", `/api/connections/${ID}`)?.action).toBe(
      "update",
    );
    expect(matchGatedRoute("DELETE", `/api/connections/${ID}`)).toEqual({
      action: "delete",
      resourceType: "connection",
      resourceId: ID,
    });
  });

  it("gates the test endpoint with the §5 audit action 'test'", () => {
    expect(matchGatedRoute("POST", `/api/connections/${ID}/test`)).toEqual({
      action: "test",
      resourceType: "connection",
      resourceId: ID,
    });
  });

  it("gates host-key reset as a connection update", () => {
    expect(
      matchGatedRoute("POST", `/api/connections/${ID}/host-key/reset`),
    ).toEqual({
      action: "update",
      resourceType: "connection",
      resourceId: ID,
    });
  });

  it("leaves reads ungated (auth is enforced in the routes)", () => {
    expect(matchGatedRoute("GET", "/api/connections")).toBeNull();
    expect(matchGatedRoute("GET", `/api/connections/${ID}`)).toBeNull();
    expect(
      matchGatedRoute("GET", `/api/connections/${ID}/checks/${ID}`),
    ).toBeNull();
  });

  it("does not gate unrelated POST subpaths", () => {
    expect(matchGatedRoute("POST", `/api/connections/${ID}/checks`)).toBeNull();
  });
});
