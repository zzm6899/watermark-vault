const { localDateTimeToUtcMs } = require("./security-core");
const VALID_AUTOMATION_TRIGGERS = new Set(["after_booking", "before_event", "after_event", "payment_overdue", "after_payment"]);
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
  {"id": "starter-after-booking-prep", "name": "Session preparation", "enabled": false, "trigger": "after_booking", "delayHours": 1, "reminderType": "booking", "templateSubject": "Getting ready for {event}", "templateBody": "Hi {name}, your {duration} session is on {date} at {time}.\n\nPlease reply with any ideas or reference images you would like to share.\n\nLocation: {location}"},
  {"id": "starter-before-event-2h", "name": "On-the-day reminder", "enabled": false, "trigger": "before_event", "delayHours": 2, "reminderType": "booking", "templateSubject": "See you soon for {event}", "templateBody": "Hi {name}, your session starts at {time} today.\n\nLocation: {location}\n\nPlease arrive a few minutes early and reply if you need help finding us."},
  {"id": "starter-after-payment", "name": "Payment received follow-up", "enabled": false, "trigger": "after_payment", "delayHours": 1, "reminderType": "booking", "templateSubject": "You are all set for {event}", "templateBody": "Hi {name}, your booking is paid in full. Thank you!\n\nYour session: {date} at {time}\nReference: {reference}"},
  {"id": "starter-feedback", "name": "Post-session feedback", "enabled": false, "trigger": "after_event", "delayHours": 72, "reminderType": "booking", "templateSubject": "How was your {event} session?", "templateBody": "Hi {name}, thank you for joining me for {event}.\n\nI would love to hear how your session went. Reply with any feedback or questions."},
];

function getStarterAutomationRules() {
  return STARTER_AUTOMATION_RULES.map(rule => ({ ...rule }));
}

function normalizeAutomationRule(rule = {}, makeId = () => `auto-${Date.now()}`) {
  return {
    id: rule.id || makeId(),
    enabled: rule.enabled !== false,
    trigger: VALID_AUTOMATION_TRIGGERS.has(rule.trigger) ? rule.trigger : "after_booking",
    name: String(rule.name || "").slice(0, 100),
    eventTypeId: String(rule.eventTypeId || "").slice(0, 150),
    bookingStatus: ["confirmed", "completed", "pending"].includes(rule.bookingStatus) ? rule.bookingStatus : "",
    createdAfter: /^\d{4}-\d{2}-\d{2}$/.test(rule.createdAfter || "") ? rule.createdAfter : "",
    delayHours: rule.delayHours !== undefined && Number.isFinite(Number(rule.delayHours)) ? Math.min(8760, Math.max(0, Number(rule.delayHours))) : 24,
    reminderType: VALID_AUTOMATION_REMINDERS.has(rule.reminderType) ? rule.reminderType : "payment",
    templateSubject: String(rule.templateSubject || "").slice(0, 200),
    templateBody: String(rule.templateBody || "").slice(0, 2000),
  };
}

function getBookingStartTs(booking, timezone) {
  if (!booking.date || !booking.time) return 0;
  const [y, mo, d] = booking.date.split("-").map(Number);
  const [h, m] = booking.time.split(":").map(Number);
  if (![y, mo, d, h, m].every(Number.isFinite)) return 0;
  return timezone ? localDateTimeToUtcMs({ year: y, month: mo, day: d, hour: h, minute: m, second: 0 }, timezone) : new Date(y, mo - 1, d, h, m).getTime();
}

function getAutomationSendAt(rule, booking, options = {}) {
  const delayMs = rule.delayHours * 3600 * 1000;
  switch (rule.trigger) {
    case "after_booking": {
      const createdAt = booking.createdAt ? new Date(booking.createdAt).getTime() : 0;
      return createdAt > 0 ? createdAt + delayMs : 0;
    }
    case "before_event": {
      const eventTs = getBookingStartTs(booking, options.timezone);
      return eventTs > 0 ? eventTs - delayMs : 0;
    }
    case "after_event": {
      const eventTs = getBookingStartTs(booking, options.timezone);
      const duration = (booking.duration || 60) * 60 * 1000;
      return eventTs > 0 ? eventTs + duration + delayMs : 0;
    }
    case "after_payment": {
      if (!["paid", "cash"].includes(booking.paymentStatus)) return 0;
      const paidAt = Date.parse(booking.paidAt || "");
      return Number.isFinite(paidAt) ? paidAt + delayMs : 0;
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

  if (rule.eventTypeId && rule.eventTypeId !== booking.eventTypeId) return { status: "skipped", reason: "Different event", sendAt: null };
  if (rule.bookingStatus && rule.bookingStatus !== booking.status) return { status: "skipped", reason: "Different booking status", sendAt: null };
  if (rule.createdAfter && String(booking.createdAt || "").slice(0, 10) < rule.createdAfter) return { status: "skipped", reason: "Booked before this rule's start date", sendAt: null };
  if (rule.trigger === "before_event" && now >= getBookingStartTs(booking, options.timezone)) return { status: "skipped", reason: "Session has already started", sendAt: null };
  const sendAt = getAutomationSendAt(rule, booking, options);
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
    ? renderAutomationTemplate(rule.templateSubject, booking)
    : (isPaymentReminder ? `Payment Reminder — ${eventTitle}` : `Upcoming ${eventTitle} Reminder`);
}

function renderAutomationTemplate(template, booking) {
  const total = Number(booking.paymentAmount) || 0;
  const paid = ["paid", "cash"].includes(booking.paymentStatus) ? total : booking.paymentStatus === "deposit-paid" ? Number(booking.depositAmount) || 0 : 0;
  const values = { name: booking.clientName || "there", event: booking.type || "Booking", date: booking.date || "", time: booking.time || "", location: booking.location || "", duration: `${booking.duration || 0} minutes`, total: `$${total.toFixed(2)}`, balance: `$${Math.max(0, total - paid).toFixed(2)}`, reference: booking.paymentReference || "" };
  return String(template || "").replace(/\{(name|event|date|time|location|duration|total|balance|reference)\}/gi, (_, key) => values[key.toLowerCase()]);
}
function renderAutomationBody(rule, booking) {
  return renderAutomationTemplate(rule.templateBody || (rule.reminderType === "payment" ? "Hi {name}, payment is still pending for {event} on {date}. Outstanding balance: {balance}. Please reply if you need a hand." : "Hi {name}, this is a reminder about {event} on {date} at {time}."), booking);
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
      subject: renderAutomationSubject(normalized, booking),
      body: renderAutomationBody(normalized, booking),
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
  renderAutomationBody,
  renderAutomationTemplate,
  DEFAULT_AUTOMATION_GRACE_MS,
  DEFAULT_AUTOMATION_INTERVAL_MS,
  buildAutomationPreview,
  getAutomationDecision,
  getAutomationSendAt,
  getStarterAutomationRules,
  normalizeAutomationRule,
  renderAutomationSubject,
};
