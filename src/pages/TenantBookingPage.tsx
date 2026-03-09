import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Camera, Clock, DollarSign, CheckCircle2,
  ChevronLeft, ChevronRight, Globe, MapPin, Calendar as CalendarIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { getTenantPublicData, createTenantBooking } from "@/lib/api";
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

type Step = "event-select" | "datetime" | "contact" | "confirmed";

// ── Main Component ────────────────────────────────────────────────────────────
export default function TenantBookingPage({ overrideSlug }: { overrideSlug?: string }) {
  const { tenantSlug: paramSlug } = useParams<{ tenantSlug: string }>();
  const tenantSlug = overrideSlug || paramSlug;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);

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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!tenantSlug) { setNotFound(true); setLoading(false); return; }
    getTenantPublicData(tenantSlug).then((data) => {
      if (!data) { setNotFound(true); } else { setTenant(data.tenant); setEventTypes(data.eventTypes); }
      setLoading(false);
    });
  }, [tenantSlug]);

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

  const handleSelectEvent = (et: EventType) => {
    setSelectedEvent(et);
    setSelectedDuration(et.durations[0] ?? 60);
    setSelectedDate(null);
    setSelectedTime(null);
    setStep("datetime");
  };

  const handleSelectTime = (t: string) => {
    setSelectedTime(t);
    setStep("contact");
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Please enter your name"); return; }
    if (!isValidEmail(email)) { toast.error("Please enter a valid email"); return; }
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration) {
      toast.error("Please complete the date/time selection"); return;
    }
    setSubmitting(true);
    const result = await createTenantBooking(tenantSlug!, {
      clientName: name.trim(),
      clientEmail: email.trim(),
      date: toDateStr(selectedDate),
      time: selectedTime,
      eventTypeId: selectedEvent.id,
      type: selectedEvent.title,
      duration: selectedDuration,
      notes: notes.trim(),
    });
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error || "Booking failed"); return; }
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
          <Button variant="outline" onClick={() => navigate("/")} className="font-body text-xs gap-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to main
          </Button>
        </div>
      </div>
    );
  }

  return (    <div className="min-h-screen bg-background flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Header */}
      <header className="border-b border-border/50 py-4 px-6 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => window.history.state?.idx > 0 ? navigate(-1) : navigate("/")} className="font-body text-xs text-muted-foreground gap-1.5 p-0 h-auto hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Button>
        <div className="flex items-center gap-3 ml-2">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden shrink-0">
            <Camera className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-display text-sm text-foreground leading-tight">{tenant.displayName}</p>
            {tenant.bio && <p className="text-xs font-body text-muted-foreground leading-tight truncate max-w-xs">{stripHtml(tenant.bio)}</p>}
          </div>
        </div>
      </header>

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
              {eventTypes.length === 0 ? (
                <div className="glass-panel rounded-xl p-10 text-center">
                  <CalendarIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-sm font-body text-muted-foreground">No sessions available right now.</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {eventTypes.map((et) => (
                    <button
                      key={et.id}
                      onClick={() => handleSelectEvent(et)}
                      className="glass-panel rounded-xl p-5 text-left hover:border-primary/40 hover:bg-primary/5 transition-all group"
                    >
                      <h3 className="font-display text-base text-foreground group-hover:text-primary transition-colors">{et.title}</h3>
                      {et.description && <p className="text-xs font-body text-muted-foreground mt-1.5 line-clamp-2">{et.description}</p>}
                      <div className="flex flex-wrap items-center gap-3 mt-3">
                        <span className="flex items-center gap-1 text-xs font-body text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {et.durations.map(formatDuration).join(" / ")}
                        </span>
                        {(et.price ?? 0) > 0 && (
                          <span className="flex items-center gap-1 text-xs font-body text-primary">
                            <DollarSign className="w-3 h-3" />
                            {getPriceForDuration(et, et.durations[0])} {et.requiresConfirmation ? "" : ""}
                          </span>
                        )}
                        {et.location && (
                          <span className="flex items-center gap-1 text-xs font-body text-muted-foreground">
                            <MapPin className="w-3 h-3" /> {et.location}
                          </span>
                        )}
                        {et.requiresConfirmation && (
                          <span className="text-[10px] font-body bg-orange-500/10 text-orange-500 px-1.5 py-0.5 rounded-full">Requires confirmation</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Date & Time ── */}
          {step === "datetime" && selectedEvent && (
            <div key="datetime" className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-200">
              <button onClick={() => setStep("event-select")} className="flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="grid lg:grid-cols-[280px_1fr_200px] divide-y lg:divide-y-0 lg:divide-x divide-border/50">
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
                        <Globe className="w-3.5 h-3.5" /> {tenant.timezone}
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
                  <Button onClick={() => setStep("contact")} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
                    Continue
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Contact Info ── */}
          {step === "contact" && selectedEvent && selectedDate && selectedTime && (
            <div key="contact" className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-200">
              <button onClick={() => setStep("datetime")} className="flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors">
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
              </div>
              <Button variant="outline" onClick={() => { setStep("event-select"); setSelectedEvent(null); setSelectedDate(null); setSelectedTime(null); }} className="font-body text-xs gap-2">
                Book another session
              </Button>
            </div>
          )}

      </div>
      <Footer />
    </div>
  );
}
