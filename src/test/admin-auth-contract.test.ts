import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_API_TOKEN_KEY,
  adminAuthHeaders,
  clearAdminApiToken,
} from "@/lib/api";

describe("native admin authentication", () => {
  beforeEach(() => localStorage.clear());

  it("never turns legacy password-equivalent storage into Basic auth", () => {
    localStorage.setItem("wv_admin", JSON.stringify({ username: "admin", passwordHash: "legacy" }));
    localStorage.setItem("wv_admin_session_hash", "sha256-password-verifier");

    expect(adminAuthHeaders()).toEqual({});
  });

  it("uses only the short-lived signed bearer", () => {
    localStorage.setItem(ADMIN_API_TOKEN_KEY, "signed-native-session");

    expect(adminAuthHeaders()).toEqual({ Authorization: "Bearer signed-native-session" });
  });

  it("clears the bearer and legacy credential remnants together", () => {
    localStorage.setItem(ADMIN_API_TOKEN_KEY, "signed-native-session");
    localStorage.setItem("wv_admin", "legacy");
    localStorage.setItem("wv_admin_session_hash", "legacy-hash");

    clearAdminApiToken();

    expect(localStorage.getItem(ADMIN_API_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem("wv_admin")).toBeNull();
    expect(localStorage.getItem("wv_admin_session_hash")).toBeNull();
  });
});
