import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("delivery API", () => {
  it("sends the reviewed photo snapshot and warning details for live server validation", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, deliveredAt: "2026-10-02T00:00:00Z" }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { deliverAlbum } = await import("@/lib/api");
    const photos = [{ id: "photo-1", src: "/uploads/photo-1.jpg" }] as import("@/lib/types").Photo[];
    const acknowledgedWarnings = [{ id: "payment", detail: "1 linked invoice still outstanding" }];

    const result = await deliverAlbum("album-1", photos, acknowledgedWarnings, "revision-4");

    expect(result?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      expectedPhotoCount: 1,
      expectedPhotos: [{ id: "photo-1", src: "/uploads/photo-1.jpg" }],
      acknowledgedWarnings,
      photoRevision: "revision-4",
    });
  });

  it("surfaces a changed-readiness response without marking delivery successful", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "Delivery checks changed since you reviewed them.",
      warnings: [{ id: "payment", detail: "Invoice now overdue" }],
    }), { status: 409, headers: { "content-type": "application/json" } })));
    const { deliverAlbum } = await import("@/lib/api");
    const result = await deliverAlbum("album-1", [], []);
    expect(result).toMatchObject({ ok: false, error: "Delivery checks changed since you reviewed them.", warnings: [{ id: "payment", detail: "Invoice now overdue" }] });
  });
});
