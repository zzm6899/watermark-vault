import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("remaining booking balance operations", () => {
  const paymentOps = readFileSync(join(process.cwd(), "src/pages/admin/PaymentOperationsView.tsx"), "utf8");
  const admin = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8");
  const api = readFileSync(join(process.cwd(), "src/lib/api.ts"), "utf8");

  it("offers an explicit audited completion action for deposit-paid bookings", () => {
    expect(paymentOps).toContain("Confirm remaining balance paid");
    expect(paymentOps).toContain('booking.paymentStatus === "deposit-paid"');
    expect(api).toContain("/complete-balance");
  });

  it("uses the same canonical operation from the booking payment selector", () => {
    expect(admin).toContain('bk.paymentStatus === "deposit-paid" && paymentStatus === "paid"');
    expect(admin).toContain("completeAdminBookingBalance");
    expect(admin).toContain("Only continue after verifying the funds were received");
  });
});
