import type { Booking, QuestionField } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function toBookingDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function generateBookingTimeSlots(startTime: string, endTime: string, duration: number): string[] {
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime) || !Number.isFinite(duration) || duration <= 0) return [];
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const slots: string[] = [];
  for (let minute = start; minute + duration <= end; minute += duration) {
    slots.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return slots;
}

function zonedMinuteKey(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
  } catch {
    return `${toBookingDateString(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
}

/** True once the start minute has begun in the photographer's timezone. */
export function isPastBookingSlot(date: string, time: string, timeZone: string, now = new Date()): boolean {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return true;
  return `${date}T${time}` <= zonedMinuteKey(now, timeZone);
}

export function isPastBookingDate(date: string, timeZone: string, now = new Date()): boolean {
  if (!DATE_RE.test(date)) return true;
  return `${date}T23:59` <= zonedMinuteKey(now, timeZone);
}

export function filterFutureBookingSlots(slots: string[], date: string, timeZone: string, now = new Date()): string[] {
  return [...new Set(slots)].filter(time => TIME_RE.test(time) && !isPastBookingSlot(date, time, timeZone, now));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((slot): slot is string => typeof slot === "string" && TIME_RE.test(slot));
}

/**
 * Reads the canonical `slots` response while accepting older `availableSlots`
 * during a rolling deployment. An empty array is a successful, fully-booked day.
 */
export function readAvailableSlots(payload: unknown): string[] | null {
  if (!isRecord(payload)) return null;
  return stringArray(payload.slots) ?? stringArray(payload.availableSlots);
}

export type ContactQuestionRole = "name" | "email" | "phone";

export function contactQuestionRole(field: QuestionField): ContactQuestionRole | null {
  const extended = field as QuestionField & { semanticKey?: unknown; role?: unknown };
  const explicit = typeof extended.semanticKey === "string"
    ? extended.semanticKey.toLowerCase()
    : typeof extended.role === "string" ? extended.role.toLowerCase() : "";
  const id = field.id.trim().toLowerCase();
  const label = field.label.trim().toLowerCase();
  if (explicit === "name" || explicit === "clientname" || id === "q1" || /^(full |client )?name$/.test(label)) return "name";
  if (explicit === "email" || explicit === "clientemail" || id === "q2" || label.includes("email")) return "email";
  if (explicit === "phone" || explicit === "clientphone" || /^(phone|mobile|telephone)$/.test(id) || /(phone|mobile|telephone)/.test(label)) return "phone";
  return null;
}

/** Contact details have dedicated stable fields; unsupported upload prompts are omitted. */
export function getPublicCustomQuestions(questions: QuestionField[] | null | undefined): QuestionField[] {
  return (questions ?? []).filter(question => !contactQuestionRole(question) && question.type !== "image-upload");
}

export function missingRequiredQuestions(questions: QuestionField[], answers: Record<string, string>): QuestionField[] {
  return questions.filter(question => question.required && !answers[question.id]?.trim());
}

/**
 * Derive confirmation-page amounts from the booking accepted by the server.
 * Event defaults are not authoritative after a client chooses pay-in-full.
 */
export function getAuthoritativeBookingCharge(
  booking: Pick<Booking, "paymentAmount" | "depositRequired" | "depositAmount"> | null | undefined,
): { total: number; depositRequired: boolean; depositAmount: number } {
  const storedTotal = booking?.paymentAmount;
  const total = typeof storedTotal === "number" && Number.isFinite(storedTotal) && storedTotal >= 0 ? storedTotal : 0;
  const depositRequired = booking?.depositRequired === true;
  const storedDeposit = booking?.depositAmount;
  const depositAmount = depositRequired && typeof storedDeposit === "number" && Number.isFinite(storedDeposit)
    ? Math.max(0, Math.min(total, storedDeposit))
    : 0;
  return { total, depositRequired, depositAmount };
}

/** True only when every amount needed for a truthful payment summary was saved on the booking. */
export function hasAuthoritativeBookingCharge(
  booking: Pick<Booking, "paymentAmount" | "depositRequired" | "depositAmount"> | null | undefined,
): boolean {
  if (!booking || typeof booking.paymentAmount !== "number" || !Number.isFinite(booking.paymentAmount) || booking.paymentAmount < 0) return false;
  return booking.depositRequired !== true
    || (typeof booking.depositAmount === "number"
      && Number.isFinite(booking.depositAmount)
      && booking.depositAmount >= 0
      && booking.depositAmount <= booking.paymentAmount);
}

/**
 * States where Stripe may already have the money and another card or bank
 * payment must stay disabled until the server reaches an authoritative result.
 */
export function isBookingPaymentVerificationPending(state: string | null | undefined): boolean {
  return state === "checkout-processing" || state === "payment-review" || state === "checkout-status-unavailable";
}

/** Stable server errors where a second payment must not be encouraged. */
export function isBookingPaymentConflictError(errorCode: string | null | undefined): boolean {
  return errorCode === "STRIPE_PAYMENT_PROCESSING"
    || errorCode === "PAYMENT_STATE_CONFLICT"
    || errorCode === "STRIPE_STATUS_UNAVAILABLE";
}

/** Payment state used by confirmation pages; bank is pending only while the stored status says so. */
export function getAuthoritativeBookingPaymentState(
  booking: Pick<Booking, "paymentAmount" | "depositRequired" | "depositAmount" | "depositMethod" | "paymentStatus" | "paidAt" | "depositPaidAt"> | null | undefined,
) {
  const charge = getAuthoritativeBookingCharge(booking);
  const chargeKnown = hasAuthoritativeBookingCharge(booking);
  const paidInFull = booking?.paymentStatus === "paid" || booking?.paymentStatus === "cash" || !!booking?.paidAt;
  const depositHasBeenPaid = paidInFull || booking?.paymentStatus === "deposit-paid" || !!booking?.depositPaidAt;
  const bankPaymentPending = !paidInFull && booking?.paymentStatus === "pending-confirmation";
  const remainingBalance = chargeKnown ? Math.max(0, charge.total - charge.depositAmount) : 0;
  const paymentLabel = !chargeKnown
    ? "Status unavailable"
    : paidInFull
    ? "Paid"
    : bankPaymentPending
    ? "Pending confirmation"
    : charge.total === 0
    ? "Free"
    : "Unpaid";
  return { ...charge, chargeKnown, paidInFull, depositHasBeenPaid, bankPaymentPending, remainingBalance, paymentLabel };
}

export interface BookingCalendarOptions {
  title: string;
  date: string;
  time: string;
  durationMinutes: number;
  timeZone: string;
  details?: string;
  location?: string;
}

function compactWallClock(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}00`;
}

/** Build a Google Calendar link using the event's wall-clock time and IANA timezone. */
export function buildBookingCalendarUrl(options: BookingCalendarOptions): string {
  if (!DATE_RE.test(options.date) || !TIME_RE.test(options.time)) return "https://calendar.google.com/calendar/render?action=TEMPLATE";
  const [year, month, day] = options.date.split("-").map(Number);
  const [hour, minute] = options.time.split(":").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const safeDuration = Number.isFinite(options.durationMinutes) && options.durationMinutes > 0 ? options.durationMinutes : 0;
  const end = new Date(start.getTime() + safeDuration * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: options.title,
    dates: `${compactWallClock(start)}/${compactWallClock(end)}`,
    ctz: options.timeZone,
    details: options.details ?? "",
    location: options.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
