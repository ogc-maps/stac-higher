// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sanitizeReturnTo } from "../pages/api/auth/login";

describe("sanitizeReturnTo", () => {
  it("accepts plain same-origin paths", () => {
    expect(sanitizeReturnTo("/collections")).toBe("/collections");
    expect(sanitizeReturnTo("/collections/x/items?page=2#top")).toBe(
      "/collections/x/items?page=2#top",
    );
  });

  it("falls back to / for empty or non-path values", () => {
    expect(sanitizeReturnTo(null)).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
    expect(sanitizeReturnTo("https://evil.com")).toBe("/");
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe("/");
    expect(sanitizeReturnTo("collections")).toBe("/");
  });

  it("rejects scheme-relative redirects", () => {
    expect(sanitizeReturnTo("//evil.com")).toBe("/");
    expect(sanitizeReturnTo("//evil.com/path")).toBe("/");
  });

  it("rejects backslash bypasses (CWE-601 — browsers normalize \\ to /)", () => {
    expect(sanitizeReturnTo("/\\evil.com")).toBe("/");
    expect(sanitizeReturnTo("/\\/evil.com")).toBe("/");
    expect(sanitizeReturnTo("/\\\\evil.com")).toBe("/");
    expect(sanitizeReturnTo("/path\\..\\evil")).toBe("/");
  });

  it("always returns a value that resolves same-origin", () => {
    for (const raw of [
      "/..//evil.com",
      "/%5Cevil.com",
      "/a/../b",
      "/\\evil.com",
      "//evil.com",
      "/ok?x=//evil.com",
    ]) {
      const out = sanitizeReturnTo(raw);
      const resolved = new URL(out, "http://app.local");
      expect(resolved.origin).toBe("http://app.local");
    }
  });
});
