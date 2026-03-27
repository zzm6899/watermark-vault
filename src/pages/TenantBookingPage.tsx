import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  ArrowLeft, Camera, Clock, DollarSign, CheckCircle2,
  ChevronLeft, ChevronRight, Globe, MapPin, Calendar as CalendarIcon,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { getTenantPublicData, createTenantBooking, createTenantEnquiry } from "@/lib/api";
import type { EventType, Tenant } from "@/lib/types";
import Footer from "@/components/Footer";
import { RichTextDisplay } from "@/components/RichTextEditor";

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
  const specific = (avail.specificDates || []).filter((s: any) => s.date === dateStr);
  if (specific.length > 0) return specific.map((s: any) => ({ startTime: s.startTime, endTime: s.endTime }));
  const dayOfWeek = date.getDay();
  return (avail.recurring || []).filter((s: any) => s.day === dayOfWeek).map((s: any) => ({ startTime: s.startTime, endTime: s.endTime }));
}
function isDayAvailable(et: EventType, date: Date) {
  return getAvailabilityForDate(et, date).length > 0;
}
function generateTimeSlots(startTime: string, endTime: string, duration: number): string[] {
  const slots: string[] = [];
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  for (let m = startMins; m + duration <= endMins; m += duration) {
    slots.push(`${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`);
  }
  return slots;
}
function getPriceForDuration(et: EventType, duration: number): number {
  if (et.prices && (et.prices as any)[duration] !== undefined) return (et.prices as any)[duration];
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

type Step = "event-select" | "datetime" | "contact" | "confirmed" | "enquiry" | "enquiry-confirmed";

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
  const [tenant, setTenant] = useState<Tenant | null>(null);
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
  const [submitting, setSubmitting] = useState(false);
  const [slotConflict, setSlotConflict] = useState(false);

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
    getTenantPublicData(tenantSlug).then((data) => {
      if (!data) { setNotFound(true); } else {
        setTenant(data.tenant);
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
    });
  }, [tenantSlug]);

  const tenantName = tenant?.displayName || "";
  const stepTitles: Record<Step, string> = {
    "event-select": tenantName ? `Book with ${tenantName}` : "Book a Session",
    "datetime": selectedEvent ? `${selectedEvent.title} — ${tenantName || "Booking"}` : `Choose a Date — ${tenantName || "Booking"}`,
    "contact": `Your Details — ${tenantName || "Booking"}`,
    "confirmed": `Booking Confirmed — ${tenantName || "Booking"}`,
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
    if (!selectedEvent || !selectedDate || !selectedDuration) return [];
    const windows = getAvailabilityForDate(selectedEvent, selectedDate);
    return windows.flatMap(w => generateTimeSlots(w.startTime, w.endTime, selectedDuration));
  }, [selectedEvent, selectedDate, selectedDuration]);

  const hasAvailabilityThisMonth = useMemo(() => {
    if (!selectedEvent) return false;
    const now = new Date(new Date().setHours(0, 0, 0, 0));
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      if (date >= now && isDayAvailable(selectedEvent, date)) return true;
    }
    return false;
  }, [selectedEvent, year, month, daysInMonth]);

  const handleNextAvailableMonth = () => {
    if (!selectedEvent) return;
    const now = new Date(new Date().setHours(0, 0, 0, 0));
    let searchYear = year;
    let searchMonth = month + 1;
    for (let i = 0; i < 24; i++) {
      if (searchMonth > 11) { searchMonth = 0; searchYear++; }
      const daysInSearch = new Date(searchYear, searchMonth + 1, 0).getDate();
      for (let d = 1; d <= daysInSearch; d++) {
        const date = new Date(searchYear, searchMonth, d);
        if (date >= now && isDayAvailable(selectedEvent, date)) {
          setCurrentMonth(new Date(searchYear, searchMonth));
          return;
        }
      }
      searchMonth++;
    }
  };

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const handleSelectEvent = (et: EventType) => {
    setSelectedEvent(et);
    setSelectedDuration(et.durations[0] ?? 60);
    setSelectedDate(null);
    setSelectedTime(null);
    setStep("datetime");
    scrollTop();
  };

  const handleSelectTime = (t: string) => {
    setSelectedTime(t);
    setStep("contact");
    scrollTop();
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
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration) {
      toast.error("Please complete the date/time selection"); return;
    }
    setSubmitting(true);
    setSlotConflict(false);
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
      cosplayCharacter: cosplayCharacter.trim() || undefined,
      cosplayCostume: cosplayCostume.trim() || undefined,
      conventionName: conventionName.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      // 409 = slot taken — send user back to pick another time
      if (result.statusCode === 409) {
        setSlotConflict(true);
        setSelectedTime(null);
        setStep("datetime");
        scrollTop();
        toast.error("That time slot was just taken — please pick another.");
        return;
      }
      toast.error(result.error || "Booking failed");
      return;
    }
    setStep("confirmed");
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

  return (    <div className="min-h-screen bg-background flex flex-col" style={brandStyle}>
      {/* Header */}
      <header className="border-b border-border/50 py-4 px-6 flex items-center gap-4">
        {hasHistory && (
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="font-body text-xs text-muted-foreground gap-1.5 p-0 h-auto hover:text-foreground">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Button>
        )}
        <div className="flex items-center gap-3 ml-2">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden shrink-0">
            {tenant.avatar
              ? <img src={tenant.avatar} alt={tenant.displayName} className="w-full h-full object-cover" />
              : <Camera className="w-4 h-4 text-primary" />}
          </div>
          <div>
            <p className="font-display text-sm text-foreground leading-tight">{tenant.displayName}</p>
            {tenant.bio && <p className="text-xs font-body text-muted-foreground leading-tight truncate max-w-xs">{stripHtml(tenant.bio)}</p>}
          </div>
        </div>
      </header>
      <TenantBookingSteps currentStep={step} />

      <div className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 lg:p-8">

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
                  {!enquiryEnabled && tenant.email && (
                    <a href={`mailto:${tenant.email}`} className="text-xs font-body text-primary hover:underline">
                      Contact {tenant.displayName} →
                    </a>
                  )}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {eventTypes.map((et) => {
                    const minPrice = et.durations.length > 0
                      ? Math.min(...et.durations.map(d => getPriceForDuration(et, d)))
                      : (et.price ?? 0);
                    const isExpanded = !!expandedDescriptions[et.id];
                    return (
                      <button
                        key={et.id}
                        onClick={() => handleSelectEvent(et)}
                        className="glass-panel rounded-xl p-5 text-left hover:border-amber-500 hover:shadow-lg transition-all cursor-pointer group"
                      >
                        <h3 className="font-display text-base text-foreground group-hover:text-primary transition-colors mb-2">{et.title}</h3>
                        {et.description && (
                          <div>
                            <div className={isExpanded ? "" : "line-clamp-4"}>
                              <RichTextDisplay html={et.description} className="text-xs font-body text-muted-foreground" />
                            </div>
                            <button
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
                          {(et.price ?? 0) > 0 && (
                            <span className="text-xs font-body text-primary bg-primary/10 rounded-full px-2 py-0.5 border border-primary/15">
                              from ${minPrice}
                            </span>
                          )}
                          {et.location && (
                            <span className="flex items-center gap-1 text-xs font-body text-muted-foreground border border-border/50 rounded-full px-2 py-0.5">
                              <MapPin className="w-3 h-3" /> {et.location}
                            </span>
                          )}
                          {et.requiresConfirmation && (
                            <span className="text-[10px] font-body bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-0.5 rounded-full">Requires confirmation</span>
                          )}
                        </div>
                        <div className="flex justify-end mt-3">
                          <span className="text-xs font-body bg-amber-500/10 text-amber-500 border border-amber-500/30 px-3 py-1 rounded-full">
                            Book →
                          </span>
                        </div>
                      </button>
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

              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="grid md:grid-cols-[220px_1fr_170px] lg:grid-cols-[280px_1fr_200px] divide-y md:divide-y-0 md:divide-x divide-border/50">
                  {/* Event info */}
                  <div className="p-6 space-y-4">
                    <h2 className="font-display text-lg text-foreground">{selectedEvent.title}</h2>
                    {selectedEvent.description && (
                      <p className="text-xs font-body text-muted-foreground line-clamp-3">{selectedEvent.description}</p>
                    )}
                    {/* Duration picker */}
                    {selectedEvent.durations.length > 1 && (
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <div className="flex rounded-full border border-border overflow-hidden">
                          {selectedEvent.durations.map(d => {
                            const p = getPriceForDuration(selectedEvent, d);
                            return (
                              <button
                                key={d}
                                onClick={() => { setSelectedDuration(d); setSelectedTime(null); }}
                                className={`px-3 py-1.5 text-xs font-body flex flex-col items-center transition-all ${selectedDuration === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
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
                    {tenant.timezone && (
                      <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                        <Globe className="w-3.5 h-3.5" /> {formatTimezone(tenant.timezone)}
                      </div>
                    )}
                  </div>

                  {/* Calendar */}
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="font-display text-base text-foreground">
                        <span className="text-primary">{currentMonth.toLocaleDateString("en-US", { month: "long" })}</span> {year}
                      </h3>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setCurrentMonth(new Date(year, month - 1))} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-secondary transition-colors">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button onClick={() => setCurrentMonth(new Date(year, month + 1))} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-secondary transition-colors">
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
                        const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
                        const isAvailable = !isPast && isDayAvailable(selectedEvent, date);
                        const isToday = toDateStr(date) === toDateStr(new Date());
                        return (
                          <button
                            key={day}
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
                  <div className="p-4">
                    {!selectedDate ? (
                      <p className="text-xs font-body text-muted-foreground text-center mt-8">Select a date to see available times</p>
                    ) : (
                      <div>
                        <p className="text-sm font-body font-medium text-foreground mb-3">
                          {selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </p>
                        {timeSlots.length === 0 ? (
                          <p className="text-xs font-body text-muted-foreground">No times available</p>
                        ) : (
                          <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                            {timeSlots.map(t => (
                              <button
                                key={t}
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
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Full Name *</label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Email *</label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Phone</label>
                  <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+61 400 000 000" className="bg-secondary border-border text-foreground font-body" />
                </div>
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
                <Button onClick={handleSubmit} disabled={submitting} className="w-full bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                  {submitting ? "Submitting…" : selectedEvent.requiresConfirmation ? "Request Booking" : "Confirm Booking"}
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
                  {selectedEvent?.requiresConfirmation ? "Request Received!" : "You're booked!"}
                </h2>
                <p className="text-sm font-body text-muted-foreground max-w-sm mx-auto">
                  {selectedEvent?.requiresConfirmation
                    ? `Your booking request has been sent to ${tenant.displayName}. You'll receive a confirmation email shortly.`
                    : `Your session with ${tenant.displayName} has been booked. A confirmation will be sent to ${email}.`}
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
                const [h, m] = selectedTime.split(":").map(Number);
                const startDt = new Date(selectedDate);
                startDt.setHours(h, m, 0, 0);
                const endDt = new Date(startDt.getTime() + (selectedDuration || 60) * 60000);
                const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
                const title = encodeURIComponent(`${selectedEvent.title} with ${tenant.displayName}`);
                const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(startDt)}/${fmt(endDt)}&details=${encodeURIComponent(`Booked via ${tenant.displayName}'s booking page`)}`;
                return (
                  <a
                    href={gcalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border/60 bg-secondary/40 hover:bg-secondary text-xs font-body text-muted-foreground hover:text-foreground transition-all"
                  >
                    <CalendarIcon className="w-3.5 h-3.5 text-primary" />
                    Add to Google Calendar
                  </a>
                );
              })()}

              {/* Bank transfer payment details */}
              {bankTransfer?.enabled && (
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
                </div>
              )}

              <Button variant="outline" onClick={() => { setStep("event-select"); setSelectedEvent(null); setSelectedDate(null); setSelectedTime(null); }} className="font-body text-xs gap-2">
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
      <Footer tenantName={tenant?.displayName} tenantEmail={tenant?.email} />
    </div>
  );
}
