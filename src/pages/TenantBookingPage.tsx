import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  ArrowLeft, ArrowRight, Camera, Clock, DollarSign, CheckCircle2,
  ChevronLeft, ChevronRight, Globe, MapPin, Calendar as CalendarIcon,
  MessageSquare, CreditCard, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  createTenantBooking,
  createTenantBookingCheckout,
  createTenantEnquiry,
  getTenantPublicData,
  getTenantStripeStatus,
  type PublicTenant,
} from "@/lib/api";
import type { Booking, EventType, QuestionField } from "@/lib/types";
import { RichTextDisplay } from "@/components/RichTextEditor";
import BookingAvatar from "@/components/BookingAvatar";
import {
  buildBookingCalendarUrl,
  contactQuestionRole,
  filterFutureBookingSlots,
  getPublicCustomQuestions,
  isPastBookingDate,
  missingRequiredQuestions,
  readAvailableSlots,
} from "@/lib/booking-utils";
import { fetchPublicAvailability } from "@/lib/booking-public-api";

/** Strip HTML tags to plain text for short teasers */
function stripHtml(html: string): string {
  try {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  } catch {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}
function formatDuration(mins: number) {
  if (mins >= 60) { const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${mins}m`;
}
function formatTime12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function getAvailabilityForDate(et: EventType, date: Date) {
  const dateStr = toDateStr(date);
  const avail = et.availability;
  if (!avail) return [];
  if ((avail.blockedDates || []).includes(dateStr)) return [];
  const specific = (avail.specificDates || []).filter(s => s.date === dateStr);
  if (specific.length > 0) return specific.map(s => ({ startTime: s.startTime, endTime: s.endTime }));
  const dayOfWeek = date.getDay();
  return (avail.recurring || []).filter(s => s.day === dayOfWeek).map(s => ({ startTime: s.startTime, endTime: s.endTime }));
}
function isDayAvailable(et: EventType, date: Date) {
  return getAvailabilityForDate(et, date).length > 0;
}
function getPriceForDuration(et: EventType, duration: number): number {
  if (et.prices?.[String(duration)] !== undefined) return et.prices[String(duration)];
  return et.price ?? 0;
}
function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
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

function TenantQuestionInput({ field, value, onChange, inputId, labelId }: { field: QuestionField; value: string; onChange: (value: string) => void; inputId: string; labelId: string }) {
  if (field.type === "textarea") {
    return <Textarea id={inputId} value={value} onChange={event => onChange(event.target.value)} placeholder={field.placeholder} className="bg-secondary border-border text-foreground font-body min-h-[80px]" />;
  }
  if (field.type === "select") {
    return (
      <select id={inputId} value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-md border border-border bg-secondary px-3 py-2.5 text-sm font-body text-foreground">
        <option value="">Select an option…</option>
        {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.type === "boolean") {
    return (
      <div className="flex gap-2" role="group" aria-labelledby={labelId}>
        {["Yes", "No"].map(option => <Button key={option} type="button" aria-pressed={value === option} variant={value === option ? "default" : "outline"} onClick={() => onChange(option)} className="flex-1">{option}</Button>)}
      </div>
    );
  }
  if (field.type === "instagram") {
    return <Input id={inputId} value={value.replace(/^@/, "")} onChange={event => onChange(event.target.value.replace(/^@/, ""))} placeholder={field.placeholder || "yourusername"} className="bg-secondary border-border text-foreground font-body" />;
  }
  return <Input id={inputId} value={value} onChange={event => onChange(event.target.value)} placeholder={field.placeholder} className="bg-secondary border-border text-foreground font-body" />;
}

export function TenantBookingQuestionField({ field, value, onChange }: { field: QuestionField; value: string; onChange: (value: string) => void }) {
  const inputId = `tenant-booking-question-${field.id}`;
  const labelId = `${inputId}-label`;
  return (
    <div>
      <label id={labelId} htmlFor={field.type === "boolean" ? undefined : inputId} className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">
        {field.label} {field.required && <span className="text-destructive">*</span>}
      </label>
      <TenantQuestionInput field={field} value={value} onChange={onChange} inputId={inputId} labelId={labelId} />
    </div>
  );
}

type Step = "event-select" | "datetime" | "contact" | "confirmed" | "enquiry" | "enquiry-confirmed";
type TenantPaymentPath = "stripe" | "bank" | "contact" | "none";

const TENANT_BOOKING_STEPS: { id: Step; label: string }[] = [
  { id: "event-select", label: "Service" },
  { id: "datetime",     label: "Date & Time" },
  { id: "contact",      label: "Details" },
];

function TenantBookingSteps({ currentStep }: { currentStep: Step }) {
  if (currentStep === "confirmed" || currentStep === "enquiry" || currentStep === "enquiry-confirmed") return null;
  const currentIdx = TENANT_BOOKING_STEPS.findIndex(s => s.id === currentStep);
  if (currentIdx < 0) return null;
  return (
    <div className="flex items-center justify-center gap-0 px-6 py-3 border-b border-border/50">
      {TENANT_BOOKING_STEPS.map((s, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={s.id} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-body transition-all ${
              active ? "text-primary font-semibold" : done ? "text-green-400" : "text-muted-foreground/50"
            }`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all ${
                active ? "bg-primary text-primary-foreground scale-110" : done ? "bg-green-500/20 text-green-400" : "bg-border text-muted-foreground/50"
              }`}>
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
              </div>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {idx < TENANT_BOOKING_STEPS.length - 1 && (
              <div className={`h-px w-4 sm:w-6 shrink-0 transition-colors ${idx < currentIdx ? "bg-green-500/40" : "bg-border/50"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TenantBookingPage({ overrideSlug }: { overrideSlug?: string }) {
  const { tenantSlug: paramSlug } = useParams<{ tenantSlug: string }>();
  const tenantSlug = overrideSlug || paramSlug;
  const navigate = useNavigate();
  const hasHistory = (window.history.state?.idx ?? 0) > 0;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [bookingLimitReached, setBookingLimitReached] = useState(false);
  const [enquiryEnabled, setEnquiryEnabled] = useState(false);
  const [enquiryLabel, setEnquiryLabel] = useState("Make an Enquiry");
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [cosplayFieldsEnabled, setCosplayFieldsEnabled] = useState(false);
  const [conventionFieldEnabled, setConventionFieldEnabled] = useState(false);
  const [bankTransfer, setBankTransfer] = useState<{
    enabled: boolean; accountName: string | null; bsb: string | null;
    accountNumber: string | null; payId: string | null; payIdType: string | null; instructions: string | null;
  } | null>(null);

  const [step, setStep] = useState<Step>("event-select");
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[] | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [availabilityTimezone, setAvailabilityTimezone] = useState("Australia/Sydney");
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth());
  });

  // Contact form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [cosplayCharacter, setCosplayCharacter] = useState("");
  const [cosplayCostume, setCosplayCostume] = useState("");
  const [conventionName, setConventionName] = useState("");
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [slotConflict, setSlotConflict] = useState(false);
  const [submittedBooking, setSubmittedBooking] = useState<Booking | null>(null);
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [paymentPath, setPaymentPath] = useState<TenantPaymentPath | null>(null);
  const [processingCheckout, setProcessingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Enquiry form
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
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

  useEffect(() => {
    if (!tenantSlug) { setNotFound(true); setLoading(false); return; }
    Promise.all([getTenantPublicData(tenantSlug), getTenantStripeStatus(tenantSlug)]).then(([data, stripeStatus]) => {
      setStripeAvailable(stripeStatus.configured);
      if (!data) { setNotFound(true); } else {
        setTenant(data.tenant);
        if (data.tenant.timezone) setAvailabilityTimezone(data.tenant.timezone);
        setEventTypes(data.eventTypes);
        setBookingLimitReached(!!data.bookingLimitReached);
        setEnquiryEnabled(!!data.enquiryEnabled);
        setEnquiryLabel(data.enquiryLabel || "Make an Enquiry");
        if (data.brandColor) setBrandColor(data.brandColor);
        setCosplayFieldsEnabled(!!data.cosplayFieldsEnabled);
        setConventionFieldEnabled(!!data.conventionFieldEnabled);
        if (data.bankTransfer) setBankTransfer(data.bankTransfer);
      }
      setLoading(false);
    }).catch(() => {
      setNotFound(true);
      setLoading(false);
    });
  }, [tenantSlug]);

  const tenantName = tenant?.displayName || "";
  const stepTitles: Record<Step, string> = {
    "event-select": tenantName ? `Book with ${tenantName}` : "Book a Session",
    "datetime": selectedEvent ? `${selectedEvent.title} — ${tenantName || "Booking"}` : `Choose a Date — ${tenantName || "Booking"}`,
    "contact": `Your Details — ${tenantName || "Booking"}`,
    "confirmed": `Booking Received — ${tenantName || "Booking"}`,
    "enquiry": `Send Enquiry — ${tenantName || "Booking"}`,
    "enquiry-confirmed": `Enquiry Sent — ${tenantName || "Booking"}`,
  };
  usePageTitle(stepTitles[step]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const blanks = Array.from({ length: (firstDay + 6) % 7 }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const timeSlots = useMemo(() => {
    if (!selectedEvent || !selectedDate || !selectedDuration || availableSlots === null) return [];
    return filterFutureBookingSlots(availableSlots, toDateStr(selectedDate), availabilityTimezone);
  }, [selectedEvent, selectedDate, selectedDuration, availableSlots, availabilityTimezone]);

  const selectedQuestions = selectedEvent?.questions ?? [];
  const customQuestions = useMemo(
    () => getPublicCustomQuestions(selectedEvent?.questions),
    [selectedEvent],
  );
  const hasRequiredUnsupportedUpload = selectedQuestions.some(question => question.type === "image-upload" && question.required);
  const phoneRequired = selectedQuestions.some(question => contactQuestionRole(question) === "phone" && question.required);
  const selectedPrice = selectedEvent && selectedDuration ? getPriceForDuration(selectedEvent, selectedDuration) : 0;
  const availablePaymentPaths = useMemo<TenantPaymentPath[]>(() => {
    if (selectedPrice <= 0) return ["none"];
    const configuredDepositMethods = selectedEvent?.depositEnabled && Number(selectedEvent.depositAmount) > 0
      ? selectedEvent.depositMethods || []
      : [];
    const methodAllowed = (method: "stripe" | "bank") => configuredDepositMethods.length === 0 || configuredDepositMethods.includes(method);
    const paths: TenantPaymentPath[] = [];
    if (stripeAvailable && methodAllowed("stripe")) paths.push("stripe");
    if (bankTransfer?.enabled && methodAllowed("bank")) paths.push("bank");
    paths.push("contact");
    return paths;
  }, [bankTransfer?.enabled, selectedEvent, selectedPrice, stripeAvailable]);

  useEffect(() => {
    if (!paymentPath || !availablePaymentPaths.includes(paymentPath)) {
      setPaymentPath(availablePaymentPaths[0]);
    }
  }, [availablePaymentPaths, paymentPath]);

  useEffect(() => {
    if (!tenantSlug || !selectedEvent || !selectedDate) {
      setAvailableSlots(null);
      setAvailabilityError(null);
      return;
    }
    const controller = new AbortController();
    const date = toDateStr(selectedDate);
    setAvailableSlots(null);
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    fetchPublicAvailability({ tenantSlug, eventTypeId: selectedEvent.id, date, duration: selectedDuration || undefined, signal: controller.signal }).then(payload => {
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
  }, [tenantSlug, selectedEvent, selectedDate, selectedDuration, availabilityRetry]);

  const hasAvailabilityThisMonth = useMemo(() => {
    if (!selectedEvent) return false;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      if (!isPastBookingDate(toDateStr(date), availabilityTimezone) && isDayAvailable(selectedEvent, date)) return true;
    }
    return false;
  }, [selectedEvent, year, month, daysInMonth, availabilityTimezone]);

  const handleNextAvailableMonth = () => {
    if (!selectedEvent) return;
    let searchYear = year;
    let searchMonth = month + 1;
    for (let i = 0; i < 24; i++) {
      if (searchMonth > 11) { searchMonth = 0; searchYear++; }
      const daysInSearch = new Date(searchYear, searchMonth + 1, 0).getDate();
      for (let d = 1; d <= daysInSearch; d++) {
        const date = new Date(searchYear, searchMonth, d);
        if (!isPastBookingDate(toDateStr(date), availabilityTimezone) && isDayAvailable(selectedEvent, date)) {
          setCurrentMonth(new Date(searchYear, searchMonth));
          return;
        }
      }
      searchMonth++;
    }
  };

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const openTenantCheckout = async (targetBooking: Booking) => {
    if (!tenantSlug || processingCheckout) return;
    const alreadyPaid = targetBooking.paymentStatus === "paid" || targetBooking.paymentStatus === "cash" || !!targetBooking.paidAt;
    if (alreadyPaid) {
      toast.info("This booking is already paid in full.");
      return;
    }
    if (!targetBooking.modifyToken) {
      const message = "This booking cannot be verified for payment. Please reopen your booking link.";
      setCheckoutError(message);
      toast.error(message);
      return;
    }

    setCheckoutError(null);
    setProcessingCheckout(true);
    const modifyPath = `/booking/modify/${encodeURIComponent(targetBooking.modifyToken)}`;
    const result = await createTenantBookingCheckout(tenantSlug, {
      bookingId: targetBooking.id,
      modifyToken: targetBooking.modifyToken,
      successUrl: `${window.location.origin}${modifyPath}?checkout=success`,
      cancelUrl: `${window.location.origin}${modifyPath}?checkout=cancelled`,
    });
    setProcessingCheckout(false);
    if (result.url) {
      window.location.href = result.url;
      return;
    }
    const message = result.error || "Secure card checkout could not be opened.";
    setCheckoutError(message);
    toast.error(message);
  };

  const handleSelectEvent = (et: EventType) => {
    setSelectedEvent(et);
    setSelectedDuration(et.durations[0] ?? 60);
    setSelectedDate(null);
    setSelectedTime(null);
    setCustomAnswers({});
    setSubmittedBooking(null);
    setPaymentPath(null);
    setCheckoutError(null);
    setStep("datetime");
    scrollTop();
  };

  const handleSelectTime = (t: string) => {
    setSelectedTime(t);
  };

  const handleOpenEnquiry = (prefillEventId?: string) => {
    setEnquiryEventId(prefillEventId || selectedEvent?.id || "");
    setEnquiryDate("");
    setEnquiryStartTime("");
    setEnquiryEndTime("");
    setEnquiryName("");
    setEnquiryEmail("");
    setEnquiryPhone("");
    setEnquiryMessage("");
    setStep("enquiry");
    scrollTop();
  };

  const handleSubmitEnquiry = async () => {
    if (!enquiryName.trim()) { toast.error("Please enter your name"); return; }
    if (!isValidEmail(enquiryEmail)) { toast.error("Please enter a valid email address"); return; }
    if (!enquiryMessage.trim()) { toast.error("Please describe what you're looking for"); return; }
    setEnquirySubmitting(true);
    const matchedEvent = eventTypes.find(e => e.id === enquiryEventId);
    const result = await createTenantEnquiry(tenantSlug!, {
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
    setEnquirySubmitting(false);
    if (!result.ok) { toast.error(result.error || "Failed to send enquiry"); return; }
    setStep("enquiry-confirmed");
    scrollTop();
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Please enter your name"); return; }
    if (!isValidEmail(email)) { toast.error("Please enter a valid email"); return; }
    if (phoneRequired && !phone.trim()) { toast.error("Please enter your phone number"); return; }
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration) {
      toast.error("Please complete the date/time selection"); return;
    }
    const missing = missingRequiredQuestions(customQuestions, customAnswers);
    if (missing.length > 0) {
      toast.error(`Please fill in: ${missing.map(question => question.label).join(", ")}`);
      return;
    }
    if (hasRequiredUnsupportedUpload) {
      toast.error("This booking form requires an upload that is not available online. Please contact the photographer.");
      return;
    }
    if (availabilityLoading || availableSlots === null || !timeSlots.includes(selectedTime)) {
      toast.error("That time is no longer available. Please choose another.");
      setSelectedTime(null);
      setStep("datetime");
      setAvailabilityRetry(retry => retry + 1);
      scrollTop();
      return;
    }
    const answers = { ...customAnswers };
    selectedQuestions.forEach(question => {
      const role = contactQuestionRole(question);
      if (role === "name") answers[question.id] = name.trim();
      if (role === "email") answers[question.id] = email.trim();
      if (role === "phone") answers[question.id] = phone.trim();
    });
    setSubmitting(true);
    setSlotConflict(false);
    setCheckoutError(null);
    const selectedPaymentPath: TenantPaymentPath = selectedPrice <= 0
      ? "none"
      : paymentPath && availablePaymentPaths.includes(paymentPath)
      ? paymentPath
      : availablePaymentPaths[0] || "contact";
    const result = await createTenantBooking(tenantSlug!, {
      clientName: name.trim(),
      clientEmail: email.trim(),
      date: toDateStr(selectedDate),
      time: selectedTime,
      eventTypeId: selectedEvent.id,
      type: selectedEvent.title,
      duration: selectedDuration,
      notes: notes.trim(),
      phone: phone.trim() || undefined,
      answers,
      cosplayCharacter: cosplayCharacter.trim() || undefined,
      cosplayCostume: cosplayCostume.trim() || undefined,
      conventionName: conventionName.trim() || undefined,
      paymentMethod: selectedPaymentPath,
    });
    setSubmitting(false);
    if (!result.ok) {
      // 409 = slot taken — send user back to pick another time
      if (result.statusCode === 409) {
        setSlotConflict(true);
        setSelectedTime(null);
        setAvailabilityRetry(retry => retry + 1);
        setStep("datetime");
        scrollTop();
        toast.error("That time slot was just taken — please pick another.");
        return;
      }
      toast.error(result.error || "Booking failed");
      return;
    }
    if (result.booking) setSubmittedBooking(result.booking);
    setPaymentPath(selectedPaymentPath);
    setStep("confirmed");
    scrollTop();
    if (selectedPaymentPath === "stripe" && result.booking) {
      await openTenantCheckout(result.booking);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground font-body text-sm">Loading…</div>
      </div>
    );
  }

  if (notFound || !tenant) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <Camera className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <h1 className="font-display text-2xl text-foreground">Page not found</h1>
          <p className="text-sm font-body text-muted-foreground">This booking page doesn't exist or has been deactivated.</p>
          {!overrideSlug && (
            <Button variant="outline" onClick={() => navigate("/")} className="font-body text-xs gap-2">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to main
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Convert hex brand color to hsl-ish CSS vars for shadcn primary token override
  const brandStyle: React.CSSProperties = brandColor ? {
    paddingTop: "env(safe-area-inset-top)",
    paddingBottom: "env(safe-area-inset-bottom)",
    // Override the --primary CSS variable so all primary-colored UI elements pick up the brand color
    ["--primary" as string]: brandColor,
    ["--primary-foreground" as string]: "#ffffff",
  } : {
    paddingTop: "env(safe-area-inset-top)",
    paddingBottom: "env(safe-area-inset-bottom)",
  };

  const confirmedPrice = submittedBooking?.paymentAmount ?? selectedPrice;
  const confirmedPaymentPaid = submittedBooking?.paymentStatus === "paid" || submittedBooking?.paymentStatus === "cash" || !!submittedBooking?.paidAt;
  const confirmedDepositPaid = submittedBooking?.paymentStatus === "deposit-paid" || !!submittedBooking?.depositPaidAt;
  const confirmedAmountDue = confirmedDepositPaid
    ? Math.max(0, confirmedPrice - (submittedBooking?.depositAmount || 0))
    : submittedBooking?.depositRequired && (submittedBooking.depositAmount || 0) > 0
    ? submittedBooking.depositAmount || 0
    : confirmedPrice;
  const confirmedNeedsPayment = confirmedPrice > 0 && !confirmedPaymentPaid;
  const confirmationIsFinal = submittedBooking?.status === "confirmed" && !confirmedNeedsPayment;

  return (    <div className="min-h-screen bg-background flex flex-col" style={brandStyle}>
      {/* Header */}
      <header className="border-b border-border/50 py-4 px-6 flex items-center gap-4">
        {hasHistory && (
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="font-body text-xs text-muted-foreground gap-1.5 p-0 h-auto hover:text-foreground">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Button>
        )}
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-3">
          <BookingAvatar name={tenant.displayName} className="h-9 w-9 rounded-full" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm leading-tight text-foreground" title={tenant.displayName}>{tenant.displayName}</p>
            {tenant.bio && <p className="text-xs font-body text-muted-foreground leading-tight truncate max-w-xs">{stripHtml(tenant.bio)}</p>}
          </div>
        </div>
      </header>
      <TenantBookingSteps currentStep={step} />

      <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8">

          {/* ── Step 1: Event Selection ── */}
          {step === "event-select" && (
            <div key="event-select" className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-200">
              <div>
                <h1 className="font-display text-2xl text-foreground mb-1">Book a session</h1>
                <p className="text-sm font-body text-muted-foreground">Choose a session type to get started.</p>
              </div>
              {/* Photographer bio — shown if set */}
              {tenant.bio && (
                <div className="glass-panel rounded-xl p-5">
                  <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2">About {tenant.displayName}</p>
                  <RichTextDisplay html={tenant.bio} />
                </div>
              )}
              {bookingLimitReached ? (
                <div className="glass-panel rounded-xl p-10 text-center space-y-3">
                  <CalendarIcon className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                  <p className="text-sm font-body text-muted-foreground">Online bookings are not available at this time.</p>
                  <p className="text-xs font-body text-muted-foreground/60">Please contact {tenant.displayName} directly to arrange a session.</p>
                  {enquiryEnabled && (
                    <Button variant="outline" onClick={() => handleOpenEnquiry()} className="font-body text-xs gap-2 mt-2">
                      <MessageSquare className="w-3.5 h-3.5" /> {enquiryLabel}
                    </Button>
                  )}
                </div>
              ) : eventTypes.length === 0 ? (
                <div className="glass-panel rounded-xl p-10 text-center space-y-3">
                  <CalendarIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-sm font-body text-muted-foreground">No sessions available right now.</p>
                  {enquiryEnabled && (
                    <Button variant="outline" onClick={() => handleOpenEnquiry()} className="font-body text-xs gap-2">
                      <MessageSquare className="w-3.5 h-3.5" /> {enquiryLabel}
                    </Button>
                  )}
                  {!enquiryEnabled && (
                    <p className="text-xs font-body text-muted-foreground/60">Please contact {tenant.displayName} directly for future availability.</p>
                  )}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {eventTypes.map((et) => {
                    const minPrice = et.durations.length > 0
                      ? Math.min(...et.durations.map(d => getPriceForDuration(et, d)))
                      : (et.price ?? 0);
                    const isExpanded = !!expandedDescriptions[et.id];
                    return (
                      <article
                        key={et.id}
                        className="booking-service-card glass-panel rounded-2xl p-5 sm:p-6 text-left hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-lg transition-all group"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/20" aria-hidden="true">
                            <Camera className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <h3 className="font-display text-xl leading-tight text-foreground group-hover:text-primary transition-colors">{et.title}</h3>
                              {(et.price ?? 0) > 0 && (
                                <span className="shrink-0 self-start rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-body font-semibold text-primary">from ${minPrice}</span>
                              )}
                            </div>
                        {et.description && (
                          <div className="mt-2">
                            <div className={isExpanded ? "" : "line-clamp-4"}>
                              <RichTextDisplay html={et.description} className="text-sm font-body text-muted-foreground" />
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setExpandedDescriptions(prev => ({ ...prev, [et.id]: !prev[et.id] })); }}
                              className="text-xs font-body text-primary/70 hover:text-primary mt-1"
                            >
                              {isExpanded ? "Show less" : "Read more"}
                            </button>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          <span className="flex items-center gap-1 text-xs font-body text-muted-foreground border border-border/50 rounded-full px-2 py-0.5">
                            <Clock className="w-3 h-3" />
                            {et.durations.map(formatDuration).join(" / ")}
                          </span>
                          {et.location && (
                            <span className="flex items-center gap-1 text-xs font-body text-muted-foreground border border-border/50 rounded-full px-2 py-0.5">
                              <MapPin className="w-3 h-3" /> {et.location}
                            </span>
                          )}
                          {et.requiresConfirmation && (
                            <span className="text-[10px] font-body bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-0.5 rounded-full">Requires confirmation</span>
                          )}
                        </div>
                        <div className="flex justify-end mt-4">
                          <button type="button" onClick={() => handleSelectEvent(et)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-body font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
                            Book <ArrowRight className="h-3 w-3" />
                          </button>
                        </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {/* Enquiry button — shown when enquiry mode is on and there are event types */}
              {enquiryEnabled && !bookingLimitReached && eventTypes.length > 0 && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={() => handleOpenEnquiry()}
                    className="flex items-center gap-1.5 text-xs font-body text-muted-foreground hover:text-primary transition-colors border border-border/50 hover:border-primary/40 rounded-full px-4 py-2"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> {enquiryLabel}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Date & Time ── */}
          {step === "datetime" && selectedEvent && (
            <div key="datetime" className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-200">
              <button onClick={() => { setStep("event-select"); scrollTop(); }} className="flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              {/* Slot conflict notice */}
              {slotConflict && (
                <div className="flex items-start gap-3 rounded-xl p-4 bg-amber-500/10 border border-amber-500/20">
                  <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-body text-amber-300 font-medium">That slot was just taken</p>
                    <p className="text-xs font-body text-amber-300/70 mt-0.5">Someone else booked that time just before you. Please choose a different time slot below.</p>
                  </div>
                </div>
              )}

              <div className="glass-panel rounded-2xl overflow-hidden">
                <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_220px] xl:grid-cols-[280px_minmax(0,1fr)_220px]">
                  {/* Event info */}
                  <div className="min-w-0 p-5 sm:p-6 space-y-5 border-b border-border/50 lg:col-span-2 xl:col-span-1 xl:border-b-0 xl:border-r">
                    <div className="flex items-center gap-3">
                      <BookingAvatar name={tenant.displayName} className="h-11 w-11 rounded-full" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-body uppercase tracking-[0.16em] text-muted-foreground/70">Session with</p>
                        <p className="truncate text-sm font-body font-medium text-foreground">{tenant.displayName}</p>
                      </div>
                    </div>
                    <h2 className="font-display text-2xl leading-tight text-foreground">{selectedEvent.title}</h2>
                    {selectedEvent.description && (
                      <div className="min-w-0 rounded-xl border border-border/50 bg-secondary/25 p-4">
                        <RichTextDisplay html={selectedEvent.description} className="text-sm" />
                      </div>
                    )}
                    {/* Duration picker */}
                    {selectedEvent.durations.length > 1 && (
                      <div className="flex items-start gap-2">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-2.5" />
                        <div className="flex min-w-0 flex-wrap gap-2">
                          {selectedEvent.durations.map(d => {
                            const p = getPriceForDuration(selectedEvent, d);
                            return (
                              <button
                                key={d}
                                type="button"
                                aria-pressed={selectedDuration === d}
                                onClick={() => { setSelectedDuration(d); setSelectedTime(null); }}
                                className={`min-w-16 rounded-lg border px-3 py-2 text-xs font-body flex flex-col items-center transition-all ${selectedDuration === d ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-secondary"}`}
                              >
                                <span>{formatDuration(d)}</span>
                                {p > 0 && <span className={`text-[10px] mt-0.5 ${selectedDuration === d ? "text-primary-foreground/70" : "text-primary"}`}>${p}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {selectedEvent.durations.length === 1 && (
                      <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" /> {formatDuration(selectedEvent.durations[0])}
                        {(getPriceForDuration(selectedEvent, selectedEvent.durations[0]) > 0) && (
                          <span className="text-primary ml-1">${getPriceForDuration(selectedEvent, selectedEvent.durations[0])}</span>
                        )}
                      </div>
                    )}
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
                    {tenant.timezone && (
                      <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                        <Globe className="w-3.5 h-3.5" /> {formatTimezone(tenant.timezone)}
                      </div>
                    )}
                  </div>

                  {/* Calendar */}
                  <div className="min-w-0 p-5 sm:p-6 lg:border-r lg:border-border/50">
                    <div className="flex items-center justify-between gap-4 mb-5">
                      <div>
                        <p className="text-[10px] font-body uppercase tracking-[0.16em] text-muted-foreground/70 mb-1">Choose a date</p>
                        <h3 className="font-display text-lg text-foreground">
                          <span className="text-primary">{currentMonth.toLocaleDateString("en-US", { month: "long" })}</span> {year}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" aria-label="Previous month" onClick={() => setCurrentMonth(new Date(year, month - 1))} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-secondary transition-colors">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button type="button" aria-label="Next month" onClick={() => setCurrentMonth(new Date(year, month + 1))} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-secondary transition-colors">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d => (
                        <div key={d} className="text-center text-[10px] font-body tracking-wider uppercase text-muted-foreground py-1">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {blanks.map(b => <div key={`b${b}`} />)}
                      {days.map(day => {
                        const date = new Date(year, month, day);
                        const isSelected = selectedDate?.getDate() === day && selectedDate?.getMonth() === month && selectedDate?.getFullYear() === year;
                        const isPast = isPastBookingDate(toDateStr(date), availabilityTimezone);
                        const isAvailable = !isPast && isDayAvailable(selectedEvent, date);
                        const isToday = toDateStr(date) === toDateStr(new Date());
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-label={`${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${isAvailable ? ", available" : ", unavailable"}`}
                            aria-pressed={isSelected}
                            disabled={!isAvailable}
                            onClick={() => { setSelectedDate(date); setSelectedTime(null); }}
                            className={`aspect-square rounded-lg text-sm font-body transition-all relative ${
                              isSelected ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background"
                                : isAvailable ? "text-foreground font-medium hover:bg-amber-500/10 hover:text-amber-500"
                                : isPast ? "text-muted-foreground/30 cursor-not-allowed line-through decoration-muted-foreground/20"
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
                      <span className="flex items-center gap-1.5">
                        <span className="line-through text-muted-foreground/30 leading-none">7</span> Past
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

                  {/* Time slots */}
                  <div className="min-w-0 p-5 sm:p-6">
                    {!selectedDate ? (
                      <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-secondary/15 px-4 py-8 text-center text-muted-foreground/60">
                        <CalendarIcon className="h-8 w-8 mb-3" />
                        <p className="text-sm font-body text-muted-foreground">Select a date</p>
                        <p className="mt-1 text-xs font-body text-muted-foreground/60">Available appointment times will appear here.</p>
                      </div>
                    ) : (
                      <div>
                        <div className="mb-3">
                          <p className="text-[10px] font-body uppercase tracking-[0.16em] text-muted-foreground/70">Available times</p>
                          <p className="text-sm font-body font-medium text-foreground">{selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</p>
                        </div>
                        {availabilityLoading ? (
                          <p className="text-xs font-body text-muted-foreground" role="status">Checking availability…</p>
                        ) : availabilityError ? (
                          <div className="space-y-3" role="alert">
                            <p className="text-xs font-body text-destructive">Live availability couldn't be loaded.</p>
                            <Button type="button" variant="outline" size="sm" onClick={() => setAvailabilityRetry(retry => retry + 1)}>Try again</Button>
                          </div>
                        ) : timeSlots.length === 0 ? (
                          <p className="text-xs font-body text-muted-foreground">No times available</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:max-h-[420px] lg:grid-cols-1 lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
                            {timeSlots.map(t => (
                              <button
                                key={t}
                                type="button"
                                aria-pressed={selectedTime === t}
                                onClick={() => handleSelectTime(t)}
                                className={`w-full py-2.5 px-3 rounded-lg text-xs font-body text-center transition-all ${
                                  selectedTime === t
                                    ? "bg-primary text-primary-foreground"
                                    : "border border-border hover:border-primary hover:bg-primary/5 text-foreground"
                                }`}
                              >
                                {formatTime12(t)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {selectedTime && (
                <div className="flex justify-end">
                  <Button onClick={() => { setStep("contact"); scrollTop(); }} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                    Continue
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Contact Info ── */}
          {step === "contact" && selectedEvent && selectedDate && selectedTime && (
            <div key="contact" className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-200">
              <button onClick={() => { setStep("datetime"); scrollTop(); }} className="flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              {/* Booking summary */}
              <div className="glass-panel rounded-xl p-4 flex flex-wrap gap-4">
                <div>
                  <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Session</p>
                  <p className="text-sm font-body text-foreground">{selectedEvent.title}</p>
                </div>
                <div>
                  <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Date</p>
                  <p className="text-sm font-body text-foreground">{selectedDate.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <div>
                  <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Time</p>
                  <p className="text-sm font-body text-foreground">{formatTime12(selectedTime)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Duration</p>
                  <p className="text-sm font-body text-foreground">{selectedDuration ? formatDuration(selectedDuration) : "—"}</p>
                </div>
                {!!selectedEvent.bufferMinutes && selectedEvent.bufferMinutes > 0 && (
                  <div>
                    <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Turnaround buffer</p>
                    <p className="text-sm font-body text-foreground">{formatDuration(selectedEvent.bufferMinutes)}</p>
                  </div>
                )}
                {selectedDuration && getPriceForDuration(selectedEvent, selectedDuration) > 0 && (
                  <div>
                    <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Price</p>
                    <p className="text-sm font-body text-primary">${getPriceForDuration(selectedEvent, selectedDuration)} AUD</p>
                  </div>
                )}
              </div>

              <div className="glass-panel rounded-xl p-6 space-y-4 max-w-lg">
                <h2 className="font-display text-lg text-foreground">Your Details</h2>
                <div>
                  <label htmlFor="tenant-booking-name" className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Full Name *</label>
                  <Input id="tenant-booking-name" name="name" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div>
                  <label htmlFor="tenant-booking-email" className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Email *</label>
                  <Input id="tenant-booking-email" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div>
                  <label htmlFor="tenant-booking-phone" className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Phone {phoneRequired && <span className="text-destructive">*</span>}</label>
                  <Input id="tenant-booking-phone" name="tel" type="tel" autoComplete="tel" required={phoneRequired} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+61 400 000 000" className="bg-secondary border-border text-foreground font-body" />
                </div>
                {customQuestions.map(question => (
                  <TenantBookingQuestionField key={question.id} field={question} value={customAnswers[question.id] || ""} onChange={value => setCustomAnswers(previous => ({ ...previous, [question.id]: value }))} />
                ))}
                {selectedQuestions.some(question => question.type === "image-upload") && (
                  <p role={hasRequiredUnsupportedUpload ? "alert" : undefined} className={`rounded-lg border p-3 text-xs font-body ${hasRequiredUnsupportedUpload ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border text-muted-foreground"}`}>
                    {hasRequiredUnsupportedUpload
                      ? "This booking form is configured with a required image upload, but secure uploads are not available here. Please contact the photographer to book."
                      : "Reference image uploads aren't accepted in this form. The photographer can arrange a secure upload after you submit."}
                  </p>
                )}
                {/* Convention name field */}
                {conventionFieldEnabled && (
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Convention / Event Name</label>
                    <Input value={conventionName} onChange={e => setConventionName(e.target.value)} placeholder="e.g. Supanova Sydney 2025" className="bg-secondary border-border text-foreground font-body" />
                  </div>
                )}
                {/* Cosplay-specific fields */}
                {cosplayFieldsEnabled && (
                  <>
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Character Name</label>
                      <Input value={cosplayCharacter} onChange={e => setCosplayCharacter(e.target.value)} placeholder="e.g. Nezuko Kamado" className="bg-secondary border-border text-foreground font-body" />
                    </div>
                    <div>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Costume / Series</label>
                      <Input value={cosplayCostume} onChange={e => setCosplayCostume(e.target.value)} placeholder="e.g. Demon Slayer — Season 2 outfit" className="bg-secondary border-border text-foreground font-body" />
                    </div>
                  </>
                )}
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Notes</label>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special requests or questions…" className="bg-secondary border-border text-foreground font-body min-h-[80px]" />
                </div>
                {selectedPrice > 0 && (
                  <fieldset className="space-y-2">
                    <legend className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2">Payment method</legend>
                    <div className="grid gap-2" role="radiogroup" aria-label="Payment method">
                      {availablePaymentPaths.includes("stripe") && (
                        <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${paymentPath === "stripe" ? "border-primary bg-primary/10" : "border-border bg-secondary/30 hover:bg-secondary/60"}`}>
                          <input className="sr-only" type="radio" name="tenant-payment-path" value="stripe" checked={paymentPath === "stripe"} onChange={() => setPaymentPath("stripe")} />
                          <CreditCard className="h-4 w-4 text-primary" />
                          <span className="text-sm font-body text-foreground">Secure card payment</span>
                        </label>
                      )}
                      {availablePaymentPaths.includes("bank") && (
                        <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${paymentPath === "bank" ? "border-primary bg-primary/10" : "border-border bg-secondary/30 hover:bg-secondary/60"}`}>
                          <input className="sr-only" type="radio" name="tenant-payment-path" value="bank" checked={paymentPath === "bank"} onChange={() => setPaymentPath("bank")} />
                          <Building2 className="h-4 w-4 text-primary" />
                          <span className="text-sm font-body text-foreground">Bank transfer / PayID</span>
                        </label>
                      )}
                      <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${paymentPath === "contact" ? "border-primary bg-primary/10" : "border-border bg-secondary/30 hover:bg-secondary/60"}`}>
                        <input className="sr-only" type="radio" name="tenant-payment-path" value="contact" checked={paymentPath === "contact"} onChange={() => setPaymentPath("contact")} />
                        <MessageSquare className="h-4 w-4 text-primary" />
                        <span className="text-sm font-body text-foreground">Arrange payment with photographer</span>
                      </label>
                    </div>
                    <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs font-body text-muted-foreground">
                      {paymentPath === "stripe"
                        ? "Your booking will be saved before you continue to Stripe. The amount due is calculated securely from the saved booking."
                        : paymentPath === "bank"
                        ? "Your booking will remain pending while the photographer confirms your transfer. Bank details appear after submission."
                        : `${tenant.displayName} will contact you with payment instructions. Your booking remains pending until payment is confirmed.`}
                    </p>
                  </fieldset>
                )}
                <Button onClick={handleSubmit} disabled={submitting || hasRequiredUnsupportedUpload} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                  {hasRequiredUnsupportedUpload
                    ? "Contact Photographer to Book"
                    : submitting
                    ? paymentPath === "stripe" ? "Creating Secure Checkout…" : "Submitting…"
                    : selectedPrice === 0
                    ? selectedEvent.requiresConfirmation ? "Submit Free Booking Request" : "Confirm Free Booking"
                    : paymentPath === "stripe"
                    ? "Continue to Secure Card Payment"
                    : paymentPath === "bank"
                    ? "Submit Booking & View Bank Details"
                    : "Submit Booking Request"}
                </Button>
                {selectedEvent.requiresConfirmation && (
                  <p className="text-xs font-body text-muted-foreground text-center">This session requires confirmation — you'll hear back within 24 hours.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 4: Confirmed ── */}
          {step === "confirmed" && (
            <div key="confirmed" className="text-center py-12 space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-200">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h2 className="font-display text-2xl text-foreground mb-2">
                  {confirmationIsFinal ? "You're booked!" : "Booking Request Received!"}
                </h2>
                <p className="text-sm font-body text-muted-foreground max-w-sm mx-auto">
                  {confirmedNeedsPayment
                    ? paymentPath === "stripe"
                      ? "Your booking has been saved, but card payment is still outstanding. Stripe confirmation is required before this page can show it as paid."
                      : paymentPath === "bank"
                      ? `Your requested time has been sent to ${tenant.displayName}. Use the bank details below; the booking remains pending until the transfer is confirmed.`
                      : `${tenant.displayName} will contact you with payment instructions. The booking remains pending until payment is confirmed.`
                    : confirmationIsFinal
                    ? `Your session with ${tenant.displayName} is confirmed for ${email}.`
                    : `Your request has been sent to ${tenant.displayName}. The photographer will contact you when it is confirmed.`}
                </p>
              </div>
              <div className="glass-panel rounded-xl p-5 max-w-sm mx-auto text-left space-y-2">
                <div className="flex justify-between text-sm font-body">
                  <span className="text-muted-foreground">Session</span>
                  <span className="text-foreground">{selectedEvent?.title}</span>
                </div>
                <div className="flex justify-between text-sm font-body">
                  <span className="text-muted-foreground">Date</span>
                  <span className="text-foreground">{selectedDate?.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}</span>
                </div>
                <div className="flex justify-between text-sm font-body">
                  <span className="text-muted-foreground">Time</span>
                  <span className="text-foreground">{selectedTime ? formatTime12(selectedTime) : "—"}</span>
                </div>
                <div className="flex justify-between text-sm font-body">
                  <span className="text-muted-foreground">Status</span>
                  <span className={confirmationIsFinal ? "text-green-400" : "text-yellow-400"}>{confirmationIsFinal ? "Confirmed" : "Pending"}</span>
                </div>
                {confirmedPrice > 0 && (
                  <>
                    <div className="flex justify-between text-sm font-body">
                      <span className="text-muted-foreground">Price</span>
                      <span className="text-foreground">${confirmedPrice} AUD</span>
                    </div>
                    <div className="flex justify-between text-sm font-body">
                      <span className="text-muted-foreground">Payment</span>
                      <span className={confirmedPaymentPaid ? "text-green-400" : "text-yellow-400"}>{confirmedPaymentPaid ? "Paid" : `$${confirmedAmountDue} AUD due${confirmedDepositPaid ? " balance" : submittedBooking?.depositRequired ? " deposit" : ""}`}</span>
                    </div>
                  </>
                )}
                {submittedBooking && (
                  <div className="flex justify-between text-sm font-body">
                    <span className="text-muted-foreground">Reference</span>
                    <span className="text-foreground font-mono text-xs">{submittedBooking.paymentReference || submittedBooking.id}</span>
                  </div>
                )}
                {cosplayCharacter && (
                  <div className="flex justify-between text-sm font-body">
                    <span className="text-muted-foreground">Character</span>
                    <span className="text-foreground truncate max-w-[180px]">{cosplayCharacter}</span>
                  </div>
                )}
                {conventionName && (
                  <div className="flex justify-between text-sm font-body">
                    <span className="text-muted-foreground">Convention</span>
                    <span className="text-foreground truncate max-w-[180px]">{conventionName}</span>
                  </div>
                )}
              </div>

              {/* Add to calendar */}
              {selectedDate && selectedTime && selectedEvent && selectedDuration && (() => {
                const gcalUrl = buildBookingCalendarUrl({
                  title: `${selectedEvent.title} with ${tenant.displayName}`,
                  date: toDateStr(selectedDate),
                  time: selectedTime,
                  durationMinutes: selectedDuration,
                  timeZone: availabilityTimezone || tenant.timezone,
                  details: confirmationIsFinal ? "Confirmed booking" : "Booking request — awaiting confirmation",
                  location: selectedEvent.location,
                });
                return (
                  <a
                    href={gcalUrl}
                    aria-label={`Add ${selectedEvent.title} on ${toDateStr(selectedDate)} at ${selectedTime} to Google Calendar`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border/60 bg-secondary/40 hover:bg-secondary text-xs font-body text-muted-foreground hover:text-foreground transition-all"
                  >
                    <CalendarIcon className="w-3.5 h-3.5 text-primary" />
                    Add to Google Calendar
                  </a>
                );
              })()}

              {/* Secure card checkout */}
              {confirmedNeedsPayment && paymentPath === "stripe" && submittedBooking && (
                <div className="glass-panel rounded-xl p-5 max-w-sm mx-auto text-left space-y-3 border border-primary/20 bg-primary/5">
                  <p className="text-xs font-body font-semibold text-primary tracking-wider uppercase flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5" />
                    Card Payment Outstanding
                  </p>
                  <p className="text-xs font-body text-muted-foreground">Amount due now: <span className="text-foreground font-medium">${confirmedAmountDue} AUD</span>. The server will verify the booking and calculate the Stripe charge.</p>
                  {checkoutError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs font-body text-destructive">{checkoutError}</p>}
                  <Button onClick={() => void openTenantCheckout(submittedBooking)} disabled={processingCheckout || confirmedPaymentPaid} className="w-full gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
                    <CreditCard className="w-4 h-4" />
                    {processingCheckout ? "Opening Secure Checkout…" : `Pay $${confirmedAmountDue} with Card`}
                  </Button>
                </div>
              )}

              {/* Bank transfer payment details */}
              {confirmedNeedsPayment && paymentPath === "bank" && bankTransfer?.enabled && (
                <div className="glass-panel rounded-xl p-5 max-w-sm mx-auto text-left space-y-3 border border-amber-500/20 bg-amber-500/5">
                  <p className="text-xs font-body font-semibold text-amber-300 tracking-wider uppercase flex items-center gap-2">
                    <DollarSign className="w-3.5 h-3.5" />
                    Bank Transfer Payment
                  </p>
                  <div className="space-y-1.5">
                    {bankTransfer.accountName && (
                      <div className="flex justify-between text-xs font-body">
                        <span className="text-muted-foreground">Account Name</span>
                        <span className="text-foreground font-medium">{bankTransfer.accountName}</span>
                      </div>
                    )}
                    {bankTransfer.bsb && (
                      <div className="flex justify-between text-xs font-body">
                        <span className="text-muted-foreground">BSB</span>
                        <span className="text-foreground font-medium font-mono">{bankTransfer.bsb}</span>
                      </div>
                    )}
                    {bankTransfer.accountNumber && (
                      <div className="flex justify-between text-xs font-body">
                        <span className="text-muted-foreground">Account Number</span>
                        <span className="text-foreground font-medium font-mono">{bankTransfer.accountNumber}</span>
                      </div>
                    )}
                    {bankTransfer.payId && (
                      <div className="flex justify-between text-xs font-body">
                        <span className="text-muted-foreground">PayID ({bankTransfer.payIdType || ""})</span>
                        <span className="text-foreground font-medium">{bankTransfer.payId}</span>
                      </div>
                    )}
                  </div>
                  {bankTransfer.instructions && (
                    <p className="text-xs font-body text-muted-foreground leading-relaxed border-t border-border/40 pt-2">{bankTransfer.instructions}</p>
                  )}
                  <p className="text-xs font-body text-muted-foreground border-t border-border/40 pt-2">Amount due now: <span className="text-foreground font-medium">${confirmedAmountDue} AUD</span></p>
                  {submittedBooking && <p className="text-xs font-body text-muted-foreground">Transfer reference: <span className="text-foreground font-mono">{submittedBooking.paymentReference || submittedBooking.id}</span></p>}
                </div>
              )}

              {confirmedNeedsPayment && paymentPath === "contact" && (
                <p className="glass-panel rounded-xl p-4 max-w-sm mx-auto text-sm font-body text-muted-foreground">{tenant.displayName} will contact you with payment instructions for the ${confirmedAmountDue} AUD currently due.</p>
              )}

              <Button variant="outline" onClick={() => { setStep("event-select"); setSelectedEvent(null); setSelectedDuration(null); setSelectedDate(null); setSelectedTime(null); setCustomAnswers({}); setSubmittedBooking(null); setPaymentPath(null); setCheckoutError(null); }} className="font-body text-xs gap-2">
                Book another session
              </Button>
            </div>
          )}

          {/* ── Enquiry Form ── */}
          {step === "enquiry" && (
            <div key="enquiry" className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-200 max-w-lg">
              <button onClick={() => { setStep("event-select"); scrollTop(); }} className="flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              <div className="glass-panel rounded-xl p-6 space-y-5">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl text-foreground">{enquiryLabel}</h2>
                    <p className="text-xs font-body text-muted-foreground">Tell us what you're looking for and we'll get back to you</p>
                  </div>
                </div>

                {/* Event type selector */}
                {eventTypes.length > 0 && (
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Session type (optional)</label>
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
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Your Name *</label>
                    <input
                      type="text"
                      value={enquiryName}
                      onChange={e => setEnquiryName(e.target.value)}
                      placeholder="Jane Smith"
                      className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Email *</label>
                    <input
                      type="email"
                      value={enquiryEmail}
                      onChange={e => setEnquiryEmail(e.target.value)}
                      placeholder="jane@example.com"
                      className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Phone (optional)</label>
                  <input
                    type="tel"
                    value={enquiryPhone}
                    onChange={e => setEnquiryPhone(e.target.value)}
                    placeholder="+61 400 000 000"
                    className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* Message */}
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Message / Details *</label>
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
                  className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2"
                >
                  {enquirySubmitting ? "Sending…" : "Send Enquiry"}
                </Button>
              </div>
            </div>
          )}

          {/* ── Enquiry Confirmed ── */}
          {step === "enquiry-confirmed" && (
            <div key="enquiry-confirmed" className="text-center py-12 space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-200">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
                <MessageSquare className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h2 className="font-display text-2xl text-foreground mb-2">Enquiry Sent!</h2>
                <p className="text-sm font-body text-muted-foreground max-w-sm mx-auto">
                  Your message has been sent to {tenant.displayName}. They'll be in touch at {enquiryEmail}.
                </p>
              </div>
              <Button variant="outline" onClick={() => { setStep("event-select"); scrollTop(); }} className="font-body text-xs gap-2">
                Back to booking page
              </Button>
            </div>
          )}

      </div>
      <footer className="border-t border-border bg-card/50 py-8">
        <div className="container mx-auto flex items-center justify-center gap-2 px-4 text-xs font-body text-muted-foreground/60">
          <Camera className="h-3.5 w-3.5 text-primary" />
          <span>© {new Date().getFullYear()} {tenant.displayName}</span>
        </div>
      </footer>
    </div>
  );
}
