const VALID_AUTOMATION_TRIGGERS = new Set(["after_booking", "before_event", "after_event", "payment_overdue"]);
const VALID_AUTOMATION_REMINDERS = new Set(["payment", "booking"]);

const DEFAULT_AUTOMATION_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_AUTOMATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const STARTER_AUTOMATION_RULES = [
  {
    id: "starter-before-event-24h",
    enabled: false,
    trigger: "before_event",
    delayHours: 24,
    reminderType: "booking",
    templateSubject: "Reminder: {event} is tomorrow",
    templateBody: "Hi {name}, this is a quick reminder for your {event} session on {date} at {time}.\n\nSee you soon!",
  },
  {
    id: "starter-payment-overdue-48h",
    enabled: false,
    trigger: "payment_overdue",
    delayHours: 48,
    reminderType: "payment",
    templateSubject: "Payment reminder for {event}",
    templateBody: "Hi {name}, this is a friendly reminder that payment is still pending for your {event} booking on {date}.\n\nPlease reply if you have any questions.",
  },
  {
    id: "starter-after-event-24h",
    enabled: false,
    trigger: "after_event",
    delayHours: 24,
    reminderType: "booking",
    templateSubject: "Thanks for your {event} session",
    templateBody: "Hi {name}, thanks again for your {event} session on {date}.\n\nI will be in touch as soon as your gallery is ready.",
  },
];

function getStarterAutomationRules() {
  return STARTER_AUTOMATION_RULES.map(rule => ({ ...rule }));
}

function normalizeAutomationRule(rule = {}, makeId = () => `auto-${Date.now()}`) {
  return {
    id: rule.id || makeId(),
    enabled: rule.enabled !== false,
    trigger: VALID_AUTOMATION_TRIGGERS.has(rule.trigger) ? rule.trigger : "after_booking",
    delayHours: Number(rule.delayHours) || 24,
    reminderType: VALID_AUTOMATION_REMINDERS.has(rule.reminderType) ? rule.reminderType : "payment",
    templateSubject: (rule.templateSubject || "").slice(0, 200),
    templateBody: (rule.templateBody || "").slice(0, 2000),
  };
}

function getBookingStartTs(booking) {
  if (!booking.date || !booking.time) return 0;
  const [y, mo, d] = booking.date.split("-").map(Number);
  const [h, m] = booking.time.split(":").map(Number);
  if (![y, mo, d, h, m].every(Number.isFinite)) return 0;
  return new Date(y, mo - 1, d, h, m).getTime();
}

function getAutomationSendAt(rule, booking) {
  const delayMs = rule.delayHours * 3600 * 1000;
  switch (rule.trigger) {
    case "after_booking": {
      const createdAt = booking.createdAt ? new Date(booking.createdAt).getTime() : 0;
      return createdAt > 0 ? createdAt + delayMs : 0;
    }
    case "before_event": {
      const eventTs = getBookingStartTs(booking);
      return eventTs > 0 ? eventTs - delayMs : 0;
    }
    case "after_event": {
      const eventTs = getBookingStartTs(booking);
      const duration = (booking.duration || 60) * 60 * 1000;
      return eventTs > 0 ? eventTs + duration + delayMs : 0;
    }
    case "payment_overdue": {
      const unpaid = !booking.paymentStatus || booking.paymentStatus === "unpaid" || booking.paymentStatus === "pending";
      if (!unpaid || !(booking.paymentAmount > 0)) return 0;
      const createdAt = booking.createdAt ? new Date(booking.createdAt).getTime() : 0;
      return createdAt > 0 ? createdAt + delayMs : 0;
    }
    default:
      return 0;
  }
}

