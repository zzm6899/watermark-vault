import { afterEach, expect, it, vi } from "vitest";
import { uploadPhotosToServer } from "@/lib/api";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

it("acknowledges the exact File object when two filenames match", async () => {
  const first = new File(["one"], "same.jpg", { type: "image/jpeg" });
  const second = new File(["two"], "same.jpg", { type: "image/jpeg" });
  let sequence = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/health") return json({ ok: true });
    expect((options?.body as FormData).getAll("photos")).toHaveLength(1);
    return json({ files: [{ id: `photo-${++sequence}`, url: "/photo.jpg", originalName: "same.jpg" }] });
  }));
  const acknowledged = vi.fn();
  await uploadPhotosToServer([first, second], undefined, undefined, 3, "Album", "album", false, "balanced", undefined, acknowledged);
  expect(acknowledged.mock.calls[0][0]).toBe(first);
  expect(acknowledged.mock.calls[1][0]).toBe(second);
});

it("waits for in-flight successes before reporting an authentication failure", async () => {
  const first = new File(["one"], "first.jpg", { type: "image/jpeg" });
  const second = new File(["two"], "second.jpg", { type: "image/jpeg" });
  let finish: (response: Response) => void = () => {};
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (url === "/api/health") return Promise.resolve(json({ ok: true }));
    const file = (options?.body as FormData).get("photos") as File;
    if (file.name === "first.jpg") return Promise.resolve(json({ error: "Expired" }, 401));
    return new Promise<Response>(resolve => { finish = resolve; });
  }));
  const acknowledged = vi.fn();
  let settled = false;
  const result = uploadPhotosToServer([first, second], undefined, undefined, 3, "Album", "album", false, "balanced", undefined, acknowledged).catch(error => { settled = true; return error; });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(settled).toBe(false);
  finish(json({ files: [{ id: "photo", url: "/photo.jpg", originalName: "second.jpg" }] }));
  expect((await result).message).toMatch(/Sign in again/);
  expect(acknowledged.mock.calls[0][0]).toBe(second);
});
