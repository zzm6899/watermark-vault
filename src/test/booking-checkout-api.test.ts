import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBookingCheckout,
  createPublicBooking,
  createTenantBookingCheckout,
  getBookingPaymentStatus,
  selectBookingBankTransfer,
} from "@/lib/api";

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

describe("booking checkout API contracts", () => {
  it("sends the stable booking attempt id used for lost-response replay", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => jsonResponse({ booking: { id: "bk-attempt" } }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createPublicBooking({
      clientName: "Client",
      clientEmail: "client@example.test",
      date: "2026-08-29",
      time: "15:10",
      eventTypeId: "portrait",
      duration: 20,
      answers: {},
      paymentMethod: "stripe",
      payInFull: false,
      bookingAttemptId: "f04729c5-80c6-468d-8800-f4fc7204e7f0",
    });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/booking");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      bookingAttemptId: "f04729c5-80c6-468d-8800-f4fc7204e7f0",
    });
  });

  it("uses the tenant booking checkout endpoint and sends only server lookup data", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => jsonResponse({ url: "https://checkout.example/session", sessionId: "cs_123" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createTenantBookingCheckout("studio one", {
      bookingId: "bk-123",
      modifyToken: "mod-secret",
      successUrl: "https://app.example/booking/modify/mod-secret?checkout=success",
      cancelUrl: "https://app.example/booking/modify/mod-secret?checkout=cancelled",
    });

    expect(result.sessionId).toBe("cs_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/tenant/studio%20one/stripe/checkout/booking");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({
      bookingId: "bk-123",
      modifyToken: "mod-secret",
      successUrl: "https://app.example/booking/modify/mod-secret?checkout=success",
      cancelUrl: "https://app.example/booking/modify/mod-secret?checkout=cancelled",
    });
    expect(JSON.parse(String(request?.body))).not.toHaveProperty("amount");
  });

  it("includes the required capability and return URLs for main booking checkout", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => jsonResponse({ url: "https://checkout.example/main" }));
    vi.stubGlobal("fetch", fetchMock);

    await createBookingCheckout({
      bookingId: "bk-main",
      modifyToken: "mod-main-secret",
      clientName: "Client",
      clientEmail: "client@example.test",
      amount: 999,
      eventTitle: "Portrait",
      successUrl: "https://app.example/booking/modify/mod-main-secret?checkout=success",
      cancelUrl: "https://app.example/booking/modify/mod-main-secret?checkout=cancelled",
    });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/stripe/checkout/booking");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      bookingId: "bk-main",
      modifyToken: "mod-main-secret",
      successUrl: "https://app.example/booking/modify/mod-main-secret?checkout=success",
      cancelUrl: "https://app.example/booking/modify/mod-main-secret?checkout=cancelled",
    });
  });

  it("reads the normalized authoritative payment status without exposing a booking id", async () => {
    const payment = {
      state: "checkout-processing",
      paymentStatus: "unpaid",
      paymentMethod: "stripe",
      canRetryCard: false,
      canSubmitBank: false,
      bankTransferIsManual: true,
      requiresAdminVerification: false,
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => jsonResponse({ ok: true, payment }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getBookingPaymentStatus("mod secret/value");

    expect(result.payment).toEqual(payment);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/booking/mod%20secret%2Fvalue/payment/status");
    expect(request?.method).toBeUndefined();
    expect(request?.cache).toBe("no-store");
  });

  it("switches to manual bank transfer with an explicit narrow action", async () => {
    const booking = { id: "bk-existing", paymentStatus: "pending-confirmation", paymentMethod: "bank" };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => jsonResponse({ ok: true, booking }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await selectBookingBankTransfer("mod-existing");

    expect(result.booking).toEqual(booking);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/booking/mod-existing/payment/bank");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({ action: "select-bank" });
  });

  it("preserves stable payment error codes for safe retry decisions", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => jsonResponse({
      ok: false,
      code: "STRIPE_PAYMENT_PROCESSING",
      error: "A payment for this booking is already processing",
    }, 409));
    vi.stubGlobal("fetch", fetchMock);

    const result = await selectBookingBankTransfer("mod-processing");

    expect(result).toMatchObject({
      errorCode: "STRIPE_PAYMENT_PROCESSING",
      errorKind: "conflict",
      statusCode: 409,
    });
  });
});
