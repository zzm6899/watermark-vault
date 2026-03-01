import { useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, ChevronLeft, ChevronRight, Camera, User, Mail, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { toast } from "sonner";

const sessionTypes = ["Wedding", "Portrait", "Event", "Product", "Family"];
const timeSlots = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];

export default function Booking() {
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
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

  const handleSubmit = () => {
    if (!selectedDate || !selectedTime || !selectedType || !name || !email) {
      toast.error("Please fill in all required fields");
      return;
    }
    toast.success("Booking request submitted! You'll receive a confirmation email shortly.");
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <section className="pt-28 pb-24">
        <div className="container mx-auto px-4 max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <p className="text-xs font-body tracking-[0.3em] uppercase text-primary mb-3">Schedule</p>
            <h1 className="font-display text-4xl md:text-5xl text-foreground">Book a Session</h1>
            <p className="text-sm font-body text-muted-foreground mt-3">
              Choose your session type, pick a date, and we'll capture something beautiful.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Calendar */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-panel rounded-xl p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <button onClick={() => setCurrentMonth(new Date(year, month - 1))} className="text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h3 className="font-display text-lg text-foreground">
                  {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </h3>
                <button onClick={() => setCurrentMonth(new Date(year, month + 1))} className="text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-2">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <div key={d} className="text-center text-[10px] font-body tracking-wider uppercase text-muted-foreground py-2">{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {blanks.map((b) => (
                  <div key={`blank-${b}`} />
                ))}
                {days.map((day) => {
                  const isSelected = selectedDate === day;
                  const isPast = new Date(year, month, day) < new Date();
                  const isWeekend = new Date(year, month, day).getDay() === 0;
                  return (
                    <button
                      key={day}
                      disabled={isPast || isWeekend}
                      onClick={() => setSelectedDate(day)}
                      className={`aspect-square rounded-lg text-sm font-body transition-all ${
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : isPast || isWeekend
                          ? "text-muted-foreground/30 cursor-not-allowed"
                          : "text-foreground hover:bg-secondary"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              {/* Time slots */}
              {selectedDate && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6">
                  <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5" /> Available Times
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {timeSlots.map((t) => (
                      <button
                        key={t}
                        onClick={() => setSelectedTime(t)}
                        className={`text-xs font-body py-2.5 rounded-lg transition-all ${
                          selectedTime === t
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>

            {/* Booking Form */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-6"
            >
              {/* Session Type */}
              <div>
                <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block flex items-center gap-2">
                  <Camera className="w-3.5 h-3.5" /> Session Type
                </label>
                <div className="flex flex-wrap gap-2">
                  {sessionTypes.map((type) => (
                    <button
                      key={type}
                      onClick={() => setSelectedType(type)}
                      className={`text-xs font-body px-4 py-2.5 rounded-full border transition-all ${
                        selectedType === type
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 block flex items-center gap-2">
                    <User className="w-3.5 h-3.5" /> Name
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body"
                  />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 block flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5" /> Email
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
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2 block flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5" /> Notes
                  </label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Tell us about your vision..."
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body min-h-[100px]"
                  />
                </div>
              </div>

              {/* Summary */}
              {selectedDate && selectedTime && selectedType && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel rounded-lg p-4">
                  <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2">Summary</p>
                  <p className="text-sm font-body text-foreground">
                    <span className="text-primary font-medium">{selectedType}</span> session on{" "}
                    <span className="text-primary font-medium">
                      {new Date(year, month, selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    </span>{" "}
                    at <span className="text-primary font-medium">{selectedTime}</span>
                  </p>
                </motion.div>
              )}

              <Button
                onClick={handleSubmit}
                size="lg"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs py-6"
              >
                <Calendar className="w-4 h-4 mr-2" />
                Request Booking
              </Button>
            </motion.div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
