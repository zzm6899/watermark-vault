import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Calendar, Settings, Plus, Upload,
  Trash2, Edit, Users, Clock, CreditCard, Building2,
  Camera, Save, X, LogOut, ChevronDown, ChevronUp,
  Image, DollarSign, Link2, Merge, Send, Copy, ExternalLink,
  MapPin, Lock, Bell, Download, Unlock, Eye, Grid, List, LayoutGrid, HardDrive, CheckSquare, XSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import {
  getProfile, setProfile, getEventTypes, setEventTypes, addEventType,
  deleteEventType, updateEventType, getBookings, deleteBooking,
  updateBooking, getSettings, setSettings, logout,
  getAlbums, addAlbum, updateAlbum, deleteAlbum,
  getPhotoLibrary, setPhotoLibrary,
} from "@/lib/storage";
import { compressImage, formatBytes, getLocalStorageUsage, generateThumbnail } from "@/lib/image-utils";
import { uploadPhotosToServer, isServerMode, deletePhotoFromServer, getGoogleCalendarStatus, startGoogleCalendarAuth, disconnectGoogleCalendar, getGoogleCalendars, syncAllBookingsToCalendar, syncBookingToCalendar, getServerStorageStats } from "@/lib/api";
import type {
  EventType, QuestionField, AvailabilitySlot,
  ProfileSettings, AppSettings, Booking, WatermarkPosition,
  Album, Photo, PaymentStatus, AlbumDisplaySize, AlbumDownloadRecord, DownloadHistoryEntry,
} from "@/lib/types";
import WatermarkedImage from "@/components/WatermarkedImage";
import ProgressiveImg from "@/components/ProgressiveImg";
import { Slider } from "@/components/ui/slider";
import sampleLandscape from "@/assets/sample-landscape.jpg";
import samplePortrait from "@/assets/sample-portrait.jpg";
import sampleWedding from "@/assets/sample-wedding.jpg";
import sampleEvent from "@/assets/sample-event.jpg";
import sampleFood from "@/assets/sample-food.jpg";

type Tab = "dashboard" | "bookings" | "events" | "albums" | "photos" | "profile" | "settings" | "storage";

