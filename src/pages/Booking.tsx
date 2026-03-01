import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock, ChevronLeft, ChevronRight, User, Mail, FileText,
  ArrowLeft, Globe, CalendarDays
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { sampleEventTypes, defaultAvailability, type EventType } from "@/lib/mock-data";

type Step = "event-select" | "datetime" | "details";

function formatDuration(mins: number) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins} min`;
}

function generateTimeSlots(startTime: string, endTime: string, duration: number): string[] {
  const slots: string[] = [];
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;

  for (let m = startMins; m + duration <= endMins; m += 30) {
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

export default function Booking() {
  const [step, setStep] = useState<Step>("event-select");
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 2)); // March 2026
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDayOfWeek }, (_, i) => i);

  const availableDays = useMemo(() => {
    return defaultAvailability.map((s) => s.day);
  }, []);

  const timeSlots = useMemo(() => {
    if (!selectedDate || !selectedEvent) return [];
    const dayOfWeek = selectedDate.getDay();
    const avail = defaultAvailability.find((s) => s.day === dayOfWeek);
    if (!avail) return [];
    return generateTimeSlots(avail.startTime, avail.endTime, selectedEvent.duration);
  }, [selectedDate, selectedEvent]);

  const activeEventTypes = sampleEventTypes.filter((e) => e.active);

  const handleSelectEvent = (ev: EventType) => {
    setSelectedEvent(ev);
    setSelectedDate(null);
    setSelectedTime(null);
    setStep("datetime");
  };

  const handleSubmit = () => {
    if (!name || !email) {
      toast.error("Please fill in all required fields");
      return;
    }
    toast.success("Booking confirmed! You'll receive a confirmation email shortly.");
    setStep("event-select");
    setSelectedEvent(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setName("");
    setEmail("");
    setNotes("");
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <section className="pt-24 pb-24 min-h-screen">
        <div className="container mx-auto px-4 max-w-5xl">
          <AnimatePresence mode="wait">
            {/* Step 1: Event Type Selection */}
            {step === "event-select" && (
              <motion.div
                key="event-select"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <div className="text-center mb-12">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <CalendarDays className="w-4 h-4 text-primary" />
                    </div>
                  </div>
                  <h1 className="font-display text-3xl md:text-4xl text-foreground mb-2">Lumière Photography</h1>
                  <p className="text-sm font-body text-muted-foreground">
                    Select a session type to get started.
                  </p>
                </div>

                <div className="max-w-2xl mx-auto space-y-3">
                  {activeEventTypes.map((ev, i) => (
                    <motion.button
                      key={ev.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => handleSelectEvent(ev)}
                      className="w-full text-left glass-panel rounded-xl p-5 hover:border-primary/30 border border-border/50 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="font-display text-lg text-foreground group-hover:text-primary transition-colors">
                            {ev.title}
                          </h3>
                          <p className="text-sm font-body text-muted-foreground mt-1 leading-relaxed">
                            {ev.description}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span className="text-sm font-body">{formatDuration(ev.duration)}</span>
                          </div>
                          <p className="text-sm font-body text-primary font-medium">
                            ${ev.price}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full bg-primary`} />
                        <span className="text-xs font-body text-muted-foreground/70">
                          {formatDuration(ev.duration)} session
                        </span>
                      </div>
                    </motion.button>
                  ))}
                </div>

                <div className="flex items-center justify-center gap-2 mt-8 text-xs font-body text-muted-foreground/50">
                  <Globe className="w-3.5 h-3.5" />
                  <span>Australia/Sydney</span>
                </div>
              </motion.div>
            )}

            {/* Step 2: Date & Time */}
            {step === "datetime" && selectedEvent && (
              <motion.div
                key="datetime"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <button
                  onClick={() => { setStep("event-select"); setSelectedEvent(null); }}
                  className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-6"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>

                <div className="flex items-center gap-3 mb-8">
                  <div className={`w-1.5 h-12 rounded-full bg-primary`} />
                  <div>
                    <h2 className="font-display text-2xl text-foreground">{selectedEvent.title}</h2>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-sm font-body text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> {formatDuration(selectedEvent.duration)}
                      </span>
                      <span className="text-sm font-body text-primary font-medium">${selectedEvent.price}</span>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-[1fr_280px] gap-8">
                  {/* Calendar */}
                  <div className="glass-panel rounded-xl p-6">
                    <div className="flex items-center justify-between mb-6">
                      <button
                        onClick={() => setCurrentMonth(new Date(year, month - 1))}
                        className="text-muted-foreground hover:text-foreground transition-colors p-1"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <h3 className="font-display text-lg text-foreground">
                        {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      </h3>
                      <button
                        onClick={() => setCurrentMonth(new Date(year, month + 1))}
                        className="text-muted-foreground hover:text-foreground transition-colors p-1"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                        <div key={d} className="text-center text-[10px] font-body tracking-wider uppercase text-muted-foreground py-2">
                          {d}
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {blanks.map((b) => (
                        <div key={`blank-${b}`} />
                      ))}
                      {days.map((day) => {
                        const date = new Date(year, month, day);
                        const isSelected = selectedDate?.getDate() === day && selectedDate?.getMonth() === month && selectedDate?.getFullYear() === year;
                        const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
                        const dayOfWeek = date.getDay();
                        const isAvailable = availableDays.includes(dayOfWeek) && !isPast;
                        return (
                          <button
                            key={day}
                            disabled={!isAvailable}
                            onClick={() => { setSelectedDate(date); setSelectedTime(null); }}
                            className={`aspect-square rounded-lg text-sm font-body transition-all ${
                              isSelected
                                ? "bg-primary text-primary-foreground font-medium"
                                : isAvailable
                                ? "text-foreground hover:bg-secondary"
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
                              <button
                                key={t}
                                onClick={() => setSelectedTime(t)}
                                className={`w-full text-sm font-body py-3 px-4 rounded-lg border transition-all text-left ${
                                  selectedTime === t
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "border-border text-foreground hover:border-primary/50"
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
                            <Button
                              onClick={() => setStep("details")}
                              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs py-5"
                            >
                              Continue
                            </Button>
                          </motion.div>
                        )}
                      </motion.div>
                    ) : (
                      <div className="text-center py-12">
                        <CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm font-body text-muted-foreground/50">Select a date to view available times</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 3: Details */}
            {step === "details" && selectedEvent && selectedDate && selectedTime && (
              <motion.div
                key="details"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-lg mx-auto"
              >
                <button
                  onClick={() => setStep("datetime")}
                  className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-6"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>

                {/* Summary card */}
                <div className="glass-panel rounded-xl p-5 mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-1.5 h-10 rounded-full bg-primary`} />
                    <div>
                      <h3 className="font-display text-lg text-foreground">{selectedEvent.title}</h3>
                      <p className="text-xs font-body text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3 h-3" /> {formatDuration(selectedEvent.duration)}
                        <span className="text-primary ml-1">${selectedEvent.price}</span>
                      </p>
                    </div>
                  </div>
                  <div className="border-t border-border/50 pt-3 space-y-1">
                    <p className="text-sm font-body text-foreground">
                      {selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    </p>
                    <p className="text-sm font-body text-primary font-medium">
                      {formatTime12(selectedTime)}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 flex items-center gap-2">
                      <User className="w-3.5 h-3.5" /> Name *
                    </label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5" /> Email *
                    </label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5" /> Additional Notes
                    </label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Tell us about your vision..."
                      className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body min-h-[100px]"
                    />
                  </div>
                </div>

                <Button
                  onClick={handleSubmit}
                  size="lg"
                  className="w-full mt-6 bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs py-6"
                >
                  Confirm Booking
                </Button>

                <p className="text-center text-[10px] font-body text-muted-foreground/40 mt-4">
                  By booking, you agree to our terms and conditions.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <Footer />
    </div>
  );
}
