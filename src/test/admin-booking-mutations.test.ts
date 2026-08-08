import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminBooking, deleteAdminBooking, getAdminPaymentHealth, patchAdminBooking } from "@/lib/api";
import type { Booking } from "@/lib/types";

const booking: Booking = {
  id: "booking-atomic", clientName: "Alex", clientEmail: "alex@example.test",
  date: "2026-08-29", time: "15:10", eventTypeId: "portrait", type: "Portrait",
  duration: 20, status: "pending", notes: "", createdAt: "2026-08-08T00:00:00.000Z",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("atomic admin booking contracts", () => {
  it("creates, patches and deletes one booking without using the generic store", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") return response({ ok: true, bookingId: booking.id });
      const payload = JSON.parse(String(init?.body));
      return response({ ok: true, booking: payload.booking || { ...booking, ...payload.changes } }, init?.method === "POST" ? 201 : 200);
    });
    vi.stubGlobal("fetch", fetchMock);

    expect((await createAdminBooking(booking)).ok).toBe(true);
    expect((await patchAdminBooking(booking.id, { status: "confirmed" })).booking?.status).toBe("confirmed");
    expect((await deleteAdminBooking(booking.id)).ok).toBe(true);

    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      "/api/admin/bookings",
      "/api/admin/bookings/booking-atomic",
      "/api/admin/bookings/booking-atomic",
    ]);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes("/api/store/wv_bookings"))).toBe(false);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ changes: { status: "confirmed" } });
  });

  it("reads a secret-free payment health summary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      ok: true,
      stripe: { ready: true, secretKeyConfigured: true, webhookVerificationConfigured: true, unsafeUnsignedWebhooks: false },
      counts: { reviews: 1, bankPending: 2, cardProcessing: 0, expiredHolds: 3, unpaid: 4 },
      checkedAt: "2026-08-08T00:00:00.000Z",
    })));
    const health = await getAdminPaymentHealth();
    expect(health?.counts.bankPending).toBe(2);
    expect(JSON.stringify(health)).not.toContain("STRIPE_SECRET_KEY");
  });
});
