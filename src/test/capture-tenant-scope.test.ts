import { afterEach, describe, expect, it, vi } from "vitest";
import { captureAlbum, ownsCapture } from "@/lib/capture-scope";
import { runUploadSpeedTest } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("capture account isolation", () => {
  it("never reassigns tenant or legacy queued photos to a different login", () => {
    expect(ownsCapture({ tenantSlug: "studio-a" }, "studio-a")).toBe(true);
    expect(ownsCapture({ tenantSlug: "studio-a" }, "studio-b")).toBe(false);
    expect(ownsCapture({ tenantSlug: "studio-a" }, null)).toBe(false);
    expect(ownsCapture({ tenantSlug: null }, "studio-b")).toBe(false);
    expect(ownsCapture({}, null)).toBe(false);
    expect(ownsCapture({}, "studio-a")).toBe(false);
    expect(ownsCapture({ tenantSlug: null }, null)).toBe(true);
  });

  it("keeps FTP destinations isolated even when album IDs match", () => {
    const destination = { albumId: "same-id", tenantSlug: "studio-a" };
    expect(captureAlbum(destination, "studio-a")).toBe("same-id");
    expect(captureAlbum(destination, "studio-b")).toBeUndefined();
    expect(captureAlbum(destination, null)).toBeUndefined();
    expect(captureAlbum("legacy-album", null)).toBeUndefined();
    expect(captureAlbum(undefined, "studio-a")).toBeUndefined();
  });

  it("sends tenant speed tests to the authenticated tenant scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bytes: 1024 }) });
    vi.stubGlobal("fetch", fetchMock);
    await runUploadSpeedTest(1024, "studio-a");
    expect(fetchMock).toHaveBeenCalledWith("/api/upload/speed-test?tenant=studio-a", expect.objectContaining({ method: "POST" }));
    await runUploadSpeedTest(1024);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/upload/speed-test", expect.anything());
  });
});
