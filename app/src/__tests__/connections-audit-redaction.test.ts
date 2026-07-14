// @vitest-environment node
// (server-side audit path — no DOM involved)
//
// Proves the Phase 2 invariant end-to-end at the audit seam: even if a
// connection payload (with live secrets) were ever passed into the audit
// detail, nothing credential-shaped reaches the INSERT. The guard only ever
// writes method/path/outcome — this is defense in depth on top of that.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/connection", () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock("@/lib/db/migrate", () => ({
  runMigrations: vi.fn(async () => {}),
}));

import { query } from "@/lib/db/connection";
import { sanitizeDetail, writeAudit } from "@/lib/audit/log";

const mockQuery = vi.mocked(query);

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

const SECRETS = [
  "hunter2-ftp-password",
  "AKIA-secret-access-key-value",
  "sess-token-value",
  "key-passphrase-value",
];

/** A full POST /api/connections body for each protocol, secrets included. */
const connectionPayloads = {
  sftp: {
    name: "SFTP drop",
    protocol: "sftp",
    group_id: "earth-observation",
    config: { host: "sftp.example.com", port: 22, root_path: "/" },
    credentials: {
      username: "ingest",
      password: "hunter2-ftp-password",
      private_key: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
      passphrase: "key-passphrase-value",
    },
  },
  s3: {
    name: "Bucket",
    protocol: "s3",
    group_id: "earth-observation",
    config: { bucket: "stac-higher" },
    credentials: {
      access_key_id: "AKIAEXAMPLE",
      secret_access_key: "AKIA-secret-access-key-value",
      session_token: "sess-token-value",
    },
  },
  ftp: {
    name: "FTP",
    protocol: "ftp",
    group_id: "earth-observation",
    config: { host: "ftp.example.com", port: 21, root_path: "/" },
    credentials: { username: "u", password: "hunter2-ftp-password" },
  },
};

describe("connection payloads never reach the audit log", () => {
  it.each(Object.entries(connectionPayloads))(
    "redacts the whole credentials object from a %s payload",
    (_protocol, payload) => {
      const sanitized = sanitizeDetail(payload) as Record<string, unknown>;
      // The credentials KEY is credential-shaped, so the entire object is
      // replaced — individual fields cannot survive.
      expect(sanitized.credentials).toBe("[REDACTED]");
      const text = JSON.stringify(sanitized);
      for (const secret of SECRETS) expect(text).not.toContain(secret);
      expect(text).not.toContain("-----BEGIN");
      // Non-secret context stays intact for the audit trail.
      expect(sanitized.name).toBe(payload.name);
      expect(sanitized.group_id).toBe("earth-observation");
    },
  );

  it("keeps secrets out of the INSERTed row even when a caller passes a request body wholesale", async () => {
    await writeAudit({
      actor: "user-1",
      actorGroups: ["earth-observation"],
      action: "create",
      resourceType: "connection",
      detail: { body: connectionPayloads.sftp },
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO stac_higher\.audit_log/);
    const inserted = JSON.stringify(params);
    for (const secret of SECRETS) expect(inserted).not.toContain(secret);
    expect(inserted).not.toContain("PRIVATE KEY");
  });

  it("redacts secret-shaped values hiding under innocent keys", () => {
    const sanitized = sanitizeDetail({
      note: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc",
      header: "Bearer eyJhbGciOiJIUzI1NiJ9.x.y",
    }) as Record<string, unknown>;
    expect(sanitized.note).toBe("[REDACTED]");
    expect(sanitized.header).toBe("[REDACTED]");
  });
});
