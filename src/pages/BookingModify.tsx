import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Clock, ChevronLeft, ChevronRight, ArrowLeft,
  CalendarDays, CheckCircle2, XCircle, MapPin,
  Calendar as CalendarIcon, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { getBookings, updateBooking, getEventTypes, getProfile, getSettings, isSlotBooked } from "@/lib/storage";
import type { EventType, Booking } from "@/lib/types";

function formatDuration(mins: number) {
  if (mins >= 60) { const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${mins}m`;
}

function formatTime12(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
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
  return (avail.recurring || []).filter((s) => s.day === dayOfWeek).map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
}

function isDayAvailable(et: EventType, date: Date): boolean {
  return getAvailabilityForDate(et, date).length > 0;
}

function generateTimeSlots(startTime: string, endTime: string, duration: number): string[] {
  const slots: string[] = [];
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  for (let m = startMins; m + duration <= endMins; m += 15) {
    slots.push(`${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`);
  }
  return slots;
}

function buildGoogleCalendarUrl(event: EventType, date: Date, time: string, duration: number): string {
  const [h, m] = time.split(":").map(Number);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
  const end = new Date(start.getTime() + duration * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({ action: "TEMPLATE", text: event.title, dates: `${fmt(start)}/${fmt(end)}`, details: event.description || "", location: event.location || "" });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function BookingModify() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const profile = getProfile();

  const booking = getBookings().find(b => b.id === bookingId || b.modifyToken === bookingId);
  const eventType = booking ? getEventTypes().find(e => e.id === booking.eventTypeId) : null;

  const [mode, setMode] = useState<"view" | "reschedule" | "cancelled" | "done">("view");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [use24h, setUse24h] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth()));

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const blanks = Array.from({ length: (firstDay + 6) % 7 }, (_, i) => i);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const timeSlots = useMemo(() => {
    if (!selectedDate || !booking || !eventType) return [];
    const ranges = getAvailabilityForDate(eventType, selectedDate);
    const dateStr = toDateStr(selectedDate);
    const allSlots: string[] = [];
    for (const range of ranges) {
      for (const slot of generateTimeSlots(range.startTime, range.endTime, booking.duration)) {
        if (!isSlotBooked(dateStr, slot, booking.duration, booking.id)) allSlots.push(slot);
      }
    }
    return allSlots;
  }, [selectedDate, booking, eventType]);

  if (!booking || !eventType) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="glass-panel rounded-xl p-8 text-center max-w-md">
          <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-2">Booking Not Found</h2>
          <p className="text-sm font-body text-muted-foreground">This modification link is invalid or has expired.</p>
          <Button onClick={() => navigate("/")} className="mt-4 font-body text-xs" variant="outline">Go to Booking Page</Button>
        </div>
      </div>
    );
  }

  if (booking.status === "cancelled") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="glass-panel rounded-xl p-8 text-center max-w-md">
          <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-2">Booking Cancelled</h2>
          <p className="text-sm font-body text-muted-foreground">This booking has already been cancelled.</p>
          <Button onClick={() => navigate("/")} className="mt-4 font-body text-xs" variant="outline">Book Again</Button>
        </div>
      </div>
    );
  }

  const handleCancel = () => {
    if (!confirm("Are you sure you want to cancel this booking?")) return;
    updateBooking({ ...booking, status: "cancelled" });
    setMode("cancelled");
    toast.success("Booking cancelled");
  };

  const handleReschedule = () => {
    if (!selectedDate || !selectedTime) return;
    const dateStr = toDateStr(selectedDate);
    if (isSlotBooked(dateStr, selectedTime, booking.duration, booking.id)) {
      toast.error("This slot was just taken. Please choose another.");
      return;
    }
    updateBooking({ ...booking, date: dateStr, time: selectedTime });
    setMode("done");
    toast.success("Booking rescheduled!");
  };

  if (mode === "cancelled") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="glass-panel rounded-xl p-8 text-center max-w-md">
          <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-2">Booking Cancelled</h2>
          <p className="text-sm font-body text-muted-foreground">Your booking has been cancelled successfully.</p>
          <Button onClick={() => navigate("/")} className="mt-4 font-body text-xs" variant="outline">Book Again</Button>
        </div>
      </div>
    );
  }

  if (mode === "done") {
    const newDate = selectedDate!;
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="glass-panel rounded-xl p-8 text-center max-w-md">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-2">Booking Rescheduled!</h2>
          <div className="border-t border-border/50 pt-4 mt-4 space-y-2 text-left">
            <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Event</span><span className="text-foreground">{eventType.title}</span></div>
            <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">New Date</span><span className="text-foreground">{newDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span></div>
            <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">New Time</span><span className="text-primary font-medium">{formatTime12(selectedTime!)}</span></div>
          </div>
          <a href={buildGoogleCalendarUrl(eventType, newDate, selectedTime!, booking.duration)} target="_blank" rel="noopener noreferrer" className="block mt-4">
            <Button variant="outline" className="w-full font-body text-xs gap-2 border-border text-foreground">
              <CalendarIcon className="w-4 h-4" /> Update Google Calendar <ExternalLink className="w-3 h-3" />
            </Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <section className="pt-8 pb-24 min-h-screen">
        <div className="container mx-auto px-4">
          {mode === "view" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto">
              <div className="glass-panel rounded-xl p-8">
                <h2 className="font-display text-2xl text-foreground mb-2">Your Booking</h2>
                <p className="text-sm font-body text-muted-foreground mb-6">Manage your booking below.</p>
                <div className="border-t border-border/50 pt-4 space-y-2">
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Event</span><span className="text-foreground">{eventType.title}</span></div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Duration</span><span className="text-foreground">{formatDuration(booking.duration)}</span></div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Date</span><span className="text-foreground">{booking.date}</span></div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Time</span><span className="text-primary font-medium">{formatTime12(booking.time)}</span></div>
                  <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Status</span>
                    <span className={`text-xs px-2.5 py-1 rounded-full ${booking.status === "confirmed" ? "bg-primary/10 text-primary" : "bg-yellow-500/10 text-yellow-400"}`}>{booking.status}</span>
                  </div>
                  {booking.clientName && <div className="flex justify-between text-sm font-body"><span className="text-muted-foreground">Name</span><span className="text-foreground">{booking.clientName}</span></div>}
                </div>
                <div className="flex flex-col gap-3 mt-6">
                  <Button onClick={() => setMode("reschedule")} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
                    <CalendarDays className="w-4 h-4" /> Change Date / Time
                  </Button>
                  <Button onClick={handleCancel} variant="outline" className="w-full font-body text-xs tracking-wider uppercase border-destructive text-destructive hover:bg-destructive/10 gap-2">
                    <XCircle className="w-4 h-4" /> Cancel Booking
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {mode === "reschedule" && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-[900px] mx-auto">
              <button onClick={() => setMode("view")} className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-4">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
              <div className="glass-panel rounded-xl overflow-hidden">
                <div className="grid lg:grid-cols-[1fr_240px] divide-y lg:divide-y-0 lg:divide-x divide-border/50">
                  {/* Calendar */}
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="font-display text-base text-foreground">
                        <span className="text-primary">{currentMonth.toLocaleDateString("en-US", { month: "long" })}</span> {year}
                      </h3>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setCurrentMonth(new Date(year, month - 1))} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary"><ChevronLeft className="w-4 h-4" /></button>
                        <button onClick={() => setCurrentMonth(new Date(year, month + 1))} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary"><ChevronRight className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map(d => (
                        <div key={d} className="text-center text-[10px] font-body tracking-wider uppercase text-muted-foreground py-2">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {blanks.map(b => <div key={`blank-${b}`} />)}
                      {days.map(day => {
                        const date = new Date(year, month, day);
                        const isSelected = selectedDate?.getDate() === day && selectedDate?.getMonth() === month && selectedDate?.getFullYear() === year;
                        const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
                        const isAvailable = !isPast && isDayAvailable(eventType, date);
                        const isToday = toDateStr(date) === toDateStr(new Date());
                        return (
                          <button key={day} disabled={!isAvailable} onClick={() => { setSelectedDate(date); setSelectedTime(null); }}
                            className={`aspect-square rounded-lg text-sm font-body transition-all relative ${
                              isSelected ? "bg-primary text-primary-foreground font-medium ring-2 ring-primary ring-offset-2 ring-offset-background"
                                : isAvailable ? "text-foreground hover:bg-secondary" : "text-muted-foreground/20 cursor-not-allowed"}`}>
                            {day}
                            {isToday && !isSelected && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Time Slots */}
                  <div className="p-4">
                    {selectedDate ? (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-body font-medium text-foreground">{selectedDate.toLocaleDateString("en-US", { weekday: "short" })} {selectedDate.getDate()}</p>
                          <div className="flex rounded-md border border-border overflow-hidden">
                            <button onClick={() => setUse24h(false)} className={`px-2 py-0.5 text-[10px] font-body ${!use24h ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>12h</button>
                            <button onClick={() => setUse24h(true)} className={`px-2 py-0.5 text-[10px] font-body ${use24h ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>24h</button>
                          </div>
                        </div>
                        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                          {timeSlots.length > 0 ? timeSlots.map(t => (
                            <button key={t} onClick={() => setSelectedTime(t)}
                              className={`w-full text-sm font-body py-2.5 px-4 rounded-lg border transition-all text-center ${
                                selectedTime === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:border-primary/50"}`}>
                              <span className="flex items-center justify-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                                {use24h ? t : formatTime12(t)}
                              </span>
                            </button>
                          )) : <p className="text-sm font-body text-muted-foreground/50 text-center py-8">No slots available</p>}
                        </div>
                        {selectedTime && (
                          <Button onClick={handleReschedule} className="w-full mt-3 bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs py-5">
                            Confirm New Time
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-xs font-body text-muted-foreground/50">Select a new date</p>
                      </div>
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
