import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmAdminBankPayment, createAdminBooking, deleteAdminBooking, deleteBookingReferenceImage, getAdminPaymentHealth, patchAdminBooking, reconcileAdminStripePayment, uploadBookingReferenceImages } from "@/lib/api";
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

  it("confirms one canonical bank payment through its dedicated endpoint", async () => {
    const fetchMock = vi.fn(async () => response({ ok: true, booking: { ...booking, paymentStatus: "paid", paymentMethod: "bank" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await confirmAdminBankPayment(booking.id);
    expect(result.booking?.paymentStatus).toBe("paid");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/bookings/booking-atomic/bank-payment", expect.objectContaining({ method: "PATCH" }));
  });

  it("reconciles one canonical card payment through Stripe", async () => {
    const fetchMock = vi.fn(async () => response({ ok: true, booking: { ...booking, paymentStatus: "paid", paymentMethod: "stripe" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await reconcileAdminStripePayment(booking.id);
    expect(result.booking?.paymentStatus).toBe("paid");
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/bookings/booking-atomic/stripe/reconcile", expect.objectContaining({ method: "POST" }));
  });

  it("uploads and deletes reference images with the booking capability", async () => {
    const saved = { ...booking, modifyToken: "modify-token", referenceImages: [{ id: "ref-1", originalName: "pose.jpg", size: 3, mimeType: "image/jpeg", uploadedAt: "now", url: "/signed" }] };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => response({ ok: true, booking: init?.method === "DELETE" ? { ...saved, referenceImages: [] } : saved }, init?.method === "POST" ? 201 : 200));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], "pose.jpg", { type: "image/jpeg" });
    expect((await uploadBookingReferenceImages("modify-token", [file])).booking?.referenceImages?.length).toBe(1);
    expect((await deleteBookingReferenceImage("modify-token", "ref-1")).booking?.referenceImages).toEqual([]);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/booking/modify-token/reference-images");
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/booking/modify-token/reference-images/ref-1");
  });
});
