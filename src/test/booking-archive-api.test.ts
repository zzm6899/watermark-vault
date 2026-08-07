import { afterEach, describe, expect, it, vi } from "vitest";
import { setBookingArchiveState } from "@/lib/api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("booking archive API", () => {
  it("uses the narrow authenticated bulk mutation contract", async () => {
    const updated = { id: "booking-1", archived: true, archivedAt: "2026-08-08T00:00:00.000Z" };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => jsonResponse({
      ok: true,
      archived: true,
      updated: [updated],
      changedIds: ["booking-1"],
      unchangedIds: [],
      skipped: [{ id: "booking-live", reason: "active-booking" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await setBookingArchiveState(["booking-1", "booking-live"], true);

    expect(result.ok).toBe(true);
    expect(result.updated).toEqual([updated]);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/bookings/archive");
    expect(request?.method).toBe("PATCH");
    expect(JSON.parse(String(request?.body))).toEqual({
      bookingIds: ["booking-1", "booking-live"],
      archived: true,
    });
  });
});
