import { expect, it, vi } from "vitest";
import { getSettings, setSettings } from "@/lib/storage";
import { persistToServer } from "@/lib/api";
vi.mock("@/lib/api", () => ({ persistToServer: vi.fn() }));
it("sends secrets to the server without caching them and cleans legacy cached credentials", () => {
  localStorage.clear();
  const settings = { ...getSettings(), discordWebhookUrl: "PRIVATE_WEBHOOK" };
  setSettings(settings);
  expect(persistToServer).toHaveBeenCalledWith("wv_settings", settings);
  expect(localStorage.getItem("wv_settings")).not.toContain("PRIVATE_WEBHOOK");
  localStorage.setItem("wv_settings", JSON.stringify(settings));
  expect(getSettings().discordWebhookUrl).toBe("");
  expect(localStorage.getItem("wv_settings")).not.toContain("PRIVATE_WEBHOOK");
  expect(JSON.parse(localStorage.getItem("wv_settings")!).discordWebhookUrlSet).toBe(true);
});
