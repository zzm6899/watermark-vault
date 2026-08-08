import { describe, expect, it } from "vitest";
import {
  buildBookingCalendarUrl,
  contactQuestionRole,
  filterFutureBookingSlots,
  generateBookingTimeSlots,
  getAuthoritativeBookingCharge,
  getAuthoritativeBookingPaymentState,
  hasAuthoritativeBookingCharge,
  isBookingPaymentConflictError,
  isBookingPaymentVerificationPending,
  getPublicCustomQuestions,
  isPastBookingDate,
  isPastBookingSlot,
  readAvailableSlots,
} from "@/lib/booking-utils";
import type { QuestionField } from "@/lib/types";

describe("booking time helpers", () => {
  it("only generates slots that fit completely inside a window", () => {
    expect(generateBookingTimeSlots("09:00", "11:00", 45)).toEqual(["09:00", "09:45"]);
  });

  it("filters elapsed times using the photographer timezone", () => {
    const now = new Date("2026-08-07T01:30:00.000Z"); // 11:30 in Sydney
    expect(isPastBookingSlot("2026-08-07", "11:30", "Australia/Sydney", now)).toBe(true);
    expect(filterFutureBookingSlots(["10:00", "11:30", "12:00"], "2026-08-07", "Australia/Sydney", now)).toEqual(["12:00"]);
  });

  it("does not disable the photographer's current date because the visitor is in another timezone", () => {
    const now = new Date("2026-08-06T23:30:00.000Z"); // 09:30 Aug 7 in Sydney
    expect(isPastBookingDate("2026-08-06", "Australia/Sydney", now)).toBe(true);
    expect(isPastBookingDate("2026-08-07", "Australia/Sydney", now)).toBe(false);
  });

  it("treats the authoritative empty slot array as a valid response", () => {
    expect(readAvailableSlots({ ok: true, slots: [] })).toEqual([]);
    expect(readAvailableSlots({ availableSlots: ["09:00"] })).toEqual(["09:00"]);
    expect(readAvailableSlots({ busy: [] })).toBeNull();
  });
});

describe("booking confirmation amounts", () => {
  it("shows the full authoritative charge when a deposit-configured event was paid in full", () => {
    expect(getAuthoritativeBookingCharge({ paymentAmount: 1000, depositRequired: false, depositAmount: 0 })).toEqual({
      total: 1000,
      depositRequired: false,
      depositAmount: 0,
    });
  });

  it("uses the server-stored deposit when a deposit is actually required", () => {
    expect(getAuthoritativeBookingCharge({ paymentAmount: 1000, depositRequired: true, depositAmount: 200 })).toEqual({
      total: 1000,
      depositRequired: true,
      depositAmount: 200,
    });
  });

  it("does not invent a charge from mutable event defaults when the booking amount is unavailable", () => {
    expect(hasAuthoritativeBookingCharge(undefined)).toBe(false);
    expect(hasAuthoritativeBookingCharge({ paymentAmount: undefined, depositRequired: true, depositAmount: 200 })).toBe(false);
    expect(getAuthoritativeBookingCharge(undefined)).toEqual({ total: 0, depositRequired: false, depositAmount: 0 });
  });

  it("does not describe an already-paid bank booking as pending", () => {
    expect(getAuthoritativeBookingPaymentState({
      paymentAmount: 1000,
      depositRequired: false,
      depositAmount: 0,
      depositMethod: "bank",
      paymentStatus: "paid",
      paidAt: "2026-08-08T00:00:00.000Z",
    })).toMatchObject({
      chargeKnown: true,
      paidInFull: true,
      bankPaymentPending: false,
      paymentLabel: "Paid",
    });
  });

  it("keeps a bank request pending only while its authoritative status is pending confirmation", () => {
    expect(getAuthoritativeBookingPaymentState({
      paymentAmount: 1000,
      depositRequired: true,
      depositAmount: 200,
      paymentStatus: "pending-confirmation",
    })).toMatchObject({
      chargeKnown: true,
      paidInFull: false,
      bankPaymentPending: true,
      paymentLabel: "Pending confirmation",
    });
  });

  it("blocks alternative payments only while Stripe may already have the money", () => {
    expect(isBookingPaymentVerificationPending("checkout-processing")).toBe(true);
    expect(isBookingPaymentVerificationPending("payment-review")).toBe(true);
    expect(isBookingPaymentVerificationPending("checkout-status-unavailable")).toBe(true);
    expect(isBookingPaymentVerificationPending("checkout-open")).toBe(false);
    expect(isBookingPaymentVerificationPending("checkout-expired")).toBe(false);
    expect(isBookingPaymentVerificationPending("unpaid")).toBe(false);
    expect(isBookingPaymentConflictError("STRIPE_PAYMENT_PROCESSING")).toBe(true);
    expect(isBookingPaymentConflictError("PAYMENT_STATE_CONFLICT")).toBe(true);
    expect(isBookingPaymentConflictError("STRIPE_STATUS_UNAVAILABLE")).toBe(true);
    expect(isBookingPaymentConflictError("BOOKING_HOLD_EXPIRED")).toBe(false);
  });
});

describe("booking contact questions", () => {
  const field = (partial: Partial<QuestionField>): QuestionField => ({
    id: "custom",
    label: "Question",
    type: "text",
    required: false,
    ...partial,
  });

  it("recognises legacy contact questions without depending solely on their labels", () => {
    expect(contactQuestionRole(field({ id: "q1", label: "Who are you?" }))).toBe("name");
    expect(contactQuestionRole(field({ id: "q2", label: "Where should we reply?" }))).toBe("email");
    expect(contactQuestionRole(field({ id: "mobile", label: "Contact number" }))).toBe("phone");
  });

  it("keeps real custom questions and removes duplicate contact and unsupported upload prompts", () => {
    const questions = [
      field({ id: "q1", label: "Name" }),
      field({ id: "style", label: "Preferred style" }),
      field({ id: "reference", label: "Reference image", type: "image-upload" }),
    ];
    expect(getPublicCustomQuestions(questions).map(question => question.id)).toEqual(["style"]);
  });
});

describe("calendar links", () => {
  it("preserves the photographer wall-clock time and includes its timezone", () => {
    const url = new URL(buildBookingCalendarUrl({
      title: "Portrait session",
      date: "2026-10-04",
      time: "09:30",
      durationMinutes: 60,
      timeZone: "Australia/Sydney",
      location: "Studio",
    }));
    expect(url.searchParams.get("dates")).toBe("20261004T093000/20261004T103000");
    expect(url.searchParams.get("ctz")).toBe("Australia/Sydney");
  });

  it("rolls an overnight appointment into the next calendar day", () => {
    const url = new URL(buildBookingCalendarUrl({
      title: "Late session",
      date: "2026-08-07",
      time: "23:30",
      durationMinutes: 90,
      timeZone: "Australia/Sydney",
    }));
    expect(url.searchParams.get("dates")).toBe("20260807T233000/20260808T010000");
  });
});
