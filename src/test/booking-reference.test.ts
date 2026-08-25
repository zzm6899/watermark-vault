import { describe, expect, it } from "vitest";
import { bookingPaymentReference } from "@/lib/booking-reference";

describe("bookingPaymentReference", () => {
  it("keeps a deliberately assigned short payment reference", () => {
    expect(bookingPaymentReference({
      id: "bk-12345678-1234-4abc-9def-123456789abc",
      paymentReference: "PF-9A8B7C6D",
    })).toBe("PF-9A8B7C6D");
  });

  it("compacts UUID and legacy references", () => {
    expect(bookingPaymentReference({ id: "bk-12345678-1234-4abc-9def-123456789abc" })).toBe("BK-89ABC");
    expect(bookingPaymentReference({ id: "ignored", paymentReference: "BK-20260826-123456789ABC" })).toBe("BK-89ABC");
  });
});
