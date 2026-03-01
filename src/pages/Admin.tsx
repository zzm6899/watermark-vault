import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Calendar, Settings, Plus, Upload,
  Trash2, Edit, Users, Clock, CreditCard, Building2,
  Camera, Save, X, LogOut, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  getProfile, setProfile, getEventTypes, setEventTypes, addEventType,
  deleteEventType, updateEventType, getBookings, deleteBooking,
  updateBooking, getSettings, setSettings, logout,
} from "@/lib/storage";
import type {
  EventType, QuestionField, AvailabilitySlot,
  ProfileSettings, AppSettings, Booking, WatermarkPosition,
} from "@/lib/types";

type Tab = "dashboard" | "bookings" | "event-types" | "profile" | "settings";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function formatDuration(mins: number) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

export default function Admin() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  const handleLogout = () => {
    logout();
    navigate("/admin");
  };

  const tabs = [
    { id: "dashboard" as Tab, label: "Dashboard", icon: LayoutDashboard },
    { id: "bookings" as Tab, label: "Bookings", icon: Calendar },
    { id: "event-types" as Tab, label: "Event Types", icon: Clock },
    { id: "profile" as Tab, label: "Profile", icon: Camera },
    { id: "settings" as Tab, label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <aside className="w-56 fixed left-0 top-0 bottom-0 border-r border-border bg-card/50 p-4 hidden lg:flex flex-col">
          <div className="flex items-center gap-2.5 px-3 mb-6 pt-2">
            <Camera className="w-5 h-5 text-primary" />
            <span className="font-display text-base text-foreground">Zacmphotos</span>
          </div>
          <p className="text-[10px] font-body tracking-[0.3em] uppercase text-muted-foreground mb-4 px-3">Admin Panel</p>
          <nav className="space-y-1 flex-1">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body transition-all ${
                  activeTab === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <tab.icon className="w-4 h-4" />{tab.label}
              </button>
            ))}
          </nav>
          <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all mt-auto">
            <LogOut className="w-4 h-4" />Logout
          </button>
        </aside>

        <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-sm border-b border-border flex overflow-x-auto">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-body tracking-wider uppercase whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id ? "text-primary border-primary" : "text-muted-foreground border-transparent"
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />{tab.label}
            </button>
          ))}
        </div>

        <main className="flex-1 lg:ml-56 p-6 lg:p-8 mt-12 lg:mt-0">
          {activeTab === "dashboard" && <DashboardView />}
          {activeTab === "bookings" && <BookingsView />}
          {activeTab === "event-types" && <EventTypesView />}
          {activeTab === "profile" && <ProfileView />}
          {activeTab === "settings" && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────
function DashboardView() {
  const bookings = getBookings();
  const eventTypes = getEventTypes();

  const stats = [
    { label: "Event Types", value: eventTypes.length, icon: Clock, color: "text-primary" },
    { label: "Total Bookings", value: bookings.length, icon: Calendar, color: "text-primary" },
    { label: "Pending", value: bookings.filter((b) => b.status === "pending").length, icon: Users, color: "text-primary" },
    { label: "Confirmed", value: bookings.filter((b) => b.status === "confirmed").length, icon: Users, color: "text-primary" },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Dashboard</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-panel rounded-xl p-5">
            <div className="flex items-center justify-between mb-3"><stat.icon className={`w-5 h-5 ${stat.color}`} /></div>
            <p className="font-display text-2xl text-foreground">{stat.value}</p>
            <p className="text-xs font-body text-muted-foreground tracking-wider uppercase">{stat.label}</p>
          </div>
        ))}
      </div>

      {bookings.length > 0 && (
        <>
          <h3 className="font-display text-lg text-foreground mb-4">Recent Bookings</h3>
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Client</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Type</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Date</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.slice(-5).reverse().map((b) => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="p-4 text-sm font-body text-foreground">{b.clientName}</td>
                      <td className="p-4 text-sm font-body text-muted-foreground">{b.type}</td>
                      <td className="p-4 text-sm font-body text-muted-foreground">{b.date}</td>
                      <td className="p-4">
                        <span className={`text-xs font-body px-2.5 py-1 rounded-full ${
                          b.status === "completed" ? "bg-green-500/10 text-green-400" :
                          b.status === "confirmed" ? "bg-primary/10 text-primary" :
                          b.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
                          "bg-destructive/10 text-destructive"
                        }`}>{b.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ─── Bookings ────────────────────────────────────────
function BookingsView() {
  const [bookings, setBookingsState] = useState<Booking[]>(getBookings());

  const handleDelete = (id: string) => {
    if (!confirm("Delete this booking?")) return;
    deleteBooking(id);
    setBookingsState(getBookings());
    toast.success("Booking deleted");
  };

  const handleStatusChange = (bk: Booking, status: Booking["status"]) => {
    updateBooking({ ...bk, status });
    setBookingsState(getBookings());
    toast.success(`Booking ${status}`);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Bookings</h2>

      {bookings.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <Calendar className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-body text-muted-foreground">No bookings yet. They'll appear here when clients book.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime()).map((bk) => (
            <div key={bk.id} className="glass-panel rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Users className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-body text-foreground font-medium">{bk.clientName}</h3>
                <p className="text-xs font-body text-muted-foreground">{bk.type} · {bk.date} at {bk.time} · {formatDuration(bk.duration)}</p>
                {bk.clientEmail && <p className="text-xs font-body text-muted-foreground/70">{bk.clientEmail}</p>}
              </div>
              <select value={bk.status} onChange={(e) => handleStatusChange(bk, e.target.value as Booking["status"])}
                className={`text-xs font-body px-2.5 py-1 rounded-full bg-secondary border border-border text-foreground cursor-pointer`}
              >
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(bk.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Event Types ─────────────────────────────────────
function EventTypesView() {
  const [eventTypes, setEts] = useState<EventType[]>(getEventTypes());
  const [editing, setEditing] = useState<EventType | null>(null);
  const [showNew, setShowNew] = useState(false);

  const refresh = () => setEts(getEventTypes());

  const toggleActive = (id: string) => {
    const et = eventTypes.find((e) => e.id === id);
    if (!et) return;
    updateEventType({ ...et, active: !et.active });
    refresh();
    toast.success("Event type updated");
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this event type?")) return;
    deleteEventType(id);
    refresh();
    toast.success("Event type deleted");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Event Types</h2>
        <Button size="sm" onClick={() => setShowNew(true)} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase">
          <Plus className="w-4 h-4" /> New Event Type
        </Button>
      </div>

      {(showNew || editing) && (
        <EventTypeEditor
          eventType={editing}
          onSave={(et) => {
            if (editing) { updateEventType(et); }
            else { addEventType(et); }
            refresh();
            setEditing(null);
            setShowNew(false);
            toast.success(editing ? "Event type updated" : "Event type created");
          }}
          onCancel={() => { setEditing(null); setShowNew(false); }}
        />
      )}

      <div className="space-y-3">
        {eventTypes.map((et) => (
          <div key={et.id} className={`glass-panel rounded-xl p-5 border transition-all ${et.active ? "border-border/50" : "border-border/20 opacity-60"}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <div className={`w-1.5 h-12 rounded-full mt-0.5 bg-primary ${!et.active ? "opacity-30" : ""}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-display text-base text-foreground">{et.title}</h3>
                    <span className="text-xs font-body text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {et.durations.map((d) => formatDuration(d)).join(", ")}
                    </span>
                  </div>
                  {et.description && <p className="text-sm font-body text-muted-foreground mt-1">{et.description}</p>}
                  <div className="flex items-center gap-3 mt-2">
                    {et.price > 0 && <p className="text-sm font-body text-primary font-medium">${et.price}</p>}
                    <span className="text-xs font-body text-muted-foreground">{et.questions.length} questions</span>
                    <span className="text-xs font-body text-muted-foreground">{et.availability.recurring.length} days/week</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={et.active} onCheckedChange={() => toggleActive(et.id)} />
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setEditing(et)}>
                  <Edit className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(et.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Event Type Editor ───────────────────────────────
function EventTypeEditor({ eventType, onSave, onCancel }: { eventType: EventType | null; onSave: (et: EventType) => void; onCancel: () => void }) {
  const isNew = !eventType;
  const [title, setTitle] = useState(eventType?.title || "");
  const [description, setDescription] = useState(eventType?.description || "");
  const [durations, setDurations] = useState<number[]>(eventType?.durations || [30]);
  const [price, setPrice] = useState(eventType?.price || 0);
  const [requiresConfirmation, setRequiresConfirmation] = useState(eventType?.requiresConfirmation || false);
  const [questions, setQuestions] = useState<QuestionField[]>(eventType?.questions || [
    { id: "q1", label: "Name", type: "text", required: true, placeholder: "Your full name" },
    { id: "q2", label: "Email", type: "text", required: true, placeholder: "you@example.com" },
  ]);
  const [recurring, setRecurring] = useState<AvailabilitySlot[]>(eventType?.availability?.recurring || [
    { day: 1, startTime: "09:00", endTime: "17:00" },
    { day: 2, startTime: "09:00", endTime: "17:00" },
    { day: 3, startTime: "09:00", endTime: "17:00" },
    { day: 4, startTime: "09:00", endTime: "17:00" },
    { day: 5, startTime: "09:00", endTime: "17:00" },
  ]);
  const [blockedDates, setBlockedDates] = useState<string[]>(eventType?.availability?.blockedDates || []);
  const [specificDates, setSpecificDates] = useState(eventType?.availability?.specificDates || []);
  const [durationInput, setDurationInput] = useState("");
  const [blockedInput, setBlockedInput] = useState("");
  const [specificDateInput, setSpecificDateInput] = useState("");
  const [specificStartInput, setSpecificStartInput] = useState("09:00");
  const [specificEndInput, setSpecificEndInput] = useState("17:00");
  const [expandAvailability, setExpandAvailability] = useState(false);
  const [expandQuestions, setExpandQuestions] = useState(false);

  const addDuration = () => {
    const val = parseInt(durationInput);
    if (!val || val <= 0 || durations.includes(val)) return;
    setDurations([...durations, val].sort((a, b) => a - b));
    setDurationInput("");
  };

  const toggleDay = (day: number) => {
    const exists = recurring.find((s) => s.day === day);
    if (exists) setRecurring(recurring.filter((s) => s.day !== day));
    else setRecurring([...recurring, { day, startTime: "09:00", endTime: "17:00" }].sort((a, b) => a.day - b.day));
  };

  const handleSave = () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (durations.length === 0) { toast.error("Add at least one duration"); return; }
    onSave({
      id: eventType?.id || generateId("et"),
      title: title.trim(),
      description: description.trim(),
      durations,
      color: "primary",
      price,
      active: eventType?.active ?? true,
      requiresConfirmation,
      questions,
      availability: { recurring, specificDates, blockedDates },
    });
  };

  return (
    <div className="glass-panel rounded-xl p-6 mb-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg text-foreground">{isNew ? "New Event Type" : "Edit Event Type"}</h3>
        <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Title *</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Price ($)</label>
          <Input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" />
        </div>
      </div>
      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Description</label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="bg-secondary border-border text-foreground font-body min-h-[60px]" />
      </div>

      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Durations (minutes)</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {durations.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 text-xs font-body bg-primary/10 text-primary px-2.5 py-1 rounded-full">
              {d}m <button onClick={() => setDurations(durations.filter((x) => x !== d))} className="hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input type="number" value={durationInput} onChange={(e) => setDurationInput(e.target.value)} placeholder="e.g. 25" className="bg-secondary border-border text-foreground font-body w-24" onKeyDown={(e) => e.key === "Enter" && addDuration()} />
          <Button variant="outline" size="sm" onClick={addDuration} className="font-body text-xs border-border text-foreground">Add</Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-body text-muted-foreground">Requires Confirmation</span>
        <Switch checked={requiresConfirmation} onCheckedChange={setRequiresConfirmation} />
      </div>

      {/* Availability Section */}
      <div>
        <button onClick={() => setExpandAvailability(!expandAvailability)} className="flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 hover:text-foreground transition-colors">
          {expandAvailability ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Availability ({recurring.length} days + {specificDates.length} specific + {blockedDates.length} blocked)
        </button>
        {expandAvailability && (
          <div className="space-y-4 pl-2 border-l-2 border-border/50 ml-1">
            {/* Recurring */}
            <div className="space-y-2">
              <p className="text-xs font-body text-muted-foreground font-medium">Weekly Schedule</p>
              {DAY_NAMES.map((dayName, i) => {
                const slot = recurring.find((s) => s.day === i);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <Switch checked={!!slot} onCheckedChange={() => toggleDay(i)} />
                    <span className="text-sm font-body text-foreground w-24">{dayName}</span>
                    {slot ? (
                      <div className="flex items-center gap-2">
                        <Input type="time" value={slot.startTime} onChange={(e) => setRecurring(recurring.map((s) => s.day === i ? { ...s, startTime: e.target.value } : s))} className="bg-secondary border-border text-foreground font-body w-28 text-xs" />
                        <span className="text-xs text-muted-foreground">—</span>
                        <Input type="time" value={slot.endTime} onChange={(e) => setRecurring(recurring.map((s) => s.day === i ? { ...s, endTime: e.target.value } : s))} className="bg-secondary border-border text-foreground font-body w-28 text-xs" />
                      </div>
                    ) : <span className="text-xs font-body text-muted-foreground/50">Unavailable</span>}
                  </div>
                );
              })}
            </div>
            {/* Specific Dates */}
            <div className="space-y-2">
              <p className="text-xs font-body text-muted-foreground font-medium">Specific Date Availability</p>
              {specificDates.map((sd, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs font-body">
                  <span className="text-foreground">{sd.date}</span>
                  <span className="text-primary">{sd.startTime} — {sd.endTime}</span>
                  <button onClick={() => setSpecificDates(specificDates.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              <div className="flex gap-2 items-end">
                <Input type="date" value={specificDateInput} onChange={(e) => setSpecificDateInput(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs w-36" />
                <Input type="time" value={specificStartInput} onChange={(e) => setSpecificStartInput(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs w-28" />
                <Input type="time" value={specificEndInput} onChange={(e) => setSpecificEndInput(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs w-28" />
                <Button variant="outline" size="sm" onClick={() => {
                  if (!specificDateInput) return;
                  setSpecificDates([...specificDates, { date: specificDateInput, startTime: specificStartInput, endTime: specificEndInput }]);
                  setSpecificDateInput("");
                }} className="font-body text-xs border-border text-foreground">Add</Button>
              </div>
            </div>
            {/* Blocked Dates */}
            <div className="space-y-2">
              <p className="text-xs font-body text-muted-foreground font-medium">Blocked Dates</p>
              <div className="flex flex-wrap gap-2">
                {blockedDates.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 text-xs font-body bg-destructive/10 text-destructive px-2.5 py-1 rounded-full">
                    {d} <button onClick={() => setBlockedDates(blockedDates.filter((x) => x !== d))}><Trash2 className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input type="date" value={blockedInput} onChange={(e) => setBlockedInput(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs w-36" />
                <Button variant="outline" size="sm" onClick={() => {
                  if (!blockedInput || blockedDates.includes(blockedInput)) return;
                  setBlockedDates([...blockedDates, blockedInput].sort());
                  setBlockedInput("");
                }} className="font-body text-xs border-border text-foreground">Block</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Questions Section */}
      <div>
        <button onClick={() => setExpandQuestions(!expandQuestions)} className="flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 hover:text-foreground transition-colors">
          {expandQuestions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Questions ({questions.length})
        </button>
        {expandQuestions && (
          <div className="space-y-3 pl-2 border-l-2 border-border/50 ml-1">
            {questions.map((q, idx) => (
              <div key={q.id} className="p-3 rounded-lg bg-secondary/50 border border-border/50 space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={q.label} onChange={(e) => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, label: e.target.value } : qq))} placeholder="Question label" className="bg-secondary border-border text-foreground font-body text-sm flex-1" />
                  <select value={q.type} onChange={(e) => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, type: e.target.value as QuestionField["type"] } : qq))} className="bg-secondary border border-border text-foreground font-body text-xs rounded-md px-2 py-2">
                    <option value="text">Text</option>
                    <option value="textarea">Long Text</option>
                    <option value="select">Select</option>
                    <option value="boolean">Yes/No</option>
                    <option value="image-upload">Image Upload</option>
                  </select>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setQuestions(questions.filter((_, i) => i !== idx))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-body text-muted-foreground cursor-pointer">
                    <Switch checked={q.required} onCheckedChange={(v) => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, required: v } : qq))} />Required
                  </label>
                  <Input value={q.placeholder || ""} onChange={(e) => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, placeholder: e.target.value } : qq))} placeholder="Placeholder" className="bg-secondary border-border text-foreground font-body text-xs flex-1" />
                </div>
                {q.type === "select" && (
                  <Input value={q.options?.join(", ") || ""} onChange={(e) => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : qq))} placeholder="Options (comma separated)" className="bg-secondary border-border text-foreground font-body text-xs" />
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setQuestions([...questions, { id: `q${Date.now()}`, label: "", type: "text", required: false, placeholder: "" }])} className="font-body text-xs border-border text-foreground gap-1">
              <Plus className="w-3.5 h-3.5" /> Add Question
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-2 border-t border-border/50">
        <Button variant="outline" onClick={onCancel} className="font-body text-xs border-border text-foreground">Cancel</Button>
        <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
          <Save className="w-4 h-4" /> {isNew ? "Create" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

// ─── Profile ─────────────────────────────────────────
function ProfileView() {
  const [profile, setProfileState] = useState<ProfileSettings>(getProfile());

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProfileState({ ...profile, avatar: reader.result as string });
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!profile.name.trim()) { toast.error("Name is required"); return; }
    setProfile(profile);
    toast.success("Profile saved! Changes visible on booking page.");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Profile & Cover Page</h2>
      <div className="max-w-lg space-y-6">
        {/* Preview */}
        <div className="glass-panel rounded-xl p-6">
          <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-4">Preview</p>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
              {profile.avatar ? <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" /> : <Camera className="w-6 h-6 text-primary" />}
            </div>
          </div>
          <h3 className="font-display text-xl text-foreground">{profile.name || "Your Name"}</h3>
          {profile.bio && <p className="text-sm font-body text-muted-foreground mt-1">{profile.bio}</p>}
        </div>

        {/* Edit */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-4">
            <label className="cursor-pointer">
              <div className="w-16 h-16 rounded-full bg-secondary border-2 border-dashed border-border flex items-center justify-center overflow-hidden">
                {profile.avatar ? <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" /> : <Upload className="w-5 h-5 text-muted-foreground/50" />}
              </div>
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </label>
            <div>
              <p className="text-xs font-body text-muted-foreground">Click to upload avatar</p>
              {profile.avatar && <button onClick={() => setProfileState({ ...profile, avatar: "" })} className="text-xs font-body text-destructive hover:underline">Remove</button>}
            </div>
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Display Name</label>
            <Input value={profile.name} onChange={(e) => setProfileState({ ...profile, name: e.target.value })} className="bg-secondary border-border text-foreground font-body" />
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Bio</label>
            <Textarea value={profile.bio} onChange={(e) => setProfileState({ ...profile, bio: e.target.value })} className="bg-secondary border-border text-foreground font-body min-h-[60px]" />
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Timezone</label>
            <Input value={profile.timezone} onChange={(e) => setProfileState({ ...profile, timezone: e.target.value })} className="bg-secondary border-border text-foreground font-body" />
          </div>
          <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
            <Save className="w-4 h-4" /> Save Profile
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Settings ────────────────────────────────────────
function SettingsView() {
  const [settings, setSettingsState] = useState<AppSettings>(getSettings());

  const watermarkOptions: { value: WatermarkPosition; label: string }[] = [
    { value: "center", label: "Center" }, { value: "top-left", label: "Top Left" }, { value: "top-right", label: "Top Right" },
    { value: "bottom-left", label: "Bottom Left" }, { value: "bottom-right", label: "Bottom Right" }, { value: "tiled", label: "Tiled" },
  ];

  const handleSave = () => {
    setSettings(settings);
    toast.success("Settings saved!");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Settings</h2>
      <div className="space-y-6 max-w-lg">
        {/* Watermark */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground">Watermark</h3>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Watermark Text</label>
            <Input value={settings.watermarkText} onChange={(e) => setSettingsState({ ...settings, watermarkText: e.target.value })} className="bg-secondary border-border text-foreground font-body" />
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Position</label>
            <div className="grid grid-cols-3 gap-2">
              {watermarkOptions.map((opt) => (
                <button key={opt.value} onClick={() => setSettingsState({ ...settings, watermarkPosition: opt.value })}
                  className={`text-xs font-body py-2.5 px-3 rounded-lg border transition-all ${
                    settings.watermarkPosition === opt.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >{opt.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Album Defaults */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground">Default Album Settings</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Free Downloads</label>
              <Input type="number" value={settings.defaultFreeDownloads} onChange={(e) => setSettingsState({ ...settings, defaultFreeDownloads: Number(e.target.value) })} className="bg-secondary border-border text-foreground font-body w-32" />
            </div>
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Price per Photo ($)</label>
              <Input type="number" value={settings.defaultPricePerPhoto} onChange={(e) => setSettingsState({ ...settings, defaultPricePerPhoto: Number(e.target.value) })} className="bg-secondary border-border text-foreground font-body w-32" />
            </div>
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Full Album Price ($)</label>
              <Input type="number" value={settings.defaultPriceFullAlbum} onChange={(e) => setSettingsState({ ...settings, defaultPriceFullAlbum: Number(e.target.value) })} className="bg-secondary border-border text-foreground font-body w-32" />
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" /> Payment Methods
          </h3>
          <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-body text-foreground font-medium flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Bank Transfer / PayID
              </span>
              <Switch checked={settings.bankTransfer.enabled} onCheckedChange={(v) => setSettingsState({ ...settings, bankTransfer: { ...settings.bankTransfer, enabled: v } })} />
            </div>
            {settings.bankTransfer.enabled && (
              <div className="space-y-3 mt-4 pt-4 border-t border-border/50">
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Account Name</label>
                  <Input value={settings.bankTransfer.accountName} onChange={(e) => setSettingsState({ ...settings, bankTransfer: { ...settings.bankTransfer, accountName: e.target.value } })} className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">BSB</label>
                    <Input value={settings.bankTransfer.bsb} onChange={(e) => setSettingsState({ ...settings, bankTransfer: { ...settings.bankTransfer, bsb: e.target.value } })} className="bg-secondary border-border text-foreground font-body" />
                  </div>
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Account Number</label>
                    <Input value={settings.bankTransfer.accountNumber} onChange={(e) => setSettingsState({ ...settings, bankTransfer: { ...settings.bankTransfer, accountNumber: e.target.value } })} className="bg-secondary border-border text-foreground font-body" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">PayID</label>
                  <Input value={settings.bankTransfer.payId} onChange={(e) => setSettingsState({ ...settings, bankTransfer: { ...settings.bankTransfer, payId: e.target.value } })} className="bg-secondary border-border text-foreground font-body" />
                </div>
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Payment Instructions</label>
                  <Textarea value={settings.bankTransfer.instructions} onChange={(e) => setSettingsState({ ...settings, bankTransfer: { ...settings.bankTransfer, instructions: e.target.value } })} className="bg-secondary border-border text-foreground font-body min-h-[60px]" />
                </div>
              </div>
            )}
          </div>
          <p className="text-xs font-body text-muted-foreground/50">
            Stripe requires backend service. Configure SMTP & Stripe via Docker env vars.
          </p>
        </div>

        <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
          <Save className="w-4 h-4" /> Save All Settings
        </Button>
      </div>
    </motion.div>
  );
}
