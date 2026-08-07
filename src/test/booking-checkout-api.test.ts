import { afterEach, describe, expect, it, vi } from "vitest";
import { createBookingCheckout, createTenantBookingCheckout } from "@/lib/api";

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
});