const TAB_ROUTE_MAP: Record<string, Tab> = {
  dashboard: "dashboard",
  bookings: "bookings",
  events: "events",
  albums: "albums",
  photos: "photos",
  profile: "profile",
  settings: "settings",
  storage: "storage",
};

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
  const { tab: routeTab } = useParams<{ tab?: string }>();
  const resolvedTab = (routeTab && TAB_ROUTE_MAP[routeTab]) || "dashboard";
  const [activeTab, setActiveTabState] = useState<Tab>(resolvedTab);
  
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    navigate(`/admin/${tab}`, { replace: true });
  };
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
    { id: "events" as Tab, label: "Events", icon: Clock },
    { id: "albums" as Tab, label: "Albums", icon: Image },
    { id: "photos" as Tab, label: "Photos", icon: Upload },
    { id: "profile" as Tab, label: "Profile", icon: Camera },
    { id: "settings" as Tab, label: "Settings", icon: Settings },
    { id: "storage" as Tab, label: "Storage", icon: HardDrive },
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
          {activeTab === "events" && <EventTypesView />}
          {activeTab === "albums" && <AlbumsView prefillBookingId={prefillBookingId} onClearPrefill={() => setPrefillBookingId(null)} />}
          {activeTab === "photos" && <PhotosView />}
          {activeTab === "profile" && <ProfileView />}
          {activeTab === "settings" && <SettingsView />}
          {activeTab === "storage" && <StorageView />}
        </main>
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────
function DashboardView() {
  const bookings = getBookings();
  const albums = getAlbums();
  const settings = getSettings();

  const totalIncome = bookings.reduce((sum, b) => sum + (b.paymentAmount || 0), 0);
  const paidIncome = bookings.filter(b => b.paymentStatus === "paid").reduce((sum, b) => sum + (b.paymentAmount || 0), 0);
  const unpaidIncome = bookings.filter(b => !b.paymentStatus || b.paymentStatus === "unpaid").reduce((sum, b) => sum + (b.paymentAmount || 0), 0);
  const pendingIncome = bookings.filter(b => b.paymentStatus === "pending-confirmation" || b.paymentStatus === "cash").reduce((sum, b) => sum + (b.paymentAmount || 0), 0);

  // Collect all pending download requests across albums
  const allPendingRequests: (AlbumDownloadRecord & { _albumId: string; _albumTitle: string; _reqIdx: number })[] = [];
  for (const alb of albums) {
    (alb.downloadRequests || []).forEach((req, idx) => {
      if (req.status === "pending") {
        allPendingRequests.push({ ...req, _albumId: alb.id, _albumTitle: alb.title, _reqIdx: idx });
      }
    });
  }

  // Download stats per album
  const albumDownloadStats = albums.map(alb => {
    const history = alb.downloadHistory || [];
    const totalDownloaded = history.reduce((sum, h) => sum + h.photoIds.length, 0);
    return { id: alb.id, title: alb.title, totalPhotos: alb.photos.length, totalDownloaded, sessions: history.length, lastDownload: history.length > 0 ? history[history.length - 1].downloadedAt : null };
  }).filter(a => a.totalPhotos > 0);

  const handleApproveRequest = (albumId: string, reqIdx: number) => {
    const alb = albums.find(a => a.id === albumId);
    if (!alb) return;
    const updated = { ...alb };
    updated.downloadRequests = updated.downloadRequests!.map((r, i) => i === reqIdx ? { ...r, status: "approved" as const, approvedAt: new Date().toISOString() } : r);
    updateAlbum(updated);
    toast.success("Download request approved — client can now download");
  };

  const stats = [
    { label: "Total Bookings", value: bookings.length, icon: Calendar, color: "text-primary" },
    { label: "Paid", value: `$${paidIncome}`, icon: DollarSign, color: "text-green-400" },
    { label: "Unpaid", value: `$${unpaidIncome}`, icon: DollarSign, color: "text-destructive" },
    { label: "Pending Requests", value: allPendingRequests.length, icon: Download, color: "text-yellow-400" },
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

      {/* Pending Download Requests */}
      {allPendingRequests.length > 0 && (
        <>
          <h3 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
            <Download className="w-5 h-5 text-yellow-400" /> Pending Download Requests
          </h3>
          <div className="space-y-2 mb-8">
            {allPendingRequests.map((req, i) => (
              <div key={i} className="glass-panel rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-body text-foreground font-medium">{req._albumTitle}</p>
                  <p className="text-xs font-body text-muted-foreground">
                    {req.photoIds.length} photos · {req.method} · {new Date(req.requestedAt).toLocaleDateString()}
                  </p>
                  {req.clientNote && <p className="text-xs font-body text-muted-foreground mt-1 italic">"{req.clientNote}"</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => handleApproveRequest(req._albumId, req._reqIdx)}
                  className="gap-1 text-xs font-body border-green-500/30 text-green-400 hover:bg-green-500/10 flex-shrink-0">
                  <Unlock className="w-3 h-3" /> Approve
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Album Download Stats */}
      {albumDownloadStats.length > 0 && (
        <>
          <h3 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
            <Image className="w-5 h-5 text-primary" /> Album Download Stats
          </h3>
          <div className="glass-panel rounded-xl overflow-hidden mb-8">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Album</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Photos</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Downloads</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Sessions</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Last Download</th>
                  </tr>
                </thead>
                <tbody>
                  {albumDownloadStats.map(a => (
                    <tr key={a.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="p-4 text-sm font-body text-foreground">{a.title}</td>
                      <td className="p-4 text-sm font-body text-muted-foreground">{a.totalPhotos}</td>
                      <td className="p-4 text-sm font-body text-primary font-medium">{a.totalDownloaded}</td>
                      <td className="p-4 text-sm font-body text-muted-foreground">{a.sessions}</td>
                      <td className="p-4 text-sm font-body text-muted-foreground">{a.lastDownload ? new Date(a.lastDownload).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

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
    defaultQuestions.push({ id: "q-ig", label: "Instagram Handle", type: "instagram", required: false, placeholder: "yourusername" });
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
                    <option value="instagram">Instagram Handle</option>
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
            onClearPrefill?.();
            toast.success(editing ? "Album updated" : "Album created");
          }}
          onCancel={() => { setEditing(null); setShowNew(false); onClearPrefill?.(); }}
        />
      )}

      {albums.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <Image className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-body text-muted-foreground">No albums yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
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
                <div className="aspect-[16/9] bg-secondary overflow-hidden">
                  <img src={alb.coverImage} alt={alb.title} className="w-full h-full object-cover" loading="lazy" />
                </div>
              )}
              <div className="p-3 space-y-1">
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
  const [allUnlocked, setAllUnlocked] = useState(album?.allUnlocked || false);
  const [displaySize, setDisplaySize] = useState<AlbumDisplaySize>(album?.displaySize || "medium");

  const [uploadStats, setUploadStats] = useState<{ total: number; done: number; errors: number; savedBytes: number } | null>(null);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    setUploadStats({ total: fileArr.length, done: 0, errors: 0, savedBytes: 0 });

    if (isServerMode()) {
      // Upload to server — files saved to TrueNAS disk
      const results = await uploadPhotosToServer(fileArr, (done, total) => {
        setUploadStats(prev => prev ? { ...prev, done, total } : null);
      });
      // Add all photos immediately (no thumbnail yet) so none are lost if modal closes
      const newPhotos: Photo[] = results.map(r => ({
        id: r.id, src: r.url, title: r.originalName.replace(/\.[^.]+$/, ""), width: 800, height: 600,
      }));
      setPhotos(prev => [...prev, ...newPhotos]);
      if (!coverImage && newPhotos.length > 0) setCoverImage(newPhotos[0].src);
      setUploadStats(prev => prev ? { ...prev, done: fileArr.length, errors: fileArr.length - results.length, savedBytes: 0 } : null);
      if (results.length > 0) toast.success(`${results.length} photos uploaded to server`);
      // Generate thumbnails in background (non-blocking)
      for (const r of results) {
        generateThumbnail(r.url).then(thumb => {
          setPhotos(prev => prev.map(p => p.id === r.id ? { ...p, thumbnail: thumb } : p));
        }).catch(() => {});
      }
    } else {
      // Fallback: compress to base64 for localStorage
      for (const file of fileArr) {
        try {
          const result = await compressImage(file);
          const id = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
          const thumb = await generateThumbnail(result.src).catch(() => undefined);
          setPhotos(prev => [...prev, { id, src: result.src, thumbnail: thumb, title: file.name.replace(/\.[^.]+$/, ""), width: result.width, height: result.height }]);
          if (!coverImage) setCoverImage(result.src);
          setUploadStats(prev => prev ? { ...prev, done: prev.done + 1, savedBytes: prev.savedBytes + (result.originalSize - result.compressedSize) } : null);
        } catch {
          setUploadStats(prev => prev ? { ...prev, done: prev.done + 1, errors: prev.errors + 1 } : null);
          toast.error(`Failed to process: ${file.name}`);
        }
      }
    }
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

  const existingAlbums = getAlbums();
  const handleSave = () => {
    if (!title.trim()) { toast.error("Title required"); return; }
    const finalSlug = slug.trim() || slugify(title);
    const slugTaken = existingAlbums.some(a => a.slug === finalSlug && a.id !== album?.id);
    if (slugTaken) { toast.error("URL slug already exists — choose a different one"); return; }
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
      allUnlocked,
      displaySize,
      usedFreeDownloads: album?.usedFreeDownloads,
      downloadRequests: album?.downloadRequests,
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
            <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} className="bg-secondary border-border text-foreground font-body flex-1" />
            {slug && (
              <span className={`text-[10px] font-body whitespace-nowrap ${existingAlbums.some(a => a.slug === slug && a.id !== album?.id) ? "text-destructive" : "text-green-500"}`}>
                {existingAlbums.some(a => a.slug === slug && a.id !== album?.id) ? "⚠ Already taken" : "✓ Available"}
              </span>
            )}
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

      {/* Unlock & Display */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-body text-muted-foreground flex items-center gap-2">
              <Unlock className="w-3.5 h-3.5" /> All Downloads Unlocked
            </span>
            <Switch checked={allUnlocked} onCheckedChange={setAllUnlocked} />
          </div>
          <p className="text-[10px] font-body text-muted-foreground/50 mt-1">When enabled, all photos can be downloaded without watermark</p>
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Display Size</label>
          <div className="flex gap-2">
            {(["small", "medium", "large", "list"] as AlbumDisplaySize[]).map(size => (
              <button key={size} onClick={() => setDisplaySize(size)}
                className={`text-xs font-body py-2 px-3 rounded-lg border transition-all capitalize ${displaySize === size ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                {size}
              </button>
            ))}
          </div>
        </div>
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

      {/* Download Requests */}
      {album?.downloadRequests && album.downloadRequests.length > 0 && (
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">
            Download Requests ({album.downloadRequests.filter(r => r.status === "pending").length} pending)
          </label>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {album.downloadRequests.map((req, idx) => (
              <div key={idx} className={`p-3 rounded-lg border ${req.status === "pending" ? "bg-yellow-500/5 border-yellow-500/20" : req.status === "approved" ? "bg-green-500/5 border-green-500/20" : "bg-secondary/50 border-border/50"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-body text-foreground">{req.photoIds.length} photos · {req.method}</p>
                    <p className="text-[10px] font-body text-muted-foreground">{new Date(req.requestedAt).toLocaleString()}</p>
                    {req.clientNote && <p className="text-[10px] font-body text-muted-foreground mt-1">Note: {req.clientNote}</p>}
                  </div>
                  {req.status === "pending" && (
                    <Button size="sm" variant="outline" onClick={() => {
                      const updated = { ...album };
                      updated.downloadRequests = updated.downloadRequests!.map((r, i) => i === idx ? { ...r, status: "approved" as const, approvedAt: new Date().toISOString() } : r);
                      updateAlbum(updated);
                      toast.success("Download request approved");
                    }} className="gap-1 text-xs font-body border-green-500/30 text-green-400 hover:bg-green-500/10">
                      <Unlock className="w-3 h-3" /> Approve
                    </Button>
                  )}
                  {req.status !== "pending" && (
                    <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${req.status === "approved" ? "bg-green-500/10 text-green-400" : "bg-secondary text-muted-foreground"}`}>
                      {req.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Photo Upload */}
      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Photos ({photos.length})</label>
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/30 transition-colors cursor-pointer relative mb-3">
          <Upload className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-xs font-body text-muted-foreground">Click to upload photos or drag and drop</p>
          <p className="text-[10px] font-body text-muted-foreground/50 mt-1">Multiple files supported</p>
          <input type="file" accept="image/*" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handlePhotoUpload} />
        </div>
        {uploadStats && (
          <div className="mb-3 p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center justify-between text-xs font-body text-muted-foreground">
              <span>Processed {uploadStats.done}/{uploadStats.total} photos{uploadStats.errors > 0 ? ` (${uploadStats.errors} failed)` : ""}</span>
              {uploadStats.savedBytes > 0 && <span className="text-green-500">Saved {formatBytes(uploadStats.savedBytes)}</span>}
            </div>
            {uploadStats.done < uploadStats.total && (
              <div className="mt-1.5 h-1.5 rounded-full bg-border overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(uploadStats.done / uploadStats.total) * 100}%` }} />
              </div>
            )}
          </div>
        )}
        {photos.length > 0 && (
          <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 max-h-48 overflow-y-auto">
            {photos.map(p => (
              <div key={p.id} className="relative group aspect-square rounded-md overflow-hidden bg-secondary">
                <ProgressiveImg thumbSrc={p.thumbnail} fullSrc={p.src} alt={p.title} className="w-full h-full object-cover" loading="lazy" />
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
  const [libraryPhotos, setLibraryPhotosState] = useState<Photo[]>(getPhotoLibrary());
  const [albums, setAlbumsState] = useState<Album[]>(getAlbums());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploadStats, setUploadStats] = useState<{ total: number; done: number; errors: number; savedBytes: number } | null>(null);
  const [showAddToAlbum, setShowAddToAlbum] = useState(false);
  const [viewSource, setViewSource] = useState<"all" | "library" | string>("all");

  // Build unified photo list — don't dedup across sources so album filters work
  const allPhotos: (Photo & { source: string })[] = [];
  const seenInAll = new Set<string>();
  for (const p of libraryPhotos) {
    if (!seenInAll.has(p.src)) { allPhotos.push({ ...p, source: "Library" }); seenInAll.add(p.src); }
  }
  for (const alb of albums) {
    for (const p of alb.photos) {
      if (!seenInAll.has(p.src)) { allPhotos.push({ ...p, source: alb.title }); seenInAll.add(p.src); }
    }
  }

  // For album-specific filters, pull directly from album.photos (not allPhotos) so added photos always appear
  const getAlbumPhotos = (albumTitle: string): (Photo & { source: string })[] => {
    const alb = albums.find(a => a.title === albumTitle);
    return alb ? alb.photos.map(p => ({ ...p, source: alb.title })) : [];
  };

  const displayPhotos = viewSource === "all" ? allPhotos : viewSource === "library" ? libraryPhotos.map(p => ({ ...p, source: "Library" })) : getAlbumPhotos(viewSource);

  // Determine if we're viewing a specific album (for upload-to-album)
  const selectedAlbum = viewSource !== "all" && viewSource !== "library" ? albums.find(a => a.title === viewSource) : null;

  const addPhotoToTarget = (photo: Photo) => {
    if (selectedAlbum) {
      // Upload directly to the selected album
      const alb = albums.find(a => a.id === selectedAlbum.id);
      if (alb) {
        const updated = { ...alb, photos: [...alb.photos, photo], photoCount: alb.photos.length + 1 };
        if (!updated.coverImage) updated.coverImage = photo.src;
        updateAlbum(updated);
        setAlbumsState(getAlbums());
      }
    } else {
      // Upload to library
      setLibraryPhotosState(prev => {
        const updated = [...prev, photo];
        setPhotoLibrary(updated);
        return updated;
      });
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    setUploadStats({ total: fileArr.length, done: 0, errors: 0, savedBytes: 0 });

    if (isServerMode()) {
      const results = await uploadPhotosToServer(fileArr, (done, total) => {
        setUploadStats(prev => prev ? { ...prev, done, total } : null);
      });
      // Add all photos immediately so none are lost if tab closes
      const newPhotos: Photo[] = results.map(r => ({
        id: r.id, src: r.url, title: r.originalName.replace(/\.[^.]+$/, ""), width: 800, height: 600,
      }));
      for (const photo of newPhotos) addPhotoToTarget(photo);
      setUploadStats(prev => prev ? { ...prev, done: fileArr.length, errors: fileArr.length - results.length } : null);
      const target = selectedAlbum ? `"${selectedAlbum.title}"` : "library";
      if (results.length > 0) toast.success(`${results.length} photos uploaded to ${target}`);
      // Generate thumbnails in background (non-blocking)
      for (const r of results) {
        generateThumbnail(r.url).then(thumb => {
          // Update in library or album depending on target
          if (selectedAlbum) {
            setAlbumsState(prev => prev.map(a => a.id === selectedAlbum.id
              ? { ...a, photos: a.photos.map(p => p.id === r.id ? { ...p, thumbnail: thumb } : p) }
              : a
            ));
          } else {
            setLibraryPhotosState(prev => prev.map(p => p.id === r.id ? { ...p, thumbnail: thumb } : p));
          }
        }).catch(() => {});
      }
    } else {
      for (const file of fileArr) {
        try {
          const result = await compressImage(file);
          const thumb = await generateThumbnail(result.src).catch(() => undefined);
          const photo: Photo = { id: generateId("ph"), src: result.src, thumbnail: thumb, title: file.name.replace(/\.[^.]+$/, ""), width: result.width, height: result.height };
          addPhotoToTarget(photo);
          setUploadStats(prev => prev ? { ...prev, done: prev.done + 1, savedBytes: prev.savedBytes + (result.originalSize - result.compressedSize) } : null);
        } catch {
          setUploadStats(prev => prev ? { ...prev, done: prev.done + 1, errors: prev.errors + 1 } : null);
          toast.error(`Failed to process: ${file.name}`);
        }
      }
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDeletePhoto = (id: string, source: string) => {
    if (source === "Library") {
      const updated = libraryPhotos.filter(p => p.id !== id);
      setPhotoLibrary(updated);
      setLibraryPhotosState(updated);
    } else {
      // Remove from the album it belongs to
      const alb = albums.find(a => a.title === source);
      if (alb) {
        const updated = { ...alb, photos: alb.photos.filter(p => p.id !== id), photoCount: alb.photos.length - 1 };
        updateAlbum(updated);
        setAlbumsState(getAlbums());
      }
    }
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const handleMassDelete = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected photo(s)?`)) return;

    // Separate by source
    const libToDelete = new Set<string>();
    const albumUpdates = new Map<string, Set<string>>(); // albumId -> photoIds to remove

    for (const id of selectedIds) {
      const photo = allPhotos.find(p => p.id === id);
      if (!photo) continue;
      if (photo.source === "Library") {
        libToDelete.add(id);
        const lp = libraryPhotos.find(p => p.id === id);
        if (lp && isServerMode()) deletePhotoFromServer(lp.src);
      } else {
        const alb = albums.find(a => a.title === photo.source);
        if (alb) {
          if (!albumUpdates.has(alb.id)) albumUpdates.set(alb.id, new Set());
          albumUpdates.get(alb.id)!.add(id);
        }
      }
    }

    // Delete from library
    if (libToDelete.size > 0) {
      const remaining = libraryPhotos.filter(p => !libToDelete.has(p.id));
      setPhotoLibrary(remaining);
      setLibraryPhotosState(remaining);
    }

    // Delete from albums
    for (const [albumId, photoIds] of albumUpdates) {
      const alb = albums.find(a => a.id === albumId);
      if (alb) {
        const updated = { ...alb, photos: alb.photos.filter(p => !photoIds.has(p.id)), photoCount: alb.photos.length - photoIds.size };
        updateAlbum(updated);
      }
    }
    if (albumUpdates.size > 0) setAlbumsState(getAlbums());

    setSelectedIds(new Set());
    toast.success(`Deleted ${selectedIds.size} photos`);
  };

  const handleCreateAlbumFromSelection = () => {
    if (selectedIds.size === 0) { toast.error("Select photos first"); return; }
    const selectedPhotos = allPhotos.filter(p => selectedIds.has(p.id));
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
    setAlbumsState(getAlbums());
    toast.success(`Album created with ${selectedPhotos.length} photos — go to Albums tab to edit`);
    setSelectedIds(new Set());
  };

  const handleAddToAlbum = (albumId: string) => {
    const selectedPhotos = allPhotos.filter(p => selectedIds.has(p.id));
    const album = albums.find(a => a.id === albumId);
    if (!album) return;
    const existingSrcs = new Set(album.photos.map(p => p.src));
    const newPhotos = selectedPhotos.filter(p => !existingSrcs.has(p.src));
    if (newPhotos.length === 0) { toast.info("All selected photos are already in this album"); return; }
    const updated = { ...album, photos: [...album.photos, ...newPhotos], photoCount: album.photos.length + newPhotos.length };
    if (!updated.coverImage && newPhotos[0]) updated.coverImage = newPhotos[0].src;
    updateAlbum(updated);
    setAlbumsState(getAlbums());
    toast.success(`Added ${newPhotos.length} photo${newPhotos.length !== 1 ? "s" : ""} to "${album.title}"`);
    setSelectedIds(new Set());
    setShowAddToAlbum(false);
  };

  // Unique sources for filter
  const sources = ["all", "library", ...albums.map(a => a.title)];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Photo Library</h2>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={handleMassDelete} className="gap-2 font-body text-xs border-destructive/30 text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4" /> Delete ({selectedIds.size})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="gap-1 font-body text-xs text-muted-foreground">
                <XSquare className="w-4 h-4" /> Clear
              </Button>
              <div className="relative">
                <Button size="sm" variant="outline" onClick={() => setShowAddToAlbum(!showAddToAlbum)} className="gap-2 font-body text-xs border-border text-foreground">
                  <Plus className="w-4 h-4" /> Add to Album ({selectedIds.size})
                </Button>
                {showAddToAlbum && albums.length > 0 && (
                  <div className="absolute top-full right-0 mt-1 z-50 glass-panel rounded-lg border border-border shadow-lg min-w-[200px]">
                    {albums.map(alb => (
                      <button key={alb.id} onClick={() => handleAddToAlbum(alb.id)} className="w-full text-left px-4 py-2.5 text-sm font-body text-foreground hover:bg-secondary transition-colors first:rounded-t-lg last:rounded-b-lg">
                        {alb.title} ({alb.photos.length} photos)
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button size="sm" onClick={handleCreateAlbumFromSelection} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase">
                <Plus className="w-4 h-4" /> Create Album ({selectedIds.size})
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => {
            if (selectedIds.size === displayPhotos.length) setSelectedIds(new Set());
            else setSelectedIds(new Set(displayPhotos.map(p => p.id)));
          }} className="gap-1 font-body text-xs text-muted-foreground">
            <CheckSquare className="w-4 h-4" /> {selectedIds.size === displayPhotos.length && displayPhotos.length > 0 ? "Deselect All" : "Select All"}
          </Button>
        </div>
      </div>

      {/* Source filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setViewSource("all")} className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${viewSource === "all" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          All ({allPhotos.length})
        </button>
        <button onClick={() => setViewSource("library")} className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${viewSource === "library" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          Library ({libraryPhotos.length})
        </button>
        {albums.map(a => (
          <button key={a.id} onClick={() => setViewSource(a.title)} className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${viewSource === a.title ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
            {a.title} ({a.photos.length})
          </button>
        ))}
      </div>

      <div className="glass-panel rounded-xl p-6 mb-6">
        <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/30 transition-colors cursor-pointer relative">
          <Upload className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm font-body text-muted-foreground">
            Upload photos to {selectedAlbum ? `"${selectedAlbum.title}"` : "your library"}
          </p>
          <p className="text-[10px] font-body text-muted-foreground/50 mt-1">
            {selectedAlbum ? "Photos will be added directly to this album" : "Select photos then create albums or add to existing ones"}
          </p>
          <input type="file" accept="image/*" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleUpload} />
        </div>
        {uploadStats && (
          <div className="mt-3 p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center justify-between text-xs font-body text-muted-foreground">
              <span>Processed {uploadStats.done}/{uploadStats.total} photos{uploadStats.errors > 0 ? ` (${uploadStats.errors} failed)` : ""}</span>
              {uploadStats.savedBytes > 0 && <span className="text-green-500">Saved {formatBytes(uploadStats.savedBytes)}</span>}
            </div>
            {uploadStats.done < uploadStats.total && (
              <div className="mt-1.5 h-1.5 rounded-full bg-border overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(uploadStats.done / uploadStats.total) * 100}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {displayPhotos.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <Image className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-body text-muted-foreground">No photos found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-1.5">
          {displayPhotos.map(p => (
            <div key={p.id + p.source} className={`relative group aspect-square rounded-md overflow-hidden bg-secondary cursor-pointer border-2 transition-all ${selectedIds.has(p.id) ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-border"}`}
              onClick={() => toggleSelect(p.id)}>
              <ProgressiveImg thumbSrc={p.thumbnail} fullSrc={p.src} alt={p.title} className="w-full h-full object-cover" loading="lazy" />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[9px] font-body text-muted-foreground truncate">{p.source}</p>
              </div>
              {selectedIds.has(p.id) && (
                <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">✓</div>
              )}
              <button onClick={(e) => { e.stopPropagation(); handleDeletePhoto(p.id, p.source); }}
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
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Opacity ({settings.watermarkOpacity}%)</label>
            <Slider
              value={[settings.watermarkOpacity]}
              onValueChange={(v) => setSettingsState({ ...settings, watermarkOpacity: v[0] })}
              min={5} max={80} step={1}
              className="mb-4"
            />
          </div>
          {/* Live Preview with Sample Image Selector */}
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Preview</label>
            <WatermarkPreviewWithSamples settings={settings} />
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

        {/* Google Calendar */}
        <GoogleCalendarSection />

        <Button onClick={handleSave} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
          <Save className="w-4 h-4" /> Save All Settings
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Watermark Preview with Sample Images ───────────
const SAMPLE_IMAGES = [
  { src: sampleLandscape, label: "Landscape" },
  { src: samplePortrait, label: "Portrait" },
  { src: sampleWedding, label: "Wedding" },
  { src: sampleEvent, label: "Event" },
  { src: sampleFood, label: "Food" },
];

function WatermarkPreviewWithSamples({ settings }: { settings: AppSettings }) {
  const [selectedSample, setSelectedSample] = useState(0);
  const currentSrc = SAMPLE_IMAGES[selectedSample].src;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {SAMPLE_IMAGES.map((img, i) => (
          <button key={i} onClick={() => setSelectedSample(i)}
            className={`text-[10px] font-body px-2.5 py-1 rounded-full transition-all ${
              selectedSample === i ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}>{img.label}</button>
        ))}
      </div>
      <div className="rounded-lg overflow-hidden bg-secondary">
        <WatermarkedImage
          src={currentSrc}
          title="Preview"
          watermarkPosition={settings.watermarkPosition}
          watermarkText={settings.watermarkText}
          watermarkImage={settings.watermarkImage}
          watermarkOpacity={settings.watermarkOpacity}
          index={0}
        />
      </div>
    </div>
  );
}

// ─── Google Calendar Section ─────────────────────────
function GoogleCalendarSection() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean; email: string | null }>({ configured: false, connected: false, email: null });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [calendars, setCalendars] = useState<{ id: string; summary: string; primary?: boolean }[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState("primary");

  useEffect(() => {
    getGoogleCalendarStatus().then(s => {
      setStatus(s);
      setLoading(false);
      if (s.connected) {
        getGoogleCalendars().then(setCalendars);
      }
    });
  }, []);

  const handleConnect = async () => {
    const url = await startGoogleCalendarAuth();
    if (url) {
      window.location.href = url;
    } else {
      toast.error("Google Calendar not configured. Add GOOGLE_API_CREDENTIALS to your Docker env.");
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Google Calendar?")) return;
    await disconnectGoogleCalendar();
    setStatus({ configured: status.configured, connected: false, email: null });
    setCalendars([]);
    toast.success("Google Calendar disconnected");
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    const bookings = getBookings();
    const result = await syncAllBookingsToCalendar(bookings, selectedCalendar);
    setSyncing(false);
    if (result.ok) {
      toast.success(`Synced ${result.created} bookings to Google Calendar${result.errors ? ` (${result.errors} failed)` : ""}`);
    } else {
      toast.error("Failed to sync bookings");
    }
  };

  if (loading) return null;

  return (
    <div className="glass-panel rounded-xl p-6 space-y-4">
      <h3 className="font-display text-base text-foreground flex items-center gap-2">
        <Calendar className="w-4 h-4 text-primary" /> Google Calendar
      </h3>

      {!status.configured && !isServerMode() && (
        <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
          <p className="text-xs font-body text-muted-foreground">
            Google Calendar sync requires the Docker backend. Add <code className="text-primary">GOOGLE_API_CREDENTIALS</code> to your Docker environment variables.
          </p>
        </div>
      )}

      {status.configured && !status.connected && (
        <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
          <p className="text-xs font-body text-muted-foreground mb-3">Connect your Google account to sync bookings to your calendar.</p>
          <Button onClick={handleConnect} size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs">
            <Calendar className="w-4 h-4" /> Connect Google Calendar
          </Button>
        </div>
      )}

      {status.connected && (
        <div className="space-y-3">
          <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20 flex items-center justify-between">
            <div>
              <p className="text-sm font-body text-foreground font-medium flex items-center gap-2">
                ✓ Connected
              </p>
              {status.email && <p className="text-xs font-body text-muted-foreground">{status.email}</p>}
            </div>
            <Button onClick={handleDisconnect} variant="ghost" size="sm" className="text-xs font-body text-destructive hover:bg-destructive/10">
              Disconnect
            </Button>
          </div>

          {calendars.length > 0 && (
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Target Calendar</label>
              <select value={selectedCalendar} onChange={(e) => setSelectedCalendar(e.target.value)}
                className="w-full bg-secondary border border-border text-foreground font-body text-sm rounded-md px-3 py-2.5">
                {calendars.map(c => (
                  <option key={c.id} value={c.id}>{c.summary}{c.primary ? " (Primary)" : ""}</option>
                ))}
              </select>
            </div>
          )}

          <Button onClick={handleSyncAll} disabled={syncing} variant="outline" size="sm" className="gap-2 font-body text-xs border-border text-foreground">
            <Calendar className="w-4 h-4" />
            {syncing ? "Syncing..." : "Sync All Bookings"}
          </Button>
          <p className="text-[10px] font-body text-muted-foreground/50">New bookings are automatically synced when created.</p>
        </div>
      )}
    </div>
  );
}

// ─── Storage View ────────────────────────────────────
function StorageView() {
  const albums = getAlbums();
  const libraryPhotos = getPhotoLibrary();
  const bookings = getBookings();
  const eventTypes = getEventTypes();

  const [serverStats, setServerStats] = useState<{
    totalBytes: number;
    photoCount: number;
    dbSizeBytes: number;
    uploadsSizeBytes: number;
    photoFiles: { name: string; size: number; modified: string }[];
    disk: { totalBytes: number; usedBytes: number; availableBytes: number; mountPoint: string } | null;
    dataDir: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getServerStorageStats().then(s => { setServerStats(s); setLoading(false); });
  }, []);

  const { used: lsUsed, limit: lsLimit } = getLocalStorageUsage();
  const totalAlbumPhotos = albums.reduce((sum, a) => sum + a.photos.length, 0);
  const totalLibraryPhotos = libraryPhotos.length;
  const totalDownloads = albums.reduce((sum, a) => sum + (a.downloadHistory || []).reduce((s, h) => s + h.photoIds.length, 0), 0);
  const totalRequests = albums.reduce((sum, a) => sum + (a.downloadRequests || []).length, 0);
  const pendingRequests = albums.reduce((sum, a) => sum + (a.downloadRequests || []).filter(r => r.status === "pending").length, 0);

  const disk = serverStats?.disk;
  const diskUsedPct = disk ? Math.min(100, (disk.usedBytes / disk.totalBytes) * 100) : 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6 flex items-center gap-2">
        <HardDrive className="w-6 h-6 text-primary" /> Storage & Usage
      </h2>

      {/* Overview Stats */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="glass-panel rounded-xl p-5">
          <p className="font-display text-2xl text-foreground">{albums.length}</p>
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase">Albums</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="font-display text-2xl text-foreground">{totalAlbumPhotos + totalLibraryPhotos}</p>
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase">Total Photos</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="font-display text-2xl text-primary">{totalDownloads}</p>
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase">Total Downloads</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="font-display text-2xl text-foreground">{bookings.length}</p>
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase">Bookings</p>
        </div>
      </div>

      {/* TrueNAS Volume / Disk Usage */}
      {loading ? (
        <div className="glass-panel rounded-xl p-6 mb-6 text-center">
          <p className="text-sm font-body text-muted-foreground animate-pulse">Loading server storage stats...</p>
        </div>
      ) : serverStats ? (
        <>
          {/* Disk Volume */}
          {disk && (
            <div className="glass-panel rounded-xl p-6 mb-6">
              <h3 className="font-display text-base text-foreground mb-1">Volume Storage</h3>
              <p className="text-[10px] font-body text-muted-foreground/50 mb-4 font-mono">{disk.mountPoint} → {serverStats.dataDir}</p>
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs font-body text-muted-foreground mb-1.5">
                  <span>{formatBytes(disk.usedBytes)} used</span>
                  <span>{formatBytes(disk.availableBytes)} free</span>
                  <span>{formatBytes(disk.totalBytes)} total</span>
                </div>
                <div className="h-4 rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${diskUsedPct > 90 ? "bg-destructive" : diskUsedPct > 70 ? "bg-yellow-500" : "bg-primary"}`} style={{ width: `${diskUsedPct}%` }} />
                </div>
                <p className="text-[10px] font-body text-muted-foreground mt-1">{diskUsedPct.toFixed(1)}% used</p>
              </div>
            </div>
          )}

          {/* App Data Breakdown */}
          <div className="glass-panel rounded-xl p-6 mb-6">
            <h3 className="font-display text-base text-foreground mb-4">App Data Breakdown</h3>
            <div className="grid sm:grid-cols-3 gap-4 mb-4">
              <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
                <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1">Photos on Disk</p>
                <p className="font-display text-xl text-foreground">{serverStats.photoCount}</p>
                <p className="text-[10px] font-body text-muted-foreground">{formatBytes(serverStats.uploadsSizeBytes)}</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
                <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1">Database</p>
                <p className="font-display text-xl text-foreground">{formatBytes(serverStats.dbSizeBytes)}</p>
                <p className="text-[10px] font-body text-muted-foreground">db.json</p>
              </div>
              <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
                <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1">Total App Data</p>
                <p className="font-display text-xl text-primary">{formatBytes(serverStats.totalBytes)}</p>
              </div>
            </div>

            {/* Largest files */}
            {serverStats.photoFiles.length > 0 && (
              <div>
                <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2">Largest Files</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {serverStats.photoFiles.slice(0, 20).map((f) => (
                    <div key={f.name} className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary/30 transition-colors">
                      <span className="text-xs font-body text-foreground font-mono truncate max-w-[50%]">{f.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-body text-muted-foreground">{new Date(f.modified).toLocaleDateString()}</span>
                        <span className="text-[10px] font-body text-muted-foreground w-16 text-right">{formatBytes(f.size)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Fallback: localStorage only (no server) */
        <div className="glass-panel rounded-xl p-6 mb-6">
          <h3 className="font-display text-base text-foreground mb-4">LocalStorage Usage</h3>
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs font-body text-muted-foreground mb-1.5">
              <span>{formatBytes(lsUsed)} used</span>
              <span>{formatBytes(lsLimit)} limit</span>
            </div>
            <div className="h-3 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full rounded-full transition-all ${(lsUsed/lsLimit)*100 > 80 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(100,(lsUsed/lsLimit)*100)}%` }} />
            </div>
          </div>
          <p className="text-[10px] font-body text-muted-foreground/50">No server backend detected — all data stored in localStorage. Enable Docker backend for disk storage.</p>
        </div>
      )}

      {/* Activity Summary */}
      <div className="glass-panel rounded-xl p-6">
        <h3 className="font-display text-base text-foreground mb-4">Activity Summary</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1">Event Types</p>
            <p className="font-display text-xl text-foreground">{eventTypes.length}</p>
            <p className="text-[10px] font-body text-muted-foreground">{eventTypes.filter(e => e.active).length} active</p>
          </div>
          <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1">Library Photos</p>
            <p className="font-display text-xl text-foreground">{totalLibraryPhotos}</p>
          </div>
          <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1">Download Requests</p>
            <p className="font-display text-xl text-foreground">{totalRequests}</p>
            <p className="text-[10px] font-body text-muted-foreground">{pendingRequests} pending</p>
          </div>
          <div className="p-4 rounded-lg bg-secondary/50 border border-border/50">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1">Photo Downloads</p>
            <p className="font-display text-xl text-primary">{totalDownloads}</p>
            <p className="text-[10px] font-body text-muted-foreground">across {albums.filter(a => (a.downloadHistory || []).length > 0).length} albums</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
