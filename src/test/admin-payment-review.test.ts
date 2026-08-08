import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Booking } from "@/lib/types";
import Admin from "@/pages/Admin";
import { ADMIN_API_TOKEN_KEY, resolveBookingPaymentReview } from "@/lib/api";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("wv_setup_complete", "true");
  localStorage.setItem("wv_session", "true");
  localStorage.setItem("wv_albums", "[]");
  localStorage.setItem("wv_event_types", "[]");
  localStorage.setItem("wv_bookings", JSON.stringify([{
    id: "booking-review",
    clientName: "Review Client",
    clientEmail: "review@example.test",
    date: "2026-08-29",
    time: "15:10",
    eventTypeId: "event-1",
    type: "Portrait",
    duration: 20,
    status: "pending",
    notes: "",
    createdAt: "2026-08-08T00:00:00.000Z",
    paymentStatus: "pending-confirmation",
    paymentNeedsReview: true,
    paymentReviewStatus: "paid-unallocated",
    paymentReviewReason: "Payment arrived after the checkout was superseded",
    paymentReceivedAt: "2026-08-08T01:00:00.000Z",
    paymentReviews: [{
      amountTotal: 1500,
      currency: "aud",
      reason: "Payment arrived after the checkout was superseded",
      receivedAt: "2026-08-08T01:00:00.000Z",
      status: "manual-review",
      stripeSessionId: "must-not-render",
    }],
  }]));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/api/auth/session")
      ? { ok: true, username: "admin", isSuperAdmin: false }
      : url.includes("/api/admin/bookings/booking-review/payment-review")
        ? {
            ok: true,
            booking: {
              ...JSON.parse(localStorage.getItem("wv_bookings") || "[]")[0],
              paymentStatus: "paid",
              paymentNeedsReview: false,
              paymentReviewStatus: "resolved",
              paymentReviewReason: undefined,
              paymentReviewResolvedAt: "2026-08-08T02:00:00.000Z",
              paymentReviews: [
                ...JSON.parse(localStorage.getItem("wv_bookings") || "[]")[0].paymentReviews,
                {
                  status: "resolved",
                  reason: "Admin resolved payment review by marking payment paid in full.",
                  resolvedAt: "2026-08-08T02:00:00.000Z",
                  resolvedBy: "admin",
                  resolutionPaymentStatus: "paid",
                },
              ],
            },
          }
      : url.includes("/api/waitlist")
        ? { entries: [] }
        : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("admin payment review visibility", () => {
  it("types the quarantined payment audit without changing the booking payment state", () => {
    const booking = {
      id: "booking-review",
      clientName: "Review Client",
      clientEmail: "review@example.test",
      date: "2026-08-29",
      time: "15:10",
      eventTypeId: "event-1",
      type: "Portrait",
      duration: 20,
      status: "pending",
      notes: "",
      createdAt: "2026-08-08T00:00:00.000Z",
      paymentStatus: "pending-confirmation",
      paymentNeedsReview: true,
      paymentReviewStatus: "paid-unallocated",
      paymentReviewReason: "Payment arrived after the checkout was superseded",
      paymentReceivedAt: "2026-08-08T01:00:00.000Z",
      paymentReviews: [{
        amountTotal: 1500,
        currency: "aud",
        receivedAt: "2026-08-08T01:00:00.000Z",
        status: "manual-review",
      }],
    } satisfies Booking;

    expect(booking.paymentStatus).toBe("pending-confirmation");
    expect(booking.paymentReviews[0].amountTotal).toBe(1500);
  });

  it("makes active reviews discoverable in the count, filter, row, and detail alert", () => {
    const adminSource = source("src/pages/Admin.tsx");

    expect(adminSource).toContain("Payment needs manual review");
    expect(adminSource).toContain("Manual Review");
    expect(adminSource).toContain("bookingNeedsManualPaymentReview");
    expect(adminSource).toContain("aria-pressed={paymentReviewOnly}");
    expect(adminSource).toContain("{reviewReason}");
    expect(adminSource).toContain("Received amount: ${reviewAmount}");
    expect(adminSource).toContain("Verify it in Stripe before selecting Paid in Full, Deposit Paid, or Cash");
    expect(adminSource).not.toMatch(/\{(?:review|entry)\?*\.stripe(?:Session|PaymentIntent)Id\}/);
  });

  it("renders the safe review reason and received amount while keeping Stripe identifiers hidden", async () => {
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/admin/bookings"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, { path: "/admin/:tab", element: React.createElement(Admin) }),
        ),
      ),
    );

    expect((await screen.findAllByText("Payment needs manual review")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Payment arrived after the checkout was superseded/)).toHaveTextContent("$15.00");
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Review Client"));

    expect(screen.getByText(/The payment remains unallocated\. Verify it in Stripe/)).toBeInTheDocument();
    expect(screen.getByText(/Received amount: (?:A)?\$15\.00/)).toBeInTheDocument();
    expect(screen.queryByText("must-not-render")).not.toBeInTheDocument();
  });

  it("uses the authenticated atomic API contract and returns the canonical booking", async () => {
    localStorage.setItem(ADMIN_API_TOKEN_KEY, "signed-admin-session");
    const canonical = {
      ...JSON.parse(localStorage.getItem("wv_bookings") || "[]")[0],
      paymentStatus: "paid",
      paymentNeedsReview: false,
      paymentReviewStatus: "resolved",
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) => new Response(JSON.stringify({ ok: true, booking: canonical }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveBookingPaymentReview("booking/review", "paid");

    expect(result).toEqual({ ok: true, booking: canonical });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/bookings/booking%2Freview/payment-review");
    expect(request?.method).toBe("PATCH");
    expect(request?.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer signed-admin-session",
    });
    expect(JSON.parse(String(request?.body))).toEqual({ paymentStatus: "paid" });
  });

  it("surfaces canonical resolution conflicts without optimistic success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: "PAYMENT_REVIEW_NOT_ACTIVE",
      error: "Payment review is no longer active",
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    })));

    const result = await resolveBookingPaymentReview("booking-review", "deposit-paid");

    expect(result).toEqual({
      ok: false,
      code: "PAYMENT_REVIEW_NOT_ACTIVE",
      error: "Payment review is no longer active",
    });
  });

  it("replaces only the canonical booking returned by the resolution endpoint", async () => {
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/admin/bookings"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, { path: "/admin/:tab", element: React.createElement(Admin) }),
        ),
      ),
    );

    fireEvent.change(await screen.findByLabelText("Payment status"), { target: { value: "paid" } });

    await waitFor(() => {
      expect(screen.queryByText("Payment needs manual review")).not.toBeInTheDocument();
    });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.some(([url, request]) =>
      String(url) === "/api/admin/bookings/booking-review/payment-review"
      && request?.method === "PATCH",
    )).toBe(true);
    expect(fetchMock.mock.calls.some(([url, request]) =>
      String(url).includes("/api/store/wv_bookings") && request?.method === "PUT",
    )).toBe(false);
    const cached = JSON.parse(localStorage.getItem("wv_bookings") || "[]");
    expect(cached[0].paymentStatus).toBe("paid");
    expect(cached[0].paymentReviews).toHaveLength(2);
    expect(cached[0].paymentReviews[0].stripeSessionId).toBe("must-not-render");
  });

  it("contains no client-side review reconciliation or full-array write in the flagged path", () => {
    const adminSource = source("src/pages/Admin.tsx");
    const start = adminSource.indexOf("const handlePaymentChange = async");
    const end = adminSource.indexOf("const handleExportCsv", start);
    const handler = adminSource.slice(start, end);
    const flaggedPath = handler.slice(handler.indexOf("if (hadActiveReview)"), handler.indexOf("const updated ="));

    expect(flaggedPath).toContain("resolveBookingPaymentReview(bk.id");
    expect(flaggedPath).toContain("setBookingsState(previous => previous.map");
    expect(flaggedPath).toContain("cacheBookingLocally(result.booking)");
    expect(flaggedPath).not.toContain("updateBooking(");
    expect(adminSource).not.toContain("function resolvePaymentReviewForAdmin");
  });
});
