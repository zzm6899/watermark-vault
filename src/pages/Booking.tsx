import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  Clock, ChevronLeft, ChevronRight, ArrowLeft, Globe,
  CalendarDays, CheckCircle2, AlertCircle, Camera,
  MapPin, Calendar as CalendarIcon, ExternalLink, XCircle, Edit,
  CreditCard, Bell, Users, Building2, Copy, Check as CheckIcon,
  MessageSquare, ChevronRight as ArrowRight, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Footer from "@/components/Footer";
import BookingAvatar from "@/components/BookingAvatar";
import { toast } from "sonner";
import { getEventTypes, getProfile, cacheBookingLocally, getBookings, getSettings } from "@/lib/storage";
import {
  createBookingCheckout,
  createPublicBooking,
  fetchBookingByToken,
  getBookingPaymentStatus,
  getStripeStatus,
  joinWaitlist,
  selectBookingBankTransfer,
} from "@/lib/api";
import type { AppSettings, Booking as BookingRecord, EventType, ProfileSettings, QuestionField } from "@/lib/types";
import type { PublicBookingPaymentStatus } from "@/lib/api";
import {
  buildBookingCalendarUrl,
  contactQuestionRole,
  filterFutureBookingSlots,
  getAuthoritativeBookingCharge,
  getAuthoritativeBookingPaymentState,
  getPublicCustomQuestions,
  hasAuthoritativeBookingCharge,
  isBookingPaymentConflictError,
  isBookingPaymentVerificationPending,
  isPastBookingDate,
  missingRequiredQuestions,
  readAvailableSlots,
} from "@/lib/booking-utils";
import {
  fetchPublicAvailability,
  fetchPublicBookingConfig,
  patchPublicBooking,
  submitPublicEnquiry,
} from "@/lib/booking-public-api";
import { RichTextDisplay } from "@/components/RichTextEditor";
import { richTextToPlainText } from "@/lib/rich-text";
import { generateCapabilityToken } from "@/lib/capability-token";
import { bookingPaymentReference } from "@/lib/booking-reference";

type Step = "event-select" | "datetime" | "questions" | "payment" | "confirmed" | "enquiry" | "enquiry-confirmed";
const BOOKING_ATTEMPT_SESSION_KEY = "wv_public_booking_attempt_id";

function getOrCreateBookingAttemptId(): string {
  try {
    const existing = sessionStorage.getItem(BOOKING_ATTEMPT_SESSION_KEY);
    if (existing) return existing;
  } catch { /* keep the in-memory attempt when session storage is unavailable */ }
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Secure booking attempt IDs are unavailable in this browser");
  }
  const attemptId = globalThis.crypto.randomUUID();
  try { sessionStorage.setItem(BOOKING_ATTEMPT_SESSION_KEY, attemptId); } catch { /* in-memory ref still protects this page */ }
  return attemptId;
}

function clearBookingAttemptId(): void {
  try { sessionStorage.removeItem(BOOKING_ATTEMPT_SESSION_KEY); } catch { /* storage may be unavailable */ }
}

/** Basic email format check — covers the vast majority of real email addresses. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatDuration(mins: number) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

/** Get the price for a given duration, with fallback to base price */
function getPriceForDuration(event: import("@/lib/types").EventType, duration: number): number {
  if (event.prices && event.prices[duration] !== undefined) return event.prices[duration];
  return event.price ?? 0;
}

function formatTime12(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

function formatTimezone(tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' });
    const parts = formatter.formatToParts(new Date());
    const abbr = parts.find(p => p.type === 'timeZoneName')?.value || tz;
    const offsetFormatter = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longOffset' });
    const offsetParts = offsetFormatter.formatToParts(new Date());
    const offset = offsetParts.find(p => p.type === 'timeZoneName')?.value?.replace('GMT', 'UTC') || '';
    const cityName = tz.split('/').pop()?.replace(/_/g, ' ') || tz;
    return `${cityName} (${abbr}, ${offset})`;
  } catch {
    return tz;
  }
}

/**
 * Returns a brief "your local time" note when the visitor's timezone differs
 * from the photographer's, e.g. "Your time: Sydney (AEST, UTC+10)".
 * Returns null when the timezones match so no duplicate label is shown.
 */
function getVisitorTimezoneNote(photographerTz: string): string | null {
  try {
    const visitorTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!visitorTz || visitorTz === photographerTz) return null;
    return `Your local time: ${formatTimezone(visitorTz)}`;
  } catch {
    return null;
  }
}

function getAvailabilityForDate(et: EventType, date: Date): { startTime: string; endTime: string }[] {
  const dateStr = toDateStr(date);
  const avail = et.availability;
  if (!avail) return [];
  if ((avail.blockedDates || []).includes(dateStr)) return [];
  const specific = (avail.specificDates || []).filter((s) => s.date === dateStr);
  if (specific.length > 0) return specific.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
  const dayOfWeek = date.getDay();
  const recurring = (avail.recurring || []).filter((s) => s.day === dayOfWeek);
  return recurring.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
}

function isDayAvailable(et: EventType, date: Date): boolean {
  return getAvailabilityForDate(et, date).length > 0;
}

