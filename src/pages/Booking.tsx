import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock, ChevronLeft, ChevronRight, ArrowLeft, Globe,
  CalendarDays, Upload, CheckCircle2, AlertCircle, Camera
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { getEventTypes, getProfile, addBooking } from "@/lib/storage";
import type { EventType, QuestionField } from "@/lib/types";

type Step = "event-select" | "duration-select" | "datetime" | "questions" | "confirmed";

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
  for (let m = startMins; m + duration <= endMins; m += 15) {
    const hh = Math.floor(m / 60).toString().padStart(2, "0");
    const mm = (m % 60).toString().padStart(2, "0");
    slots.push(`${hh}:${mm}`);
  }
  return slots;
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
  if (et.availability.blockedDates.includes(dateStr)) return [];
  const specific = et.availability.specificDates.filter((s) => s.date === dateStr);
  if (specific.length > 0) return specific.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
  const dayOfWeek = date.getDay();
  const recurring = et.availability.recurring.filter((s) => s.day === dayOfWeek);
  return recurring.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
}

function isDayAvailable(et: EventType, date: Date): boolean {
  return getAvailabilityForDate(et, date).length > 0;
}

// ─── Question Field Renderer ─────────────────────────────────
function QuestionInput({ field, value, onChange }: { field: QuestionField; value: string; onChange: (val: string) => void }) {
  switch (field.type) {
    case "text":
      return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body" />;
    case "textarea":
      return <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body min-h-[80px]" />;
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

// ─── Main Component ──────────────────────────────────────────
export default function Booking() {
  const profile = getProfile();
  const eventTypes = getEventTypes().filter((e) => e.active);

  const [step, setStep] = useState<Step>("event-select");
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth());
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDayOfWeek }, (_, i) => i);

  const timeSlots = useMemo(() => {
    if (!selectedDate || !selectedDuration || !selectedEvent) return [];
    const ranges = getAvailabilityForDate(selectedEvent, selectedDate);
    const allSlots: string[] = [];
    for (const range of ranges) {
      allSlots.push(...generateTimeSlots(range.startTime, range.endTime, selectedDuration));
    }
    return allSlots;
  }, [selectedDate, selectedDuration, selectedEvent]);

  const handleSelectEvent = (ev: EventType) => {
    setSelectedEvent(ev);
    setSelectedDate(null);
    setSelectedTime(null);
    setAnswers({});
    if (ev.durations.length === 1) {
      setSelectedDuration(ev.durations[0]);
      setStep("datetime");
    } else {
      setSelectedDuration(null);
      setStep("duration-select");
    }
  };

  const handleSelectDuration = (dur: number) => {
    setSelectedDuration(dur);
    setSelectedDate(null);
    setSelectedTime(null);
    setStep("datetime");
  };

  const handleSubmitQuestions = () => {
    if (!selectedEvent || !selectedDate || !selectedTime || !selectedDuration) return;
    const missing = selectedEvent.questions.filter((q) => q.required && !answers[q.id]?.trim());
    if (missing.length > 0) {
      toast.error(`Please fill in: ${missing.map((q) => q.label).join(", ")}`);
      return;
    }
    // Save booking to localStorage
    const booking = {
      id: `bk-${Date.now()}`,
      clientName: answers["q1"] || "Client",
      clientEmail: answers["q2"] || "",
      date: toDateStr(selectedDate),
      time: selectedTime,
      eventTypeId: selectedEvent.id,
      type: selectedEvent.title,
      duration: selectedDuration,
      status: selectedEvent.requiresConfirmation ? "pending" as const : "confirmed" as const,
      notes: "",
      answers,
      createdAt: new Date().toISOString(),
    };
    addBooking(booking);
    setStep("confirmed");
  };

  const handleReset = () => {
    setStep("event-select");
    setSelectedEvent(null);
    setSelectedDuration(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setAnswers({});
  };

  return (
    <div className="min-h-screen bg-background">
      <section className="pt-12 pb-24 min-h-screen">
        <div className="container mx-auto px-4 max-w-3xl">
          <AnimatePresence mode="wait">

            {/* ─── Step 1: Event List ─── */}
            {step === "event-select" && (
              <motion.div key="event-select" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
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
                    <p className="text-sm font-body text-muted-foreground mt-1">{profile.bio}</p>
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
                        <h3 className="font-display text-base text-foreground mb-1">{ev.title}</h3>
                        {ev.description && <p className="text-sm font-body text-muted-foreground leading-relaxed mb-3">{ev.description}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          {ev.durations.map((d) => (
                            <span key={d} className="inline-flex items-center gap-1 text-xs font-body text-muted-foreground border border-border rounded-full px-2.5 py-1">
                              <Clock className="w-3 h-3" />{formatDuration(d)}
                            </span>
                          ))}
                          {ev.price > 0 && (
                            <span className="text-xs font-body text-primary">${ev.price}</span>
                          )}
                          {ev.requiresConfirmation && (
                            <span className="inline-flex items-center gap-1 text-xs font-body text-muted-foreground border border-border rounded-full px-2.5 py-1">
                              <AlertCircle className="w-3 h-3" />May require confirmation
                            </span>
                          )}
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

            {/* ─── Duration Select ─── */}
            {step === "duration-select" && selectedEvent && (
              <motion.div key="duration-select" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <button onClick={handleReset} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-6">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
                <div className="glass-panel rounded-xl p-6 mb-6">
                  <h2 className="font-display text-xl text-foreground mb-1">{selectedEvent.title}</h2>
                  {selectedEvent.description && <p className="text-sm font-body text-muted-foreground leading-relaxed">{selectedEvent.description}</p>}
                </div>
                <div className="glass-panel rounded-xl p-6">
                  <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-4">Select Duration</p>
                  <div className="space-y-2">
                    {selectedEvent.durations.map((d) => (
                      <button key={d} onClick={() => handleSelectDuration(d)} className="w-full text-left p-4 rounded-lg border border-border hover:border-primary/50 transition-all flex items-center gap-3">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-body text-foreground">{formatDuration(d)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ─── Date & Time ─── */}
            {step === "datetime" && selectedEvent && selectedDuration && (
              <motion.div key="datetime" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <button onClick={() => { selectedEvent.durations.length > 1 ? setStep("duration-select") : handleReset(); }} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-6">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>

                <div className="flex items-center gap-3 mb-6">
                  <div className="w-1.5 h-12 rounded-full bg-primary" />
                  <div>
                    <h2 className="font-display text-xl text-foreground">{selectedEvent.title}</h2>
                    <span className="text-sm font-body text-muted-foreground flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> {formatDuration(selectedDuration)}
                    </span>
                  </div>
                </div>

                <div className="grid md:grid-cols-[1fr_260px] gap-6">
                  {/* Calendar */}
                  <div className="glass-panel rounded-xl p-6">
                    <div className="flex items-center justify-between mb-5">
                      <button onClick={() => setCurrentMonth(new Date(year, month - 1))} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <h3 className="font-display text-base text-foreground">
                        {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      </h3>
                      <button onClick={() => setCurrentMonth(new Date(year, month + 1))} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
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
                        return (
                          <button key={day} disabled={!isAvailable} onClick={() => { setSelectedDate(date); setSelectedTime(null); }}
                            className={`aspect-square rounded-lg text-sm font-body transition-all ${
                              isSelected ? "bg-primary text-primary-foreground font-medium"
                                : isAvailable ? "text-foreground hover:bg-secondary"
                                : "text-muted-foreground/20 cursor-not-allowed"
                            }`}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Time Slots */}
                  <div>
                    {selectedDate ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3">
                          {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                        </p>
                        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                          {timeSlots.length > 0 ? (
                            timeSlots.map((t) => (
                              <button key={t} onClick={() => setSelectedTime(t)}
                                className={`w-full text-sm font-body py-3 px-4 rounded-lg border transition-all text-left ${
                                  selectedTime === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:border-primary/50"
                                }`}
                              >
                                {formatTime12(t)}
                              </button>
                            ))
                          ) : (
                            <p className="text-sm font-body text-muted-foreground/50">No slots available</p>
                          )}
                        </div>
                        {selectedTime && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                            <Button onClick={() => setStep("questions")} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs py-5">
                              Continue
                            </Button>
                          </motion.div>
                        )}
                      </motion.div>
                    ) : (
                      <div className="text-center py-12">
                        <CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm font-body text-muted-foreground/50">Select a date to view times</p>
                      </div>
                    )}
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
                  Confirm Booking
                </Button>
                <p className="text-center text-[10px] font-body text-muted-foreground/40 mt-4">By booking, you agree to our terms and conditions.</p>
              </motion.div>
            )}

            {/* ─── Confirmation ─── */}
            {step === "confirmed" && selectedEvent && selectedDate && selectedTime && selectedDuration && (
              <motion.div key="confirmed" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md mx-auto text-center">
                <div className="glass-panel rounded-xl p-8">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
                  <h2 className="font-display text-2xl text-foreground mb-2">
                    {selectedEvent.requiresConfirmation ? "Booking Request Sent!" : "Booking Confirmed!"}
                  </h2>
                  <p className="text-sm font-body text-muted-foreground mb-6">
                    {selectedEvent.requiresConfirmation ? "You'll receive a confirmation once approved." : "You'll receive a confirmation email shortly."}
                  </p>
                  <div className="border-t border-border/50 pt-4 space-y-2 text-left">
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Event</span><span className="text-foreground">{selectedEvent.title}</span></div>
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Duration</span><span className="text-foreground">{formatDuration(selectedDuration)}</span></div>
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Date</span><span className="text-foreground">{selectedDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span></div>
                    <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Time</span><span className="text-primary font-medium">{formatTime12(selectedTime)}</span></div>
                  </div>
                  <Button onClick={handleReset} variant="outline" className="mt-6 font-body text-xs tracking-wider uppercase border-border text-foreground">
                    Book Another Session
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
