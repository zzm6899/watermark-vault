import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildDownloadCaptureRecord,
  freeAccessRequiresCapture,
  hashDownloadIdentifier,
  normalizeDownloadEmail,
  normalizeDownloadEmailPolicy,
  recordMatchesRequest,
} = require("../../server/download-email-capture.js") as {
  buildDownloadCaptureRecord: (input: Record<string, unknown>) => Record<string, any>;
  freeAccessRequiresCapture: (policy: string, usesFreeAccess: boolean, hasValidCapture: boolean) => boolean;
  hashDownloadIdentifier: (value: string, secret: string) => string;
  normalizeDownloadEmail: (value: unknown) => string | null;
  normalizeDownloadEmailPolicy: (value: unknown) => string;
  recordMatchesRequest: (record: Record<string, unknown>, albumId: string, sessionKey: string, secret: string) => boolean;
};

describe("free-download email capture", () => {
  it("normalizes supported album policies and safely defaults unknown values", () => {
    expect(normalizeDownloadEmailPolicy(" REQUIRED ")).toBe("required");
    expect(normalizeDownloadEmailPolicy("optional")).toBe("optional");
    expect(normalizeDownloadEmailPolicy("always")).toBe("off");
    expect(normalizeDownloadEmailPolicy(undefined)).toBe("off");
  });

  it("normalizes valid addresses and rejects malformed or oversized values", () => {
    expect(normalizeDownloadEmail(" Client@Example.COM ")).toBe("client@example.com");
    expect(normalizeDownloadEmail("not-an-email")).toBeNull();
    expect(normalizeDownloadEmail(`${"a".repeat(65)}@example.com`)).toBeNull();
    expect(normalizeDownloadEmail(`${"a".repeat(245)}@example.com`)).toBeNull();
  });

  it("requires capture only when required-policy downloads use free access", () => {
    expect(freeAccessRequiresCapture("required", true, false)).toBe(true);
    expect(freeAccessRequiresCapture("required", true, true)).toBe(false);
    expect(freeAccessRequiresCapture("required", false, false)).toBe(false);
    expect(freeAccessRequiresCapture("optional", true, false)).toBe(false);
  });

  it("stores bounded metadata and hashes session/network identifiers", () => {
    const now = new Date("2026-07-19T10:00:00.000Z");
    const record = buildDownloadCaptureRecord({
      email: "Client@Example.com",
      album: { id: "album-1", slug: "wedding", title: "Wedding Gallery" },
      tenantSlug: "zac",
      sessionKey: "private-session",
      ip: "203.0.113.42",
      userAgent: "x".repeat(500),
      secret: "test-secret",
      now,
    });

    expect(record.email).toBe("client@example.com");
    expect(record.sessionHash).toBe(hashDownloadIdentifier("private-session", "test-secret"));
    expect(record.ipHash).toBe(hashDownloadIdentifier("203.0.113.42", "test-secret"));
    expect(record).not.toHaveProperty("sessionKey");
    expect(record).not.toHaveProperty("ip");
    expect(record.userAgent).toHaveLength(300);
    expect(record.createdAt).toBe(now.toISOString());
  });

  it("binds capture IDs to both album and hashed session", () => {
    const record = buildDownloadCaptureRecord({
      email: "client@example.com",
      album: { id: "album-1" },
      sessionKey: "session-a",
      secret: "test-secret",
    });

    expect(recordMatchesRequest(record, "album-1", "session-a", "test-secret")).toBe(true);
    expect(recordMatchesRequest(record, "album-2", "session-a", "test-secret")).toBe(false);
    expect(recordMatchesRequest(record, "album-1", "session-b", "test-secret")).toBe(false);
  });
});