// ─── Question Field Renderer ─────────────────────────────────
function QuestionInput({ field, value, onChange, inputId, labelId }: { field: QuestionField; value: string; onChange: (val: string) => void; inputId: string; labelId: string }) {
  switch (field.type) {
    case "text":
      return <Input id={inputId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body" />;
    case "textarea":
      return <Textarea id={inputId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body min-h-[80px]" />;
    case "instagram":
      return (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-body text-sm">@</span>
          <Input id={inputId} value={value.replace(/^@/, "")} onChange={(e) => onChange(e.target.value.replace(/^@/, ""))} placeholder="yourusername" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body pl-7" />
        </div>
      );
    case "select":
      return (
        <select id={inputId} value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-secondary border border-border text-foreground font-body text-sm rounded-md px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="">Select an option...</option>
          {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case "boolean":
      return (
        <div className="flex gap-3" role="group" aria-labelledby={labelId}>
          {["Yes", "No"].map((opt) => (
            <button key={opt} type="button" aria-pressed={value === opt} onClick={() => onChange(opt)} className={`flex-1 py-2.5 px-4 rounded-md border text-sm font-body transition-all ${value === opt ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
              {opt}
            </button>
          ))}
        </div>
      );
    case "image-upload":
      return null;
    default:
      return null;
  }
}

function bookingMatchesSelection(
  booking: Pick<BookingRecord, "eventTypeId" | "date" | "time" | "duration">,
  eventTypeId: string,
  date: string,
  time: string,
  duration: number,
): boolean {
  return booking.eventTypeId === eventTypeId
    && booking.date === date
    && booking.time === time
    && booking.duration === duration;
}

export function BookingQuestionField({ field, value, onChange }: { field: QuestionField; value: string; onChange: (val: string) => void }) {
  const inputId = `booking-question-${field.id}`;
  const labelId = `${inputId}-label`;
  return (
    <div>
      <label id={labelId} htmlFor={field.type === "boolean" ? undefined : inputId} className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 block">
        {field.label} {field.required && <span className="text-destructive">*</span>}
      </label>
      <QuestionInput field={field} value={value} onChange={onChange} inputId={inputId} labelId={labelId} />
    </div>
  );
}

// ─── Timer Component ─────────────────────────────────────
function BookingTimer({ expiresAt, onExpire }: { expiresAt: number; onExpire: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));

  useEffect(() => {
    const update = () => {
      const next = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(next);
      if (next === 0) onExpire();
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, onExpire]);

  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const isLow = secondsLeft < 120;

  return (
    <div className={`text-xs font-body tabular-nums ${isLow ? "text-destructive" : "text-muted-foreground"}`}>
      ⏱ Complete within {m}:{s.toString().padStart(2, "0")} · your selection is not held until submitted
    </div>
  );
}

// ─── Step Progress Indicator ─────────────────────────────────────
const BOOKING_STEPS: { id: Step; label: string }[] = [
  { id: "event-select", label: "Service" },
  { id: "datetime",     label: "Date & Time" },
  { id: "questions",    label: "Details" },
  { id: "payment",      label: "Confirm" },
];

function BookingSteps({ currentStep }: { currentStep: Step }) {
  if (currentStep === "confirmed" || currentStep === "enquiry" || currentStep === "enquiry-confirmed") return null;
  const currentIdx = BOOKING_STEPS.findIndex(s => s.id === currentStep);
  if (currentIdx < 0) return null;
  return (
    <div className="flex items-center justify-center gap-0 mb-8 max-w-sm mx-auto">
      {BOOKING_STEPS.map((s, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={s.id} className="flex items-center min-w-0">
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-body transition-all ${
              active ? "text-primary font-semibold" : done ? "text-green-400" : "text-muted-foreground/50"
            }`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 transition-all ${
                active ? "bg-primary text-primary-foreground scale-110" : done ? "bg-green-500/20 text-green-400" : "bg-border text-muted-foreground/50"
              }`}>
                {done ? <CheckCircle2 className="w-3 h-3" /> : idx + 1}
              </div>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {idx < BOOKING_STEPS.length - 1 && (
              <div className={`h-px w-4 sm:w-6 shrink-0 transition-colors ${idx < currentIdx ? "bg-green-500/40" : "bg-border/50"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────
export default function Booking() {
  const [profile, setProfile] = useState<ProfileSettings>(() => getProfile());
  const [eventTypes, setEventTypes] = useState<EventType[]>(() => getEventTypes().filter(event => event.active));
  const [settings, setSettings] = useState<AppSettings>(() => getSettings());
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicBookingConfig(controller.signal).then(config => {
      if (config.profile) setProfile(previous => ({ ...previous, ...config.profile }));
      if (config.settings) setSettings(previous => ({ ...previous, ...config.settings }));
      if (Array.isArray(config.eventTypes)) setEventTypes(config.eventTypes.filter(event => event.active));
      setConfigError(false);
    }).catch(error => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setConfigError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setConfigLoading(false);
    });
    return () => controller.abort();
  }, []);

  // ── Restore last booking from localStorage on page reload ──
  const restoredBookingId = (() => {
    try {
      const saved = localStorage.getItem("lastBookingId");
      if (!saved) return null;
      const booking = getBookings().find(b => b.id === saved);
      // Only restore if booking exists and was made in the last 24h
      if (!booking) { localStorage.removeItem("lastBookingId"); return null; }
      const age = Date.now() - new Date(booking.createdAt).getTime();
      if (age > 24 * 60 * 60 * 1000) { localStorage.removeItem("lastBookingId"); return null; }
      return saved;
    } catch { return null; }
  })();

  const restoredBooking = restoredBookingId ? getBookings().find(b => b.id === restoredBookingId) : null;
  const restoredEventType = restoredBooking ? getEventTypes().find(e => e.id === restoredBooking.eventTypeId) : null;
  const restoredDate = restoredBooking ? (() => { const [y,m,d] = restoredBooking.date.split("-").map(Number); return new Date(y, m-1, d); })() : null;

  const [step, setStep] = useState<Step>(restoredBooking ? "confirmed" : "event-select");
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(restoredEventType || null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(restoredBooking?.duration || null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(restoredDate);
  const [selectedTime, setSelectedTime] = useState<string | null>(restoredBooking?.time || null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth());
  });
  const [answers, setAnswers] = useState<Record<string, string>>(restoredBooking?.answers || {});
  const [clientName, setClientName] = useState(restoredBooking?.clientName || "");
  const [clientEmail, setClientEmail] = useState(restoredBooking?.clientEmail || "");
  const [clientPhone, setClientPhone] = useState(() => {
    const phoneQuestion = restoredEventType?.questions.find(question => contactQuestionRole(question) === "phone");
    return phoneQuestion ? restoredBooking?.answers?.[phoneQuestion.id] || "" : "";
  });
  const [use24h, setUse24h] = useState(false);
  const [timerExpiresAt, setTimerExpiresAt] = useState<number | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[] | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilityTimezone, setAvailabilityTimezone] = useState(profile.timezone || "Australia/Sydney");
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [lastBookingId, setLastBookingId] = useState<string | null>(restoredBookingId);
  const [lastBookingPaymentStatus, setLastBookingPaymentStatus] = useState<PublicBookingPaymentStatus | null>(null);
  const [, setBookingVersion] = useState(0);
  const [cancellingBooking, setCancellingBooking] = useState(false);

  useEffect(() => {
    if (!selectedEvent) return;
    const current = eventTypes.find(event => event.id === selectedEvent.id);
    if (current && current !== selectedEvent) setSelectedEvent(current);
  }, [eventTypes, selectedEvent]);

  // Stripe returns the client before webhook delivery can be guaranteed. Refresh
  // the authoritative booking shortly after returning so the confirmation page
  // reflects a completed deposit or balance payment.
  useEffect(() => {
    if (!lastBookingId) return;
    let cancelled = false;
    const refresh = async () => {
      const local = getBookings().find(booking => booking.id === lastBookingId);
      if (!local?.modifyToken) return;
      const [bookingResult, paymentResult] = await Promise.all([
        fetchBookingByToken(local.modifyToken),
        getBookingPaymentStatus(local.modifyToken),
      ]);
      if (!cancelled && bookingResult) {
        cacheBookingLocally(bookingResult);
        setBookingVersion(version => version + 1);
      }
      if (!cancelled && paymentResult.payment) setLastBookingPaymentStatus(paymentResult.payment);
    };
    void refresh();
    const timer = window.setTimeout(() => { void refresh(); }, 2500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [lastBookingId]);

  // Waitlist state
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [waitlistName, setWaitlistName] = useState("");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistNote, setWaitlistNote] = useState("");
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [stripeChecked, setStripeChecked] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [payFullInstead, setPayFullInstead] = useState(false);
  const [paymentActionError, setPaymentActionError] = useState<{ kind: "network" | "processing" | "api"; message: string } | null>(null);
  const paymentActionRef = useRef(false);
  const bookingAttemptIdRef = useRef<string | null>(null);

  // Enquiry form state
  const [enquiryEventId, setEnquiryEventId] = useState("");
  const [enquiryName, setEnquiryName] = useState("");
  const [enquiryEmail, setEnquiryEmail] = useState("");
  const [enquiryPhone, setEnquiryPhone] = useState("");
  const [enquiryDate, setEnquiryDate] = useState("");
  const [enquiryStartTime, setEnquiryStartTime] = useState("");
  const [enquiryEndTime, setEnquiryEndTime] = useState("");
  const [enquiryMessage, setEnquiryMessage] = useState("");
  const [enquirySubmitting, setEnquirySubmitting] = useState(false);

  // Per-card "Read more" expanded state for event type descriptions
  const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({});

  // Handle Stripe cancel redirect (?cancelled=1) — show a friendly message and clean up URL
  const cancelHandledRef = useRef(false);
  useEffect(() => {
    if (cancelHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") === "1") {
      cancelHandledRef.current = true;
      toast.error("Payment was cancelled — your booking is not yet confirmed.", { duration: 6000 });
      // Remove the query param so a reload doesn't re-show the toast
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

  // Check Stripe availability on mount
  useEffect(() => {
    getStripeStatus().then(s => setStripeAvailable(s.configured)).finally(() => setStripeChecked(true));
  }, []);

  const profileName = profile.name || "Book a Session";
  const bookingStepTitles: Record<Step, string> = {
    "event-select": profile.name ? `Book with ${profileName}` : "Book a Session",
    "datetime": selectedEvent ? `${selectedEvent.title} — ${profileName}` : `Choose a Date — ${profileName}`,
    "questions": `Your Details — ${profileName}`,
    "payment": `Payment — ${profileName}`,
    "confirmed": `${lastBookingId && ["confirmed", "completed"].includes(getBookings().find(booking => booking.id === lastBookingId)?.status || "") ? "Booking Confirmed" : "Booking Received"} — ${profileName}`,
    "enquiry": `Send Enquiry — ${profileName}`,
    "enquiry-confirmed": `Enquiry Sent — ${profileName}`,
  };
  usePageTitle(bookingStepTitles[step]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-start calendar
  const firstDay = new Date(year, month, 1).getDay();
  const blanks = Array.from({ length: (firstDay + 6) % 7 }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // The server folds bookings, buffers, and external-calendar conflicts into
  // this list. Never re-introduce a slot that the authoritative response omits.
  useEffect(() => {
    if (!selectedDate || !selectedEvent) {
      setAvailableSlots(null);
      setAvailabilityError(null);
      return;
    }
    const controller = new AbortController();
    const date = toDateStr(selectedDate);
    setAvailableSlots(null);
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    fetchPublicAvailability({ eventTypeId: selectedEvent.id, date, duration: selectedDuration || undefined, signal: controller.signal }).then(payload => {
      const slots = readAvailableSlots(payload);
      if (slots === null) throw new Error("Availability could not be read");
      setAvailableSlots(slots);
      if (payload.timezone) setAvailabilityTimezone(payload.timezone);
    }).catch(error => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setAvailabilityError(error instanceof Error ? error.message : "Availability could not be loaded");
    }).finally(() => {
      if (!controller.signal.aborted) setAvailabilityLoading(false);
    });
    return () => controller.abort();
  }, [selectedDate, selectedEvent, selectedDuration, availabilityRetry]);

  const timeSlots = useMemo(() => {
    if (!selectedDate || !selectedDuration || !selectedEvent || availableSlots === null) return [];
    const dateStr = toDateStr(selectedDate);
    return filterFutureBookingSlots(availableSlots, dateStr, availabilityTimezone || profile.timezone);
  }, [selectedDate, selectedDuration, selectedEvent, availableSlots, availabilityTimezone, profile.timezone]);

  const hasAvailabilityThisMonth = useMemo(() => {
    if (!selectedEvent) return false;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      if (!isPastBookingDate(toDateStr(date), availabilityTimezone || profile.timezone) && isDayAvailable(selectedEvent, date)) return true;
    }
    return false;
  }, [selectedEvent, year, month, daysInMonth, availabilityTimezone, profile.timezone]);

  const selectedQuestions = selectedEvent?.questions ?? [];
  const customQuestions = useMemo(
    () => getPublicCustomQuestions(selectedEvent?.questions),
    [selectedEvent],
  );
  const hasRequiredUnsupportedUpload = selectedQuestions.some(question => question.type === "image-upload" && question.required);
  const phoneRequired = selectedQuestions.some(question => contactQuestionRole(question) === "phone" && question.required);

  const handleSelectEvent = (ev: EventType) => {
    setSelectedEvent(ev);
    setSelectedDate(null);
    setSelectedTime(null);
    setAnswers({});
    setClientName("");
    setClientEmail("");
    setClientPhone("");
    setTimerExpiresAt(null);
    setSelectedDuration(ev.durations[0]);
    setStep("datetime");
  };

  const handleTimerExpire = useCallback(() => {
    toast.error("Please select the time again before continuing.");
    setSelectedTime(null);
    setTimerExpiresAt(null);
    setStep(current => current === "questions" || current === "payment" ? "datetime" : current);
  }, []);

  const handleSelectTime = (time: string) => {
    setSelectedTime(time);
    const minutes = Number.isFinite(settings.bookingTimerMinutes) && settings.bookingTimerMinutes > 0
      ? settings.bookingTimerMinutes
      : 10;
    setTimerExpiresAt(Date.now() + minutes * 60_000);
  };

  const handleJoinWaitlist = async () => {
    if (!selectedEvent || !selectedDate) return;
    if (!waitlistName.trim() || !isValidEmail(waitlistEmail)) {
      toast.error("Please enter your name and a valid email.");
      return;
    }
    setWaitlistSubmitting(true);
    const dateStr = toDateStr(selectedDate);
    const result = await joinWaitlist({
      eventTypeId: selectedEvent.id,
      eventTypeTitle: selectedEvent.title,
      date: dateStr,
      clientName: waitlistName.trim(),
      clientEmail: waitlistEmail.trim(),
      note: waitlistNote.trim(),
    });
    setWaitlistSubmitting(false);
    if (result.ok || result.duplicate) {
      setWaitlistDone(true);
      toast.success(result.duplicate ? "You're already on the waitlist for this date!" : "You're on the waitlist! We'll email you if a spot opens.");
    } else {
      toast.error("Couldn't join waitlist. Please try again.");
    }
  };

  const handleSubmitQuestions = () => {
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration) return;
    if (!clientName.trim()) { toast.error("Please enter your name"); return; }
    if (!isValidEmail(clientEmail)) { toast.error("Please enter a valid email address"); return; }
    if (phoneRequired && !clientPhone.trim()) { toast.error("Please enter your phone number"); return; }
    if (hasRequiredUnsupportedUpload) {
      toast.error("This booking form requires an upload that is not available online. Please contact the photographer.");
      return;
    }
    const missing = missingRequiredQuestions(customQuestions, answers);
    if (missing.length > 0) {
      toast.error(`Please fill in: ${missing.map((q) => q.label).join(", ")}`);
      return;
    }
    if (availabilityLoading || availableSlots === null || !timeSlots.includes(selectedTime)) {
      toast.error("That time is no longer available. Please choose another.");
      setSelectedTime(null);
      setStep("datetime");
      setAvailabilityRetry(retry => retry + 1);
      return;
    }

    // Proceed to payment step (skip if free)
    if (getPriceForDuration(selectedEvent, selectedDuration!) === 0) {
      handleCompletePaymentFree();
    } else {
      setStep("payment");
    }
  };

  const buildBookingRecord = (paymentMethod: "stripe" | "bank" | "none") => {
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration) return null;
    const modifyToken = generateCapabilityToken("mod");
    const depositEnabled = selectedEvent.depositEnabled && selectedEvent.depositAmount && selectedEvent.depositAmount > 0;
    const depositAmt = depositEnabled
      ? selectedEvent.depositType === "percentage"
        ? Math.round((getPriceForDuration(selectedEvent, selectedDuration!) * (selectedEvent.depositAmount || 0)) / 100)
        : (selectedEvent.depositAmount || 0)
      : 0;
    const totalPrice = getPriceForDuration(selectedEvent, selectedDuration!);
    // If user chose pay-in-full, skip deposit logic
    const skipDeposit = payFullInstead && depositEnabled;
    // Booking must stay "pending" until the deposit is actually received
    const awaitingDeposit = !skipDeposit && depositEnabled && (paymentMethod === "stripe" || paymentMethod === "bank");
    const dateStr = toDateStr(selectedDate);
    const bookingAnswers = { ...answers };
    selectedQuestions.forEach(question => {
      const role = contactQuestionRole(question);
      if (role === "name") bookingAnswers[question.id] = clientName.trim();
      if (role === "email") bookingAnswers[question.id] = clientEmail.trim();
      if (role === "phone") bookingAnswers[question.id] = clientPhone.trim();
    });
    return {
      id: `bk-${Date.now()}`,
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      date: dateStr,
      time: selectedTime,
      eventTypeId: selectedEvent.id,
      type: selectedEvent.title,
      duration: selectedDuration,
      status: (selectedEvent.requiresConfirmation || awaitingDeposit) ? "pending" as const : "confirmed" as const,
      requiresConfirmation: !!selectedEvent.requiresConfirmation,
      notes: "",
      answers: bookingAnswers,
      answerLabels: Object.fromEntries(
        selectedQuestions.map(q => [q.id, q.label])
      ),
      createdAt: new Date().toISOString(),
      paymentStatus: paymentMethod === "bank" ? "pending-confirmation" as const : paymentMethod === "none" ? "unpaid" as const : "unpaid" as const,
      paymentAmount: totalPrice,
      instagramHandle: bookingAnswers[selectedQuestions.find(q => q.type === "instagram" || q.label.toLowerCase().includes("instagram"))?.id || ""] || "",
      modifyToken,
      depositRequired: skipDeposit ? false : (depositEnabled || false),
      depositAmount: skipDeposit ? 0 : depositAmt,
      depositMethod: paymentMethod === "none" ? undefined : paymentMethod,
    };
  };

  const createServerBooking = async (paymentMethod: "stripe" | "bank" | "none") => {
    const draft = buildBookingRecord(paymentMethod);
    if (!draft || !selectedEvent) return { error: "Please complete your booking details" };
    let bookingAttemptId: string;
    try {
      bookingAttemptId = bookingAttemptIdRef.current ?? getOrCreateBookingAttemptId();
      bookingAttemptIdRef.current = bookingAttemptId;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "A secure booking attempt could not be created", errorKind: "server" as const };
    }
    const result = await createPublicBooking({
      clientName: draft.clientName, clientEmail: draft.clientEmail, date: draft.date, time: draft.time,
      eventTypeId: selectedEvent.id, duration: draft.duration, answers: draft.answers,
      paymentMethod, payInFull: payFullInstead,
      phone: clientPhone.trim(),
      bookingAttemptId,
    });
    // Network failures and 5xx responses are ambiguous: the server may have
    // committed the booking before failing to respond. Only a booking payload or
    // a definitive 4xx rejection is safe grounds to rotate this attempt key.
    const definitiveClientRejection = typeof result.statusCode === "number"
      && result.statusCode >= 400
      && result.statusCode < 500;
    if (result.booking || definitiveClientRejection) {
      bookingAttemptIdRef.current = null;
      clearBookingAttemptId();
    }
    if (result.booking) cacheBookingLocally(result.booking);
    return result;
  };

  const handleCompletePaymentFree = async () => {
    if (!selectedEvent || processingPayment) return;
    setProcessingPayment(true);
    const result = await createServerBooking("none");
    if (!result.booking) {
      setProcessingPayment(false);
      toast.error(result.error || "Could not save your booking");
      if (/available|taken|conflict/i.test(result.error || "")) {
        setSelectedTime(null);
        setStep("datetime");
        setAvailabilityRetry(retry => retry + 1);
      }
      return;
    }
    const booking = result.booking;
    localStorage.setItem("lastBookingId", booking.id);
    setLastBookingId(booking.id);
    setTimerExpiresAt(null);
    setProcessingPayment(false);
    setStep("confirmed");
  };

  const handleSelectBankTransfer = async () => {
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration || processingPayment || paymentActionRef.current) return;
    paymentActionRef.current = true;
    setProcessingPayment(true);
    setPaymentActionError(null);
    try {
      const existing = lastBookingId ? getBookings().find(item => item.id === lastBookingId) : undefined;
      if (existing && !bookingMatchesSelection(existing, selectedEvent.id, toDateStr(selectedDate), selectedTime, selectedDuration)) {
        setPaymentActionError({
          kind: "api",
          message: "A different booking is already holding your earlier selection. Open that booking to change or cancel it before paying for this new time.",
        });
        return;
      }
      if (existing && !existing.modifyToken) {
        setPaymentActionError({
          kind: "api",
          message: "The existing booking cannot be safely verified. Reopen its management link instead of creating another booking.",
        });
        return;
      }
      if (existing?.paymentStatus === "deposit-paid" || existing?.depositPaidAt) {
        setPaymentActionError({
          kind: "api",
          message: "Your deposit is already recorded. Contact the photographer to confirm a manual remaining-balance transfer.",
        });
        return;
      }
      if (existing?.modifyToken) {
        const statusResult = await getBookingPaymentStatus(existing.modifyToken);
        if (!statusResult.payment) {
          setPaymentActionError({
            kind: statusResult.errorKind === "network" ? "network" : "api",
            message: statusResult.error || "Payment status could not be verified. Do not send a second payment yet.",
          });
          return;
        }
        if (!statusResult.payment.canSubmitBank) {
          const processing = isBookingPaymentVerificationPending(statusResult.payment.state);
          const refreshed = await fetchBookingByToken(existing.modifyToken);
          if (refreshed) {
            cacheBookingLocally(refreshed);
            setBookingVersion(version => version + 1);
          }
          setPaymentActionError({
            kind: processing ? "processing" : "api",
            message: processing
              ? "A card payment is already being verified. Do not send a bank transfer as well."
              : "Bank transfer is not available for the booking’s current payment state.",
          });
          return;
        }
      }
      const result = existing?.modifyToken
        ? await selectBookingBankTransfer(existing.modifyToken)
        : await createServerBooking("bank");
      if (!result.booking) {
        const errorKind = "errorKind" in result ? result.errorKind : undefined;
        const errorCode = "errorCode" in result && typeof result.errorCode === "string" ? result.errorCode : undefined;
        const kind = errorKind === "network" ? "network" : isBookingPaymentConflictError(errorCode) ? "processing" : "api";
        const message = result.error || "Could not record the bank transfer";
        setPaymentActionError({ kind, message });
        toast.error(message);
        if (!existing && /available|taken|conflict/i.test(message)) {
          setSelectedTime(null);
          setStep("datetime");
          setAvailabilityRetry(retry => retry + 1);
        }
        return;
      }
      const booking = result.booking;
      cacheBookingLocally(booking);
      localStorage.setItem("lastBookingId", booking.id);
      setLastBookingId(booking.id);
      setBookingVersion(version => version + 1);
      setLastBookingPaymentStatus({
        state: "bank-pending",
        paymentStatus: "pending-confirmation",
        paymentMethod: "bank",
        canRetryCard: false,
        canSubmitBank: false,
        bankTransferIsManual: true,
        requiresAdminVerification: true,
      });
      setTimerExpiresAt(null);
      setStep("confirmed");
    } finally {
      paymentActionRef.current = false;
      setProcessingPayment(false);
    }
  };

  const handleReset = () => {
    localStorage.removeItem("lastBookingId");
    setStep("event-select");
    setSelectedEvent(null);
    setSelectedDuration(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setAnswers({});
    setClientName("");
    setClientEmail("");
    setClientPhone("");
    setTimerExpiresAt(null);
    setLastBookingId(null);
    setLastBookingPaymentStatus(null);
    setProcessingPayment(false);
    setPayFullInstead(false);
    setPaymentActionError(null);
    paymentActionRef.current = false;
    bookingAttemptIdRef.current = null;
    clearBookingAttemptId();
  };

  const handleNextAvailableMonth = useCallback(() => {
    if (!selectedEvent) return;
    let searchYear = year;
    let searchMonth = month + 1;
    for (let i = 0; i < 24; i++) {
      if (searchMonth > 11) { searchMonth = 0; searchYear++; }
      const daysInSearch = new Date(searchYear, searchMonth + 1, 0).getDate();
      for (let d = 1; d <= daysInSearch; d++) {
        const date = new Date(searchYear, searchMonth, d);
        if (!isPastBookingDate(toDateStr(date), availabilityTimezone || profile.timezone) && isDayAvailable(selectedEvent, date)) {
          setCurrentMonth(new Date(searchYear, searchMonth));
          return;
        }
      }
      searchMonth++;
    }
  }, [selectedEvent, year, month, availabilityTimezone, profile.timezone]);

  // Open the enquiry form, optionally pre-filling event and/or date
  const handleOpenEnquiry = (prefillEventId?: string, prefillDate?: string) => {
    setEnquiryEventId(prefillEventId || selectedEvent?.id || "");
    setEnquiryDate(prefillDate || (selectedDate ? toDateStr(selectedDate) : ""));
    setEnquiryStartTime("");
    setEnquiryEndTime("");
    setEnquiryName("");
    setEnquiryEmail("");
    setEnquiryPhone("");
    setEnquiryMessage("");
    setStep("enquiry");
  };

  const handleSubmitEnquiry = async () => {
    if (!enquiryName.trim()) { toast.error("Please enter your name"); return; }
    if (!isValidEmail(enquiryEmail)) { toast.error("Please enter a valid email address"); return; }
    if (!enquiryMessage.trim()) { toast.error("Please describe what you're looking for"); return; }
    setEnquirySubmitting(true);
    const matchedEvent = eventTypes.find(e => e.id === enquiryEventId);
    try {
      await submitPublicEnquiry({
        name: enquiryName.trim(),
        email: enquiryEmail.trim(),
        phone: enquiryPhone.trim() || undefined,
        eventTypeId: enquiryEventId || undefined,
        eventTypeTitle: matchedEvent?.title,
        preferredDate: enquiryDate || undefined,
        preferredStartTime: enquiryStartTime || undefined,
        preferredEndTime: enquiryEndTime || undefined,
        message: enquiryMessage.trim(),
      });
      setStep("enquiry-confirmed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send your enquiry. Please try again.");
    } finally {
      setEnquirySubmitting(false);
    }
  };

  const handleCancelBooking = async (booking: import("@/lib/types").Booking) => {
    if (!booking.modifyToken) {
      toast.error("This booking cannot be cancelled online. Please contact the photographer.");
      return;
    }
    if (!confirm("Are you sure you want to cancel this booking?")) return;
    setCancellingBooking(true);
    try {
      const updated = await patchPublicBooking(booking.modifyToken, { action: "cancel" });
      cacheBookingLocally(updated);
      setBookingVersion(version => version + 1);
      toast.success("Booking cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel the booking");
    } finally {
      setCancellingBooking(false);
    }
  };

  return (
    <div className="min-h-screen app-shell">
      <section className="min-h-screen" style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)", paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}>
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          <BookingSteps currentStep={step} />
          <AnimatePresence mode="wait">

            {/* ─── Step 1: Event List ─── */}
            {step === "event-select" && (
              <motion.div key="event-select" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="mx-auto w-full max-w-3xl">
                {/* Profile Card */}
                <div className="glass-panel rounded-2xl p-6 sm:p-8 mb-5">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                    <BookingAvatar src={profile.avatar} name={profile.name || "Photographer"} className="h-20 w-20 rounded-2xl shadow-lg shadow-primary/10" />
                    <div className="flex-1 min-w-0 pt-0.5">
                      <h1 className="font-display text-4xl sm:text-5xl leading-none text-foreground">{profile.name}</h1>
                      {profile.bio && (
                        <RichTextDisplay html={profile.bio} className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl" />
                      )}
                    </div>
                  </div>
                </div>

                {configError && (
                  <div className="mb-5 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs font-body text-yellow-200" role="status">
                    Live booking settings couldn't be refreshed. Availability will still be checked before a time can be selected.
                  </div>
                )}

                {configLoading ? (
                  <div className="glass-panel rounded-xl p-12 text-center" role="status">
                    <p className="text-sm font-body text-muted-foreground">Loading booking options…</p>
                  </div>
                ) : eventTypes.length === 0 ? (
                  <div className="glass-panel rounded-xl p-12 text-center">
                    <CalendarDays className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm font-body text-muted-foreground">No event types available yet.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {eventTypes.map((ev) => {
                      const minPrice = ev.durations.length > 0
                        ? Math.min(...ev.durations.map(d => getPriceForDuration(ev, d)))
                        : (ev.price ?? 0);
                      const isExpanded = !!expandedDescriptions[ev.id];
                      return (
                        <article key={ev.id} className="booking-service-card w-full text-left glass-panel rounded-2xl p-5 sm:p-6 hover:border-primary/50 hover:-translate-y-0.5 transition-all group">
                          <div className="flex items-start gap-4">
                            <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-primary/25 transition-colors ring-1 ring-primary/20" aria-hidden="true">
                              <Camera className="w-4 h-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                <h3 className="font-display text-2xl leading-tight text-foreground">{ev.title}</h3>
                                {(ev.price ?? 0) > 0 && (
                                  <span className="text-sm font-body font-semibold text-primary bg-primary/10 rounded-full px-3 py-1 border border-primary/20 shrink-0">
                                    from ${minPrice}
                                  </span>
                                )}
                              </div>
                              {ev.description && (
                                <div>
                                  <div className={isExpanded ? "" : "line-clamp-4"}>
                                    <RichTextDisplay html={ev.description} className="text-sm font-body text-muted-foreground" />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setExpandedDescriptions(prev => ({ ...prev, [ev.id]: !prev[ev.id] })); }}
                                    className="text-xs font-body text-primary/70 hover:text-primary mt-1"
                                  >
                                    {isExpanded ? "Show less" : "Read more"}
                                  </button>
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <span className="inline-flex items-center gap-1 text-xs font-body text-muted-foreground border border-border rounded-full px-2.5 py-1">
                                  <Clock className="w-3 h-3" />
                                  {ev.durations.map((d) => formatDuration(d)).join(" / ")}
                                </span>
                                {ev.requiresConfirmation && (
                                  <span className="inline-flex items-center gap-1 text-xs font-body text-muted-foreground border border-border rounded-full px-2.5 py-1">
                                    <AlertCircle className="w-3 h-3" />Requires confirmation
                                  </span>
                                )}
                                {ev.location && (
                                  <span className="inline-flex items-center gap-1 text-xs font-body text-muted-foreground border border-border rounded-full px-2.5 py-1">
                                    <MapPin className="w-3 h-3" />{ev.location}
                                  </span>
                                )}
                              </div>
                              <div className="flex justify-end mt-3">
                                <button type="button" onClick={() => handleSelectEvent(ev)} className="inline-flex items-center gap-1.5 text-xs font-body font-semibold bg-primary text-primary-foreground px-3.5 py-1.5 rounded-full hover:bg-primary/90 transition-colors">
                                  Book <ArrowRight className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-col items-center gap-1 mt-6">
                  <div className="flex items-center gap-2 text-xs font-body text-muted-foreground/50">
                    <Globe className="w-3.5 h-3.5" />
                    <span>{profile.timezone ? formatTimezone(profile.timezone) : ""}</span>
                  </div>
                  {profile.timezone && (() => {
                    const note = getVisitorTimezoneNote(profile.timezone);
                    return note ? (
                      <p className="text-[11px] font-body text-muted-foreground/35 italic">{note}</p>
                    ) : null;
                  })()}
                </div>

                {settings.enquiryEnabled && (
                  <div className="mt-4 text-center">
                    <Button
                      variant="outline"
                      onClick={() => handleOpenEnquiry()}
                      className="gap-2 font-body text-sm"
                    >
                      <MessageCircle className="w-4 h-4" />
                      {settings.enquiryLabel || "Make an Enquiry"}
                    </Button>
                    <p className="mt-2 text-xs font-body text-muted-foreground/60">Can't find a time that works? Send a message.</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* ─── Date & Time (Cal.com Style) ─── */}
            {step === "datetime" && selectedEvent && selectedDuration && (
              <motion.div key="datetime" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <div className="max-w-[1100px] mx-auto">
                  <button onClick={handleReset} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-4">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>

                  <div className="glass-panel rounded-2xl overflow-hidden">
                    <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_220px] xl:grid-cols-[280px_minmax(0,1fr)_220px]">
                      
                      {/* Left: Event Info */}
                      <div className="min-w-0 p-5 sm:p-6 space-y-5 border-b border-border/50 lg:col-span-2 xl:col-span-1 xl:border-b-0 xl:border-r">
                        <div className="flex items-center gap-3">
                          <BookingAvatar src={profile.avatar} name={profile.name || "Photographer"} className="h-11 w-11 rounded-full" />
                          <div className="min-w-0">
                            <p className="text-[10px] font-body uppercase tracking-[0.16em] text-muted-foreground/70">Session with</p>
                            <p className="truncate text-sm font-body font-medium text-foreground">{profile.name}</p>
                          </div>
                        </div>
                        <h2 className="font-display text-2xl leading-tight text-foreground">{selectedEvent.title}</h2>
                        {selectedEvent.description && (
                          <div className="min-w-0 rounded-xl border border-border/50 bg-secondary/25 p-4">
                            <RichTextDisplay html={selectedEvent.description} className="text-sm" />
                          </div>
                        )}
                        
                        {selectedEvent.requiresConfirmation && (
                          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Requires confirmation
                          </div>
                        )}

                        {/* Duration Selector */}
                        <div className="flex items-start gap-2">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground mt-2.5 shrink-0" />
                          <div className="flex min-w-0 flex-wrap gap-2">
                            {selectedEvent.durations.map((d) => {
                              const dPrice = getPriceForDuration(selectedEvent, d);
                              return (
                                <button key={d} type="button" aria-pressed={selectedDuration === d} onClick={() => { setSelectedDuration(d); setSelectedTime(null); setTimerExpiresAt(null); }}
                                  className={`min-w-16 rounded-lg border px-3 py-2 text-xs font-body transition-all flex flex-col items-center ${
                                    selectedDuration === d ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-secondary"
                                  }`}
                                >
                                  <span>{formatDuration(d)}</span>
                                  {dPrice > 0 && <span className={`text-[10px] mt-0.5 ${selectedDuration === d ? "text-primary-foreground/70" : "text-primary"}`}>${dPrice}</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {selectedEvent.location && (
                          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                            <MapPin className="w-3.5 h-3.5" /> {selectedEvent.location}
                          </div>
                        )}

                        {!!selectedEvent.bufferMinutes && selectedEvent.bufferMinutes > 0 && (
                          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" /> Includes a {formatDuration(selectedEvent.bufferMinutes)} turnaround buffer between sessions
                          </div>
                        )}

                        <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                          <Globe className="w-3.5 h-3.5" /> {profile.timezone ? formatTimezone(profile.timezone) : ""}
                        </div>
                      </div>

                      {/* Center: Calendar */}
                      <div className="min-w-0 p-5 sm:p-6 lg:border-r lg:border-border/50">
                        <div className="flex items-center justify-between gap-4 mb-5">
                          <div>
                            <p className="text-[10px] font-body uppercase tracking-[0.16em] text-muted-foreground/70 mb-1">Choose a date</p>
                            <h3 className="font-display text-lg text-foreground">
                              <span className="text-primary">{currentMonth.toLocaleDateString("en-US", { month: "long" })}</span>{" "}
                              {year}
                            </h3>
                          </div>
                          <div className="flex items-center gap-1">
                            <button type="button" aria-label="Previous month" onClick={() => setCurrentMonth(new Date(year, month - 1))} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary">
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button type="button" aria-label="Next month" onClick={() => setCurrentMonth(new Date(year, month + 1))} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary">
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-7 gap-1 mb-2">
                          {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
                            <div key={d} className="text-center text-[10px] font-body tracking-wider uppercase text-muted-foreground py-2">{d}</div>
                          ))}
                        </div>

                        <div className="grid grid-cols-7 gap-1">
                          {blanks.map((b) => <div key={`blank-${b}`} />)}
                          {days.map((day) => {
                            const date = new Date(year, month, day);
                            const isSelected = selectedDate?.getDate() === day && selectedDate?.getMonth() === month && selectedDate?.getFullYear() === year;
                            const isPast = isPastBookingDate(toDateStr(date), availabilityTimezone || profile.timezone);
                            const isAvailable = !isPast && isDayAvailable(selectedEvent, date);
                            const isToday = toDateStr(date) === toDateStr(new Date());
                            return (
                              <button key={day} type="button" aria-label={`${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${isAvailable ? ", available" : ", unavailable"}`} aria-pressed={isSelected} disabled={!isAvailable} onClick={() => { setSelectedDate(date); setSelectedTime(null); setTimerExpiresAt(null); setShowWaitlist(false); setWaitlistDone(false); setWaitlistName(""); setWaitlistEmail(""); setWaitlistNote(""); }}
                                className={`aspect-square rounded-lg text-sm font-body transition-all relative ${
                                  isSelected ? "bg-primary text-primary-foreground font-medium ring-2 ring-primary ring-offset-2 ring-offset-background"
                                    : isAvailable ? "text-foreground font-medium hover:bg-amber-500/10 hover:text-amber-500"
                                    : "text-muted-foreground opacity-40 cursor-not-allowed"
                                }`}
                              >
                                {day}
                                {isAvailable && !isSelected && (
                                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-500" />
                                )}
                                {isToday && !isSelected && !isAvailable && (
                                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {/* Calendar legend */}
                        <div className="flex items-center justify-center gap-4 mt-3 text-[10px] font-body text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> Available
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full border border-muted-foreground/40 inline-block" /> Unavailable
                          </span>
                        </div>

                        {/* No availability this month */}
                        {!hasAvailabilityThisMonth && (
                          <div className="mt-4 text-center space-y-2">
                            <p className="text-xs font-body text-muted-foreground">No availability this month</p>
                            <button
                              onClick={handleNextAvailableMonth}
                              className="text-xs font-body text-primary hover:text-primary/80 border border-primary/30 hover:border-primary/60 px-3 py-1.5 rounded-full transition-colors"
                            >
                              Next available →
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Right: Time Slots */}
                      <div className="min-w-0 p-5 sm:p-6">
                        {selectedDate ? (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <p className="text-[10px] font-body uppercase tracking-[0.16em] text-muted-foreground/70">Available times</p>
                                <p className="text-sm font-body font-medium text-foreground">{selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</p>
                              </div>
                              <div className="flex rounded-md border border-border overflow-hidden">
                                <button type="button" aria-pressed={!use24h} onClick={() => setUse24h(false)} className={`px-2 py-0.5 text-[10px] font-body ${!use24h ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>12h</button>
                                <button type="button" aria-pressed={use24h} onClick={() => setUse24h(true)} className={`px-2 py-0.5 text-[10px] font-body ${use24h ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>24h</button>
                              </div>
                            </div>
                            
                            {timerExpiresAt && selectedTime && (
                              <div className="mb-2">
                                <BookingTimer expiresAt={timerExpiresAt} onExpire={handleTimerExpire} />
                              </div>
                            )}
                            
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:max-h-[420px] lg:grid-cols-1 lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
                              {availabilityLoading ? (
                                <div className="py-6 text-center text-sm font-body text-muted-foreground" role="status">Checking availability…</div>
                              ) : availabilityError ? (
                                <div className="py-6 text-center space-y-3" role="alert">
                                  <p className="text-sm font-body text-destructive">We couldn't load live availability.</p>
                                  <Button type="button" variant="outline" size="sm" onClick={() => setAvailabilityRetry(retry => retry + 1)}>Try again</Button>
                                </div>
                              ) : timeSlots.length > 0 ? (
                                timeSlots.map((t) => (
                                  <button key={t} type="button" aria-pressed={selectedTime === t} onClick={() => handleSelectTime(t)}
                                    className={`w-full text-sm font-body py-2.5 px-4 rounded-lg border transition-all text-center ${
                                      selectedTime === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:border-primary/50"
                                    }`}
                                  >
                                    <span className="flex items-center justify-center gap-2">
                                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                                      {use24h ? t : formatTime12(t)}
                                    </span>
                                  </button>
                                ))
                              ) : (
                                <div className="py-6 text-center space-y-4">
                                  {!waitlistDone ? (
                                    <>
                                      <div className="flex items-center justify-center gap-2 text-muted-foreground/60">
                                        <Users className="w-4 h-4" />
                                        <p className="text-sm font-body">No slots available on this date</p>
                                      </div>
                                      {!showWaitlist ? (
                                        <div className="flex flex-col items-center gap-2">
                                          <button
                                            onClick={() => setShowWaitlist(true)}
                                            className="flex items-center gap-2 mx-auto text-xs font-body text-primary hover:text-primary/80 border border-primary/30 hover:border-primary/60 px-4 py-2 rounded-full transition-colors"
                                          >
                                            <Bell className="w-3.5 h-3.5" />
                                            Join waitlist — get notified if a spot opens
                                          </button>
                                          {settings.enquiryEnabled && (
                                            <button
                                              onClick={() => handleOpenEnquiry(selectedEvent.id, toDateStr(selectedDate))}
                                              className="flex items-center gap-2 mx-auto text-xs font-body text-muted-foreground hover:text-foreground border border-border/50 hover:border-primary/40 px-4 py-2 rounded-full transition-colors"
                                            >
                                              <MessageSquare className="w-3.5 h-3.5" />
                                              Enquire for a custom time
                                            </button>
                                          )}
                                        </div>
                                      ) : (
                                        <motion.div
                                          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                                          className="glass-panel rounded-xl p-4 text-left space-y-3"
                                        >
                                          <div className="flex items-center justify-between">
                                            <p className="text-xs font-display text-foreground">Join the waitlist</p>
                                            <button onClick={() => setShowWaitlist(false)} className="text-muted-foreground/50 hover:text-muted-foreground">
                                              <XCircle className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                          <input
                                            type="text"
                                            value={waitlistName}
                                            onChange={e => setWaitlistName(e.target.value)}
                                            placeholder="Your name"
                                            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                                          />
                                          <input
                                            type="email"
                                            value={waitlistEmail}
                                            onChange={e => setWaitlistEmail(e.target.value)}
                                            placeholder="Your email"
                                            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                                          />
                                          <input
                                            type="text"
                                            value={waitlistNote}
                                            onChange={e => setWaitlistNote(e.target.value)}
                                            placeholder="Anything to add? (optional)"
                                            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                                          />
                                          <button
                                            onClick={handleJoinWaitlist}
                                            disabled={waitlistSubmitting}
                                            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-lg px-4 py-2 text-xs font-body tracking-wider uppercase transition-colors flex items-center justify-center gap-2"
                                          >
                                            <Bell className="w-3.5 h-3.5" />
                                            {waitlistSubmitting ? "Joining…" : "Notify Me"}
                                          </button>
                                        </motion.div>
                                      )}
                                    </>
                                  ) : (
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                                      className="flex flex-col items-center gap-2"
                                    >
                                      <CheckCircle2 className="w-8 h-8 text-green-400" />
                                      <p className="text-sm font-display text-foreground">You're on the waitlist!</p>
                                      <p className="text-xs font-body text-muted-foreground">We'll email you at {waitlistEmail} if a spot opens up.</p>
                                    </motion.div>
                                  )}
                                </div>
                              )}
                            </div>
                            {selectedTime && (
                              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
                                <Button onClick={() => setStep("questions")} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs py-5">
                                  Continue
                                </Button>
                              </motion.div>
                            )}
                          </motion.div>
                        ) : (
                          <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-secondary/15 px-4 py-8 text-center text-muted-foreground/60">
                            <CalendarDays className="w-8 h-8 mb-3" />
                            <p className="text-sm font-body text-muted-foreground">Select a date</p>
                            <p className="mt-1 text-xs font-body text-muted-foreground/60">Available appointment times will appear here.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ─── Questionnaire ─── */}
            {step === "questions" && selectedEvent && selectedDate && selectedTime && selectedDuration && (
              <motion.div key="questions" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-lg mx-auto">
                <button onClick={() => setStep("datetime")} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-6">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>

                {timerExpiresAt && (
                  <div className="glass-panel rounded-lg p-3 mb-4 flex items-center justify-center">
                    <BookingTimer expiresAt={timerExpiresAt} onExpire={handleTimerExpire} />
                  </div>
                )}

                <div className="glass-panel rounded-xl p-5 mb-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-1.5 h-10 rounded-full bg-primary" />
                    <div>
                      <h3 className="font-display text-lg text-foreground">{selectedEvent.title}</h3>
                      <p className="text-xs font-body text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3 h-3" /> {formatDuration(selectedDuration)}
                      </p>
                    </div>
                  </div>
                  <div className="border-t border-border/50 pt-3 space-y-1">
                    <p className="text-sm font-body text-foreground">
                      {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    </p>
                    <p className="text-sm font-body text-primary font-medium">{formatTime12(selectedTime)}</p>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <label htmlFor="booking-client-name" className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 block">Name <span className="text-destructive">*</span></label>
                    <Input id="booking-client-name" name="name" autoComplete="name" required value={clientName} onChange={event => setClientName(event.target.value)} className="bg-secondary border-border text-foreground font-body" />
                  </div>
                  <div>
                    <label htmlFor="booking-client-email" className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 block">Email <span className="text-destructive">*</span></label>
                    <Input id="booking-client-email" name="email" type="email" autoComplete="email" required value={clientEmail} onChange={event => setClientEmail(event.target.value)} className="bg-secondary border-border text-foreground font-body" />
                  </div>
                  <div>
                    <label htmlFor="booking-client-phone" className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 block">Phone {phoneRequired ? <span className="text-destructive">*</span> : <span className="normal-case tracking-normal">(optional)</span>}</label>
                    <Input id="booking-client-phone" name="tel" type="tel" autoComplete="tel" required={phoneRequired} value={clientPhone} onChange={event => setClientPhone(event.target.value)} className="bg-secondary border-border text-foreground font-body" />
                  </div>
                  {customQuestions.map((q) => (
                    <BookingQuestionField key={q.id} field={q} value={answers[q.id] || ""} onChange={(val) => setAnswers((prev) => ({ ...prev, [q.id]: val }))} />
                  ))}
                  {selectedQuestions.some(question => question.type === "image-upload") && (
                    <p role={hasRequiredUnsupportedUpload ? "alert" : undefined} className={`rounded-lg border p-3 text-xs font-body ${hasRequiredUnsupportedUpload ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>
                      {hasRequiredUnsupportedUpload
                        ? "This booking form is configured with a required image upload, but secure uploads are not available here. Please contact the photographer to book."
                        : "Reference image uploads aren't accepted in this form. The photographer can arrange a secure upload after you submit."}
                    </p>
                  )}
                </div>

                <Button onClick={handleSubmitQuestions} disabled={processingPayment || hasRequiredUnsupportedUpload} size="lg" className="w-full mt-6 bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs py-6">
                  {hasRequiredUnsupportedUpload ? "Contact Photographer to Book" : processingPayment ? "Submitting…" : getPriceForDuration(selectedEvent, selectedDuration) === 0 ? "Confirm Free Booking" : "Continue to Payment"}
                </Button>
                <p className="text-center text-[10px] font-body text-muted-foreground/40 mt-4">By booking, you agree to our terms and conditions.</p>
              </motion.div>
            )}

            {/* ─── Payment Step ─── */}
            {step === "payment" && selectedEvent && selectedDate && selectedTime && selectedDuration && (() => {
              const existingBookingCandidate = lastBookingId ? getBookings().find(b => b.id === lastBookingId) : null;
              const existingBookingMismatch = !!existingBookingCandidate && !bookingMatchesSelection(
                existingBookingCandidate,
                selectedEvent.id,
                toDateStr(selectedDate),
                selectedTime,
                selectedDuration,
              );
              const existingBooking = existingBookingMismatch ? null : existingBookingCandidate;
              const existingChargeKnown = !existingBooking || hasAuthoritativeBookingCharge(existingBooking);
              const storedCharge = existingBooking ? getAuthoritativeBookingCharge(existingBooking) : null;
              const configuredDepositEnabled = !!(selectedEvent.depositEnabled && selectedEvent.depositAmount && selectedEvent.depositAmount > 0);
              const configuredTotal = getPriceForDuration(selectedEvent, selectedDuration!);
              const configuredDeposit = configuredDepositEnabled
                ? selectedEvent.depositType === "percentage"
                  ? Math.round((configuredTotal * (selectedEvent.depositAmount || 0)) / 100)
                  : (selectedEvent.depositAmount || 0)
                : 0;
              // Existing bookings retain the exact price and deposit accepted by the server,
              // even if the event type is edited before the client returns to this screen.
              const depositEnabled = storedCharge?.depositRequired ?? configuredDepositEnabled;
              const totalPrice = storedCharge?.total ?? configuredTotal;
              const depositAmt = storedCharge?.depositAmount ?? configuredDeposit;

              // Check if deposit was already paid for this event (returning to pay remaining)
              const depositAlreadyPaid = existingBooking?.paymentStatus === "deposit-paid" || !!existingBooking?.depositPaidAt;
              const existingPaidInFull = existingBooking?.paymentStatus === "paid" || existingBooking?.paymentStatus === "cash" || !!existingBooking?.paidAt;
              const existingBankPending = existingBooking?.paymentStatus === "pending-confirmation";

              // If user chose to pay full, or deposit already paid, or no deposit — determine amount
              const wantsPayFull = !existingBooking && payFullInstead && depositEnabled && !depositAlreadyPaid;
              const amountDue = existingPaidInFull
                ? 0
                : depositAlreadyPaid
                ? Math.max(0, totalPrice - depositAmt)
                : wantsPayFull
                ? totalPrice
                : depositEnabled ? depositAmt : totalPrice;

              const paymentLabel = !existingChargeKnown
                ? "Payment Details Unavailable"
                : existingPaidInFull
                ? "Payment Complete"
                : depositAlreadyPaid
                ? "Pay Remaining Balance"
                : wantsPayFull
                ? "Full Payment"
                : depositEnabled ? "Deposit Required" : "Full Payment Required";
              const depositMethods = selectedEvent.depositMethods || [];
              const bankTransfer = settings.bankTransfer;
              const methodAllowed = (method: "stripe" | "bank") => !depositEnabled || depositMethods.length === 0 || depositMethods.includes(method);
              const stripeOffered = !existingBookingMismatch && existingChargeKnown && !existingPaidInFull && !existingBankPending && amountDue > 0 && methodAllowed("stripe") && stripeAvailable;
              const bankOffered = !existingBookingMismatch && existingChargeKnown && !existingPaidInFull && !existingBankPending && amountDue > 0 && methodAllowed("bank") && bankTransfer.enabled;
              const canRecordBankTransfer = bankOffered && !depositAlreadyPaid;

              const handleStripePayment = async () => {
                if (processingPayment || paymentActionRef.current) return;
                if (existingBookingMismatch) {
                  setPaymentActionError({
                    kind: "api",
                    message: "A different booking is already holding your earlier selection. Manage or cancel it before paying for this new time.",
                  });
                  return;
                }
                if (!existingChargeKnown) {
                  toast.error("The saved booking amount could not be verified. Please reopen your booking link.");
                  return;
                }
                if (existingBankPending) {
                  toast.info("Your bank transfer is awaiting confirmation. Please do not pay again.");
                  return;
                }
                if (existingPaidInFull || amountDue <= 0) {
                  toast.info("This booking is already paid in full.");
                  return;
                }
                paymentActionRef.current = true;
                setProcessingPayment(true);
                setPaymentActionError(null);
                let bookingId: string;
                let modifyToken: string;
                let clientName: string;
                let clientEmail: string;

                if (existingBooking) {
                  // Retry or continue payment against the booking already holding
                  // this slot. Never create a second booking for the same attempt.
                  bookingId = existingBooking.id;
                  modifyToken = existingBooking.modifyToken;
                  clientName = existingBooking.clientName;
                  clientEmail = existingBooking.clientEmail;
                } else {
                  // New booking — create record before redirecting to Stripe
                  const createResult = await createServerBooking("stripe");
                  if (!createResult.booking) {
                    const message = createResult.error || "Could not save your booking";
                    setPaymentActionError({ kind: /network/i.test(message) ? "network" : "api", message });
                    setProcessingPayment(false);
                    paymentActionRef.current = false;
                    toast.error(message);
                    return;
                  }
                  const newBooking = createResult.booking;
                  localStorage.setItem("lastBookingId", newBooking.id);
                  setLastBookingId(newBooking.id);
                  setTimerExpiresAt(null);
                  bookingId = newBooking.id;
                  modifyToken = newBooking.modifyToken;
                  clientName = newBooking.clientName;
                  clientEmail = newBooking.clientEmail;
                }

                if (!modifyToken) {
                  setProcessingPayment(false);
                  paymentActionRef.current = false;
                  toast.error("This booking cannot be verified for payment. Please reopen your booking link.");
                  return;
                }

                const statusResult = await getBookingPaymentStatus(modifyToken);
                if (!statusResult.payment) {
                  const message = statusResult.error || "Payment status could not be verified. Your existing booking has not been duplicated; check the status before trying again.";
                  setPaymentActionError({ kind: statusResult.errorKind === "network" ? "network" : "api", message });
                  setProcessingPayment(false);
                  paymentActionRef.current = false;
                  toast.error(message);
                  return;
                }
                if (statusResult.payment.state === "deposit-paid" && !depositAlreadyPaid) {
                  const refreshed = await fetchBookingByToken(modifyToken);
                  if (refreshed) {
                    cacheBookingLocally(refreshed);
                    setBookingVersion(version => version + 1);
                  }
                  const message = "Your deposit has already been confirmed. Review the updated remaining balance before continuing.";
                  setPaymentActionError({ kind: "api", message });
                  setProcessingPayment(false);
                  paymentActionRef.current = false;
                  toast.info(message);
                  return;
                }
                if (!statusResult.payment.canRetryCard) {
                  const processing = isBookingPaymentVerificationPending(statusResult.payment.state);
                  const refreshed = await fetchBookingByToken(modifyToken);
                  if (refreshed) {
                    cacheBookingLocally(refreshed);
                    setBookingVersion(version => version + 1);
                  }
                  const message = processing
                    ? "Your existing card payment is being verified. Do not submit another payment."
                    : statusResult.payment.state === "bank-pending"
                    ? "Your bank transfer is awaiting manual confirmation. Do not pay again."
                    : "This booking cannot accept another card payment in its current state.";
                  setPaymentActionError({ kind: processing ? "processing" : "api", message });
                  setProcessingPayment(false);
                  paymentActionRef.current = false;
                  toast.info(message);
                  return;
                }

                const modifyPath = `/booking/modify/${encodeURIComponent(modifyToken)}`;

                const result = await createBookingCheckout({
                  bookingId,
                  modifyToken,
                  clientName,
                  clientEmail,
                  amount: amountDue,
                  eventTitle: selectedEvent.title,
                  paymentKind: depositAlreadyPaid ? "balance" : wantsPayFull || !depositEnabled ? "full" : "deposit",
                  successUrl: `${window.location.origin}${modifyPath}?checkout=success`,
                  cancelUrl: `${window.location.origin}${modifyPath}?checkout=cancelled`,
                });
                setProcessingPayment(false);
                paymentActionRef.current = false;
                if (result.url) {
                  window.location.href = result.url;
                } else {
                  const processing = isBookingPaymentConflictError(result.errorCode);
                  const message = processing
                    ? "A card payment is already processing. Refresh your booking status before trying again."
                    : result.error || "Failed to create checkout session";
                  setPaymentActionError({ kind: processing ? "processing" : result.errorKind === "network" ? "network" : "api", message });
                  if (processing) {
                    const refreshed = await fetchBookingByToken(modifyToken);
                    if (refreshed) {
                      cacheBookingLocally(refreshed);
                      setBookingVersion(version => version + 1);
                    }
                  }
                  toast.error(message);
                }
              };

              return (
                <motion.div key="payment" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-md mx-auto">
                  <button onClick={() => setStep("questions")} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-6">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>

                  {timerExpiresAt && (
                    <div className="glass-panel rounded-lg p-3 mb-4 flex items-center justify-center">
                      <BookingTimer expiresAt={timerExpiresAt} onExpire={handleTimerExpire} />
                    </div>
                  )}

                  {/* Booking summary */}
                  <div className="glass-panel rounded-xl p-5 mb-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-1.5 h-10 rounded-full bg-primary" />
                      <div>
                        <h3 className="font-display text-lg text-foreground">{selectedEvent.title}</h3>
                        <p className="text-xs font-body text-muted-foreground flex items-center gap-1.5">
                          <Clock className="w-3 h-3" /> {formatDuration(selectedDuration)}
                        </p>
                      </div>
                    </div>
                    <div className="border-t border-border/50 pt-3 space-y-1">
                      <p className="text-sm font-body text-foreground">
                        {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                      </p>
                      <p className="text-sm font-body text-primary font-medium">{formatTime12(selectedTime)}</p>
                    </div>
                  </div>

                  {/* Payment panel */}
                  <div className="glass-panel rounded-xl p-6 space-y-5">
                    <div>
                      <h2 className="font-display text-xl text-foreground mb-1">{paymentLabel}</h2>
                      <p className="text-xs font-body text-muted-foreground">
                        {!existingChargeKnown
                          ? "The saved booking amount could not be verified. Reopen your booking link or contact the photographer before paying."
                          : existingPaidInFull
                          ? "This booking is already paid in full. No further payment is due."
                          : depositAlreadyPaid
                          ? `Deposit paid. Remaining balance of $${amountDue} is due.`
                          : wantsPayFull
                          ? `Full payment of $${totalPrice} to confirm your booking.`
                          : depositEnabled
                          ? `A $${depositAmt} deposit is required to secure your booking. Remaining $${Math.max(0, totalPrice - depositAmt)} due on the day.`
                          : `Full payment of $${amountDue} is required to confirm your booking.`}
                      </p>
                    </div>

                    {/* Pay full vs deposit toggle */}
                    {depositEnabled && !depositAlreadyPaid && !existingPaidInFull && totalPrice > depositAmt && (
                      <div className="flex rounded-lg border border-border overflow-hidden">
                        <button
                          onClick={() => setPayFullInstead(false)}
                          className={`flex-1 py-3 px-4 text-sm font-body transition-all ${!payFullInstead ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
                        >
                          <span className="block font-medium">Pay Deposit</span>
                          <span className="block text-xs mt-0.5 opacity-70">${depositAmt}</span>
                        </button>
                        <button
                          onClick={() => setPayFullInstead(true)}
                          className={`flex-1 py-3 px-4 text-sm font-body transition-all ${payFullInstead ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
                        >
                          <span className="block font-medium">Pay in Full</span>
                          <span className="block text-xs mt-0.5 opacity-70">${totalPrice}</span>
                        </button>
                      </div>
                    )}

                    <div className={`flex justify-between items-center border rounded-lg p-4 ${existingPaidInFull ? "border-green-500/20 bg-green-500/10" : "border-border/50 bg-secondary/30"}`}>
                      <span className="text-sm font-body text-muted-foreground">
                        {existingPaidInFull ? "Amount Due" : depositAlreadyPaid ? "Remaining Balance" : wantsPayFull ? "Total" : depositEnabled ? "Deposit" : "Total"}
                      </span>
                      <span className={`font-display text-xl ${existingPaidInFull ? "text-green-400" : "text-foreground"}`}>${amountDue}</span>
                    </div>

                    <div className="space-y-3">
                      {existingBookingMismatch && existingBookingCandidate && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-center" role="alert">
                          <p className="text-sm font-body text-amber-300">Your existing booking is for a different date or time.</p>
                          <p className="mt-1 text-xs font-body text-muted-foreground">Manage or cancel that held booking before starting payment for this selection.</p>
                          {existingBookingCandidate.modifyToken && <Button asChild variant="outline" size="sm" className="mt-3"><a href={`/booking/modify/${encodeURIComponent(existingBookingCandidate.modifyToken)}`}>Open Existing Booking</a></Button>}
                        </div>
                      )}
                      {/* Stripe */}
                      {stripeOffered && (
                        <Button
                          onClick={handleStripePayment}
                          disabled={processingPayment}
                          className="w-full gap-3 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-sm h-12"
                        >
                          <CreditCard className="w-5 h-5" />
                          {processingPayment ? "Checking…" : `${existingBooking ? "Continue" : "Pay"} $${amountDue} with Card`}
                        </Button>
                      )}

                      {/* Bank Transfer */}
                      {bankOffered && (
                        canRecordBankTransfer ? (
                          <div className="space-y-2">
                            <Button
                              onClick={() => void handleSelectBankTransfer()}
                              disabled={processingPayment}
                              variant="outline"
                              className="w-full gap-3 border-border text-foreground hover:bg-secondary font-body text-sm h-12"
                            >
                              <Building2 className="w-5 h-5" />
                              {processingPayment
                                ? existingBooking ? "Switching safely…" : "Creating booking…"
                                : existingBooking ? "Switch to Bank Transfer / PayID" : "Choose Bank Transfer / PayID"}
                            </Button>
                            <p className="text-[10px] font-body text-muted-foreground text-center">
                              {existingBooking
                                ? "Any open card checkout is closed before the bank details are revealed."
                                : "Your booking is created before the bank details are revealed, so the transfer has the correct reference."}
                            </p>
                          </div>
                        ) : (
                          <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs font-body text-amber-300 text-center">
                            For a remaining-balance bank transfer, contact the photographer. Your paid deposit will stay recorded while they confirm the balance manually.
                          </p>
                        )
                      )}
                      {existingBankPending && (
                        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-center" role="status">
                          <p className="text-sm font-body text-blue-300">Bank Transfer Pending</p>
                          <p className="mt-1 text-xs font-body text-muted-foreground">The transfer is manual and will show as paid only after the photographer confirms receipt. Please do not pay again.</p>
                        </div>
                      )}
                      {paymentActionError && (
                        <div className={`rounded-lg border p-4 ${paymentActionError.kind === "processing" ? "border-amber-500/30 bg-amber-500/10" : "border-destructive/30 bg-destructive/10"}`} role="alert">
                          <p className={`text-sm font-body ${paymentActionError.kind === "processing" ? "text-amber-300" : "text-destructive"}`}>
                            {paymentActionError.kind === "network" ? "Connection problem" : paymentActionError.kind === "processing" ? "Payment status is updating" : "Payment could not be started"}
                          </p>
                          <p className="mt-1 text-xs font-body text-muted-foreground">{paymentActionError.message}</p>
                        </div>
                      )}
                      {stripeChecked && !existingBookingMismatch && !existingPaidInFull && !existingBankPending && !stripeOffered && !bankOffered && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center" role="alert">
                          <p className="text-sm font-body text-destructive">No payment method is currently available for this session.</p>
                          <p className="mt-1 text-xs font-body text-muted-foreground">Please go back or contact the photographer before booking.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })()}

            {/* ─── Confirmation ─── */}
            {step === "confirmed" && selectedEvent && selectedDate && selectedTime && selectedDuration && (() => {
              const lastBooking = lastBookingId ? getBookings().find(b => b.id === lastBookingId) : null;
              const modifyUrl = lastBooking?.modifyToken ? `${window.location.origin}/booking/modify/${lastBooking.modifyToken}` : null;
              const paymentState = getAuthoritativeBookingPaymentState(lastBooking);
              const paymentStateKnown = paymentState.chargeKnown;
              const depositEnabled = paymentState.depositRequired;
              const depositAmt = paymentState.depositAmount;
              const storedBankPaymentPending = paymentState.bankPaymentPending;
              const bankPaymentPending = storedBankPaymentPending && lastBookingPaymentStatus?.state === "bank-pending";
              const bankPaymentStatusChecking = storedBankPaymentPending && !lastBookingPaymentStatus;
              const bankPaymentHoldExpired = storedBankPaymentPending && lastBookingPaymentStatus?.state === "hold-expired";
              const bankPaymentNeedsReview = lastBookingPaymentStatus?.state === "payment-review" || lastBookingPaymentStatus?.state === "checkout-processing";
              const totalPrice = paymentState.total;
              const isCancelled = lastBooking?.status === "cancelled";
              const isConfirmed = lastBooking?.status === "confirmed" || lastBooking?.status === "completed";
              const paidInFull = paymentState.paidInFull;
              const depositHasBeenPaid = paymentState.depositHasBeenPaid;
              const remainingBalance = paymentState.remainingBalance;
              const paymentLabel = paymentState.paymentLabel;

              return (
              <motion.div key="confirmed" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md mx-auto text-center">
                <div className="glass-panel rounded-xl p-8">
                  {isCancelled ? <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" /> : <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />}
                  <h2 className="font-display text-2xl text-foreground mb-2">
                    {isCancelled ? "Booking Cancelled" : isConfirmed ? "Booking Confirmed!" : "Booking Request Sent!"}
                  </h2>
                  <p className="text-sm font-body text-muted-foreground mb-6">
                    {isCancelled
                      ? "This appointment has been cancelled."
                      : bankPaymentHoldExpired
                      ? "The bank-transfer booking hold has expired. Contact the photographer before sending money."
                      : bankPaymentNeedsReview
                      ? "Payment is being reviewed. Do not send another card or bank payment."
                      : bankPaymentStatusChecking
                      ? "Checking the bank-transfer hold before showing payment details."
                      : bankPaymentPending
                      ? "Your booking is held pending payment confirmation."
                      : !isConfirmed
                      ? "You'll receive a confirmation once approved."
                      : "You're all set!"}
                  </p>
                  <div className="border-t border-border/50 pt-4 space-y-2 text-left">
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Event</span><span className="text-foreground">{selectedEvent.title}</span></div>
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Duration</span><span className="text-foreground">{formatDuration(selectedDuration)}</span></div>
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Date</span><span className="text-foreground">{selectedDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span></div>
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Time</span><span className="text-primary font-medium">{formatTime12(selectedTime)}</span></div>
                    {!paymentStateKnown && (
                      <div className="flex justify-between gap-4 text-sm font-body">
                        <span className="text-muted-foreground">Payment</span>
                        <span className="text-yellow-400 font-medium text-right">Status unavailable — reopen your booking link</span>
                      </div>
                    )}
                    {paymentStateKnown && depositEnabled && totalPrice > 0 && (
                      <div className="flex justify-between text-sm font-body">
                        <span className="text-muted-foreground">Deposit</span>
                        <span className={`font-medium ${depositHasBeenPaid ? "text-green-400" : "text-yellow-400"}`}>
                          ${depositAmt} · {depositHasBeenPaid ? "Paid" : bankPaymentPending ? "Pending confirmation" : bankPaymentHoldExpired ? "Hold expired" : bankPaymentStatusChecking ? "Checking status" : "Unpaid"}
                        </span>
                      </div>
                    )}
                    {paymentStateKnown && !depositEnabled && (
                      <div className="flex justify-between text-sm font-body">
                        <span className="text-muted-foreground">Payment</span>
                        <span className={`font-medium ${totalPrice === 0 || paidInFull ? "text-green-400" : "text-yellow-400"}`}>
                          {totalPrice > 0 ? `$${totalPrice} · ${paymentLabel}` : paymentLabel}
                        </span>
                      </div>
                    )}
                  </div>

                  {bankPaymentPending && !isCancelled && (
                    <div className="mt-4 space-y-3 rounded-lg bg-blue-500/10 border border-blue-500/20 p-4 text-left">
                      <div>
                        <p className="text-sm font-body font-medium text-blue-300">Complete your manual bank transfer</p>
                        <p className="mt-1 text-xs font-body text-muted-foreground">Bank transfer is now selected and any prior card checkout has been closed. This remains unpaid until the photographer verifies receipt.</p>
                      </div>
                      {settings.bankTransfer.accountName && <div className="flex items-center justify-between rounded-lg bg-secondary p-3"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Account Name</p><p className="text-sm font-body text-foreground font-medium">{settings.bankTransfer.accountName}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { navigator.clipboard.writeText(settings.bankTransfer.accountName); setCopiedField("confirm-name"); setTimeout(() => setCopiedField(null), 2000); }}>{copiedField === "confirm-name" ? <CheckIcon className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}</Button></div>}
                      {settings.bankTransfer.bsb && <div className="flex items-center justify-between rounded-lg bg-secondary p-3"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">BSB</p><p className="text-sm font-body text-foreground font-medium">{settings.bankTransfer.bsb}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { navigator.clipboard.writeText(settings.bankTransfer.bsb); setCopiedField("confirm-bsb"); setTimeout(() => setCopiedField(null), 2000); }}>{copiedField === "confirm-bsb" ? <CheckIcon className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}</Button></div>}
                      {settings.bankTransfer.accountNumber && <div className="flex items-center justify-between rounded-lg bg-secondary p-3"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Account Number</p><p className="text-sm font-body text-foreground font-medium">{settings.bankTransfer.accountNumber}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { navigator.clipboard.writeText(settings.bankTransfer.accountNumber); setCopiedField("confirm-account"); setTimeout(() => setCopiedField(null), 2000); }}>{copiedField === "confirm-account" ? <CheckIcon className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}</Button></div>}
                      {settings.bankTransfer.payId && <div className="flex items-center justify-between rounded-lg bg-secondary p-3"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">PayID ({settings.bankTransfer.payIdType})</p><p className="text-sm font-body text-foreground font-medium">{settings.bankTransfer.payId}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { navigator.clipboard.writeText(settings.bankTransfer.payId); setCopiedField("confirm-payid"); setTimeout(() => setCopiedField(null), 2000); }}>{copiedField === "confirm-payid" ? <CheckIcon className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}</Button></div>}
                      {lastBooking && <div className="rounded-lg bg-secondary p-3"><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Transfer Reference</p><p className="font-mono text-sm text-primary">{bookingPaymentReference(lastBooking)}</p></div>}
                      <p className="text-xs font-body text-blue-300">Transfer ${depositEnabled ? depositAmt : totalPrice} using the reference above. The photographer will confirm it manually and notify you by email.</p>
                    </div>
                  )}

                  {(bankPaymentHoldExpired || bankPaymentNeedsReview) && !isCancelled && (
                    <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-left">
                      <p className="text-xs font-body text-amber-300">{bankPaymentHoldExpired ? "Do not transfer to the displayed account for this expired hold. Contact the photographer to arrange the booking." : "A payment may already be in progress or awaiting review. Do not pay again until the photographer confirms its status."}</p>
                    </div>
                  )}

                  {/* Pay remaining balance button (deposit was paid, balance still owed) */}
                  {paymentStateKnown && depositEnabled && !isCancelled && !bankPaymentPending && !paidInFull && depositHasBeenPaid && remainingBalance > 0 && (
                    <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
                      <p className="text-xs font-body text-muted-foreground mb-3">
                        Deposit paid. Remaining balance due on the day:
                      </p>
                      <Button
                        onClick={() => setStep("payment")}
                        className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase h-10"
                      >
                        Pay Remaining ${remainingBalance}
                      </Button>
                    </div>
                  )}
                  
                  <div className="flex flex-col gap-3 mt-6">
                    {!isCancelled && <Button asChild variant="outline" className="w-full font-body text-xs tracking-wider uppercase border-border text-foreground gap-2">
                      <a aria-label={`Add ${selectedEvent.title} on ${toDateStr(selectedDate)} at ${selectedTime} to Google Calendar`} href={buildBookingCalendarUrl({ title: selectedEvent.title, date: toDateStr(selectedDate), time: selectedTime, durationMinutes: selectedDuration, timeZone: availabilityTimezone || profile.timezone, details: richTextToPlainText(selectedEvent.description), location: selectedEvent.location })} target="_blank" rel="noopener noreferrer">
                        <CalendarIcon className="w-4 h-4" /> Add to Google Calendar
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </Button>}
                    {modifyUrl && !isCancelled && (
                      <Button asChild variant="outline" className="w-full font-body text-xs tracking-wider uppercase border-border text-foreground gap-2">
                        <a href={modifyUrl}>
                          <Edit className="w-4 h-4" /> Modify Booking
                        </a>
                      </Button>
                    )}
                    {lastBooking && lastBooking.status !== "cancelled" && (
                      <Button variant="outline" disabled={cancellingBooking} onClick={() => void handleCancelBooking(lastBooking)} className="w-full font-body text-xs tracking-wider uppercase border-destructive text-destructive hover:bg-destructive/10 gap-2">
                        <XCircle className="w-4 h-4" /> {cancellingBooking ? "Cancelling…" : "Cancel Booking"}
                      </Button>
                    )}
                    <Button onClick={handleReset} variant="outline" className="w-full font-body text-xs tracking-wider uppercase border-border text-foreground">
                      Book Another Session
                    </Button>
                  </div>
                </div>
              </motion.div>
              );
            })()}

            {/* ─── Enquiry Form ─── */}
            {step === "enquiry" && (
              <motion.div key="enquiry" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-lg mx-auto">
                <button
                  onClick={() => setStep(selectedEvent ? "datetime" : "event-select")}
                  className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-6"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>

                <div className="glass-panel rounded-xl p-6 space-y-5">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <MessageSquare className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-display text-xl text-foreground">Make an Enquiry</h2>
                      <p className="text-xs font-body text-muted-foreground">Tell us what you're looking for and we'll get back to you</p>
                    </div>
                  </div>

                  {/* Event type selector */}
                  {eventTypes.length > 0 && (
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Event Type (optional)</label>
                      <select
                        value={enquiryEventId}
                        onChange={e => setEnquiryEventId(e.target.value)}
                        className="w-full bg-secondary border border-border text-foreground font-body text-sm rounded-md px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">Not sure yet / other</option>
                        {eventTypes.map(et => <option key={et.id} value={et.id}>{et.title}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Preferred date + time range */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Preferred Date</label>
                      <input
                        type="date"
                        value={enquiryDate}
                        onChange={e => setEnquiryDate(e.target.value)}
                        className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">From</label>
                      <input
                        type="time"
                        value={enquiryStartTime}
                        onChange={e => setEnquiryStartTime(e.target.value)}
                        className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">To</label>
                      <input
                        type="time"
                        value={enquiryEndTime}
                        onChange={e => setEnquiryEndTime(e.target.value)}
                        className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </div>

                  {/* Name + email */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">
                        Your Name <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={enquiryName}
                        onChange={e => setEnquiryName(e.target.value)}
                        placeholder="Jane Smith"
                        className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">
                        Email <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="email"
                        value={enquiryEmail}
                        onChange={e => setEnquiryEmail(e.target.value)}
                        placeholder="jane@example.com"
                        className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </div>

                  {/* Phone (optional) */}
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Phone (optional)</label>
                    <input
                      type="tel"
                      value={enquiryPhone}
                      onChange={e => setEnquiryPhone(e.target.value)}
                      placeholder="+61 4xx xxx xxx"
                      className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  {/* Message */}
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">
                      Message / Details <span className="text-destructive">*</span>
                    </label>
                    <textarea
                      value={enquiryMessage}
                      onChange={e => setEnquiryMessage(e.target.value)}
                      placeholder="Tell us what you have in mind, any special requirements, or questions you have…"
                      rows={4}
                      className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                    />
                  </div>

                  <Button
                    onClick={handleSubmitEnquiry}
                    disabled={enquirySubmitting}
                    size="lg"
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs py-6"
                  >
                    {enquirySubmitting ? "Sending…" : "Send Enquiry"}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ─── Enquiry Confirmed ─── */}
            {step === "enquiry-confirmed" && (
              <motion.div key="enquiry-confirmed" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md mx-auto text-center">
                <div className="glass-panel rounded-xl p-8">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
                  <h2 className="font-display text-2xl text-foreground mb-2">Enquiry Received!</h2>
                  <p className="text-sm font-body text-muted-foreground mb-6">
                    Thanks <strong className="text-foreground">{enquiryName}</strong>, we'll be in touch at{" "}
                    <strong className="text-foreground">{enquiryEmail}</strong>.
                  </p>
                  {(enquiryDate || enquiryStartTime || enquiryEndTime) && (
                    <div className="border border-border/50 rounded-xl p-4 mb-6 text-left space-y-2">
                      {enquiryDate && (
                        <div className="flex justify-between text-sm font-body">
                          <span className="text-muted-foreground">Preferred date</span>
                          <span className="text-foreground">
                            {new Date(enquiryDate + "T12:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
                          </span>
                        </div>
                      )}
                      {(enquiryStartTime || enquiryEndTime) && (
                        <div className="flex justify-between text-sm font-body">
                          <span className="text-muted-foreground">Preferred time</span>
                          <span className="text-foreground">{[enquiryStartTime, enquiryEndTime].filter(Boolean).join(" – ")}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    onClick={() => {
                      setStep("event-select");
                      setEnquiryName(""); setEnquiryEmail(""); setEnquiryPhone("");
                      setEnquiryDate(""); setEnquiryStartTime(""); setEnquiryEndTime("");
                      setEnquiryMessage(""); setEnquiryEventId("");
                    }}
                    variant="outline"
                    className="w-full font-body text-xs tracking-wider uppercase border-border text-foreground"
                  >
                    Back to Home
                  </Button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </section>
      <Footer />
    </div>
  );
}
