import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateCapabilityToken } from "@/lib/capability-token";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("capability token generation", () => {
  it("creates unique 192-bit, URL-safe bearer capabilities", () => {
    const first = generateCapabilityToken("ct");
    const second = generateCapabilityToken("ct");

    expect(first).toMatch(/^ct-[a-f\d]{48}$/);
    expect(second).toMatch(/^ct-[a-f\d]{48}$/);
    expect(second).not.toBe(first);
  });

  it("never falls back to Math.random", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random must not be used for bearer capabilities");
    });

    expect(() => generateCapabilityToken("mod")).not.toThrow();
  });

  it("fails closed when secure randomness is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => generateCapabilityToken("inv")).toThrow(/secure random token generation is unavailable/i);
  });

  it("keeps capability-bearing call sites off timestamp and Math.random generators", () => {
    for (const relativePath of [
      "src/pages/Admin.tsx",
      "src/pages/TenantAdmin.tsx",
      "src/pages/Booking.tsx",
      "src/pages/AlbumDetail.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).not.toMatch(/(?:clientToken|shareToken|modifyToken)[^\n]*Math\.random/);
    }
  });
});