function getAutomationDecision(rule, booking, now = Date.now(), options = {}) {
  const intervalMs = options.intervalMs || DEFAULT_AUTOMATION_INTERVAL_MS;
  const graceMs = options.graceMs ?? DEFAULT_AUTOMATION_GRACE_MS;

  if (!booking.clientEmail) return { status: "skipped", reason: "Missing client email", sendAt: null };
  if (booking.status === "cancelled") return { status: "skipped", reason: "Booking is cancelled", sendAt: null };
  if (booking.emailsDisabled) return { status: "skipped", reason: "Emails disabled", sendAt: null };

  if (options.sentSet?.has(`${rule.id}:${booking.id}`)) {
    return { status: "sent", reason: "Already sent in this server process", sendAt: null };
  }

  const sendAt = getAutomationSendAt(rule, booking);
  const alreadySent = (booking.emailLog || []).some(e => e.type === `auto-${rule.id}`);
  if (alreadySent) return { status: "sent", reason: "Already sent for this rule", sendAt: sendAt || null };
  if (!sendAt) return { status: "skipped", reason: "Missing required timing or payment data", sendAt: null };

  const originalWindowEnd = sendAt + intervalMs * 2;
  const graceWindowEnd = sendAt + graceMs;
  if (now >= sendAt && now < graceWindowEnd) {
    return {
      status: "due",
      reason: now < originalWindowEnd ? "Inside scheduler send window" : "Overdue but still inside grace window",
      sendAt,
      windowEnd: originalWindowEnd,
      graceWindowEnd,
    };
  }
  if (now < sendAt) return { status: "upcoming", reason: "Scheduled for later", sendAt, windowEnd: originalWindowEnd, graceWindowEnd };
  return { status: "missed", reason: "Grace window has passed", sendAt, windowEnd: originalWindowEnd, graceWindowEnd };
}

function renderAutomationSubject(rule, booking) {
  const isPaymentReminder = rule.reminderType === "payment";
  const clientName = booking.clientName || "there";
  const eventTitle = booking.type || "Booking";
  return rule.templateSubject
    ? rule.templateSubject
        .replace(/\{name\}/gi, clientName)
        .replace(/\{event\}/gi, eventTitle)
        .replace(/\{date\}/gi, booking.date || "")
    : (isPaymentReminder ? `Payment Reminder — ${eventTitle}` : `Upcoming ${eventTitle} Reminder`);
}

function buildAutomationPreview(rule, bookings, now = Date.now(), options = {}) {
  const normalized = normalizeAutomationRule(rule, options.makeId);
  const rows = bookings.map(booking => {
    const decision = getAutomationDecision(normalized, booking, now, options);
    return {
      ruleId: normalized.id,
      trigger: normalized.trigger,
      bookingId: booking.id,
      clientName: booking.clientName || "",
      clientEmail: booking.clientEmail || "",
      eventTitle: booking.type || "Booking",
      date: booking.date || "",
      time: booking.time || "",
      paymentStatus: booking.paymentStatus || "unpaid",
      status: decision.status,
      reason: decision.reason,
      sendAt: decision.sendAt ? new Date(decision.sendAt).toISOString() : null,
      windowEndsAt: decision.windowEnd ? new Date(decision.windowEnd).toISOString() : null,
      graceWindowEndsAt: decision.graceWindowEnd ? new Date(decision.graceWindowEnd).toISOString() : null,
      subject: decision.status === "due" ? renderAutomationSubject(normalized, booking) : "",
    };
  });

  const rank = { due: 0, upcoming: 1, missed: 2, sent: 3, skipped: 4 };
  rows.sort((a, b) => {
    const byStatus = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    return String(a.sendAt || "").localeCompare(String(b.sendAt || ""));
  });

  return {
    rule: normalized,
    generatedAt: new Date(now).toISOString(),
    windowMinutes: ((options.graceMs ?? DEFAULT_AUTOMATION_GRACE_MS) / 60000),
    schedulerWindowMinutes: ((options.intervalMs || DEFAULT_AUTOMATION_INTERVAL_MS) * 2) / 60000,
    summary: rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, { due: 0, upcoming: 0, missed: 0, sent: 0, skipped: 0 }),
    matches: rows.slice(0, 100),
    total: rows.length,
  };
}

module.exports = {
  DEFAULT_AUTOMATION_GRACE_MS,
  DEFAULT_AUTOMATION_INTERVAL_MS,
  buildAutomationPreview,
  getAutomationDecision,
  getAutomationSendAt,
  getStarterAutomationRules,
  normalizeAutomationRule,
  renderAutomationSubject,
};
