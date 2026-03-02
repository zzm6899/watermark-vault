import { useState, useMemo, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock, ChevronLeft, ChevronRight, ArrowLeft, Globe,
  CalendarDays, Upload, CheckCircle2, AlertCircle, Camera,
  MapPin, Calendar as CalendarIcon, ExternalLink, XCircle, Edit,
  CreditCard, Building2, Copy, Check as CheckIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { getEventTypes, getProfile, addBooking, getBookings, getSettings, isSlotBooked, updateBooking } from "@/lib/storage";
import { syncBookingToCalendar, createBookingCheckout, getStripeStatus, sendBookingConfirmationEmail, getGoogleBusyTimes } from "@/lib/api";
import type { EventType, QuestionField } from "@/lib/types";
import { RichTextDisplay } from "@/components/RichTextEditor";

function sendBookingEmail(payload: Parameters<typeof sendBookingConfirmationEmail>[0]) {
  // Non-fatal — email failure should never break the booking flow
  sendBookingConfirmationEmail(payload).catch(() => {});
}

type Step = "event-select" | "datetime" | "questions" | "payment" | "confirmed";

function formatDuration(mins: number) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function generateTimeSlots(startTime: string, endTime: string, duration: number): string[] {
  const slots: string[] = [];
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  // Step by the booking duration — no gaps, no overlaps
  for (let m = startMins; m + duration <= endMins; m += duration) {
    const hh = Math.floor(m / 60).toString().padStart(2, "0");
    const mm = (m % 60).toString().padStart(2, "0");
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

/** Check if a slot overlaps with a Google Calendar busy period */
function isSlotBusyOnGoogle(
  time: string, duration: number,
  busyPeriods: { start: string; end: string }[]
): boolean {
  const [h, m] = time.split(":").map(Number);
  const slotStart = h * 60 + m;
  const slotEnd   = slotStart + duration;
  for (const b of busyPeriods) {
    const bs = new Date(b.start);
    const be = new Date(b.end);
    const bStartMins = bs.getHours() * 60 + bs.getMinutes();
    const bEndMins   = be.getHours() * 60 + be.getMinutes();
    if (slotStart < bEndMins && slotEnd > bStartMins) return true;
  }
  return false;
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

function buildGoogleCalendarUrl(event: EventType, date: Date, time: string, duration: number): string {
  const [h, m] = time.split(":").map(Number);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
  const end = new Date(start.getTime() + duration * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: event.description || "",
    location: event.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ─── Question Field Renderer ─────────────────────────────────
function QuestionInput({ field, value, onChange }: { field: QuestionField; value: string; onChange: (val: string) => void }) {
  switch (field.type) {
    case "text":
      return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body" />;
    case "textarea":
      return <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body min-h-[80px]" />;
    case "instagram":
      return (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-body text-sm">@</span>
          <Input value={value.replace(/^@/, "")} onChange={(e) => onChange(e.target.value.replace(/^@/, ""))} placeholder="yourusername" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body pl-7" />
        </div>
      );
    case "select":
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-secondary border border-border text-foreground font-body text-sm rounded-md px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="">Select an option...</option>
          {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case "boolean":
      return (
        <div className="flex gap-3">
          {["Yes", "No"].map((opt) => (
            <button key={opt} onClick={() => onChange(opt)} className={`flex-1 py-2.5 px-4 rounded-md border text-sm font-body transition-all ${value === opt ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
              {opt}
            </button>
          ))}
        </div>
      );
    case "image-upload":
      return (
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/30 transition-colors cursor-pointer relative">
          <Upload className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-xs font-body text-muted-foreground">{value ? "File selected" : "Click to upload or drag and drop"}</p>
          <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => { const file = e.target.files?.[0]; if (file) onChange(file.name); }} />
        </div>
      );
    default:
      return null;
  }
}

// ─── Timer Component ─────────────────────────────────────
function BookingTimer({ minutes, onExpire }: { minutes: number; onExpire: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(minutes * 60);
  
  useEffect(() => {
    if (secondsLeft <= 0) { onExpire(); return; }
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, onExpire]);

  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const isLow = secondsLeft < 120;

  return (
    <div className={`text-xs font-body tabular-nums ${isLow ? "text-destructive" : "text-muted-foreground"}`}>
      ⏱ {m}:{s.toString().padStart(2, "0")} remaining
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────
export default function Booking() {
  const profile = getProfile();
  const eventTypes = getEventTypes().filter((e) => e.active);
  const settings = getSettings();

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
  const [gcalBusy, setGcalBusy] = useState<{ start: string; end: string }[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(restoredDate);
  const [selectedTime, setSelectedTime] = useState<string | null>(restoredBooking?.time || null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth());
  });
  const [answers, setAnswers] = useState<Record<string, string>>(restoredBooking?.answers || {});
  const [use24h, setUse24h] = useState(false);
  const [timerActive, setTimerActive] = useState(false);
  const [lastBookingId, setLastBookingId] = useState<string | null>(restoredBookingId);
  const [showBankDeposit, setShowBankDeposit] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [payFullInstead, setPayFullInstead] = useState(false);

  // Check Stripe availability on mount
  useEffect(() => {
    getStripeStatus().then(s => setStripeAvailable(s.configured));
  }, []);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-start calendar
  const firstDay = new Date(year, month, 1).getDay();
  const blanks = Array.from({ length: (firstDay + 6) % 7 }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Fetch Google Calendar busy times whenever date changes
  useEffect(() => {
    if (!selectedDate) { setGcalBusy([]); return; }
    getGoogleBusyTimes(toDateStr(selectedDate)).then(setGcalBusy).catch(() => setGcalBusy([]));
  }, [selectedDate]);

  const timeSlots = useMemo(() => {
    if (!selectedDate || !selectedDuration || !selectedEvent) return [];
    const dateStr = toDateStr(selectedDate);
    const ranges = getAvailabilityForDate(selectedEvent, selectedDate);
    const allSlots: string[] = [];
    for (const range of ranges) {
      const slots = generateTimeSlots(range.startTime, range.endTime, selectedDuration);
      for (const slot of slots) {
        // Filter out already-booked slots and Google Calendar busy periods
        if (!isSlotBooked(dateStr, slot, selectedDuration) &&
            !isSlotBusyOnGoogle(slot, selectedDuration, gcalBusy)) {
          allSlots.push(slot);
        }
      }
    }
    return allSlots;
  }, [selectedDate, selectedDuration, selectedEvent, gcalBusy]);

  const handleSelectEvent = (ev: EventType) => {
    setSelectedEvent(ev);
    setSelectedDate(null);
    setSelectedTime(null);
    setAnswers({});
    setSelectedDuration(ev.durations[0]);
    setStep("datetime");
  };

  const handleTimerExpire = useCallback(() => {
    toast.error("Booking timer expired. Please select a new time.");
    setSelectedTime(null);
    setTimerActive(false);
  }, []);

  const handleSelectTime = (time: string) => {
    setSelectedTime(time);
    setTimerActive(true);
  };

  const handleSubmitQuestions = () => {
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration) return;
    
    // Validate email field
    const emailQuestion = selectedEvent.questions.find(q => q.label.toLowerCase().includes("email"));
    if (emailQuestion) {
      const emailValue = answers[emailQuestion.id] || "";
      if (!emailValue.includes("@") || !emailValue.includes(".")) {
        toast.error("Please enter a valid email address");
        return;
      }
    }

    const missing = selectedEvent.questions.filter((q) => q.required && !answers[q.id]?.trim());
    if (missing.length > 0) {
      toast.error(`Please fill in: ${missing.map((q) => q.label).join(", ")}`);
      return;
    }

    // Double-check slot isn't taken
    const dateStr = toDateStr(selectedDate);
    if (isSlotBooked(dateStr, selectedTime, selectedDuration)) {
      toast.error("This time slot was just booked by someone else. Please choose another.");
      setSelectedTime(null);
      return;
    }

    // Proceed to payment step (skip if free)
    if (selectedEvent.price === 0) {
      handleCompletePaymentFree();
    } else {
      setStep("payment");
    }
  };

  const buildBookingRecord = (paymentMethod: "stripe" | "bank" | "none") => {
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration) return null;
    const modifyToken = `mod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const depositEnabled = selectedEvent.depositEnabled && selectedEvent.depositAmount && selectedEvent.depositAmount > 0;
    const depositAmt = depositEnabled
      ? selectedEvent.depositType === "percentage"
        ? Math.round((getPriceForDuration(selectedEvent, selectedDuration!) * (selectedEvent.depositAmount || 0)) / 100)
        : (selectedEvent.depositAmount || 0)
      : 0;
    const totalPrice = getPriceForDuration(selectedEvent, selectedDuration!);
    // If user chose pay-in-full, skip deposit logic
    const skipDeposit = payFullInstead && depositEnabled;
    const dateStr = toDateStr(selectedDate);
    return {
      id: `bk-${Date.now()}`,
      clientName: answers["q1"] || "Client",
      clientEmail: answers["q2"] || "",
      date: dateStr,
      time: selectedTime,
      eventTypeId: selectedEvent.id,
      type: selectedEvent.title,
      duration: selectedDuration,
      status: selectedEvent.requiresConfirmation ? "pending" as const : "confirmed" as const,
      notes: "",
      answers,
      createdAt: new Date().toISOString(),
      paymentStatus: paymentMethod === "bank" ? "pending-confirmation" as const : paymentMethod === "none" ? "unpaid" as const : "unpaid" as const,
      paymentAmount: totalPrice,
      instagramHandle: answers[selectedEvent.questions.find(q => q.type === "instagram" || q.label.toLowerCase().includes("instagram"))?.id || ""] || "",
      modifyToken,
      depositRequired: skipDeposit ? false : (depositEnabled || false),
      depositAmount: skipDeposit ? 0 : depositAmt,
      depositMethod: paymentMethod === "none" ? undefined : paymentMethod,
    };
  };

  const handleCompletePaymentFree = () => {
    if (!selectedEvent) return;
    const booking = buildBookingRecord("none");
    if (!booking) return;
    addBooking(booking);
    syncBookingToCalendar(booking).catch(() => {});
    if (booking.clientEmail) {
      sendBookingEmail({
        to: booking.clientEmail,
        clientName: booking.clientName,
        eventTitle: selectedEvent.title,
        date: booking.date,
        time: booking.time,
        duration: booking.duration,
        location: selectedEvent.location,
        price: 0,
        paymentMethod: "none",
        modifyToken: booking.modifyToken,
        bookingId: booking.id,
      });
    }
    localStorage.setItem("lastBookingId", booking.id);
    setLastBookingId(booking.id);
    setTimerActive(false);
    setStep("confirmed");
  };

  const handleCompletePayment = (paymentMethod: "stripe" | "bank" | "none") => {
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration) return;
    const booking = buildBookingRecord(paymentMethod);
    if (!booking) return;
    addBooking(booking);
    syncBookingToCalendar(booking).catch(() => {});
    if (booking.clientEmail) {
      sendBookingEmail({
        to: booking.clientEmail,
        clientName: booking.clientName,
        eventTitle: selectedEvent.title,
        date: booking.date,
        time: booking.time,
        duration: booking.duration,
        location: selectedEvent.location,
        price: getPriceForDuration(selectedEvent, booking.duration),
        depositAmount: booking.depositAmount,
        paymentMethod,
        modifyToken: booking.modifyToken,
        bookingId: booking.id,
      });
    }
    localStorage.setItem("lastBookingId", booking.id);
    setLastBookingId(booking.id);
    setTimerActive(false);
    setStep("confirmed");
  };

  const handleReset = () => {
    localStorage.removeItem("lastBookingId");
    setStep("event-select");
    setSelectedEvent(null);
    setSelectedDuration(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setAnswers({});
    setTimerActive(false);
    setLastBookingId(null);
    setShowBankDeposit(false);
    setProcessingPayment(false);
    setPayFullInstead(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <section className="pt-8 pb-24 min-h-screen">
        <div className="container mx-auto px-4">
          <AnimatePresence mode="wait">

            {/* ─── Step 1: Event List ─── */}
            {step === "event-select" && (
              <motion.div key="event-select" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-2xl mx-auto">
                {/* Profile Card */}
                <div className="glass-panel rounded-xl p-6 mb-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                      {profile.avatar ? (
                        <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <Camera className="w-6 h-6 text-primary" />
                      )}
                    </div>
                  </div>
                  <h1 className="font-display text-2xl text-foreground">{profile.name}</h1>
                  {profile.bio && (
                    <RichTextDisplay html={profile.bio} className="mt-1" />
                  )}
                </div>

                {eventTypes.length === 0 ? (
                  <div className="glass-panel rounded-xl p-12 text-center">
                    <CalendarDays className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm font-body text-muted-foreground">No event types available yet.</p>
                  </div>
                ) : (
                  <div className="glass-panel rounded-xl divide-y divide-border/50">
                    {eventTypes.map((ev) => (
                      <button key={ev.id} onClick={() => handleSelectEvent(ev)} className="w-full text-left p-5 hover:bg-secondary/30 transition-colors first:rounded-t-xl last:rounded-b-xl">
                        <div className="flex items-start gap-3">
                          <div className="w-1.5 h-10 rounded-full bg-primary mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <h3 className="font-display text-base text-foreground mb-1">{ev.title}</h3>
                            {ev.description && <RichTextDisplay html={ev.description} className="mb-3 max-h-24 overflow-y-auto" />}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-xs font-body text-muted-foreground border border-border rounded-full px-2.5 py-1">
                                <Clock className="w-3 h-3" />
                                {ev.durations.map((d) => formatDuration(d)).join(" / ")}
                              </span>
                              {ev.price > 0 && (
                                <span className="text-xs font-body text-primary">
                                  {ev.prices && Object.keys(ev.prices).length > 0
                                    ? ev.durations.map(d => `${formatDuration(d)}: $${ev.prices![d] ?? ev.price}`).join(" · ")
                                    : `$${ev.price}`}
                                </span>
                              )}
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
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-center gap-2 mt-6 text-xs font-body text-muted-foreground/50">
                  <Globe className="w-3.5 h-3.5" />
                  <span>{profile.timezone}</span>
                </div>
              </motion.div>
            )}

            {/* ─── Date & Time (Cal.com Style) ─── */}
            {step === "datetime" && selectedEvent && selectedDuration && (
              <motion.div key="datetime" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <div className="max-w-[1100px] mx-auto">
                  <button onClick={handleReset} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-4">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>

                  <div className="glass-panel rounded-xl overflow-hidden">
                    <div className="grid lg:grid-cols-[320px_1fr_240px] divide-y lg:divide-y-0 lg:divide-x divide-border/50">
                      
                      {/* Left: Event Info */}
                      <div className="p-6 space-y-4">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {profile.avatar ? (
                              <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Camera className="w-5 h-5 text-primary" />
                            )}
                          </div>
                          <span className="text-xs font-body text-muted-foreground">{profile.name}</span>
                        </div>
                        <h2 className="font-display text-xl text-foreground">{selectedEvent.title}</h2>
                        {selectedEvent.description && (
                          <div className="text-sm font-body text-muted-foreground leading-relaxed max-h-48 overflow-y-auto pr-1">
                            <RichTextDisplay html={selectedEvent.description} />
                          </div>
                        )}
                        
                        {selectedEvent.requiresConfirmation && (
                          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Requires confirmation
                          </div>
                        )}

                        {/* Duration Selector */}
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          <div className="flex rounded-full border border-border overflow-hidden">
                            {selectedEvent.durations.map((d) => {
                              const dPrice = getPriceForDuration(selectedEvent, d);
                              return (
                                <button key={d} onClick={() => { setSelectedDuration(d); setSelectedTime(null); }}
                                  className={`px-4 py-2 text-xs font-body transition-all flex flex-col items-center ${
                                    selectedDuration === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
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

                        <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                          <Globe className="w-3.5 h-3.5" /> {profile.timezone}
                        </div>
                      </div>

                      {/* Center: Calendar */}
                      <div className="p-6">
                        <div className="flex items-center justify-between mb-5">
                          <h3 className="font-display text-base text-foreground">
                            <span className="text-primary">{currentMonth.toLocaleDateString("en-US", { month: "long" })}</span>{" "}
                            {year}
                          </h3>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setCurrentMonth(new Date(year, month - 1))} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary">
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button onClick={() => setCurrentMonth(new Date(year, month + 1))} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary">
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
                            const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
                            const isAvailable = !isPast && isDayAvailable(selectedEvent, date);
                            const isToday = toDateStr(date) === toDateStr(new Date());
                            return (
                              <button key={day} disabled={!isAvailable} onClick={() => { setSelectedDate(date); setSelectedTime(null); setTimerActive(false); }}
                                className={`aspect-square rounded-lg text-sm font-body transition-all relative ${
                                  isSelected ? "bg-primary text-primary-foreground font-medium ring-2 ring-primary ring-offset-2 ring-offset-background"
                                    : isAvailable ? "text-foreground hover:bg-secondary"
                                    : "text-muted-foreground/20 cursor-not-allowed"
                                }`}
                              >
                                {day}
                                {isToday && !isSelected && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right: Time Slots */}
                      <div className="p-4">
                        {selectedDate ? (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-sm font-body font-medium text-foreground">
                                {selectedDate.toLocaleDateString("en-US", { weekday: "short" })}{" "}
                                {selectedDate.getDate()}
                              </p>
                              <div className="flex rounded-md border border-border overflow-hidden">
                                <button onClick={() => setUse24h(false)} className={`px-2 py-0.5 text-[10px] font-body ${!use24h ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>12h</button>
                                <button onClick={() => setUse24h(true)} className={`px-2 py-0.5 text-[10px] font-body ${use24h ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>24h</button>
                              </div>
                            </div>
                            
                            {timerActive && selectedTime && (
                              <div className="mb-2">
                                <BookingTimer minutes={settings.bookingTimerMinutes} onExpire={handleTimerExpire} />
                              </div>
                            )}
                            
                            <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                              {timeSlots.length > 0 ? (
                                timeSlots.map((t) => (
                                  <button key={t} onClick={() => handleSelectTime(t)}
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
                                <p className="text-sm font-body text-muted-foreground/50 text-center py-8">No slots available</p>
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
                          <div className="text-center py-12">
                            <CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                            <p className="text-xs font-body text-muted-foreground/50">Select a date</p>
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

                {timerActive && (
                  <div className="glass-panel rounded-lg p-3 mb-4 flex items-center justify-center">
                    <BookingTimer minutes={settings.bookingTimerMinutes} onExpire={handleTimerExpire} />
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
                  {selectedEvent.questions.map((q) => (
                    <div key={q.id}>
                      <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 block">
                        {q.label} {q.required && <span className="text-destructive">*</span>}
                      </label>
                      <QuestionInput field={q} value={answers[q.id] || ""} onChange={(val) => setAnswers((prev) => ({ ...prev, [q.id]: val }))} />
                    </div>
                  ))}
                </div>

                <Button onClick={handleSubmitQuestions} size="lg" className="w-full mt-6 bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs py-6">
                  Continue to Payment
                </Button>
                <p className="text-center text-[10px] font-body text-muted-foreground/40 mt-4">By booking, you agree to our terms and conditions.</p>
              </motion.div>
            )}

            {/* ─── Payment Step ─── */}
            {step === "payment" && selectedEvent && selectedDate && selectedTime && selectedDuration && (() => {
              const depositEnabled = selectedEvent.depositEnabled && selectedEvent.depositAmount && selectedEvent.depositAmount > 0;
              const totalPrice = getPriceForDuration(selectedEvent, selectedDuration!);
              const depositAmt = depositEnabled
                ? selectedEvent.depositType === "percentage"
                  ? Math.round((totalPrice * (selectedEvent.depositAmount || 0)) / 100)
                  : (selectedEvent.depositAmount || 0)
                : 0;

              // Check if deposit was already paid for this event (returning to pay remaining)
              const existingBooking = lastBookingId ? getBookings().find(b => b.id === lastBookingId) : null;
              const depositAlreadyPaid = !!(existingBooking?.depositPaidAt);

              // If user chose to pay full, or deposit already paid, or no deposit — determine amount
              const wantsPayFull = payFullInstead && depositEnabled && !depositAlreadyPaid;
              const amountDue = depositAlreadyPaid
                ? Math.max(0, totalPrice - depositAmt)
                : wantsPayFull
                ? totalPrice
                : depositEnabled ? depositAmt : totalPrice;

              const paymentLabel = depositAlreadyPaid
                ? "Pay Remaining Balance"
                : wantsPayFull
                ? "Full Payment"
                : depositEnabled ? "Deposit Required" : "Full Payment Required";
              const depositMethods = selectedEvent.depositMethods || [];
              const bankTransfer = settings.bankTransfer;

              const handleStripePayment = async () => {
                setProcessingPayment(true);
                let bookingId: string;
                let modifyToken: string;
                let clientName: string;
                let clientEmail: string;

                if (existingBooking && depositAlreadyPaid) {
                  // Paying remaining on existing booking
                  bookingId = existingBooking.id;
                  modifyToken = existingBooking.modifyToken;
                  clientName = existingBooking.clientName;
                  clientEmail = existingBooking.clientEmail;
                } else {
                  // New booking — create record before redirecting to Stripe
                  const newBooking = buildBookingRecord("stripe");
                  if (!newBooking) { setProcessingPayment(false); return; }
                  addBooking(newBooking);
                  syncBookingToCalendar(newBooking).catch(() => {});
                  localStorage.setItem("lastBookingId", newBooking.id);
                  setLastBookingId(newBooking.id);
                  bookingId = newBooking.id;
                  modifyToken = newBooking.modifyToken;
                  clientName = newBooking.clientName;
                  clientEmail = newBooking.clientEmail;
                }

                const result = await createBookingCheckout({
                  bookingId,
                  clientName,
                  clientEmail,
                  amount: amountDue,
                  eventTitle: selectedEvent.title,
                });
                setProcessingPayment(false);
                if (result.url) {
                  window.location.href = result.url;
                } else {
                  toast.error(result.error || "Failed to create checkout session");
                }
              };

              return (
                <motion.div key="payment" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-md mx-auto">
                  <button onClick={() => setStep("questions")} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-6">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>

                  {timerActive && (
                    <div className="glass-panel rounded-lg p-3 mb-4 flex items-center justify-center">
                      <BookingTimer minutes={settings.bookingTimerMinutes} onExpire={handleTimerExpire} />
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
                        {depositAlreadyPaid
                          ? `Deposit paid. Remaining balance of $${amountDue} is due.`
                          : wantsPayFull
                          ? `Full payment of $${totalPrice} to confirm your booking.`
                          : depositEnabled
                          ? `A $${depositAmt} deposit is required to secure your booking. Remaining $${Math.max(0, totalPrice - depositAmt)} due on the day.`
                          : `Full payment of $${amountDue} is required to confirm your booking.`}
                      </p>
                    </div>

                    {/* Pay full vs deposit toggle */}
                    {depositEnabled && !depositAlreadyPaid && totalPrice > depositAmt && (
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

                    <div className="flex justify-between items-center border border-border/50 rounded-lg p-4 bg-secondary/30">
                      <span className="text-sm font-body text-muted-foreground">
                        {depositAlreadyPaid ? "Remaining Balance" : wantsPayFull ? "Total" : depositEnabled ? "Deposit" : "Total"}
                      </span>
                      <span className="font-display text-xl text-foreground">${amountDue}</span>
                    </div>

                    <div className="space-y-3">
                      {/* Stripe */}
                      {(!depositEnabled || depositMethods.includes("stripe")) && stripeAvailable && (
                        <Button
                          onClick={handleStripePayment}
                          disabled={processingPayment}
                          className="w-full gap-3 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-sm h-12"
                        >
                          <CreditCard className="w-5 h-5" />
                          {processingPayment ? "Redirecting…" : `Pay $${amountDue} with Card`}
                        </Button>
                      )}

                      {/* Bank Transfer */}
                      {(!depositEnabled || depositMethods.includes("bank")) && bankTransfer.enabled && (
                        <>
                          <Button
                            onClick={() => setShowBankDeposit(!showBankDeposit)}
                            variant="outline"
                            className="w-full gap-3 border-border text-foreground hover:bg-secondary font-body text-sm h-12"
                          >
                            <Building2 className="w-5 h-5" />
                            Bank Transfer / PayID
                          </Button>

                          {showBankDeposit && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-3">
                              {bankTransfer.accountName && (
                                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                                  <div>
                                    <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Account Name</p>
                                    <p className="text-sm font-body text-foreground font-medium">{bankTransfer.accountName}</p>
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => { navigator.clipboard.writeText(bankTransfer.accountName); setCopiedField("name"); setTimeout(() => setCopiedField(null), 2000); }}>
                                    {copiedField === "name" ? <CheckIcon className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                                  </Button>
                                </div>
                              )}
                              {bankTransfer.bsb && (
                                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                                  <div>
                                    <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">BSB</p>
                                    <p className="text-sm font-body text-foreground font-medium">{bankTransfer.bsb}</p>
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => { navigator.clipboard.writeText(bankTransfer.bsb); setCopiedField("bsb"); setTimeout(() => setCopiedField(null), 2000); }}>
                                    {copiedField === "bsb" ? <CheckIcon className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                                  </Button>
                                </div>
                              )}
                              {bankTransfer.accountNumber && (
                                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                                  <div>
                                    <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Account Number</p>
                                    <p className="text-sm font-body text-foreground font-medium">{bankTransfer.accountNumber}</p>
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => { navigator.clipboard.writeText(bankTransfer.accountNumber); setCopiedField("acc"); setTimeout(() => setCopiedField(null), 2000); }}>
                                    {copiedField === "acc" ? <CheckIcon className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                                  </Button>
                                </div>
                              )}
                              {bankTransfer.payId && (
                                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                                  <div>
                                    <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">PayID ({bankTransfer.payIdType})</p>
                                    <p className="text-sm font-body text-foreground font-medium">{bankTransfer.payId}</p>
                                  </div>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => { navigator.clipboard.writeText(bankTransfer.payId); setCopiedField("payid"); setTimeout(() => setCopiedField(null), 2000); }}>
                                    {copiedField === "payid" ? <CheckIcon className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                                  </Button>
                                </div>
                              )}
                              {bankTransfer.instructions && (
                                <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                                  <p className="text-xs font-body text-muted-foreground">{bankTransfer.instructions}</p>
                                </div>
                              )}
                              <Button
                                onClick={() => handleCompletePayment("bank")}
                                className="w-full bg-green-600/90 text-white hover:bg-green-600 font-body text-xs tracking-wider uppercase h-11"
                              >
                                I've Sent the Transfer — Submit Booking
                              </Button>
                              <p className="text-[10px] font-body text-muted-foreground text-center">
                                Your booking will be held pending payment confirmation by the admin.
                              </p>
                            </motion.div>
                          )}
                        </>
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
              const depositEnabled = selectedEvent.depositEnabled && selectedEvent.depositAmount && selectedEvent.depositAmount > 0;
              const depositAmt = depositEnabled
                ? selectedEvent.depositType === "percentage"
                  ? Math.round((getPriceForDuration(selectedEvent, selectedDuration!) * (selectedEvent.depositAmount || 0)) / 100)
                  : (selectedEvent.depositAmount || 0)
                : 0;
              const wasBankTransfer = lastBooking?.depositMethod === "bank" || lastBooking?.paymentStatus === "pending-confirmation";

              return (
              <motion.div key="confirmed" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md mx-auto text-center">
                <div className="glass-panel rounded-xl p-8">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
                  <h2 className="font-display text-2xl text-foreground mb-2">
                    {selectedEvent.requiresConfirmation ? "Booking Request Sent!" : "Booking Confirmed!"}
                  </h2>
                  <p className="text-sm font-body text-muted-foreground mb-6">
                    {wasBankTransfer
                      ? "Your booking is held pending payment confirmation."
                      : selectedEvent.requiresConfirmation
                      ? "You'll receive a confirmation once approved."
                      : "You're all set!"}
                  </p>
                  <div className="border-t border-border/50 pt-4 space-y-2 text-left">
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Event</span><span className="text-foreground">{selectedEvent.title}</span></div>
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Duration</span><span className="text-foreground">{formatDuration(selectedDuration)}</span></div>
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Date</span><span className="text-foreground">{selectedDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span></div>
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Time</span><span className="text-primary font-medium">{formatTime12(selectedTime)}</span></div>
                    {depositEnabled && (
                      <div className="flex justify-between text-sm font-body">
                        <span className="text-muted-foreground">Deposit</span>
                        <span className={`font-medium ${wasBankTransfer ? "text-yellow-400" : "text-green-400"}`}>
                          ${depositAmt} {wasBankTransfer ? "· Pending confirmation" : "· Paid"}
                        </span>
                      </div>
                    )}
                    {!depositEnabled && (
                      <div className="flex justify-between text-sm font-body">
                        <span className="text-muted-foreground">Payment</span>
                        <span className={`font-medium ${wasBankTransfer ? "text-yellow-400" : "text-green-400"}`}>
                          ${getPriceForDuration(selectedEvent, lastBooking?.duration || selectedDuration!)} {wasBankTransfer ? "· Pending confirmation" : "· Paid"}
                        </span>
                      </div>
                    )}
                  </div>

                  {wasBankTransfer && (
                    <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-left">
                      <p className="text-xs font-body text-yellow-400">
                        Once your bank transfer is received, the admin will confirm your booking. You'll be notified by email.
                      </p>
                    </div>
                  )}

                  {/* Pay remaining balance button (deposit was paid, balance still owed) */}
                  {depositEnabled && !wasBankTransfer && lastBooking?.depositPaidAt && (getPriceForDuration(selectedEvent, lastBooking?.duration || selectedDuration!) - depositAmt) > 0 && (
                    <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
                      <p className="text-xs font-body text-muted-foreground mb-3">
                        Deposit paid. Remaining balance due on the day:
                      </p>
                      <Button
                        onClick={() => setStep("payment")}
                        className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase h-10"
                      >
                        Pay Remaining ${getPriceForDuration(selectedEvent, lastBooking?.duration || selectedDuration!) - depositAmt}
                      </Button>
                    </div>
                  )}
                  
                  <div className="flex flex-col gap-3 mt-6">
                    <a href={buildGoogleCalendarUrl(selectedEvent, selectedDate, selectedTime, selectedDuration)} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" className="w-full font-body text-xs tracking-wider uppercase border-border text-foreground gap-2">
                        <CalendarIcon className="w-4 h-4" /> Add to Google Calendar
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </a>
                    {modifyUrl && (
                      <a href={modifyUrl}>
                        <Button variant="outline" className="w-full font-body text-xs tracking-wider uppercase border-border text-foreground gap-2">
                          <Edit className="w-4 h-4" /> Modify Booking
                        </Button>
                      </a>
                    )}
                    {lastBooking && lastBooking.status !== "cancelled" && (
                      <Button variant="outline" onClick={() => {
                        if (!confirm("Are you sure you want to cancel this booking?")) return;
                        updateBooking({ ...lastBooking, status: "cancelled" });
                        toast.success("Booking cancelled");
                        handleReset();
                      }} className="w-full font-body text-xs tracking-wider uppercase border-destructive text-destructive hover:bg-destructive/10 gap-2">
                        <XCircle className="w-4 h-4" /> Cancel Booking
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

          </AnimatePresence>
        </div>
      </section>
      <Footer />
    </div>
  );
}
