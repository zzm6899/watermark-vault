import { expect, it } from "vitest";
import { getRecordedBookingBalance } from "@/lib/booking-utils";

it("deducts a confirmed deposit from the recorded booking total", () => {
  expect(getRecordedBookingBalance({ paymentAmount: 150, depositAmount: 50, paymentStatus: "deposit-paid" })).toEqual({ total: 150, paid: 50, remaining: 100 });
  expect(getRecordedBookingBalance({ paymentAmount: 10.1, depositAmount: 0.2, paymentStatus: "deposit-paid" })?.remaining).toBe(9.9);
});
it("does not deduct a pending bank transfer", () => {
  expect(getRecordedBookingBalance({ paymentAmount: 150, depositAmount: 50, paymentStatus: "pending-confirmation" })).toEqual({ total: 150, paid: 0, remaining: 150 });
});
it("shows paid bookings at zero and handles missing or excessive deposits", () => {
  expect(getRecordedBookingBalance({ paymentAmount: 150, paymentStatus: "paid" })?.remaining).toBe(0);
  expect(getRecordedBookingBalance({ paymentStatus: "unpaid" })).toBeNull();
  expect(getRecordedBookingBalance({ paymentAmount: 150, paymentStatus: "deposit-paid" })).toBeNull();
  expect(getRecordedBookingBalance({ paymentAmount: 20, depositAmount: 50, paymentStatus: "deposit-paid" })?.remaining).toBe(0);
});
