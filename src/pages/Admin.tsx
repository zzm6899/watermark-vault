import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Calendar, Settings, Plus, Upload,
  Trash2, Edit, Users, Clock, CreditCard, Building2,
  Camera, Save, X, LogOut, ChevronDown, ChevronUp,
  Image, DollarSign, Link2, Merge, Send, Copy, ExternalLink,
  MapPin, Lock, Bell
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
  getAlbums, addAlbum, updateAlbum, deleteAlbum,
  getPhotoLibrary, setPhotoLibrary,
} from "@/lib/storage";
import type {
  EventType, QuestionField, AvailabilitySlot,
  ProfileSettings, AppSettings, Booking, WatermarkPosition,
  Album, Photo, PaymentStatus,
} from "@/lib/types";

type Tab = "dashboard" | "bookings" | "event-types" | "albums" | "photos" | "profile" | "settings";

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

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function Admin() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [prefillBookingId, setPrefillBookingId] = useState<string | null>(null);

  const handleLogout = () => {
    logout();
    navigate("/admin");
  };

  const handleCreateAlbumForBooking = (bookingId: string) => {
    setPrefillBookingId(bookingId);
    setActiveTab("albums");
  };

  const tabs = [
    { id: "dashboard" as Tab, label: "Dashboard", icon: LayoutDashboard },
    { id: "bookings" as Tab, label: "Bookings", icon: Calendar },
    { id: "event-types" as Tab, label: "Events", icon: Clock },
    { id: "albums" as Tab, label: "Albums", icon: Image },
    { id: "photos" as Tab, label: "Photos", icon: Upload },
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
          {activeTab === "bookings" && <BookingsView onCreateAlbum={handleCreateAlbumForBooking} />}
          {activeTab === "event-types" && <EventTypesView />}
          {activeTab === "albums" && <AlbumsView prefillBookingId={prefillBookingId} onClearPrefill={() => setPrefillBookingId(null)} />}
          {activeTab === "photos" && <PhotosView />}
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
  const settings = getSettings();

  const totalIncome = bookings.reduce((sum, b) => sum + (b.paymentAmount || 0), 0);
  const paidIncome = bookings.filter(b => b.paymentStatus === "paid").reduce((sum, b) => sum + (b.paymentAmount || 0), 0);
  const unpaidIncome = bookings.filter(b => !b.paymentStatus || b.paymentStatus === "unpaid").reduce((sum, b) => sum + (b.paymentAmount || 0), 0);
  const pendingIncome = bookings.filter(b => b.paymentStatus === "pending-confirmation" || b.paymentStatus === "cash").reduce((sum, b) => sum + (b.paymentAmount || 0), 0);

  const stats = [
    { label: "Total Bookings", value: bookings.length, icon: Calendar, color: "text-primary" },
    { label: "Paid", value: `$${paidIncome}`, icon: DollarSign, color: "text-green-400" },
    { label: "Unpaid", value: `$${unpaidIncome}`, icon: DollarSign, color: "text-destructive" },
    { label: "Pending", value: `$${pendingIncome}`, icon: DollarSign, color: "text-yellow-400" },
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
                    {settings.instagramFieldEnabled && <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Instagram</th>}
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Type</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Date & Time</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Amount</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Payment</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.slice(-8).reverse().map((b) => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="p-4 text-sm font-body text-foreground">{b.clientName}</td>
                      {settings.instagramFieldEnabled && <td className="p-4 text-sm font-body text-muted-foreground">{b.instagramHandle || "—"}</td>}
                      <td className="p-4 text-sm font-body text-muted-foreground">{b.type}</td>
                      <td className="p-4 text-sm font-body text-muted-foreground">{b.date} {b.time}</td>
                      <td className="p-4 text-sm font-body text-foreground">${b.paymentAmount || 0}</td>
                      <td className="p-4">
                        <span className={`text-xs font-body px-2 py-0.5 rounded-full ${
                          b.paymentStatus === "paid" ? "bg-green-500/10 text-green-400" :
                          b.paymentStatus === "cash" ? "bg-yellow-500/10 text-yellow-400" :
                          b.paymentStatus === "pending-confirmation" ? "bg-blue-500/10 text-blue-400" :
                          "bg-destructive/10 text-destructive"
                        }`}>{b.paymentStatus || "unpaid"}</span>
                      </td>
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
function BookingsView({ onCreateAlbum }: { onCreateAlbum?: (bookingId: string) => void }) {
  const [bookings, setBookingsState] = useState<Booking[]>(getBookings());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const settings = getSettings();
  const eventTypes = getEventTypes();

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

  const handlePaymentChange = (bk: Booking, paymentStatus: PaymentStatus) => {
    updateBooking({ ...bk, paymentStatus });
    setBookingsState(getBookings());
    toast.success(`Payment marked as ${paymentStatus}`);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Bookings</h2>

      {bookings.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <Calendar className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-body text-muted-foreground">No bookings yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime()).map((bk) => {
            const isExpanded = expandedId === bk.id;
            const et = eventTypes.find(e => e.id === bk.eventTypeId);
            return (
              <div key={bk.id} className="glass-panel rounded-xl overflow-hidden">
                <div className="p-4 cursor-pointer hover:bg-secondary/20 transition-colors" onClick={() => setExpandedId(isExpanded ? null : bk.id)}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Users className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-body text-foreground font-medium">{bk.clientName}</h3>
                        {bk.instagramHandle && <span className="text-xs font-body text-primary">@{bk.instagramHandle.replace("@", "")}</span>}
                      </div>
                      <p className="text-xs font-body text-muted-foreground">{bk.type} · {bk.date} at {bk.time} · {formatDuration(bk.duration)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <select value={bk.status} onChange={(e) => handleStatusChange(bk, e.target.value as Booking["status"])}
                        className="text-xs font-body px-2.5 py-1 rounded-full bg-secondary border border-border text-foreground cursor-pointer">
                        <option value="pending">Pending</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      <select value={bk.paymentStatus || "unpaid"} onChange={(e) => handlePaymentChange(bk, e.target.value as PaymentStatus)}
                        className="text-xs font-body px-2.5 py-1 rounded-full bg-secondary border border-border text-foreground cursor-pointer">
                        <option value="unpaid">Unpaid</option>
                        <option value="paid">Paid</option>
                        <option value="cash">Cash</option>
                        <option value="pending-confirmation">Pending Confirm</option>
                      </select>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(bk.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div className="p-3 rounded-lg bg-secondary/50">
                        <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1">Email</p>
                        <p className="text-sm font-body text-foreground">{bk.clientEmail || "—"}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-secondary/50">
                        <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1">Amount</p>
                        <p className="text-sm font-body text-foreground">${bk.paymentAmount || 0}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-secondary/50">
                        <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1">Payment</p>
                        <p className="text-sm font-body text-foreground">{bk.paymentStatus || "unpaid"}</p>
                      </div>
                    </div>
                    {bk.answers && Object.keys(bk.answers).length > 0 && (
                      <div>
                        <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-2">Questionnaire Answers</p>
                        <div className="space-y-2">
                          {Object.entries(bk.answers).map(([qId, answer]) => {
                            const question = et?.questions.find(q => q.id === qId);
                            return (
                              <div key={qId} className="p-2 rounded-lg bg-secondary/30 border border-border/30">
                                <p className="text-[10px] font-body text-muted-foreground">{question?.label || qId}</p>
                                <p className="text-sm font-body text-foreground">{answer}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      {bk.albumId ? (
                        <a href={`/gallery/${bk.albumId}`} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="outline" className="gap-2 font-body text-xs border-border text-foreground">
                            <ExternalLink className="w-3.5 h-3.5" /> View Album
                          </Button>
                        </a>
                      ) : onCreateAlbum ? (
                        <Button size="sm" variant="outline" onClick={() => onCreateAlbum(bk.id)} className="gap-2 font-body text-xs border-border text-foreground">
                          <Image className="w-3.5 h-3.5" /> Create Album
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
          <Plus className="w-4 h-4" /> New
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
            toast.success(editing ? "Updated" : "Created");
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
                  {et.description && <p className="text-sm font-body text-muted-foreground mt-1 line-clamp-2">{et.description}</p>}
                  <div className="flex items-center gap-3 mt-2">
                    {et.price > 0 && <p className="text-sm font-body text-primary font-medium">${et.price}</p>}
                    <span className="text-xs font-body text-muted-foreground">{et.questions.length} questions</span>
                    <span className="text-xs font-body text-muted-foreground">
                      {et.availability.recurring.length} days + {et.availability.specificDates.length} specific
                    </span>
                    {et.location && <span className="text-xs font-body text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{et.location}</span>}
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
  const [location, setLocation] = useState(eventType?.location || "");
  const [durations, setDurations] = useState<number[]>(eventType?.durations || [30]);
  const [price, setPrice] = useState(eventType?.price || 0);
  const [requiresConfirmation, setRequiresConfirmation] = useState(eventType?.requiresConfirmation || false);
  const currentSettings = getSettings();
  const defaultQuestions: QuestionField[] = [
    { id: "q1", label: "Name", type: "text", required: true, placeholder: "Your full name" },
    { id: "q2", label: "Email", type: "text", required: true, placeholder: "you@example.com" },
  ];
  if (currentSettings.instagramFieldEnabled) {
    defaultQuestions.push({ id: "q-ig", label: "Instagram Handle", type: "text", required: false, placeholder: "@yourusername" });
  }
  const [questions, setQuestions] = useState<QuestionField[]>(eventType?.questions || defaultQuestions);
  const [recurring, setRecurring] = useState<AvailabilitySlot[]>(eventType?.availability?.recurring || []);
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
      location: location.trim(),
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
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Location</label>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Sydney CBD" className="bg-secondary border-border text-foreground font-body" />
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
            <div className="space-y-2">
              <p className="text-xs font-body text-muted-foreground font-medium">Specific Date Availability</p>
              {specificDates.map((sd, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs font-body">
                  <span className="text-foreground">{sd.date}</span>
                  <span className="text-primary">{sd.startTime} — {sd.endTime}</span>
                  <button onClick={() => setSpecificDates(specificDates.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              <div className="flex gap-2 items-end flex-wrap">
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
          <Save className="w-4 h-4" /> {isNew ? "Create" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ─── Albums ──────────────────────────────────────────
function AlbumsView({ prefillBookingId, onClearPrefill }: { prefillBookingId?: string | null; onClearPrefill?: () => void }) {
  const [albums, setAlbumsState] = useState<Album[]>(getAlbums());
  const bookings = getBookings();
  const settings = getSettings();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Album | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (prefillBookingId) {
      setShowNew(true);
      onClearPrefill?.();
    }
  }, [prefillBookingId]);

  const refresh = () => setAlbumsState(getAlbums());

  const handleDelete = (id: string) => {
    if (!confirm("Delete this album?")) return;
    deleteAlbum(id);
    refresh();
    toast.success("Album deleted");
  };

  const handleMerge = () => {
    if (mergeSelection.size < 2) { toast.error("Select at least 2 albums to merge"); return; }
    const selectedAlbums = albums.filter(a => mergeSelection.has(a.id));
    const mergedPhotos: Photo[] = [];
    const seen = new Set<string>();
    for (const alb of selectedAlbums) {
      for (const p of alb.photos) {
        if (!seen.has(p.id)) { mergedPhotos.push(p); seen.add(p.id); }
      }
    }
    const totalFree = selectedAlbums.reduce((sum, a) => sum + a.freeDownloads, 0);
    const merged: Album = {
      id: generateId("alb"),
      slug: slugify(selectedAlbums.map(a => a.title).join("-merged-")),
      title: selectedAlbums.map(a => a.title).join(" + "),
      description: "Merged album",
      coverImage: selectedAlbums[0].coverImage,
      date: new Date().toISOString().split("T")[0],
      photoCount: mergedPhotos.length,
      freeDownloads: totalFree,
      pricePerPhoto: settings.defaultPricePerPhoto,
      priceFullAlbum: settings.defaultPriceFullAlbum,
      isPublic: true,
      photos: mergedPhotos,
      clientName: selectedAlbums[0].clientName,
      clientEmail: selectedAlbums[0].clientEmail,
      mergedFrom: Array.from(mergeSelection),
    };
    addAlbum(merged);
    refresh();
    setMergeMode(false);
    setMergeSelection(new Set());
    toast.success(`Merged ${mergeSelection.size} albums with ${totalFree} free downloads`);
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/gallery/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Gallery link copied!");
  };

  const handleSendNotification = (album: Album) => {
    const template = settings.notificationEmailTemplate || "Hey {name}, your photos are ready! {link}";
    const link = `${window.location.origin}/gallery/${album.slug}`;
    const message = template
      .replace("{name}", album.clientName || "there")
      .replace("{link}", link)
      .replace("{instagram}", album.clientEmail || "");
    toast.info(`Email notification stub:\n\nTo: ${album.clientEmail || "no email"}\n${message}`);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Albums</h2>
        <div className="flex gap-2">
          {albums.length >= 2 && (
            <Button variant="outline" size="sm" onClick={() => { setMergeMode(!mergeMode); setMergeSelection(new Set()); }} className="gap-2 font-body text-xs border-border text-foreground">
              <Merge className="w-4 h-4" /> {mergeMode ? "Cancel Merge" : "Merge"}
            </Button>
          )}
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase">
            <Plus className="w-4 h-4" /> New Album
          </Button>
        </div>
      </div>

      {mergeMode && (
        <div className="glass-panel rounded-xl p-4 mb-4 flex items-center justify-between">
          <p className="text-sm font-body text-muted-foreground">Select albums to merge ({mergeSelection.size} selected)</p>
          <Button size="sm" onClick={handleMerge} disabled={mergeSelection.size < 2} className="bg-primary text-primary-foreground font-body text-xs gap-2">
            <Merge className="w-4 h-4" /> Merge Selected
          </Button>
        </div>
      )}

      {(showNew || editing) && (
        <AlbumEditor
          album={editing}
          bookings={bookings}
          settings={settings}
          prefillBookingId={showNew && !editing ? prefillBookingId : undefined}
          onSave={(alb) => {
            if (editing) { updateAlbum(alb); }
            else { addAlbum(alb); }
            refresh();
            setEditing(null);
            setShowNew(false);
            toast.success(editing ? "Album updated" : "Album created");
          }}
          onCancel={() => { setEditing(null); setShowNew(false); }}
        />
      )}

      {albums.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <Image className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-body text-muted-foreground">No albums yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {albums.map((alb) => (
            <div key={alb.id} className={`glass-panel rounded-xl overflow-hidden ${mergeMode ? "cursor-pointer" : ""} ${mergeSelection.has(alb.id) ? "ring-2 ring-primary" : ""}`}
              onClick={() => {
                if (mergeMode) {
                  setMergeSelection(prev => {
                    const next = new Set(prev);
                    if (next.has(alb.id)) next.delete(alb.id); else next.add(alb.id);
                    return next;
                  });
                }
              }}
            >
              {alb.coverImage && (
                <div className="aspect-video bg-secondary overflow-hidden">
                  <img src={alb.coverImage} alt={alb.title} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="p-4 space-y-2">
                <h3 className="font-display text-base text-foreground">{alb.title}</h3>
                <p className="text-xs font-body text-muted-foreground">
                  {alb.photos.length} photos · {alb.freeDownloads} free · ${alb.pricePerPhoto}/photo
                </p>
                {alb.clientName && <p className="text-xs font-body text-primary">{alb.clientName}</p>}
                {alb.mergedFrom && <p className="text-[10px] font-body text-muted-foreground/50">Merged from {alb.mergedFrom.length} albums</p>}
                {!mergeMode && (
                  <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => copyLink(alb.slug)}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => handleSendNotification(alb)}>
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                    <a href={`/gallery/${alb.slug}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </a>
                    <div className="flex-1" />
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setEditing(alb)}>
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(alb.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Album Editor ────────────────────────────────────
function AlbumEditor({ album, bookings, settings, prefillBookingId, onSave, onCancel }: {
  album: Album | null;
  bookings: Booking[];
  settings: AppSettings;
  prefillBookingId?: string | null;
  onSave: (alb: Album) => void;
  onCancel: () => void;
}) {
  const isNew = !album;
  const prefillBk = prefillBookingId ? bookings.find(b => b.id === prefillBookingId) : null;
  const [title, setTitle] = useState(album?.title || (prefillBk ? `${prefillBk.clientName} — ${prefillBk.type}` : ""));
  const [slug, setSlug] = useState(album?.slug || (prefillBk ? slugify(`${prefillBk.clientName}-${prefillBk.date}`) : ""));
  const [description, setDescription] = useState(album?.description || "");
  const [bookingId, setBookingId] = useState(album?.bookingId || prefillBookingId || "");
  const [clientName, setClientName] = useState(album?.clientName || prefillBk?.clientName || "");
  const [clientEmail, setClientEmail] = useState(album?.clientEmail || prefillBk?.clientEmail || "");
  const [freeDownloads, setFreeDownloads] = useState(album?.freeDownloads ?? settings.defaultFreeDownloads);
  const [pricePerPhoto, setPricePerPhoto] = useState(album?.pricePerPhoto ?? settings.defaultPricePerPhoto);
  const [priceFullAlbum, setPriceFullAlbum] = useState(album?.priceFullAlbum ?? settings.defaultPriceFullAlbum);
  const [photos, setPhotos] = useState<Photo[]>(album?.photos || []);
  const [coverImage, setCoverImage] = useState(album?.coverImage || "");
  const [accessCode, setAccessCode] = useState(album?.accessCode || "");

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result as string;
        const id = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        setPhotos(prev => [...prev, { id, src, title: file.name.replace(/\.[^.]+$/, ""), width: 800, height: 600 }]);
        if (!coverImage) setCoverImage(src);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleBookingLink = (bkId: string) => {
    setBookingId(bkId);
    const bk = bookings.find(b => b.id === bkId);
    if (bk) {
      if (!clientName) setClientName(bk.clientName);
      if (!clientEmail) setClientEmail(bk.clientEmail);
      if (!title) setTitle(`${bk.clientName} — ${bk.type}`);
      if (!slug) setSlug(slugify(`${bk.clientName}-${bk.date}`));
    }
  };

  const handleSave = () => {
    if (!title.trim()) { toast.error("Title required"); return; }
    const finalSlug = slug.trim() || slugify(title);
    const albumId = album?.id || generateId("alb");
    onSave({
      id: albumId,
      slug: finalSlug,
      title: title.trim(),
      description: description.trim(),
      coverImage: coverImage || (photos[0]?.src || ""),
      date: new Date().toISOString().split("T")[0],
      photoCount: photos.length,
      freeDownloads,
      pricePerPhoto,
      priceFullAlbum,
      isPublic: true,
      photos,
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      bookingId: bookingId || undefined,
      accessCode: accessCode || undefined,
      mergedFrom: album?.mergedFrom,
    });
    if (bookingId) {
      const bk = bookings.find(b => b.id === bookingId);
      if (bk) {
        updateBooking({ ...bk, albumId });
      }
    }
  };

  return (
    <div className="glass-panel rounded-xl p-6 mb-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg text-foreground">{isNew ? "New Album" : "Edit Album"}</h3>
        <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-4 h-4" /></Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Title *</label>
          <Input value={title} onChange={(e) => { setTitle(e.target.value); if (!slug || slug === slugify(album?.title || "")) setSlug(slugify(e.target.value)); }} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Custom URL Slug</label>
          <div className="flex items-center gap-2">
            <span className="text-xs font-body text-muted-foreground">/gallery/</span>
            <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} className="bg-secondary border-border text-foreground font-body" />
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Description</label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="bg-secondary border-border text-foreground font-body min-h-[50px]" />
      </div>

      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Link to Booking</label>
        <select value={bookingId} onChange={(e) => handleBookingLink(e.target.value)} className="w-full bg-secondary border border-border text-foreground font-body text-sm rounded-md px-3 py-2.5">
          <option value="">No booking (standalone)</option>
          {bookings.map(bk => (
            <option key={bk.id} value={bk.id}>{bk.clientName} — {bk.type} ({bk.date})</option>
          ))}
        </select>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Client Name</label>
          <Input value={clientName} onChange={(e) => setClientName(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Client Email</label>
          <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
      </div>

      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Album PIN (optional)</label>
        <Input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Leave empty for no PIN" className="bg-secondary border-border text-foreground font-body" />
        <p className="text-[10px] font-body text-muted-foreground/50 mt-1">Visitors must enter this PIN to view the gallery</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Free Downloads</label>
          <Input type="number" value={freeDownloads} onChange={(e) => setFreeDownloads(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">$/Photo</label>
          <Input type="number" value={pricePerPhoto} onChange={(e) => setPricePerPhoto(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Full Album $</label>
          <Input type="number" value={priceFullAlbum} onChange={(e) => setPriceFullAlbum(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" />
        </div>
      </div>

      {/* Photo Upload */}
      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Photos ({photos.length})</label>
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/30 transition-colors cursor-pointer relative mb-3">
          <Upload className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-xs font-body text-muted-foreground">Click to upload photos or drag and drop</p>
          <p className="text-[10px] font-body text-muted-foreground/50 mt-1">Multiple files supported</p>
          <input type="file" accept="image/*" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handlePhotoUpload} />
        </div>
        {photos.length > 0 && (
          <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto">
            {photos.map(p => (
              <div key={p.id} className="relative group aspect-square rounded-md overflow-hidden bg-secondary">
                <img src={p.src} alt={p.title} className="w-full h-full object-cover" />
                <button onClick={() => setPhotos(photos.filter(pp => pp.id !== p.id))}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-2 border-t border-border/50">
        <Button variant="outline" onClick={onCancel} className="font-body text-xs border-border text-foreground">Cancel</Button>
        <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
          <Save className="w-4 h-4" /> {isNew ? "Create Album" : "Save Album"}
        </Button>
      </div>
    </div>
  );
}

// ─── Photo Library ───────────────────────────────────
function PhotosView() {
  const [photos, setPhotosState] = useState<Photo[]>(getPhotoLibrary());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result as string;
        const photo: Photo = { id: generateId("ph"), src, title: file.name.replace(/\.[^.]+$/, ""), width: 800, height: 600 };
        setPhotosState(prev => {
          const updated = [...prev, photo];
          setPhotoLibrary(updated);
          return updated;
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDeletePhoto = (id: string) => {
    const updated = photos.filter(p => p.id !== id);
    setPhotoLibrary(updated);
    setPhotosState(updated);
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const handleCreateAlbumFromSelection = () => {
    if (selectedIds.size === 0) { toast.error("Select photos first"); return; }
    const selectedPhotos = photos.filter(p => selectedIds.has(p.id));
    const s = getSettings();
    const alb: Album = {
      id: generateId("alb"),
      slug: slugify(`album-${Date.now()}`),
      title: "New Album",
      description: "",
      coverImage: selectedPhotos[0]?.src || "",
      date: new Date().toISOString().split("T")[0],
      photoCount: selectedPhotos.length,
      freeDownloads: s.defaultFreeDownloads,
      pricePerPhoto: s.defaultPricePerPhoto,
      priceFullAlbum: s.defaultPriceFullAlbum,
      isPublic: true,
      photos: selectedPhotos,
    };
    addAlbum(alb);
    toast.success(`Album created with ${selectedPhotos.length} photos — go to Albums tab to edit`);
    setSelectedIds(new Set());
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Photo Library</h2>
        {selectedIds.size > 0 && (
          <Button size="sm" onClick={handleCreateAlbumFromSelection} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase">
            <Plus className="w-4 h-4" /> Create Album ({selectedIds.size})
          </Button>
        )}
      </div>

      <div className="glass-panel rounded-xl p-6 mb-6">
        <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/30 transition-colors cursor-pointer relative">
          <Upload className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm font-body text-muted-foreground">Upload photos to your library</p>
          <p className="text-[10px] font-body text-muted-foreground/50 mt-1">Select photos then create albums from them</p>
          <input type="file" accept="image/*" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleUpload} />
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <Image className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-body text-muted-foreground">No photos in library yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
          {photos.map(p => (
            <div key={p.id} className={`relative group aspect-square rounded-lg overflow-hidden bg-secondary cursor-pointer border-2 transition-all ${selectedIds.has(p.id) ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-border"}`}
              onClick={() => toggleSelect(p.id)}>
              <img src={p.src} alt={p.title} className="w-full h-full object-cover" />
              {selectedIds.has(p.id) && (
                <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">✓</div>
              )}
              <button onClick={(e) => { e.stopPropagation(); handleDeletePhoto(p.id); }}
                className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </motion.div>
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
    toast.success("Profile saved!");
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Profile & Cover Page</h2>
      <div className="max-w-lg space-y-6">
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

  const handleWatermarkImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSettingsState({ ...settings, watermarkImage: reader.result as string });
    reader.readAsDataURL(file);
  };

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
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Watermark Image (optional, overrides text)</label>
            <div className="flex items-center gap-4">
              <label className="cursor-pointer">
                <div className="w-20 h-12 rounded-md bg-secondary border-2 border-dashed border-border flex items-center justify-center overflow-hidden">
                  {settings.watermarkImage ? <img src={settings.watermarkImage} alt="Watermark" className="w-full h-full object-contain" /> : <Upload className="w-4 h-4 text-muted-foreground/50" />}
                </div>
                <input type="file" accept="image/*" onChange={handleWatermarkImageUpload} className="hidden" />
              </label>
              {settings.watermarkImage && <button onClick={() => setSettingsState({ ...settings, watermarkImage: "" })} className="text-xs font-body text-destructive hover:underline">Remove</button>}
            </div>
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

        {/* Booking */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground">Booking Settings</h3>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Booking Timer (minutes)</label>
            <Input type="number" value={settings.bookingTimerMinutes} onChange={(e) => setSettingsState({ ...settings, bookingTimerMinutes: Number(e.target.value) })} className="bg-secondary border-border text-foreground font-body w-32" />
            <p className="text-[10px] font-body text-muted-foreground/50 mt-1">How long a client has to complete their booking after selecting a time</p>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-body text-muted-foreground">Show Instagram Handle Field</span>
            <Switch checked={settings.instagramFieldEnabled} onCheckedChange={(v) => setSettingsState({ ...settings, instagramFieldEnabled: v })} />
          </div>
        </div>

        {/* Notification Email */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground">Notification Email Template</h3>
          <Textarea value={settings.notificationEmailTemplate} onChange={(e) => setSettingsState({ ...settings, notificationEmailTemplate: e.target.value })}
            className="bg-secondary border-border text-foreground font-body min-h-[80px]" placeholder="Hey {name}, your photos are ready! {link}" />
          <p className="text-[10px] font-body text-muted-foreground/50">Variables: {"{name}"}, {"{link}"}, {"{instagram}"}. Requires SMTP backend to send.</p>
        </div>

        {/* Discord Webhook */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" /> Discord Webhooks
          </h3>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Webhook URL</label>
            <Input value={settings.discordWebhookUrl} onChange={(e) => setSettingsState({ ...settings, discordWebhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/..." className="bg-secondary border-border text-foreground font-body" />
            <p className="text-[10px] font-body text-muted-foreground/50 mt-1">Receive notifications for new bookings and reminders. Requires backend service to send.</p>
          </div>
        </div>

        {/* Payment Methods */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" /> Payment Methods
          </h3>

          {/* Stripe */}
          <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-body text-foreground font-medium flex items-center gap-2">
                <CreditCard className="w-4 h-4" /> Stripe
              </span>
              <Switch checked={settings.stripeEnabled} onCheckedChange={(v) => setSettingsState({ ...settings, stripeEnabled: v })} />
            </div>
            <p className="text-[10px] font-body text-muted-foreground/50 mt-2">Configure STRIPE_SECRET_KEY in Docker env vars</p>
          </div>

          {/* Bank Transfer */}
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
        </div>

        <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
          <Save className="w-4 h-4" /> Save All Settings
        </Button>
      </div>
    </motion.div>
  );
}
