import { expect, it, vi } from "vitest";
import { getSettings, setSettings } from "@/lib/storage";
import { persistToServer } from "@/lib/api";
vi.mock("@/lib/api", () => ({ persistToServer: vi.fn(), retryPendingWrites: vi.fn().mockResolvedValue(undefined) }));
it("sends secrets to the server without caching them and cleans legacy cached credentials", async () => {
  localStorage.clear();
  const settings = { ...getSettings(), discordWebhookUrl: "PRIVATE_WEBHOOK" };
  expect(await setSettings(settings)).toBe(true);
  expect(persistToServer).toHaveBeenCalledWith("wv_settings", settings);
  expect(localStorage.getItem("wv_settings")).not.toContain("PRIVATE_WEBHOOK");
  localStorage.setItem("wv_settings", JSON.stringify(settings));
  expect(getSettings().discordWebhookUrl).toBe("");
  expect(localStorage.getItem("wv_settings")).not.toContain("PRIVATE_WEBHOOK");
  expect(JSON.parse(localStorage.getItem("wv_settings")!).discordWebhookUrlSet).toBe(true);
});
