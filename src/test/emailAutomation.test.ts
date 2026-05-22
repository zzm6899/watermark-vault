import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildAutomationPreview,
  getAutomationDecision,
  getStarterAutomationRules,
  normalizeAutomationRule,
  renderAutomationSubject,
} = require("../../server/email-automation-core.js");

const baseBooking = {
  id: "bk1",
  clientName: "Ada",
  clientEmail: "ada@example.com",
  type: "Portrait",
  date: "2026-05-22",
  time: "10:00",
  duration: 30,
  status: "confirmed",
  createdAt: "2026-05-21T10:00:00.000Z",
  paymentStatus: "unpaid",
  paymentAmount: 100,
};

describe("email automation core", () => {
  it("normalizes invalid rules without dropping custom templates", () => {
    const rule = normalizeAutomationRule({
      id: "rule1",
      enabled: true,
      trigger: "bad",
      delayHours: 0,
      reminderType: "unknown",
      templateSubject: "Hi {name}",
      templateBody: "Body",
    });

    expect(rule).toMatchObject({
      id: "rule1",
      enabled: true,
      trigger: "after_booking",
      delayHours: 24,
      reminderType: "payment",
      templateSubject: "Hi {name}",
      templateBody: "Body",
    });
  });

  it("marks overdue-but-within-grace bookings due instead of missed", () => {
    const rule = normalizeAutomationRule({ id: "rule1", trigger: "after_booking", delayHours: 1 });
    const sendAt = new Date(baseBooking.createdAt).getTime() + 3600_000;
    const decision = getAutomationDecision(rule, baseBooking, sendAt + 12 * 3600_000, {
      intervalMs: 5 * 60_000,
      graceMs: 24 * 3600_000,
    });

    expect(decision.status).toBe("due");
    expect(decision.reason).toContain("grace");
  });

  it("marks bookings missed after the grace window", () => {
    const rule = normalizeAutomationRule({ id: "rule1", trigger: "after_booking", delayHours: 1 });
    const sendAt = new Date(baseBooking.createdAt).getTime() + 3600_000;
    const decision = getAutomationDecision(rule, baseBooking, sendAt + 25 * 3600_000, {
      intervalMs: 5 * 60_000,
      graceMs: 24 * 3600_000,
    });

    expect(decision.status).toBe("missed");
  });

  it("suppresses cancelled, disabled, missing email, and already-sent bookings", () => {
    const rule = normalizeAutomationRule({ id: "rule1", trigger: "after_booking", delayHours: 1 });
    const now = new Date(baseBooking.createdAt).getTime() + 2 * 3600_000;

    expect(getAutomationDecision(rule, { ...baseBooking, status: "cancelled" }, now).status).toBe("skipped");
    expect(getAutomationDecision(rule, { ...baseBooking, emailsDisabled: true }, now).status).toBe("skipped");
    expect(getAutomationDecision(rule, { ...baseBooking, clientEmail: "" }, now).status).toBe("skipped");
    expect(getAutomationDecision(rule, { ...baseBooking, emailLog: [{ type: "auto-rule1" }] }, now).status).toBe("sent");
  });

  it("requires unpaid positive-amount bookings for payment_overdue", () => {
    const rule = normalizeAutomationRule({ id: "rule1", trigger: "payment_overdue", delayHours: 1 });
    const now = new Date(baseBooking.createdAt).getTime() + 2 * 3600_000;

    expect(getAutomationDecision(rule, baseBooking, now).status).toBe("due");
    expect(getAutomationDecision(rule, { ...baseBooking, paymentStatus: "paid" }, now).status).toBe("skipped");
    expect(getAutomationDecision(rule, { ...baseBooking, paymentAmount: 0 }, now).status).toBe("skipped");
  });

  it("builds sorted previews with summary counts and due subjects", () => {
    const rule = normalizeAutomationRule({ id: "rule1", trigger: "after_booking", delayHours: 1, templateSubject: "Hi {name} - {event}" });
    const now = new Date(baseBooking.createdAt).getTime() + 2 * 3600_000;
    const preview = buildAutomationPreview(rule, [
      baseBooking,
      { ...baseBooking, id: "bk2", createdAt: "2026-05-23T10:00:00.000Z" },
      { ...baseBooking, id: "bk3", emailLog: [{ type: "auto-rule1" }] },
    ], now, { intervalMs: 5 * 60_000, graceMs: 24 * 3600_000 });

    expect(preview.summary).toMatchObject({ due: 1, upcoming: 1, sent: 1 });
    expect(preview.matches[0].status).toBe("due");
    expect(preview.matches[0].subject).toBe("Hi Ada - Portrait");
    expect(preview.schedulerWindowMinutes).toBe(10);
  });

  it("renders default payment and booking subjects", () => {
    expect(renderAutomationSubject({ reminderType: "payment" }, baseBooking)).toBe("Payment Reminder — Portrait");
    expect(renderAutomationSubject({ reminderType: "booking" }, baseBooking)).toBe("Upcoming Portrait Reminder");
  });

  it("provides disabled starter automation drafts", () => {
    const starters = getStarterAutomationRules();
    expect(starters).toHaveLength(3);
    expect(starters.every((rule: any) => rule.enabled === false)).toBe(true);
    expect(starters.map((rule: any) => rule.id)).toEqual([
      "starter-before-event-24h",
      "starter-payment-overdue-48h",
      "starter-after-event-24h",
    ]);

    starters[0].enabled = true;
    expect(getStarterAutomationRules()[0].enabled).toBe(false);
  });
});
