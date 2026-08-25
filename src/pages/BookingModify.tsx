import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import { motion } from "framer-motion";
import {
  Clock, ChevronLeft, ChevronRight, ArrowLeft,
  CalendarDays, CheckCircle2, XCircle, MapPin,
  Calendar as CalendarIcon, ExternalLink, CreditCard,
  Building2, Copy, Check as CheckIcon, AlertCircle,
  DollarSign, Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Footer from "@/components/Footer";
import BookingReferenceUploads from "@/components/BookingReferenceUploads";
import { toast } from "sonner";
import { cacheBookingLocally, getBookings, getEventTypes, getProfile, getSettings } from "@/lib/storage";
import {
  createBookingCheckout,
  createTenantBookingCheckout,
  fetchBookingByToken,
  getBookingPaymentStatus,
  getStripeStatus,
  getTenantPublicData,
  getTenantStripeStatus,
  selectBookingBankTransfer,
} from "@/lib/api";
import type { PublicBookingPaymentStatus } from "@/lib/api";
import type { EventType, Booking } from "@/lib/types";
import { bookingPaymentReference } from "@/lib/booking-reference";
import { buildBookingCalendarUrl, filterFutureBookingSlots, isBookingPaymentConflictError, isBookingPaymentVerificationPending, isPastBookingDate, readAvailableSlots } from "@/lib/booking-utils";
import { fetchPublicAvailability, fetchPublicBookingConfig, patchPublicBooking } from "@/lib/booking-public-api";

function formatDuration(mins: number) {
  if (mins >= 60) { const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${mins}m`;
}
function formatTime12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function formatDateNice(dateStr: string) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
}
function getAvailabilityForDate(et: EventType, date: Date) {
  const dateStr = toDateStr(date);
  const avail = et.availability;
  if (!avail) return [];
  if ((avail.blockedDates || []).includes(dateStr)) return [];
  const specific = (avail.specificDates || []).filter(s => s.date === dateStr);
  if (specific.length > 0) return specific.map(s => ({ startTime: s.startTime, endTime: s.endTime }));
  return (avail.recurring || []).filter(s => s.day === date.getDay()).map(s => ({ startTime: s.startTime, endTime: s.endTime }));
}

export default function BookingModify() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const checkoutResult = new URLSearchParams(window.location.search).get("checkout");
  const [profile, setProfile] = useState(() => getProfile());
  const [settings, setSettings] = useState(() => getSettings());

  const [booking, setBooking] = useState<Booking | undefined>(
    () => getBookings().find(b => b.modifyToken === bookingId || b.id === bookingId)
  );
  const localEventTypes = booking ? getEventTypes() : [];
  const localEventType = localEventTypes.find(e => e.id === booking?.eventTypeId) ||
                         localEventTypes.find(e => e.title === booking?.type);
  const [tenantEventType, setTenantEventType] = useState<EventType | undefined>(undefined);
  const [publicEventType, setPublicEventType] = useState<EventType | undefined>(undefined);
  const eventType = tenantEventType ?? publicEventType ?? localEventType ?? null;

  // True while we are fetching the booking from the server (only needed when not in localStorage)
  const [fetchingBooking, setFetchingBooking] = useState(!booking && !!bookingId);

  const [mode, setMode] = useState<"status"|"reschedule"|"done">("status");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [use24h, setUse24h] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentActionError, setPaymentActionError] = useState<{ kind: "network" | "processing" | "api"; message: string } | null>(null);
  const paymentActionRef = useRef(false);
  const [authoritativePayment, setAuthoritativePayment] = useState<PublicBookingPaymentStatus | null>(null);
  const [tenantPaymentVerificationPending, setTenantPaymentVerificationPending] = useState(false);
  const [paymentStatusLoading, setPaymentStatusLoading] = useState(!!bookingId);
  const [paymentStatusError, setPaymentStatusError] = useState<{ kind: "network" | "api"; message: string } | null>(null);
  const paymentStatusRequestRef = useRef(0);
  const [savingChange, setSavingChange] = useState(false);
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth()));
  const [availableSlots, setAvailableSlots] = useState<string[] | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [bookingTimezone, setBookingTimezone] = useState(profile.timezone || "Australia/Sydney");
  const [tenantBankTransfer, setTenantBankTransfer] = useState<{
    enabled: boolean;
    accountName: string | null;
    bsb: string | null;
    accountNumber: string | null;
    payId: string | null;
    payIdType: string | null;
    instructions: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const statusRequest = booking?.tenantSlug
      ? getTenantStripeStatus(booking.tenantSlug)
      : getStripeStatus();
    statusRequest.then(status => {
      if (!cancelled) setStripeAvailable(status.configured);
    });
    return () => { cancelled = true; };
  }, [booking?.tenantSlug]);

  // Always refresh from the server. A local copy is only an instant-loading cache
  // and may have stale payment, cancellation, or reschedule state.
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    const refreshBooking = async () => {
      const found = await fetchBookingByToken(bookingId);
      if (found && !cancelled) {
        cacheBookingLocally(found);
        setBooking(found);
      }
      if (!cancelled) setFetchingBooking(false);
    };
    refreshBooking().catch(() => { if (!cancelled) setFetchingBooking(false); });
    return () => { cancelled = true; };
  }, [bookingId]);

  const refreshAuthoritativePayment = useCallback(async (pollForSettlement = false) => {
    const token = booking?.modifyToken || bookingId;
    if (!token) return;
    const requestId = ++paymentStatusRequestRef.current;
    setPaymentStatusLoading(true);
    setPaymentStatusError(null);
    const attempts = pollForSettlement ? 6 : 1;
    let lastError: { kind: "network" | "api"; message: string } | null = null;

    // Tenant bookings do not expose the main-site normalized status endpoint.
    // Poll the capability-protected booking instead, and keep payment actions
    // blocked after a Stripe success return until a settled booking is observed.
    if (booking?.tenantSlug) {
      setAuthoritativePayment(null);
      setTenantPaymentVerificationPending(pollForSettlement);
      for (let attempt = 0; attempt < attempts && paymentStatusRequestRef.current === requestId; attempt++) {
        const found = await fetchBookingByToken(token);
        if (found) {
          cacheBookingLocally(found);
          setBooking(found);
          lastError = null;
          const settled = found.paymentStatus === "paid" || found.paymentStatus === "deposit-paid" || !!found.paidAt || !!found.depositPaidAt;
          if (settled) {
            setTenantPaymentVerificationPending(false);
            break;
          }
          if (!pollForSettlement) setTenantPaymentVerificationPending(false);
        } else {
          lastError = { kind: "network", message: "The booking could not be refreshed" };
          if (!pollForSettlement) break;
        }
        if (attempt < attempts - 1) await new Promise(resolve => window.setTimeout(resolve, 1200));
      }
      if (paymentStatusRequestRef.current !== requestId) return;
      setPaymentStatusError(lastError);
      setPaymentStatusLoading(false);
      return;
    }

    setTenantPaymentVerificationPending(false);
    for (let attempt = 0; attempt < attempts && paymentStatusRequestRef.current === requestId; attempt++) {
      const result = await getBookingPaymentStatus(token);
      if (result.payment) {
        setAuthoritativePayment(result.payment);
        lastError = null;
        const stateMaySettle = ["checkout-open", "checkout-processing", "checkout-status-unavailable", "unpaid"].includes(result.payment.state);
        if (["paid", "deposit-paid", "bank-pending"].includes(result.payment.state)) {
          const refreshedBooking = await fetchBookingByToken(token);
          if (refreshedBooking && paymentStatusRequestRef.current === requestId) {
            cacheBookingLocally(refreshedBooking);
            setBooking(refreshedBooking);
          }
        }
        if (!pollForSettlement || !stateMaySettle) break;
      } else {
        lastError = {
          kind: result.errorKind === "network" ? "network" : "api",
          message: result.error || "Payment status could not be verified",
        };
        if (!pollForSettlement) break;
      }
      if (attempt < attempts - 1) await new Promise(resolve => window.setTimeout(resolve, 1200));
    }
    if (paymentStatusRequestRef.current !== requestId) return;
    setPaymentStatusError(lastError);
    setPaymentStatusLoading(false);
  }, [booking?.modifyToken, booking?.tenantSlug, bookingId]);

  useEffect(() => {
    if (fetchingBooking) return;
    void refreshAuthoritativePayment(checkoutResult === "success");
    return () => { paymentStatusRequestRef.current += 1; };
  }, [checkoutResult, fetchingBooking, refreshAuthoritativePayment]);

  // If booking belongs to a tenant and the event type wasn't found in local storage,
  // fetch it from the tenant's public API (tenant event types are stored separately).
  // Also handles bookings where eventTypeId is missing/stale — falls back to title match.
  useEffect(() => {
    if (tenantEventType || !booking?.tenantSlug) return;
    getTenantPublicData(booking.tenantSlug).then(data => {
      if (!data) return;
      if (data.tenant.timezone) setBookingTimezone(data.tenant.timezone);
      if (data.bankTransfer) setTenantBankTransfer(data.bankTransfer);
      const found = data.eventTypes.find(
        e => e.id === booking.eventTypeId || e.title === booking.type
      );
      if (found) setTenantEventType(found);
    }).catch(() => {});
  }, [booking?.tenantSlug, booking?.eventTypeId, booking?.type, tenantEventType]);

  useEffect(() => {
    if (!booking || booking.tenantSlug || publicEventType) return;
    const controller = new AbortController();
    fetchPublicBookingConfig(controller.signal).then(config => {
      const found = config.eventTypes.find(event => event.id === booking.eventTypeId || event.title === booking.type);
      if (found) setPublicEventType(found);
      if (config.profile) {
        setProfile(previous => ({ ...previous, ...config.profile }));
        if (config.profile.timezone) setBookingTimezone(config.profile.timezone);
      }
      if (config.settings) setSettings(previous => ({ ...previous, ...config.settings }));
    }).catch(() => {});
    return () => controller.abort();
  }, [booking, publicEventType]);

  // Availability is authoritative: it already excludes bookings, buffers, and
  // connected calendar conflicts (including the booking currently being edited).
  useEffect(() => {
    if (!selectedDate || !booking || !eventType) {
      setAvailableSlots(null);
      setAvailabilityError(null);
      return;
    }
    const controller = new AbortController();
    const date = toDateStr(selectedDate);
    setAvailableSlots(null);
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    fetchPublicAvailability({
      eventTypeId: eventType.id,
      date,
      duration: booking.duration,
      tenantSlug: booking.tenantSlug,
      signal: controller.signal,
    }).then(payload => {
      const slots = readAvailableSlots(payload);
      if (slots === null) throw new Error("Availability could not be read");
      setAvailableSlots(slots);
      if (payload.timezone) setBookingTimezone(payload.timezone);
    }).catch(error => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setAvailabilityError(error instanceof Error ? error.message : "Availability could not be loaded");
    }).finally(() => {
      if (!controller.signal.aborted) setAvailabilityLoading(false);
    });
    return () => controller.abort();
  }, [selectedDate, booking, eventType, availabilityRetry]);

  usePageTitle(
    eventType && booking
      ? `${eventType.title} — ${formatDateNice(booking.date)}`
      : "Manage Booking"
  );

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const blanks = Array.from({ length: (new Date(year,month,1).getDay()+6)%7 });
  const days = Array.from({ length: daysInMonth }, (_, i) => i+1);

  const timeSlots = useMemo(() => {
    if (!selectedDate || !booking || !eventType || availableSlots === null) return [];
    const dateStr = toDateStr(selectedDate);
    return filterFutureBookingSlots(availableSlots, dateStr, bookingTimezone);
  }, [selectedDate, booking, eventType, availableSlots, bookingTimezone]);

  const handleCancel = useCallback(async () => {
    if (!booking || !confirm("Cancel this booking?")) return;
    if (!booking.modifyToken) { toast.error("This booking cannot be cancelled online."); return; }
    setSavingChange(true);
    try {
      const updated = await patchPublicBooking(booking.modifyToken, { action: "cancel" });
      cacheBookingLocally(updated);
      setBooking(updated);
      toast.success("Booking cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel the booking");
    } finally {
      setSavingChange(false);
    }
  }, [booking]);

  const handleReschedule = useCallback(async () => {
    if (!booking || !selectedDate || !selectedTime) return;
    if (!booking.modifyToken) { toast.error("This booking cannot be changed online."); return; }
    const dateStr = toDateStr(selectedDate);
    if (availabilityLoading || availableSlots === null || !timeSlots.includes(selectedTime)) {
      toast.error("That time is no longer available. Please choose another.");
      setSelectedTime(null);
      setAvailabilityRetry(retry => retry + 1);
      return;
    }
    setSavingChange(true);
    try {
      const updated = await patchPublicBooking(booking.modifyToken, {
        date: dateStr,
        time: selectedTime,
      });
      cacheBookingLocally(updated);
      setBooking(updated);
      setMode("done");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reschedule the booking");
      setSelectedTime(null);
      setAvailabilityRetry(retry => retry + 1);
    } finally {
      setSavingChange(false);
    }
  }, [booking, selectedDate, selectedTime, availabilityLoading, availableSlots, timeSlots]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleBookAnother = () => {
    // The main booking page restores the last booking by default. Clear that
    // marker so this link always opens a fresh booking rather than this one.
    sessionStorage.removeItem("lastBookingId");
    navigate(booking?.tenantSlug ? `/book/${encodeURIComponent(booking.tenantSlug)}` : "/");
  };

  if (fetchingBooking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="animate-pulse text-muted-foreground font-body text-sm">Loading…</div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="glass-panel rounded-xl p-8 text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-2">Booking Not Found</h2>
          <p className="text-sm font-body text-muted-foreground mb-4">This link may have expired or the booking was removed.</p>
          <Button onClick={() => navigate("/")} variant="outline" className="font-body text-xs">Book a New Session</Button>
        </div>
      </div>
    );
  }

  // Use the resolved event type, or synthesise a minimal one from the booking data so
  // the page renders immediately even while the tenant event types are still loading.
  const et: EventType = eventType ?? {
    id: booking.eventTypeId,
    title: booking.type || "Session",  // booking.type stores the event type display name
    description: "",
    durations: [booking.duration],
    color: "#6366f1",
    price: booking.paymentAmount ?? 0,
    active: true,
    questions: [],
    availability: { recurring: [], specificDates: [], blockedDates: [] },
  };

  const depositAmt = booking.depositAmount ?? 0;
  const totalAmt = booking.paymentAmount ?? et.price ?? 0;
  const remainingAmt = Math.max(0, totalAmt - depositAmt);
  const storedDepositPaid = booking.paymentStatus === "deposit-paid" || !!booking.depositPaidAt;
  const storedPaidInFull = booking.paymentStatus === "paid" || booking.paymentStatus === "cash" || !!booking.paidAt;
  const storedBankPending = booking.paymentStatus === "pending-confirmation";
  const paymentState = authoritativePayment?.state
    ?? (booking.tenantSlug
      ? storedPaidInFull ? "paid" : storedDepositPaid ? "deposit-paid" : storedBankPending ? "bank-pending" : "unpaid"
      : undefined);
  const mayUseStoredPaymentState = !!booking.tenantSlug || !authoritativePayment;
  const isDepositPaid = paymentState === "deposit-paid" || (mayUseStoredPaymentState && storedDepositPaid);
  const isPaidInFull = paymentState === "paid" || authoritativePayment?.paymentStatus === "cash" || (mayUseStoredPaymentState && storedPaidInFull);
  const isBankPending = paymentState === "bank-pending" || (mayUseStoredPaymentState && storedBankPending);
  const paymentIsProcessing = isBookingPaymentVerificationPending(paymentState) || tenantPaymentVerificationPending;
  const paymentPageCanAct = !paymentIsProcessing && !paymentStatusLoading && !paymentStatusError && !isPaidInFull && !isBankPending && !["cancelled", "completed"].includes(booking.status);
  const canRetryCard = booking.tenantSlug
    ? paymentPageCanAct
    : paymentPageCanAct && authoritativePayment?.canRetryCard === true;
  const canSubmitBank = !booking.tenantSlug && authoritativePayment?.canSubmitBank === true && !isDepositPaid && !paymentIsProcessing && !paymentStatusLoading && !paymentStatusError;
  const isFree = totalAmt === 0;
  const depositEnabled = booking.depositRequired && depositAmt > 0;
  const bankTransfer = booking.tenantSlug
    ? tenantBankTransfer ?? { enabled: false, accountName: null, bsb: null, accountNumber: null, payId: null, payIdType: null, instructions: null }
    : settings.bankTransfer;
  const bookingDate = (() => { const [y,mo,d] = booking.date.split("-").map(Number); return new Date(y,mo-1,d); })();

  const handleStripePayment = async (amount: number) => {
    if (processingPayment || paymentActionRef.current) return;
    if (isPaidInFull || amount <= 0) {
      toast.info("This booking is already paid in full.");
      return;
    }
    if (isBankPending) {
      toast.info("Your bank transfer is awaiting confirmation. Please do not pay again.");
      return;
    }
    if (!canRetryCard) {
      setPaymentActionError({
        kind: paymentIsProcessing ? "processing" : "api",
        message: paymentIsProcessing
          ? "Your existing card payment is still being verified. Do not submit another payment."
          : "Refresh the authoritative payment status before trying card payment.",
      });
      return;
    }
    if (!booking.modifyToken) {
      toast.error("This booking cannot be verified for payment. Please reopen your booking link.");
      return;
    }
    paymentActionRef.current = true;
    setProcessingPayment(true);
    setPaymentActionError(null);
    const modifyPath = `/booking/modify/${encodeURIComponent(booking.modifyToken)}`;
    const successUrl = `${window.location.origin}${modifyPath}?checkout=success`;
    const cancelUrl = `${window.location.origin}${modifyPath}?checkout=cancelled`;
    const result = booking.tenantSlug
      ? await createTenantBookingCheckout(booking.tenantSlug, {
          bookingId: booking.id,
          modifyToken: booking.modifyToken,
          successUrl,
          cancelUrl,
        })
      : await createBookingCheckout({
          bookingId: booking.id,
          modifyToken: booking.modifyToken,
          clientName: booking.clientName,
          clientEmail: booking.clientEmail,
          amount,
          eventTitle: et.title,
          successUrl,
          cancelUrl,
        });
    setProcessingPayment(false);
    paymentActionRef.current = false;
    if (result.url) {
      window.location.href = result.url;
      return;
    }
    const processing = isBookingPaymentConflictError(result.errorCode);
    const message = processing
      ? "A card payment is already processing. Refresh your booking status before trying again."
      : result.error || "Payment could not be started";
    setPaymentActionError({ kind: processing ? "processing" : result.errorKind === "network" ? "network" : "api", message });
    if (processing) void refreshAuthoritativePayment(true);
    toast.error(message);
  };

  const handleSelectBankTransfer = async () => {
    if (processingPayment || paymentActionRef.current) return;
    if (booking.tenantSlug) {
      setPaymentActionError({ kind: "api", message: "This booking cannot be switched to bank transfer online. Contact the photographer before sending money." });
      return;
    }
    if (isPaidInFull || isDepositPaid) {
      setPaymentActionError({ kind: "api", message: "Your deposit is already recorded. Contact the photographer to confirm a manual remaining-balance transfer." });
      return;
    }
    if (!canSubmitBank) {
      setPaymentActionError({
        kind: paymentIsProcessing ? "processing" : "api",
        message: paymentIsProcessing
          ? "Your existing card payment is still being verified. Do not submit a bank transfer as well."
          : "Refresh the authoritative payment status before recording a bank transfer.",
      });
      return;
    }
    if (!booking.modifyToken) {
      setPaymentActionError({ kind: "api", message: "This booking cannot be verified. Reopen your booking link before recording a transfer." });
      return;
    }
    paymentActionRef.current = true;
    setProcessingPayment(true);
    setPaymentActionError(null);
    try {
      const result = await selectBookingBankTransfer(booking.modifyToken);
      if (!result.booking) {
        const processing = isBookingPaymentConflictError(result.errorCode);
        const message = processing
          ? "A card payment is already processing. Wait for its status to update before using bank transfer."
          : result.error || "The transfer could not be recorded";
        setPaymentActionError({ kind: processing ? "processing" : result.errorKind === "network" ? "network" : "api", message });
        if (processing) void refreshAuthoritativePayment(true);
        toast.error(message);
        return;
      }
      cacheBookingLocally(result.booking);
      setBooking(result.booking);
      void refreshAuthoritativePayment(false);
      toast.success("Bank transfer selected — complete it using the details below");
    } finally {
      paymentActionRef.current = false;
      setProcessingPayment(false);
    }
  };

  // ── Rescheduled confirmation ──
  if (mode === "done") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="glass-panel rounded-xl p-8 text-center max-w-md w-full">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-6">Booking Rescheduled!</h2>
          <div className="border-t border-border/50 pt-4 space-y-2 text-left">
            <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Event</span><span className="text-foreground">{et.title}</span></div>
            <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">New Date</span><span className="text-foreground">{formatDateNice(booking.date)}</span></div>
            <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">New Time</span><span className="text-primary font-medium">{formatTime12(booking.time)}</span></div>
          </div>
          <Button asChild variant="outline" className="w-full mt-4 font-body text-xs gap-2">
            <a aria-label={`Add rescheduled ${et.title} on ${booking.date} at ${booking.time} to Google Calendar`} href={buildBookingCalendarUrl({ title: et.title, date: booking.date, time: booking.time, durationMinutes: booking.duration, timeZone: bookingTimezone, details: et.description, location: et.location })} target="_blank" rel="noopener noreferrer"><CalendarIcon className="w-4 h-4" /> Add Updated Time to Calendar <ExternalLink className="w-3 h-3" /></a>
          </Button>
          <Button onClick={handleBookAnother} variant="outline" className="w-full mt-2 font-body text-xs gap-2"><CalendarDays className="w-4 h-4" /> Book Another Session</Button>
          <Button onClick={() => setMode("status")} variant="ghost" className="w-full mt-2 font-body text-xs text-muted-foreground">Back to Booking</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <section className="min-h-screen" style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)", paddingBottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}>
        <div className="container mx-auto px-4">

          {mode === "status" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto">
              <div className="glass-panel rounded-xl p-8 mb-4">

                {checkoutResult === "success" && (
                  <div role="status" className={`mb-5 rounded-lg border p-3 text-sm font-body ${isPaidInFull || isDepositPaid ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
                    <p>{isPaidInFull
                      ? "Card payment confirmed. This booking is paid in full."
                      : isDepositPaid
                      ? "Card deposit confirmed. Any remaining balance is shown below."
                      : "We’re confirming your card payment with Stripe. Don’t pay again while this is processing."}</p>
                    {!isPaidInFull && !isDepositPaid && (
                      <Button type="button" variant="ghost" size="sm" disabled={paymentStatusLoading} onClick={() => void refreshAuthoritativePayment(true)} className="mt-2 h-8 px-2 text-xs text-amber-200 hover:text-amber-100">
                        {paymentStatusLoading ? "Checking status…" : "Refresh payment status"}
                      </Button>
                    )}
                  </div>
                )}
                {checkoutResult === "cancelled" && (
                  <div role="status" className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-body text-amber-300">
                    {isPaidInFull || isDepositPaid
                      ? "Payment has since been confirmed. No retry is needed."
                      : paymentIsProcessing
                      ? "Checkout closed, but Stripe is still reporting a payment in progress. Don’t pay again while it is being verified."
                      : "Card checkout was cancelled before payment was confirmed. This same booking remains on screen; refresh its status before continuing."}
                  </div>
                )}
                {!checkoutResult && paymentIsProcessing && (
                  <div role="status" className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-body text-amber-300">
                    {paymentState === "payment-review"
                      ? "A card payment needs manual review. Don’t pay again; contact the photographer if this does not update."
                      : paymentState === "checkout-status-unavailable"
                      ? "Stripe’s current status could not be verified. Don’t pay again until the status can be checked."
                      : "A card payment is being verified. Don’t submit another card or bank payment while this is processing."}
                  </div>
                )}
                {paymentStatusError && (
                  <div role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-body">
                    <p className="text-destructive">{paymentStatusError.kind === "network" ? "Couldn’t connect to check payment status." : "Payment status could not be verified."}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Don’t pay again until an authoritative status check succeeds.</p>
                    <Button type="button" variant="ghost" size="sm" disabled={paymentStatusLoading} onClick={() => void refreshAuthoritativePayment(false)} className="mt-2 h-8 px-2 text-xs">
                      {paymentStatusLoading ? "Checking…" : "Try status check again"}
                    </Button>
                  </div>
                )}

                {/* Header icon + title */}
                <div className="text-center mb-6">
                  {booking.status === "cancelled"
                    ? <><Ban className="w-12 h-12 text-destructive mx-auto mb-3" /><h2 className="font-display text-2xl text-foreground">Booking Cancelled</h2></>
                    : <><CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" /><h2 className="font-display text-2xl text-foreground">{booking.status === "confirmed" || booking.status === "completed" ? "Booking Confirmed" : "Booking Pending"}</h2><p className="text-sm font-body text-muted-foreground mt-1">{booking.status === "pending" ? "Awaiting confirmation." : "You're all set!"}</p></>
                  }
                </div>

                {/* Details */}
                <div className="border-t border-border/50 pt-4 space-y-2.5">
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Event</span><span className="text-foreground font-medium">{et.title}</span></div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Duration</span><span className="text-foreground">{formatDuration(booking.duration)}</span></div>
                  {!!et.bufferMinutes && et.bufferMinutes > 0 && <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Turnaround buffer</span><span className="text-foreground">{formatDuration(et.bufferMinutes)}</span></div>}
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Date</span><span className="text-foreground">{formatDateNice(booking.date)}</span></div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Time</span><span className="text-primary font-medium">{formatTime12(booking.time)}</span></div>
                  {et.location && <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Location</span><span className="text-foreground">{et.location}</span></div>}
                  <div className="flex justify-between text-sm font-body items-center">
                    <span className="text-muted-foreground">Status</span>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-body ${booking.status === "confirmed" || booking.status === "completed" ? "bg-green-500/10 text-green-400" : booking.status === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-yellow-500/10 text-yellow-400"}`}>
                      {booking.status === "confirmed" ? "Confirmed" : booking.status === "completed" ? "Completed" : booking.status === "cancelled" ? "Cancelled" : "Pending"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Ref</span><span className="font-mono text-xs text-muted-foreground">{booking.id}</span></div>
                </div>

                {/* Payment status */}
                {!isFree && (
                  <div className="border-t border-border/50 pt-4 mt-4 space-y-2">
                    <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-3">Payment</p>
                    {isPaidInFull && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                        <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-400" /><span className="text-sm font-body text-green-400 font-medium">Paid in Full</span></div>
                        <span className="text-sm font-body text-green-400 font-medium">${totalAmt}</span>
                      </div>
                    )}
                    {isDepositPaid && (
                      <>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-teal-500/10 border border-teal-500/20">
                          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400" /><span className="text-sm font-body text-teal-400 font-medium">Deposit Paid</span></div>
                          <span className="text-sm font-body text-teal-400 font-medium">${depositAmt}</span>
                        </div>
                        {remainingAmt > 0 && (
                          <div className="flex items-center justify-between p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <div className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-yellow-400" /><span className="text-sm font-body text-yellow-400 font-medium">Remaining Balance</span></div>
                            <span className="text-sm font-body text-yellow-400 font-medium">${remainingAmt}</span>
                          </div>
                        )}
                      </>
                    )}
                    {isBankPending && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                        <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-400" /><span className="text-sm font-body text-blue-400 font-medium">Bank Transfer Pending</span></div>
                        <span className="text-sm font-body text-blue-400 font-medium">${depositEnabled ? depositAmt : totalAmt}</span>
                      </div>
                    )}
                    {paymentIsProcessing && !isPaidInFull && !isDepositPaid && !isBankPending && (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-300" /><span className="text-sm font-body text-amber-300 font-medium">{paymentState === "payment-review" ? "Payment Needs Review" : "Card Payment Processing"}</span></div>
                        <p className="mt-1.5 text-xs font-body text-muted-foreground">No additional payment should be submitted while this status is being checked.</p>
                      </div>
                    )}
                    {paymentState === "hold-expired" && !isPaidInFull && !isDepositPaid && (
                      <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <div className="flex items-center gap-2"><XCircle className="w-4 h-4 text-destructive" /><span className="text-sm font-body text-destructive font-medium">Booking Hold Expired</span></div>
                        <p className="mt-1.5 text-xs font-body text-muted-foreground">This booking can no longer accept payment. Contact the photographer or make a new booking.</p>
                      </div>
                    )}
                    {!isPaidInFull && !isDepositPaid && !isBankPending && !paymentIsProcessing && !paymentStatusLoading && !paymentStatusError && paymentState !== "hold-expired" && paymentState !== "not-payable" && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                        <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-destructive" /><span className="text-sm font-body text-destructive font-medium">Payment Required</span></div>
                        <span className="text-sm font-body text-destructive font-medium">${depositEnabled ? depositAmt : totalAmt}</span>
                      </div>
                    )}
                    {!isPaidInFull && !isDepositPaid && !isBankPending && (paymentStatusLoading || paymentStatusError) && (
                      <div className="p-3 rounded-lg bg-secondary/40 border border-border">
                        <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-body text-muted-foreground font-medium">{paymentStatusLoading ? "Checking Payment Status" : "Payment Status Unavailable"}</span></div>
                      </div>
                    )}
                  </div>
                )}

                {isBankPending && bankTransfer.enabled && booking.status !== "cancelled" && !paymentStatusLoading && !paymentStatusError && (
                  <div className="mt-4 space-y-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                    <p className="text-sm font-body font-medium text-blue-300">Complete your manual transfer</p>
                    <p className="text-xs font-body text-muted-foreground">Bank transfer is selected. It remains unpaid until the photographer verifies receipt.</p>
                    {bankTransfer.accountName && <div className="flex items-center justify-between p-3 rounded-lg bg-secondary"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Account Name</p><p className="text-sm font-body text-foreground font-medium">{bankTransfer.accountName}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(bankTransfer.accountName,"name")}>{copiedField==="name"?<CheckIcon className="w-4 h-4 text-primary"/>:<Copy className="w-4 h-4"/>}</Button></div>}
                    {bankTransfer.bsb && <div className="flex items-center justify-between p-3 rounded-lg bg-secondary"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">BSB</p><p className="text-sm font-body text-foreground font-medium">{bankTransfer.bsb}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(bankTransfer.bsb,"bsb")}>{copiedField==="bsb"?<CheckIcon className="w-4 h-4 text-primary"/>:<Copy className="w-4 h-4"/>}</Button></div>}
                    {bankTransfer.accountNumber && <div className="flex items-center justify-between p-3 rounded-lg bg-secondary"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Account Number</p><p className="text-sm font-body text-foreground font-medium">{bankTransfer.accountNumber}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(bankTransfer.accountNumber,"acc")}>{copiedField==="acc"?<CheckIcon className="w-4 h-4 text-primary"/>:<Copy className="w-4 h-4"/>}</Button></div>}
                    {bankTransfer.payId && <div className="flex items-center justify-between p-3 rounded-lg bg-secondary"><div><p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">PayID ({bankTransfer.payIdType})</p><p className="text-sm font-body text-foreground font-medium">{bankTransfer.payId}</p></div><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(bankTransfer.payId,"payid")}>{copiedField==="payid"?<CheckIcon className="w-4 h-4 text-primary"/>:<Copy className="w-4 h-4"/>}</Button></div>}
                    {bankTransfer.instructions && <div className="p-3 rounded-lg bg-primary/5 border border-primary/10"><p className="text-xs font-body text-muted-foreground">{bankTransfer.instructions}</p></div>}
                    <p className="text-xs font-body text-muted-foreground text-center">Transfer reference: <span className="text-primary font-medium">{bookingPaymentReference(booking)}</span></p>
                  </div>
                )}

                <BookingReferenceUploads booking={booking} onChange={updated => { setBooking(updated); cacheBookingLocally(updated); }} />

                {/* Pay now buttons */}
                {!isFree && !isPaidInFull && booking.status !== "cancelled" && paymentState !== "hold-expired" && paymentState !== "not-payable" && (
                  <div className="mt-4 space-y-2.5">
                    {paymentStatusLoading && (
                      <p className="rounded-lg border border-border bg-secondary/30 p-3 text-center text-xs font-body text-muted-foreground" role="status">Checking authoritative payment status…</p>
                    )}
                    {isDepositPaid && remainingAmt > 0 && !paymentStatusLoading && !paymentStatusError && (
                      <>
                        <p className="text-xs font-body text-muted-foreground">Pay your remaining balance:</p>
                        {stripeAvailable && canRetryCard && <Button onClick={() => handleStripePayment(remainingAmt)} disabled={processingPayment} className="w-full gap-2 bg-primary text-primary-foreground font-body text-sm h-11"><CreditCard className="w-4 h-4" />{processingPayment ? "Checking…" : `Pay Remaining $${remainingAmt} with Card`}</Button>}
                        {bankTransfer.enabled && <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs font-body text-amber-300 text-center">For a remaining-balance bank transfer, contact the photographer. Your paid deposit will stay recorded while they confirm the balance manually.</p>}
                      </>
                    )}
                    {!isDepositPaid && !isBankPending && !paymentIsProcessing && !paymentStatusLoading && !paymentStatusError && (
                      <>
                        <p className="text-xs font-body text-muted-foreground">{depositEnabled ? `Pay your $${depositAmt} deposit:` : `Pay $${totalAmt} to confirm:`}</p>
                        {stripeAvailable && canRetryCard && <Button onClick={() => handleStripePayment(depositEnabled ? depositAmt : totalAmt)} disabled={processingPayment} className="w-full gap-2 bg-primary text-primary-foreground font-body text-sm h-11"><CreditCard className="w-4 h-4" />{processingPayment ? "Checking…" : `Continue $${depositEnabled ? depositAmt : totalAmt} Card Payment`}</Button>}
                        {bankTransfer.enabled && !booking.tenantSlug && canSubmitBank && <Button onClick={() => void handleSelectBankTransfer()} disabled={processingPayment} variant="outline" className="w-full gap-2 border-border text-foreground font-body text-sm h-11"><Building2 className="w-4 h-4" />{processingPayment ? "Switching safely…" : "Switch to Bank Transfer / PayID"}</Button>}
                        {bankTransfer.enabled && booking.tenantSlug && <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs font-body text-amber-300 text-center">Contact the photographer to switch this unpaid booking to manual bank transfer. Payment details are shown only after the payment method is safely selected.</p>}
                      </>
                    )}
                    {paymentActionError && (
                      <div role="alert" className={`rounded-lg border p-3 ${paymentActionError.kind === "processing" ? "border-amber-500/30 bg-amber-500/10" : "border-destructive/30 bg-destructive/10"}`}>
                        <p className={`text-sm font-body ${paymentActionError.kind === "processing" ? "text-amber-300" : "text-destructive"}`}>{paymentActionError.kind === "network" ? "Connection problem" : paymentActionError.kind === "processing" ? "Payment is already processing" : "Payment action failed"}</p>
                        <p className="mt-1 text-xs font-body text-muted-foreground">{paymentActionError.message}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                {booking.status !== "cancelled" && (
                  <div className="flex flex-col gap-3 mt-6 border-t border-border/50 pt-5">
                    <Button asChild variant="outline" className="w-full font-body text-xs tracking-wider uppercase gap-2">
                      <a aria-label={`Add ${et.title} on ${booking.date} at ${booking.time} to Google Calendar`} href={buildBookingCalendarUrl({ title: et.title, date: booking.date, time: booking.time, durationMinutes: booking.duration, timeZone: bookingTimezone, details: et.description, location: et.location })} target="_blank" rel="noopener noreferrer"><CalendarIcon className="w-4 h-4" /> Add to Google Calendar <ExternalLink className="w-3 h-3" /></a>
                    </Button>
                    <Button onClick={handleBookAnother} variant="outline" className="w-full font-body text-xs tracking-wider uppercase gap-2"><CalendarDays className="w-4 h-4" /> Book Another Session</Button>
                    <Button onClick={() => setMode("reschedule")} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2"><CalendarDays className="w-4 h-4" /> Change Date / Time</Button>
                    <Button onClick={() => void handleCancel()} disabled={savingChange} variant="outline" className="w-full font-body text-xs tracking-wider uppercase border-destructive text-destructive hover:bg-destructive/10 gap-2"><XCircle className="w-4 h-4" /> {savingChange ? "Cancelling…" : "Cancel Booking"}</Button>
                  </div>
                )}
              </div>
              <p className="text-center text-xs font-body text-muted-foreground/40">{profile.name}</p>
            </motion.div>
          )}

          {mode === "reschedule" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-[900px] mx-auto">
              <button onClick={() => setMode("status")} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-4">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="grid lg:grid-cols-[1fr_240px] divide-y lg:divide-y-0 lg:divide-x divide-border/50">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="font-display text-base text-foreground"><span className="text-primary">{currentMonth.toLocaleDateString("en-US",{month:"long"})}</span> {year}</h3>
                      <div className="flex gap-1">
                        <button type="button" aria-label="Previous month" onClick={() => setCurrentMonth(new Date(year,month-1))} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground"><ChevronLeft className="w-4 h-4" /></button>
                        <button type="button" aria-label="Next month" onClick={() => setCurrentMonth(new Date(year,month+1))} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground"><ChevronRight className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-1 mb-2">{["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d=><div key={d} className="text-center text-[10px] font-body tracking-wider uppercase text-muted-foreground py-2">{d}</div>)}</div>
                    <div className="grid grid-cols-7 gap-1">
                      {blanks.map((_,i)=><div key={i}/>)}
                      {days.map(day=>{
                        const date=new Date(year,month,day);
                        const isSelected=selectedDate?.getDate()===day&&selectedDate?.getMonth()===month&&selectedDate?.getFullYear()===year;
                        const isPast=isPastBookingDate(toDateStr(date),bookingTimezone);
                        const isAvail=!isPast&&getAvailabilityForDate(et,date).length>0;
                        const isToday=toDateStr(date)===toDateStr(new Date());
                        return <button key={day} type="button" aria-label={`${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${isAvail ? ", available" : ", unavailable"}`} aria-pressed={isSelected} disabled={!isAvail} onClick={()=>{setSelectedDate(date);setSelectedTime(null);}} className={`aspect-square rounded-lg text-sm font-body transition-all relative ${isSelected?"bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background":isAvail?"text-foreground hover:bg-secondary":"text-muted-foreground/20 cursor-not-allowed"}`}>{day}{isToday&&!isSelected&&<span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"/>}</button>;
                      })}
                    </div>
                  </div>
                  <div className="p-4">
                    {selectedDate ? (
                      <motion.div initial={{opacity:0}} animate={{opacity:1}}>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-body font-medium text-foreground">{selectedDate.toLocaleDateString("en-US",{weekday:"short"})} {selectedDate.getDate()}</p>
                          <div className="flex rounded-md border border-border overflow-hidden">
                            <button type="button" aria-pressed={!use24h} onClick={()=>setUse24h(false)} className={`px-2 py-0.5 text-[10px] font-body ${!use24h?"bg-secondary text-foreground":"text-muted-foreground"}`}>12h</button>
                            <button type="button" aria-pressed={use24h} onClick={()=>setUse24h(true)} className={`px-2 py-0.5 text-[10px] font-body ${use24h?"bg-secondary text-foreground":"text-muted-foreground"}`}>24h</button>
                          </div>
                        </div>
                        <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                          {availabilityLoading ? <p className="text-sm font-body text-muted-foreground text-center py-8" role="status">Checking availability…</p> : availabilityError ? (
                            <div className="text-center py-6 space-y-3" role="alert"><p className="text-sm font-body text-destructive">Live availability couldn't be loaded.</p><Button type="button" variant="outline" size="sm" onClick={() => setAvailabilityRetry(retry => retry + 1)}>Try again</Button></div>
                          ) : timeSlots.length>0?timeSlots.map(t=>(
                            <button key={t} onClick={()=>setSelectedTime(t)} className={`w-full text-sm font-body py-2.5 px-4 rounded-lg border transition-all text-center ${selectedTime===t?"bg-primary text-primary-foreground border-primary":"border-border text-foreground hover:border-primary/50"}`}>
                              <span className="flex items-center justify-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-400"/>{use24h?t:formatTime12(t)}</span>
                            </button>
                          )):<p className="text-sm font-body text-muted-foreground/50 text-center py-8">No slots available</p>}
                        </div>
                        {selectedTime && <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="mt-3"><Button disabled={savingChange} onClick={() => void handleReschedule()} className="w-full bg-primary text-primary-foreground font-body tracking-wider uppercase text-xs py-5">{savingChange ? "Saving…" : "Confirm New Time"}</Button></motion.div>}
                      </motion.div>
                    ) : (
                      <div className="text-center py-12"><CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3"/><p className="text-xs font-body text-muted-foreground/50">Select a date</p></div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}
