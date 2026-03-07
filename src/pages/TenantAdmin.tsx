import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Calendar, Clock, Image, Receipt,
  Users, Settings, Key, LogOut, Camera, Plus, Edit, Trash2,
  Save, X, ChevronDown, ChevronUp, Globe, Upload, Search, Copy,
  DollarSign, MessageSquare, HardDrive, User, RefreshCw, Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import WatermarkedImage from "@/components/WatermarkedImage";
import { toast } from "sonner";
import { getMobileTenantSession, setMobileTenantSession, hashPassword } from "@/lib/storage";
import { generateThumbnail } from "@/lib/image-utils";
import {
  fetchTenantMobileData, getTenantSettings, saveTenantSettings,
  deleteTenantBooking, updateTenantBookingFull,
  getTenantLicenseInfo, deleteTenantAlbum,
  getTenantStoreKey, saveTenantStoreKey, updateTenant,
  clearTenantImageCache, tenantPhotoSrc, saveTenantAlbum,
  uploadPhotosToServer, isServerMode, notifyTenantDiscord,
  getSuperAdminWebhooks,
} from "@/lib/api";
import type {
  Booking, Album, EventType, Invoice, InvoiceItem, InvoiceParty,
  Contact, TenantSettings, AvailabilitySlot, QuestionField, WatermarkPosition,
} from "@/lib/types";

type Tab = "dashboard" | "bookings" | "events" | "albums" | "photos" | "finance" | "invoices" | "contacts" | "enquiries" | "profile" | "settings" | "storage" | "license";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
function formatDuration(mins: number) {
  if (mins >= 60) { const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${mins}m`;
}
function calcInvTotal(inv: Invoice): number {
  const sub = inv.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const tax = inv.tax ? sub * inv.tax / 100 : 0;
  const disc = inv.discount || 0;
  return sub + tax - disc;
}
function emptyParty(): InvoiceParty { return { name: "", email: "", address: "", abn: "" }; }
function emptyItem(): InvoiceItem { return { id: generateId("item"), description: "", quantity: 1, unitPrice: 0 }; }

// ─── Root TenantAdmin Component ──────────────────────────────────────────────
export default function TenantAdmin() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  // Auth check
  const session = getMobileTenantSession();
  useEffect(() => {
    if (!session || session.slug !== slug) {
      navigate("/login", { replace: true });
    }
  }, [session, slug, navigate]);

  if (!session || session.slug !== slug) return null;

  const handleLogout = () => {
    setMobileTenantSession(null);
    navigate("/login", { replace: true });
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "bookings", label: "Bookings", icon: Calendar },
    { id: "events", label: "Events", icon: Clock },
    { id: "albums", label: "Albums", icon: Image },
    { id: "photos", label: "Photos", icon: Camera },
    { id: "finance", label: "Finance", icon: DollarSign },
    { id: "invoices", label: "Invoices", icon: Receipt },
    { id: "contacts", label: "Contacts", icon: Users },
    { id: "enquiries", label: "Enquiries", icon: MessageSquare },
    { id: "profile", label: "Profile", icon: User },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "storage", label: "Storage", icon: HardDrive },
    { id: "license", label: "License", icon: Key },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="w-56 fixed left-0 top-0 bottom-0 border-r border-border bg-card/50 p-4 hidden lg:flex flex-col" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}>
          <div className="flex items-center gap-2.5 px-3 mb-2 pt-2">
            <Camera className="w-5 h-5 text-primary" />
            <span className="font-display text-base text-foreground truncate">{session.displayName}</span>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground/60 px-3 mb-5">/{slug}</p>
          <p className="text-[10px] font-body tracking-[0.3em] uppercase text-muted-foreground mb-4 px-3">Admin Panel</p>
          <nav className="space-y-1 flex-1">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body transition-all ${activeTab === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
              >
                <tab.icon className="w-4 h-4" />{tab.label}
              </button>
            ))}
          </nav>
          <div className="mt-auto space-y-1">
            <button onClick={() => navigate("/capture")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body text-primary hover:bg-primary/10 transition-all">
              <Upload className="w-4 h-4" />Capture
            </button>
            <button onClick={() => window.open(`/book/${slug}`, "_blank")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
              <Globe className="w-4 h-4" />Booking Page
            </button>
            <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
              <LogOut className="w-4 h-4" />Logout
            </button>
          </div>
        </aside>

        {/* Mobile top bar */}
        <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-sm border-b border-border flex items-center justify-between px-4" style={{ height: "calc(env(safe-area-inset-top, 0px) + 3rem)", paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-primary" />
            <span className="font-display text-sm text-foreground capitalize">{tabs.find(t => t.id === activeTab)?.label ?? "Admin"}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/capture")} className="flex items-center gap-1.5 text-xs font-body text-primary px-2.5 py-1.5 rounded-lg bg-primary/10 active:bg-primary/20">
              <Upload className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs font-body text-muted-foreground px-2.5 py-1.5 rounded-lg hover:bg-secondary">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Mobile bottom tab bar */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-sm border-t border-border" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="flex overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`relative flex flex-col items-center justify-center gap-0.5 px-3 py-2 min-w-[56px] min-h-[52px] flex-shrink-0 transition-colors ${isActive ? "text-primary" : "text-muted-foreground"}`}
                >
                  <tab.icon className="w-5 h-5" />
                  <span className="text-[9px] font-body tracking-wide whitespace-nowrap">{tab.label}</span>
                  {isActive && <span className="absolute top-0 inset-x-2 h-0.5 rounded-full bg-primary" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 lg:ml-56 p-4 sm:p-6 lg:p-8 lg:pt-8" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4rem)" }}>
          <style>{`@media (min-width: 1024px) { #tenant-admin-main { padding-bottom: 2rem; } }`}</style>
          {activeTab === "dashboard" && <TenantDashboard slug={slug!} session={session} />}
          {activeTab === "bookings" && <TenantBookings slug={slug!} />}
          {activeTab === "events" && <TenantEvents slug={slug!} />}
          {activeTab === "albums" && <TenantAlbums slug={slug!} />}
          {activeTab === "photos" && <TenantPhotos slug={slug!} />}
          {activeTab === "finance" && <TenantFinance slug={slug!} />}
          {activeTab === "invoices" && <TenantInvoices slug={slug!} session={session} />}
          {activeTab === "contacts" && <TenantContacts slug={slug!} />}
          {activeTab === "enquiries" && <TenantEnquiries slug={slug!} />}
          {activeTab === "profile" && <TenantProfileView slug={slug!} session={session} />}
          {activeTab === "settings" && <TenantSettingsView slug={slug!} />}
          {activeTab === "storage" && <TenantStorage slug={slug!} />}
          {activeTab === "license" && <TenantLicense slug={slug!} />}
        </main>
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
function TenantDashboard({ slug, session }: { slug: string; session: { displayName: string; email: string } }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTenantMobileData(slug).then(data => {
      setBookings(data.bookings || []);
      setAlbums(data.albums || []);
      setLoading(false);
    });
  }, [slug]);

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings.filter(b => b.status !== "cancelled" && b.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const pending = bookings.filter(b => b.status === "pending");
  const totalPhotos = albums.reduce((s, a) => s + (a.photos?.length || 0), 0);

  const stats = [
    { label: "Total Bookings", value: bookings.length, icon: Calendar, color: "text-primary" },
    { label: "Upcoming", value: upcoming.length, icon: Clock, color: "text-blue-400" },
    { label: "Pending Approval", value: pending.length, icon: Calendar, color: "text-yellow-400" },
    { label: "Albums", value: albums.length, icon: Image, color: "text-purple-400" },
    { label: "Photos", value: totalPhotos, icon: Camera, color: "text-green-400" },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="mb-6">
        <h2 className="font-display text-2xl text-foreground">Welcome back, {session.displayName}</h2>
        <p className="text-sm font-body text-muted-foreground mt-1">Your photographer dashboard</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        {stats.map(s => (
          <div key={s.label} className="glass-panel rounded-xl p-4 space-y-1">
            <s.icon className={`w-4 h-4 ${s.color}`} />
            <p className="font-display text-2xl text-foreground">{s.value}</p>
            <p className="text-xs font-body text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {upcoming.length > 0 && (
        <div className="glass-panel rounded-xl p-5">
          <h3 className="font-display text-base text-foreground mb-4">Upcoming Sessions</h3>
          <div className="space-y-2">
            {upcoming.slice(0, 5).map(bk => (
              <div key={bk.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div>
                  <p className="text-sm font-body text-foreground">{bk.clientName}</p>
                  <p className="text-xs font-body text-muted-foreground">{bk.date} · {bk.time} · {formatDuration(bk.duration)}</p>
                </div>
                <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${
                  bk.status === "confirmed" ? "bg-green-500/10 text-green-400" :
                  bk.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
                  "bg-secondary text-muted-foreground"
                }`}>{bk.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── Bookings ────────────────────────────────────────────────────────────────
function TenantBookings({ slug }: { slug: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "confirmed" | "completed" | "cancelled">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchTenantMobileData(slug).then(d => { setBookings(d.bookings || []); setLoading(false); });
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (bk: Booking, status: Booking["status"]) => {
    const { ok, error } = await updateTenantBookingFull(slug, bk.id, { status });
    if (!ok) { toast.error(error || "Failed to update"); return; }
    toast.success(`Booking ${status}`);
    load();
  };

  const handlePaymentChange = async (bk: Booking, paymentStatus: string) => {
    const { ok, error } = await updateTenantBookingFull(slug, bk.id, { paymentStatus } as Partial<Booking>);
    if (!ok) { toast.error(error || "Failed to update"); return; }
    toast.success(`Payment marked as ${paymentStatus}`);
    load();
  };

  const handleDelete = async (bk: Booking) => {
    if (!confirm("Delete this booking? This cannot be undone.")) return;
    const { ok, error } = await deleteTenantBooking(slug, bk.id);
    if (!ok) { toast.error(error || "Failed to delete"); return; }
    toast.success("Booking deleted");
    load();
  };

  const filtered = bookings.filter(bk => {
    if (statusFilter !== "all" && bk.status !== statusFilter) return false;
    if (search && !`${bk.clientName} ${bk.clientEmail} ${bk.type}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Bookings</h2>
        <span className="text-sm font-body text-muted-foreground">{bookings.length} total</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bookings…" className="pl-9 bg-secondary border-border text-foreground font-body text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          className="bg-secondary border border-border text-foreground font-body text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/50">
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-body text-sm">{bookings.length === 0 ? "No bookings yet" : "No bookings match your filter"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(bk => (
            <div key={bk.id} className="glass-panel rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => setExpandedId(expandedId === bk.id ? null : bk.id)}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-body text-sm text-foreground font-medium">{bk.clientName}</p>
                    <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${
                      bk.status === "confirmed" ? "bg-green-500/10 text-green-400" :
                      bk.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
                      bk.status === "completed" ? "bg-blue-500/10 text-blue-400" :
                      "bg-red-500/10 text-red-400"
                    }`}>{bk.status}</span>
                  </div>
                  <p className="text-xs font-body text-muted-foreground mt-0.5">{bk.date} · {bk.time} · {formatDuration(bk.duration)} · {bk.type}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {bk.paymentAmount ? <span className="text-xs font-body text-primary">${bk.paymentAmount}</span> : null}
                  {expandedId === bk.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </div>

              {expandedId === bk.id && (
                <div className="border-t border-border/30 p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-xs font-body">
                    <div><span className="text-muted-foreground">Email: </span><span className="text-foreground">{bk.clientEmail}</span></div>
                    {bk.notes && <div className="col-span-2"><span className="text-muted-foreground">Notes: </span><span className="text-foreground">{bk.notes}</span></div>}
                    {bk.paymentStatus && <div><span className="text-muted-foreground">Payment: </span><span className="text-foreground">{bk.paymentStatus}</span></div>}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs font-body text-muted-foreground self-center">Status:</span>
                    {(["pending", "confirmed", "completed", "cancelled"] as Booking["status"][]).map(s => (
                      <button key={s} onClick={() => handleStatusChange(bk, s)}
                        className={`px-3 py-1 rounded-full text-xs font-body transition-all ${bk.status === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                      >{s}</button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs font-body text-muted-foreground self-center">Payment:</span>
                    {(["unpaid", "paid", "cash", "deposit-paid"] as string[]).map(s => (
                      <button key={s} onClick={() => handlePaymentChange(bk, s)}
                        className={`px-3 py-1 rounded-full text-xs font-body transition-all ${bk.paymentStatus === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                      >{s}</button>
                    ))}
                  </div>

                  <button onClick={() => handleDelete(bk)} className="flex items-center gap-1.5 text-xs font-body text-destructive hover:text-destructive/80 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" /> Delete booking
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Event Types ─────────────────────────────────────────────────────────────
function TenantEvents({ slug }: { slug: string }) {
  const [eventTypes, setEts] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EventType | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    const data = await getTenantStoreKey<EventType[]>(slug, "wv_event_types");
    setEts(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const save = async (ets: EventType[]) => {
    const { ok, error } = await saveTenantStoreKey(slug, "wv_event_types", ets);
    if (!ok) { toast.error(error || "Failed to save"); return false; }
    return true;
  };

  const handleSave = async (et: EventType) => {
    const updated = editing ? eventTypes.map(e => e.id === et.id ? et : e) : [...eventTypes, et];
    if (await save(updated)) {
      setEts(updated);
      setEditing(null);
      setShowNew(false);
      toast.success(editing ? "Event type updated" : "Event type created");
    }
  };

  const handleToggle = async (id: string) => {
    const updated = eventTypes.map(e => e.id === id ? { ...e, active: !e.active } : e);
    if (await save(updated)) setEts(updated);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this event type?")) return;
    const updated = eventTypes.filter(e => e.id !== id);
    if (await save(updated)) {
      setEts(updated);
      toast.success("Event type deleted");
    }
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Event Types</h2>
        <Button size="sm" onClick={() => setShowNew(true)} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
          <Plus className="w-4 h-4" /> New
        </Button>
      </div>

      {(showNew || editing) && (
        <TenantEventEditor
          eventType={editing}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowNew(false); }}
        />
      )}

      <div className="space-y-3">
        {eventTypes.length === 0 && !showNew ? (
          <div className="text-center py-16 text-muted-foreground">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-body text-sm">No event types yet</p>
            <p className="font-body text-xs text-muted-foreground/60 mt-1">Add event types so clients can book sessions with you.</p>
            <Button onClick={() => setShowNew(true)} variant="outline" className="mt-4 gap-2 font-body text-sm">
              <Plus className="w-4 h-4" /> Create First Event Type
            </Button>
          </div>
        ) : eventTypes.map(et => (
          <div key={et.id} className={`glass-panel rounded-xl p-4 border transition-all ${et.active ? "border-border/50" : "border-border/20 opacity-60"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className={`w-1.5 h-10 rounded-full bg-primary mt-0.5 flex-shrink-0 ${!et.active ? "opacity-30" : ""}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-display text-sm text-foreground">{et.title}</p>
                  <p className="text-xs font-body text-muted-foreground mt-0.5">
                    {et.durations.map(d => formatDuration(d)).join(", ")}
                    {et.price > 0 && <> · <span className="text-primary">${et.price}</span></>}
                    {et.location && <> · {et.location}</>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={et.active} onCheckedChange={() => handleToggle(et.id)} />
                <button onClick={() => setEditing(et)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground/60 hover:text-foreground transition-colors"><Edit className="w-3.5 h-3.5" /></button>
                <button onClick={() => handleDelete(et.id)} className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground/60 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Event Type Editor (simplified) ──────────────────────────────────────────
function TenantEventEditor({ eventType, onSave, onCancel }: { eventType: EventType | null; onSave: (et: EventType) => void; onCancel: () => void }) {
  const isNew = !eventType;
  const [title, setTitle] = useState(eventType?.title || "");
  const [description, setDescription] = useState(eventType?.description || "");
  const [location, setLocation] = useState(eventType?.location || "");
  const [durations, setDurations] = useState<number[]>(eventType?.durations || [60]);
  const [price, setPrice] = useState(eventType?.price || 0);
  const [requiresConfirmation, setRequiresConfirmation] = useState(eventType?.requiresConfirmation || false);
  const [recurring, setRecurring] = useState<AvailabilitySlot[]>(eventType?.availability?.recurring || []);
  const [blockedDates, setBlockedDates] = useState<string[]>(eventType?.availability?.blockedDates || []);
  const [durationInput, setDurationInput] = useState("");
  const [blockedInput, setBlockedInput] = useState("");
  const [showAvail, setShowAvail] = useState(false);
  const [questions, setQuestions] = useState<QuestionField[]>(eventType?.questions || [
    { id: "q1", label: "Name", type: "text", required: true, placeholder: "Your full name" },
    { id: "q2", label: "Email", type: "text", required: true, placeholder: "you@example.com" },
  ]);

  const addDuration = () => {
    const val = parseInt(durationInput);
    if (!val || val <= 0 || durations.includes(val)) return;
    setDurations([...durations, val].sort((a, b) => a - b));
    setDurationInput("");
  };

  const toggleDay = (day: number) => {
    const exists = recurring.find(s => s.day === day);
    if (exists) setRecurring(recurring.filter(s => s.day !== day));
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
      availability: { recurring, specificDates: eventType?.availability?.specificDates || [], blockedDates },
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
          <Input value={title} onChange={e => setTitle(e.target.value)} className="bg-secondary border-border text-foreground font-body" autoFocus />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Base Price ($)</label>
          <Input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" />
        </div>
      </div>
      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Description</label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="bg-secondary border-border text-foreground font-body resize-none" />
      </div>
      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Location</label>
        <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Sydney CBD" className="bg-secondary border-border text-foreground font-body" />
      </div>

      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Durations (minutes)</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {durations.map(d => (
            <span key={d} className="inline-flex items-center gap-1 text-xs font-body bg-primary/10 text-primary px-2.5 py-1 rounded-full">
              {d}m <button onClick={() => setDurations(durations.filter(x => x !== d))} className="hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input type="number" value={durationInput} onChange={e => setDurationInput(e.target.value)} placeholder="e.g. 60" className="bg-secondary border-border text-foreground font-body w-24" onKeyDown={e => e.key === "Enter" && addDuration()} />
          <Button variant="outline" size="sm" onClick={addDuration} className="font-body text-xs border-border text-foreground">Add</Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-body text-muted-foreground">Requires Confirmation</span>
        <Switch checked={requiresConfirmation} onCheckedChange={setRequiresConfirmation} />
      </div>

      {/* Availability */}
      <div>
        <button onClick={() => setShowAvail(!showAvail)} className="flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 hover:text-foreground transition-colors">
          {showAvail ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Availability ({recurring.length} days, {blockedDates.length} blocked)
        </button>
        {showAvail && (
          <div className="space-y-4 pl-2 border-l-2 border-border/50 ml-1">
            <div className="space-y-2">
              <p className="text-xs font-body text-muted-foreground font-medium">Weekly Schedule</p>
              {DAY_NAMES.map((dayName, i) => {
                const slot = recurring.find(s => s.day === i);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <Switch checked={!!slot} onCheckedChange={() => toggleDay(i)} />
                    <span className="text-sm font-body text-foreground w-24">{dayName}</span>
                    {slot && (
                      <div className="flex items-center gap-2">
                        <Input type="time" value={slot.startTime} onChange={e => setRecurring(recurring.map(s => s.day === i ? { ...s, startTime: e.target.value } : s))} className="bg-secondary border-border text-foreground font-body w-28 text-xs" />
                        <span className="text-xs text-muted-foreground">—</span>
                        <Input type="time" value={slot.endTime} onChange={e => setRecurring(recurring.map(s => s.day === i ? { ...s, endTime: e.target.value } : s))} className="bg-secondary border-border text-foreground font-body w-28 text-xs" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-body text-muted-foreground font-medium">Blocked Dates</p>
              <div className="flex flex-wrap gap-2">
                {blockedDates.map(d => (
                  <span key={d} className="inline-flex items-center gap-1 text-xs font-body bg-destructive/10 text-destructive px-2.5 py-1 rounded-full">
                    {d} <button onClick={() => setBlockedDates(blockedDates.filter(x => x !== d))}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input type="date" value={blockedInput} onChange={e => setBlockedInput(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs w-36" />
                <Button variant="outline" size="sm" onClick={() => { if (!blockedInput || blockedDates.includes(blockedInput)) return; setBlockedDates([...blockedDates, blockedInput].sort()); setBlockedInput(""); }} className="font-body text-xs border-border text-foreground">Block</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Questions */}
      <div className="space-y-3">
        <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Booking Questions</p>
        {questions.map((q, idx) => (
          <div key={q.id} className="p-3 rounded-lg bg-secondary/50 border border-border/50 space-y-2">
            <div className="flex items-center gap-2">
              <Input value={q.label} onChange={e => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, label: e.target.value } : qq))} placeholder="Question label" className="bg-secondary border-border text-foreground font-body text-sm flex-1" />
              <select value={q.type} onChange={e => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, type: e.target.value as QuestionField["type"] } : qq))} className="bg-secondary border border-border text-foreground font-body text-xs rounded-md px-2 py-2">
                <option value="text">Text</option>
                <option value="textarea">Long Text</option>
                <option value="select">Select</option>
                <option value="boolean">Yes/No</option>
              </select>
              <button onClick={() => setQuestions(questions.filter((_, i) => i !== idx))} className="p-1.5 text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-body text-muted-foreground cursor-pointer">
                <Switch checked={q.required} onCheckedChange={v => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, required: v } : qq))} />Required
              </label>
              <Input value={q.placeholder || ""} onChange={e => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, placeholder: e.target.value } : qq))} placeholder="Placeholder text" className="bg-secondary border-border text-foreground font-body text-xs flex-1" />
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setQuestions([...questions, { id: `q${Date.now()}`, label: "", type: "text", required: false, placeholder: "" }])} className="font-body text-xs border-border text-foreground gap-1">
          <Plus className="w-3.5 h-3.5" /> Add Question
        </Button>
      </div>

      <div className="flex gap-3 pt-2 border-t border-border/50">
        <Button variant="outline" onClick={onCancel} className="font-body text-xs border-border text-foreground">Cancel</Button>
        <Button onClick={handleSave} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
          <Save className="w-4 h-4" /> {isNew ? "Create" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ─── Gallery ─────────────────────────────────────────────────────────────────
function TenantAlbums({ slug }: { slug: string }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newClient, setNewClient] = useState("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [newSlug, setNewSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const data = await fetchTenantMobileData(slug);
    setAlbums(data.albums || []);
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (albumId: string) => {
    if (!confirm("Delete this album and all its photos?")) return;
    const { ok, error } = await deleteTenantAlbum(slug, albumId);
    if (!ok) { toast.error(error || "Failed to delete"); return; }
    toast.success("Album deleted");
    setSelectedAlbum(null);
    load();
  };

  const handleCreateAlbum = async () => {
    if (!newTitle.trim()) { toast.error("Album title is required"); return; }
    setSaving(true);
    const id = generateId("album");
    const albumSlug = newSlug.trim() || newTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const album: Album = {
      id,
      slug: albumSlug,
      title: newTitle.trim(),
      clientName: newClient.trim(),
      date: newDate,
      photos: [],
      isPublic: false,
      freeDownloads: 0,
      pricePerPhoto: 0,
      priceFullAlbum: 0,
      createdAt: new Date().toISOString(),
    };
    const { ok, error } = await saveTenantAlbum(slug, album);
    setSaving(false);
    if (!ok) { toast.error(error || "Failed to create album"); return; }
    toast.success("Album created");
    setNewTitle(""); setNewClient(""); setNewSlug("");
    setNewDate(new Date().toISOString().split("T")[0]);
    setShowCreateForm(false);
    await load();
    const fresh = (await fetchTenantMobileData(slug)).albums?.find((a: Album) => a.id === id);
    if (fresh) setSelectedAlbum(fresh);
  };

  const handleUploadPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0 || !selectedAlbum) return;
    if (!isServerMode()) { toast.error("Server required for photo uploads"); return; }
    setUploading(true);
    setUploadProgress(0);
    const fileArr = Array.from(files);
    const uploaded = await uploadPhotosToServer(fileArr, (done, total) => {
      setUploadProgress(Math.round((done / total) * 100));
    });
    if (uploaded.length === 0) { setUploading(false); toast.error("Upload failed"); return; }
    const newPhotos: Photo[] = await Promise.all(uploaded.map(async (u) => {
      let thumbnail = "";
      try { thumbnail = await generateThumbnail(u.url, 300, 0.65); } catch { thumbnail = u.url; }
      return {
        id: generateId("photo"),
        src: u.url,
        thumbnail,
        title: u.originalName,
        isStarred: false,
        isPublic: true,
      } as Photo;
    }));
    const updatedAlbum: Album = {
      ...selectedAlbum,
      photos: [...(selectedAlbum.photos || []), ...newPhotos],
    };
    const { ok, error } = await saveTenantAlbum(slug, updatedAlbum);
    setUploading(false);
    if (!ok) { toast.error(error || "Failed to save photos"); return; }
    setSelectedAlbum(updatedAlbum);
    setAlbums(prev => prev.map(a => a.id === updatedAlbum.id ? updatedAlbum : a));
    toast.success(`${newPhotos.length} photo${newPhotos.length !== 1 ? "s" : ""} uploaded`);
    notifyTenantDiscord(slug, { event: "photos-uploaded", album: updatedAlbum, photoCount: newPhotos.length });
  };

  /** Append ?tenant=slug so server uses this tenant's watermark settings */
  const photoUrl = (src: string) => tenantPhotoSrc(src, slug);

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  if (selectedAlbum) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => setSelectedAlbum(null)} className="flex items-center gap-2 text-sm font-body text-muted-foreground hover:text-foreground transition-colors">
            ← Back to Albums
          </button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="font-body text-xs gap-1.5 border-border" onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
              <Upload className="w-3.5 h-3.5" />
              {uploading ? `Uploading ${uploadProgress}%…` : "Upload Photos"}
            </Button>
            <button onClick={() => handleDelete(selectedAlbum.id)} className="flex items-center gap-1.5 text-xs font-body text-destructive hover:text-destructive/80">
              <Trash2 className="w-3.5 h-3.5" /> Delete Album
            </button>
          </div>
        </div>
        <input ref={uploadInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleUploadPhotos(e.target.files)} />
        <h2 className="font-display text-2xl text-foreground mb-2">{selectedAlbum.title}</h2>
        <p className="text-sm font-body text-muted-foreground mb-6">{selectedAlbum.photos?.length || 0} photos · {selectedAlbum.date}</p>
        {uploading && (
          <div className="mb-4 h-1.5 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
        {selectedAlbum.photos?.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {selectedAlbum.photos.map(photo => (
              <div key={photo.id} className="aspect-square rounded-lg overflow-hidden bg-secondary">
                <img
                  src={photoUrl(photo.thumbnail || (photo.src.startsWith("/uploads/") ? `${photo.src}?size=thumb` : photo.src))}
                  alt={photo.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 text-muted-foreground">
            <Camera className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-body text-sm">No photos in this album yet</p>
            <p className="font-body text-xs text-muted-foreground/60 mt-1">Click "Upload Photos" to add images, or use the Capture feature.</p>
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Albums</h2>
        <Button size="sm" className="font-body text-xs gap-1.5 bg-primary text-primary-foreground" onClick={() => setShowCreateForm(v => !v)}>
          <Plus className="w-3.5 h-3.5" /> New Album
        </Button>
      </div>

      {showCreateForm && (
        <div className="glass-panel rounded-xl p-5 mb-6 space-y-4">
          <h3 className="font-display text-base text-foreground">Create New Album</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Album Title *</label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Wedding · Smith Family" className="bg-background border-border text-foreground font-body text-sm" />
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Client Name</label>
              <Input value={newClient} onChange={e => setNewClient(e.target.value)} placeholder="Jane Smith" className="bg-background border-border text-foreground font-body text-sm" />
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Date</label>
              <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="bg-background border-border text-foreground font-body text-sm" />
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Slug (optional)</label>
              <Input value={newSlug} onChange={e => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="auto-generated" className="bg-background border-border text-foreground font-body text-sm font-mono" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={handleCreateAlbum} disabled={saving} className="font-body text-xs gap-1.5">
              <Save className="w-3.5 h-3.5" /> {saving ? "Creating…" : "Create Album"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCreateForm(false)} className="font-body text-xs border-border">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {albums.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Image className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-body text-sm">No albums yet</p>
          <p className="font-body text-xs text-muted-foreground/60 mt-1">Create one manually or capture photos for a booking.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {albums.map(album => {
            const coverSrc = album.coverImage
              ? photoUrl(album.coverImage.startsWith("/uploads/") ? `${album.coverImage}?size=thumb` : album.coverImage)
              : album.photos?.[0]
                ? photoUrl(album.photos[0].thumbnail || (album.photos[0].src.startsWith("/uploads/") ? `${album.photos[0].src}?size=thumb` : album.photos[0].src))
                : null;
            return (
              <div key={album.id} className="glass-panel rounded-xl overflow-hidden cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all" onClick={() => setSelectedAlbum(album)}>
                <div className="aspect-square bg-secondary overflow-hidden">
                  {coverSrc
                    ? <img src={coverSrc} alt={album.title} className="w-full h-full object-cover" loading="lazy" />
                    : <div className="w-full h-full flex items-center justify-center"><Image className="w-8 h-8 text-muted-foreground/30" /></div>
                  }
                </div>
                <div className="p-3">
                  <p className="font-body text-sm text-foreground font-medium truncate">{album.title}</p>
                  <p className="text-xs font-body text-muted-foreground">{album.photos?.length || 0} photos · {album.date}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}


// ─── Photos ──────────────────────────────────────────────────────────────────
function TenantPhotos({ slug }: { slug: string }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTenantMobileData(slug).then(d => {
      setAlbums(d.albums || []);
      setLoading(false);
    });
  }, [slug]);

  const photoUrl = (src: string) => tenantPhotoSrc(src, slug);

  const allPhotos = albums.flatMap(a =>
    (a.photos || []).map(p => ({ ...p, albumTitle: a.title, albumId: a.id }))
  );

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Photos</h2>
        <span className="text-sm font-body text-muted-foreground">{allPhotos.length} total</span>
      </div>
      {allPhotos.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Camera className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-body text-sm">No photos yet</p>
          <p className="font-body text-xs text-muted-foreground/60 mt-1">Photos appear here once captured for bookings.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {allPhotos.map(photo => (
            <div key={photo.id} className="group relative aspect-square rounded-lg overflow-hidden bg-secondary">
              <img
                src={photoUrl(photo.thumbnail || (photo.src.startsWith("/uploads/") ? `${photo.src}?size=thumb` : photo.src))}
                alt={photo.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[10px] font-body text-white truncate">{photo.albumTitle}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Finance ─────────────────────────────────────────────────────────────────
function TenantFinance({ slug }: { slug: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTenantMobileData(slug).then(d => {
      setBookings(d.bookings || []);
      setLoading(false);
    });
  }, [slug]);

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  const paid = bookings.filter(b => b.paymentStatus === "paid");
  const deposit = bookings.filter(b => b.paymentStatus === "deposit");
  const unpaid = bookings.filter(b => !b.paymentStatus || b.paymentStatus === "unpaid");

  const totalPaid = paid.reduce((s, b) => s + (b.paymentAmount || 0), 0);
  const totalDeposit = deposit.reduce((s, b) => s + (b.depositAmount || b.paymentAmount || 0), 0);

  const curr = (n: number) => `$${n.toFixed(2)}`;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Finance</h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <div className="glass-panel rounded-xl p-4">
          <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Paid in Full</p>
          <p className="font-display text-2xl text-green-400 mt-1">{curr(totalPaid)}</p>
          <p className="text-[10px] font-body text-muted-foreground">{paid.length} bookings</p>
        </div>
        <div className="glass-panel rounded-xl p-4">
          <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Deposits Received</p>
          <p className="font-display text-2xl text-yellow-400 mt-1">{curr(totalDeposit)}</p>
          <p className="text-[10px] font-body text-muted-foreground">{deposit.length} bookings</p>
        </div>
        <div className="glass-panel rounded-xl p-4">
          <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Unpaid</p>
          <p className="font-display text-2xl text-muted-foreground mt-1">{unpaid.length}</p>
          <p className="text-[10px] font-body text-muted-foreground">bookings</p>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-6">
        <h3 className="font-display text-base text-foreground mb-4">Recent Payments</h3>
        {bookings.length === 0 ? (
          <p className="text-sm font-body text-muted-foreground">No bookings yet.</p>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {[...bookings]
              .filter(b => b.paymentStatus === "paid" || b.paymentStatus === "deposit")
              .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
              .map(bk => (
                <div key={bk.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 border border-border/40">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-body text-foreground">{bk.clientName}</p>
                    <p className="text-xs font-body text-muted-foreground">{bk.date} · {bk.type}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-body text-foreground">{curr(bk.paymentAmount || 0)}</p>
                    <span className={`text-[10px] font-body px-1.5 py-0.5 rounded-full ${
                      bk.paymentStatus === "paid" ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"
                    }`}>{bk.paymentStatus}</span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Enquiries ───────────────────────────────────────────────────────────────
function TenantEnquiries({ slug }: { slug: string }) {
  const [enquiries, setEnquiries] = useState<Array<{
    id: string; name: string; email: string; phone?: string;
    eventTypeTitle?: string; preferredDate?: string; message: string;
    status: "pending" | "accepted" | "declined"; createdAt: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await getTenantStoreKey<Array<{
      id: string; name: string; email: string; phone?: string;
      eventTypeTitle?: string; preferredDate?: string; message: string;
      status: "pending" | "accepted" | "declined"; createdAt: string;
    }>>(slug, "wv_enquiries");
    setEnquiries(
      (data || []).slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    );
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: "accepted" | "declined") => {
    const updated = enquiries.map(e => e.id === id ? { ...e, status } : e);
    await saveTenantStoreKey(slug, "wv_enquiries", updated);
    setEnquiries(updated.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
    toast.success(status === "accepted" ? "Enquiry accepted" : "Enquiry declined");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this enquiry?")) return;
    const updated = enquiries.filter(e => e.id !== id);
    await saveTenantStoreKey(slug, "wv_enquiries", updated);
    setEnquiries(updated);
    toast.success("Enquiry deleted");
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  const pending = enquiries.filter(e => e.status === "pending");

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center gap-3 mb-6">
        <h2 className="font-display text-2xl text-foreground">Enquiries</h2>
        {pending.length > 0 && (
          <span className="bg-yellow-500/15 text-yellow-400 text-xs font-body px-2 py-0.5 rounded-full">
            {pending.length} pending
          </span>
        )}
      </div>
      {enquiries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-body text-sm">No enquiries yet</p>
          <p className="font-body text-xs text-muted-foreground/60 mt-1">Enquiries from your booking page will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {enquiries.map(enq => (
            <div key={enq.id} className="glass-panel rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-body text-foreground font-medium">{enq.name}</span>
                    <span className={`text-[10px] font-body px-1.5 py-0.5 rounded-full ${
                      enq.status === "pending" ? "bg-yellow-500/10 text-yellow-400"
                      : enq.status === "accepted" ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                    }`}>{enq.status}</span>
                  </div>
                  <p className="text-xs font-body text-muted-foreground">{enq.email}{enq.phone ? ` · ${enq.phone}` : ""}</p>
                  {enq.preferredDate && <p className="text-xs font-body text-muted-foreground">Date: {enq.preferredDate}</p>}
                  {enq.eventTypeTitle && <p className="text-xs font-body text-muted-foreground">Event: {enq.eventTypeTitle}</p>}
                </div>
                <button onClick={() => handleDelete(enq.id)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-sm font-body text-foreground bg-secondary/50 rounded-lg p-3">{enq.message}</p>
              {enq.status === "pending" && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => updateStatus(enq.id, "accepted")}
                    className="bg-green-600 hover:bg-green-700 text-white font-body text-xs gap-1">
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateStatus(enq.id, "declined")}
                    className="font-body text-xs gap-1 border-border text-muted-foreground hover:text-foreground">
                    Decline
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Invoices ────────────────────────────────────────────────────────────────
function TenantInvoices({ slug, session }: { slug: string; session: { displayName: string; email: string } }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    const data = await getTenantStoreKey<Invoice[]>(slug, "wv_invoices");
    setInvoices(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const saveAll = async (invs: Invoice[]) => {
    const { ok, error } = await saveTenantStoreKey(slug, "wv_invoices", invs);
    if (!ok) { toast.error(error || "Failed to save"); return false; }
    return true;
  };

  const getNextNumber = (invs: Invoice[]) => {
    const nums = invs.map(i => parseInt(i.number.replace(/\D/g, ""), 10)).filter(n => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `INV-${String(next).padStart(4, "0")}`;
  };

  const openCreate = () => {
    const now = new Date();
    const due = new Date(now); due.setDate(due.getDate() + 30);
    setEditing({
      id: generateId("inv"),
      number: getNextNumber(invoices),
      status: "draft",
      from: { name: session.displayName, email: session.email, address: "", abn: "" },
      to: emptyParty(),
      items: [emptyItem()],
      notes: "",
      dueDate: due.toISOString().slice(0, 10),
      createdAt: now.toISOString(),
      shareToken: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      emailLog: [],
      paymentMethods: [],
    });
  };

  const handleSave = async (inv: Invoice) => {
    const exists = invoices.find(i => i.id === inv.id);
    const updated = exists ? invoices.map(i => i.id === inv.id ? inv : i) : [...invoices, inv];
    if (await saveAll(updated)) {
      setInvoices(updated);
      setEditing(null);
      toast.success(exists ? "Invoice updated" : "Invoice created");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this invoice?")) return;
    const updated = invoices.filter(i => i.id !== id);
    if (await saveAll(updated)) {
      setInvoices(updated);
      toast.success("Invoice deleted");
    }
  };

  const handleMarkPaid = async (inv: Invoice) => {
    if (!confirm(`Mark ${inv.number} as paid?`)) return;
    const updated = invoices.map(i => i.id === inv.id ? { ...i, status: "paid" as const, paidAt: new Date().toISOString() } : i);
    if (await saveAll(updated)) { setInvoices(updated); toast.success("Invoice marked as paid"); }
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  if (editing) {
    return <TenantInvoiceEditor invoice={editing} onSave={handleSave} onCancel={() => setEditing(null)} />;
  }

  const statusColor = (s: string) => s === "paid" ? "bg-green-500/10 text-green-400" : s === "overdue" ? "bg-red-500/10 text-red-400" : s === "sent" ? "bg-blue-500/10 text-blue-400" : "bg-secondary text-muted-foreground";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Invoices</h2>
        <Button size="sm" onClick={openCreate} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
          <Plus className="w-4 h-4" /> New Invoice
        </Button>
      </div>
      {invoices.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Receipt className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-body text-sm">No invoices yet</p>
          <Button onClick={openCreate} variant="outline" className="mt-4 gap-2 font-body text-sm"><Plus className="w-4 h-4" /> Create First Invoice</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(inv => (
            <div key={inv.id} className="glass-panel rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-body text-sm text-foreground font-mono">{inv.number}</p>
                  <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${statusColor(inv.status)}`}>{inv.status}</span>
                </div>
                <p className="text-xs font-body text-muted-foreground mt-0.5">{inv.to.name || "No client"} · ${calcInvTotal(inv).toFixed(2)} · Due {inv.dueDate}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {inv.status !== "paid" && inv.status !== "cancelled" && (
                  <button onClick={() => handleMarkPaid(inv)} className="px-2 py-1 text-xs font-body rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors">Paid</button>
                )}
                <button onClick={() => setEditing({ ...inv })} className="p-1.5 rounded hover:bg-secondary text-muted-foreground/60 hover:text-foreground transition-colors"><Edit className="w-3.5 h-3.5" /></button>
                <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/invoice/${inv.shareToken}`).then(() => toast.success("Invoice link copied")).catch(() => {}); }} className="p-1.5 rounded hover:bg-secondary text-muted-foreground/60 hover:text-foreground transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                <button onClick={() => handleDelete(inv.id)} className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground/60 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Invoice Editor ───────────────────────────────────────────────────────────
function TenantInvoiceEditor({ invoice, onSave, onCancel }: { invoice: Invoice; onSave: (inv: Invoice) => void; onCancel: () => void }) {
  const [inv, setInv] = useState<Invoice>(invoice);
  const set = (patch: Partial<Invoice>) => setInv(i => ({ ...i, ...patch }));
  const setFrom = (patch: Partial<InvoiceParty>) => setInv(i => ({ ...i, from: { ...i.from, ...patch } }));
  const setTo = (patch: Partial<InvoiceParty>) => setInv(i => ({ ...i, to: { ...i.to, ...patch } }));
  const setItem = (idx: number, patch: Partial<InvoiceItem>) => setInv(i => ({ ...i, items: i.items.map((it, j) => j === idx ? { ...it, ...patch } : it) }));

  const fieldCls = "w-full bg-secondary border border-border text-foreground font-body text-sm rounded-lg px-3 py-2 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50";
  const labelCls = "block text-[10px] font-body uppercase tracking-wider text-muted-foreground mb-1";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-xl text-foreground">{invoice.id ? "Edit Invoice" : "New Invoice"} · {inv.number}</h2>
        <Button variant="outline" onClick={onCancel} className="font-body text-xs gap-1"><X className="w-3.5 h-3.5" />Cancel</Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="space-y-3 glass-panel rounded-xl p-4">
          <p className="text-xs font-body text-muted-foreground uppercase tracking-wider font-medium">From</p>
          <div><label className={labelCls}>Name</label><input className={fieldCls} value={inv.from.name} onChange={e => setFrom({ name: e.target.value })} /></div>
          <div><label className={labelCls}>Email</label><input className={fieldCls} type="email" value={inv.from.email} onChange={e => setFrom({ email: e.target.value })} /></div>
          <div><label className={labelCls}>ABN</label><input className={fieldCls} value={inv.from.abn || ""} onChange={e => setFrom({ abn: e.target.value })} /></div>
          <div><label className={labelCls}>Address</label><textarea className={fieldCls} rows={2} value={inv.from.address} onChange={e => setFrom({ address: e.target.value })} /></div>
        </div>
        <div className="space-y-3 glass-panel rounded-xl p-4">
          <p className="text-xs font-body text-muted-foreground uppercase tracking-wider font-medium">To (Client)</p>
          <div><label className={labelCls}>Name</label><input className={fieldCls} value={inv.to.name} onChange={e => setTo({ name: e.target.value })} /></div>
          <div><label className={labelCls}>Email</label><input className={fieldCls} type="email" value={inv.to.email} onChange={e => setTo({ email: e.target.value })} /></div>
          <div><label className={labelCls}>Address</label><textarea className={fieldCls} rows={2} value={inv.to.address} onChange={e => setTo({ address: e.target.value })} /></div>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-4 mb-6">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className={labelCls}>Due Date</label><input className={fieldCls} type="date" value={inv.dueDate} onChange={e => set({ dueDate: e.target.value })} /></div>
          <div><label className={labelCls}>Status</label>
            <select className={fieldCls} value={inv.status} onChange={e => set({ status: e.target.value as Invoice["status"] })}>
              <option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground mb-2 font-medium">Line Items</p>
        {inv.items.map((item, idx) => (
          <div key={item.id} className="flex gap-2 items-start mb-2">
            <input className={`${fieldCls} flex-1`} value={item.description} onChange={e => setItem(idx, { description: e.target.value })} placeholder="Description" />
            <input className={`${fieldCls} w-16`} type="number" value={item.quantity} onChange={e => setItem(idx, { quantity: Number(e.target.value) })} placeholder="Qty" />
            <input className={`${fieldCls} w-24`} type="number" value={item.unitPrice} onChange={e => setItem(idx, { unitPrice: Number(e.target.value) })} placeholder="$" />
            <button onClick={() => setInv(i => ({ ...i, items: i.items.filter((_, j) => j !== idx) }))} className="p-2 text-muted-foreground hover:text-destructive mt-0.5"><X className="w-4 h-4" /></button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setInv(i => ({ ...i, items: [...i.items, emptyItem()] }))} className="font-body text-xs gap-1 mt-2"><Plus className="w-3.5 h-3.5" />Add Item</Button>
        <div className="mt-4 text-right">
          <p className="text-sm font-body text-foreground">Total: <span className="font-medium text-primary">${calcInvTotal(inv).toFixed(2)}</span></p>
        </div>
      </div>

      <div className="glass-panel rounded-xl p-4 mb-6">
        <label className={labelCls}>Notes</label>
        <textarea className={fieldCls} rows={3} value={inv.notes} onChange={e => set({ notes: e.target.value })} placeholder="Payment instructions, terms, etc." />
      </div>

      <Button onClick={() => onSave(inv)} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
        <Save className="w-4 h-4" /> Save Invoice
      </Button>
    </motion.div>
  );
}

// ─── Contacts ────────────────────────────────────────────────────────────────
function TenantContacts({ slug }: { slug: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const data = await getTenantStoreKey<Contact[]>(slug, "wv_contacts");
    setContacts(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const saveAll = async (cs: Contact[]) => {
    const { ok, error } = await saveTenantStoreKey(slug, "wv_contacts", cs);
    if (!ok) { toast.error(error || "Failed to save"); return false; }
    return true;
  };

  const emptyContact = (): Contact => ({ id: generateId("contact"), name: "", email: "", address: "", abn: "", phone: "", company: "", notes: "", createdAt: new Date().toISOString() });

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error("Name is required"); return; }
    const exists = contacts.find(c => c.id === editing.id);
    const updated = exists ? contacts.map(c => c.id === editing.id ? editing : c) : [...contacts, editing];
    if (await saveAll(updated)) {
      setContacts(updated);
      setEditing(null);
      toast.success(exists ? "Contact updated" : "Contact saved");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this contact?")) return;
    const updated = contacts.filter(c => c.id !== id);
    if (await saveAll(updated)) { setContacts(updated); toast.success("Contact deleted"); }
  };

  const filtered = contacts.filter(c => !search || `${c.name} ${c.email} ${c.company || ""}`.toLowerCase().includes(search.toLowerCase()));
  const fieldCls = "w-full bg-secondary border border-border text-foreground font-body text-sm rounded-lg px-3 py-2 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50";
  const labelCls = "block text-[10px] font-body uppercase tracking-wider text-muted-foreground mb-1.5";

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Contacts</h2>
        <Button onClick={() => setEditing(emptyContact())} className="gap-2 font-body text-sm"><Plus className="w-4 h-4" /> New Contact</Button>
      </div>

      {editing && (
        <div className="glass-panel rounded-xl p-5 mb-6 space-y-4 max-w-lg">
          <h3 className="font-display text-base text-foreground">{contacts.find(c => c.id === editing.id) ? "Edit Contact" : "New Contact"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Name *</label><input className={fieldCls} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Full name" /></div>
            <div><label className={labelCls}>Company</label><input className={fieldCls} value={editing.company || ""} onChange={e => setEditing({ ...editing, company: e.target.value })} /></div>
            <div><label className={labelCls}>Email</label><input className={fieldCls} type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} /></div>
            <div><label className={labelCls}>Phone</label><input className={fieldCls} value={editing.phone || ""} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></div>
            <div><label className={labelCls}>ABN</label><input className={fieldCls} value={editing.abn || ""} onChange={e => setEditing({ ...editing, abn: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className={labelCls}>Address</label><textarea className={fieldCls} rows={2} value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className={labelCls}>Notes</label><textarea className={fieldCls} rows={2} value={editing.notes || ""} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} className="font-body text-sm gap-1.5"><Save className="w-4 h-4" />Save</Button>
            <Button variant="outline" onClick={() => setEditing(null)} className="font-body text-sm gap-1.5"><X className="w-4 h-4" />Cancel</Button>
          </div>
        </div>
      )}

      {contacts.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…" className="pl-9 bg-secondary border-border font-body text-sm" />
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-body text-sm">No contacts yet</p>
          <Button onClick={() => setEditing(emptyContact())} variant="outline" className="mt-4 gap-2 font-body text-sm"><Plus className="w-4 h-4" /> Add First Contact</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div key={c.id} className="glass-panel rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm text-foreground font-medium">{c.name}{c.company ? <span className="text-muted-foreground font-normal"> · {c.company}</span> : null}</p>
                <p className="font-body text-xs text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditing({ ...c })} className="p-1.5 rounded hover:bg-secondary text-muted-foreground/60 hover:text-foreground transition-colors"><Edit className="w-3.5 h-3.5" /></button>
                <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground/60 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Profile ─────────────────────────────────────────────────────────────────
function TenantProfileView({ slug, session }: { slug: string; session: { displayName: string; email: string } }) {
  const [displayName, setDisplayName] = useState(session.displayName);
  const [email, setEmail] = useState(session.email);
  const [bio, setBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    fetch(`/api/tenant/${encodeURIComponent(slug)}/public`)
      .then(r => r.json())
      .then(d => { if (d.tenant) setBio(d.tenant.bio || ""); })
      .catch(() => {});
  }, [slug]);

  const handleSave = async () => {
    if (!displayName.trim()) { toast.error("Display name is required"); return; }
    setSavingProfile(true);
    const { ok, error } = await updateTenant(slug, { displayName: displayName.trim(), email: email.trim(), bio: bio.trim() || undefined });
    setSavingProfile(false);
    if (!ok) { toast.error(error || "Failed to save profile"); return; }
    toast.success("Profile updated");
  };

  const handleChangePassword = async () => {
    if (!currentPassword) { toast.error("Enter your current password"); return; }
    if (!newPassword) { toast.error("Enter a new password"); return; }
    if (newPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (newPassword !== confirmNewPassword) { toast.error("Passwords do not match"); return; }
    setSavingPassword(true);
    try {
      const currentHash = await hashPassword(currentPassword);
      const checkRes = await fetch(`/api/tenant/${encodeURIComponent(slug)}/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordHash: currentHash }),
      });
      if (!checkRes.ok) { toast.error("Current password is incorrect"); return; }
      const newHash = await hashPassword(newPassword);
      const { ok, error } = await updateTenant(slug, { passwordHash: newHash });
      if (!ok) { toast.error(error || "Failed to update password"); return; }
      toast.success("Password updated");
      setCurrentPassword(""); setNewPassword(""); setConfirmNewPassword("");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Profile</h2>
      <div className="space-y-8 max-w-md">
        {/* Profile info */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Display Name</label>
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Email</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Bio</label>
            <Textarea value={bio} onChange={e => setBio(e.target.value)} rows={4} className="bg-secondary border-border text-foreground font-body resize-none" placeholder="Short bio shown on your booking page" />
          </div>
          <div className="p-3 rounded-lg bg-secondary/50 border border-border/50">
            <p className="text-xs font-body text-muted-foreground">Booking page URL:</p>
            <a href={`/book/${slug}`} target="_blank" rel="noopener noreferrer" className="text-sm font-body text-primary hover:underline">{window.location.origin}/book/{slug}</a>
          </div>
          <Button onClick={handleSave} disabled={savingProfile} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2 w-full">
            <Save className="w-4 h-4" /> {savingProfile ? "Saving…" : "Save Profile"}
          </Button>
        </div>

        {/* Password change */}
        <div className="space-y-4 pt-4 border-t border-border/30">
          <h3 className="font-display text-base text-foreground">Change Password</h3>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Current Password</label>
            <Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">New Password</label>
            <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Confirm New Password</label>
            <Input type="password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} className="bg-secondary border-border text-foreground font-body" onKeyDown={e => e.key === "Enter" && handleChangePassword()} />
          </div>
          <Button onClick={handleChangePassword} disabled={savingPassword} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2 w-full">
            <Save className="w-4 h-4" /> {savingPassword ? "Updating…" : "Update Password"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────
function TenantSettingsView({ slug }: { slug: string }) {
  const [settings, setSettings] = useState<TenantSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<"payments" | "notifications" | "watermark">("payments");
  const [wmUploading, setWmUploading] = useState(false);

  useEffect(() => {
    getTenantSettings(slug).then(s => { setSettings(s); setLoading(false); });
  }, [slug]);

  const set = (patch: Partial<TenantSettings>) => setSettings(s => ({ ...s, ...patch }));

  const handleSaveSettings = async () => {
    setSaving(true);
    const { ok, error } = await saveTenantSettings(slug, settings);
    setSaving(false);
    if (!ok) { toast.error(error || "Failed to save"); return; }
    toast.success("Settings saved");
  };

  const handleWatermarkImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setWmUploading(true);
    const reader = new FileReader();
    reader.onload = ev => {
      set({ watermarkImage: ev.target?.result as string });
      setWmUploading(false);
    };
    reader.readAsDataURL(file);
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  const sectionTabs = [
    { id: "payments" as const, label: "Payments" },
    { id: "notifications" as const, label: "Notifications" },
    { id: "watermark" as const, label: "Watermark" },
  ];

  const WATERMARK_POSITIONS: { value: WatermarkPosition; label: string }[] = [
    { value: "center", label: "Center" },
    { value: "top-left", label: "Top Left" },
    { value: "top-right", label: "Top Right" },
    { value: "bottom-left", label: "Bottom Left" },
    { value: "bottom-right", label: "Bottom Right" },
    { value: "tiled", label: "Tiled" },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Settings</h2>

      <div className="flex gap-1 mb-6 bg-secondary rounded-xl p-1 max-w-fit overflow-x-auto">
        {sectionTabs.map(t => (
          <button key={t.id} onClick={() => setActiveSection(t.id)}
            className={`px-4 py-2 rounded-lg text-xs font-body tracking-wider uppercase whitespace-nowrap transition-all ${activeSection === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >{t.label}</button>
        ))}
      </div>

      {activeSection === "payments" && (
        <div className="space-y-5 max-w-lg">
          {/* Stripe */}
          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Stripe</span>
              <Switch checked={settings.stripeEnabled !== false && !!(settings.stripePublishableKey || settings.stripeSecretKey)} onCheckedChange={v => set({ stripeEnabled: v })} />
              <span className="text-xs font-body text-muted-foreground">{settings.stripeEnabled !== false && (settings.stripePublishableKey || settings.stripeSecretKey) ? "Enabled" : "Disabled"}</span>
            </div>
            <div><label className="text-xs font-body text-muted-foreground mb-1 block">Publishable Key</label>
              <Input value={settings.stripePublishableKey || ""} onChange={e => set({ stripePublishableKey: e.target.value, stripeEnabled: true })} placeholder="pk_live_..." className="bg-background border-border text-foreground font-body text-xs font-mono" /></div>
            <div><label className="text-xs font-body text-muted-foreground mb-1 block">Secret Key</label>
              <Input type="password" value={settings.stripeSecretKey || ""} onChange={e => set({ stripeSecretKey: e.target.value, stripeEnabled: true })} placeholder="sk_live_..." className="bg-background border-border text-foreground font-body text-xs font-mono" /></div>
            <div><label className="text-xs font-body text-muted-foreground mb-1 block">Webhook Secret</label>
              <Input type="password" value={settings.stripeWebhookSecret || ""} onChange={e => set({ stripeWebhookSecret: e.target.value })} placeholder="whsec_..." className="bg-background border-border text-foreground font-body text-xs font-mono" />
              <p className="text-[10px] font-body text-muted-foreground mt-1">Webhook URL: <code className="bg-secondary px-1 rounded text-[10px]">/api/tenant/{slug}/stripe/webhook</code></p>
            </div>
            <div><label className="text-xs font-body text-muted-foreground mb-1 block">Currency</label>
              <Input value={settings.stripeCurrency || ""} onChange={e => set({ stripeCurrency: e.target.value.toLowerCase() })} placeholder="aud" maxLength={3} className="bg-background border-border text-foreground font-body text-xs font-mono w-24" /></div>
          </div>

          {/* Bank Transfer */}
          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Bank Transfer</span>
              <Switch checked={!!settings.bankTransferEnabled} onCheckedChange={v => set({ bankTransferEnabled: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">Account Name</label><Input value={settings.bankAccountName || ""} onChange={e => set({ bankAccountName: e.target.value })} placeholder="Jane Smith Photography" className="bg-background border-border text-foreground font-body text-xs" /></div>
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">BSB</label><Input value={settings.bankBsb || ""} onChange={e => set({ bankBsb: e.target.value })} placeholder="000-000" className="bg-background border-border text-foreground font-body text-xs" /></div>
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">Account Number</label><Input value={settings.bankAccountNumber || ""} onChange={e => set({ bankAccountNumber: e.target.value })} placeholder="00000000" className="bg-background border-border text-foreground font-body text-xs" /></div>
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">PayID</label><Input value={settings.bankPayId || ""} onChange={e => set({ bankPayId: e.target.value })} placeholder="you@example.com" className="bg-background border-border text-foreground font-body text-xs" /></div>
            </div>
            <div><label className="text-xs font-body text-muted-foreground mb-1 block">Payment Instructions</label><Input value={settings.bankInstructions || ""} onChange={e => set({ bankInstructions: e.target.value })} placeholder="Use your name as reference" className="bg-background border-border text-foreground font-body text-xs" /></div>
          </div>

          <Button onClick={handleSaveSettings} disabled={saving} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2 w-full">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Payment Settings"}
          </Button>
        </div>
      )}

      {activeSection === "notifications" && (
        <div className="space-y-5 max-w-lg">
          {/* Discord */}
          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Discord</span>
            <div><label className="text-xs font-body text-muted-foreground mb-1 block">Webhook URL</label>
              <Input value={settings.discordWebhookUrl || ""} onChange={e => set({ discordWebhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/..." className="bg-background border-border text-foreground font-body text-xs" />
              <p className="text-[10px] font-body text-muted-foreground mt-1">Your booking notifications will be sent to this webhook.</p>
            </div>
            <div className="flex flex-wrap gap-4">
              {([{ key: "discordNotifyBookings", label: "Bookings" }, { key: "discordNotifyDownloads", label: "Downloads" }, { key: "discordNotifyProofing", label: "Proofing" }] as { key: keyof TenantSettings; label: string }[]).map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <Switch checked={settings[key] !== false} onCheckedChange={v => set({ [key]: v })} />
                  <label className="text-xs font-body text-foreground">{label}</label>
                </div>
              ))}
            </div>
          </div>

          {/* SMTP */}
          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Email SMTP</span>
            <p className="text-[10px] font-body text-muted-foreground -mt-1">Booking confirmation emails will be sent from your email server.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">SMTP Host</label><Input value={settings.smtpHost || ""} onChange={e => set({ smtpHost: e.target.value })} placeholder="smtp.gmail.com" className="bg-background border-border text-foreground font-body text-xs" /></div>
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">Port</label><Input type="number" value={settings.smtpPort || ""} onChange={e => set({ smtpPort: parseInt(e.target.value) || undefined })} placeholder="587" className="bg-background border-border text-foreground font-body text-xs" /></div>
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">Username</label><Input value={settings.smtpUser || ""} onChange={e => set({ smtpUser: e.target.value })} placeholder="you@example.com" className="bg-background border-border text-foreground font-body text-xs" /></div>
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">Password</label><Input type="password" value={settings.smtpPassword || ""} onChange={e => set({ smtpPassword: e.target.value })} placeholder="••••••••" className="bg-background border-border text-foreground font-body text-xs" /></div>
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">From Address</label><Input value={settings.smtpFrom || ""} onChange={e => set({ smtpFrom: e.target.value })} placeholder="Jane <jane@example.com>" className="bg-background border-border text-foreground font-body text-xs" /></div>
              <div className="flex items-center gap-2 pt-5"><Switch checked={!!settings.smtpSecure} onCheckedChange={v => set({ smtpSecure: v })} /><label className="text-xs font-body text-foreground">Use TLS (port 465)</label></div>
            </div>
          </div>

          <Button onClick={handleSaveSettings} disabled={saving} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2 w-full">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Notification Settings"}
          </Button>
        </div>
      )}

      {activeSection === "watermark" && (
        <div className="space-y-5 max-w-lg">
          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <h3 className="text-xs font-body tracking-wider uppercase text-muted-foreground">Watermark Image</h3>
            {settings.watermarkImage ? (
              <div className="flex items-center gap-3">
                <img src={settings.watermarkImage} alt="Watermark" className="h-12 object-contain rounded bg-secondary p-1" />
                <Button size="sm" variant="ghost" onClick={() => set({ watermarkImage: undefined })} className="text-destructive hover:text-destructive hover:bg-destructive/10 font-body text-xs gap-1">
                  <X className="w-3 h-3" /> Remove
                </Button>
              </div>
            ) : (
              <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/80 border border-border/50 text-xs font-body text-muted-foreground hover:text-foreground transition-colors">
                <Upload className="w-3.5 h-3.5" />
                {wmUploading ? "Uploading…" : "Upload Image"}
                <input type="file" accept="image/*" className="hidden" onChange={handleWatermarkImageUpload} />
              </label>
            )}
          </div>

          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <h3 className="text-xs font-body tracking-wider uppercase text-muted-foreground">Watermark Text</h3>
            <Input value={settings.watermarkText || ""} onChange={e => set({ watermarkText: e.target.value })} placeholder="© Your Studio Name" className="bg-background border-border text-foreground font-body text-sm" />
            <p className="text-[10px] font-body text-muted-foreground">Used as fallback when no image is set.</p>
          </div>

          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <h3 className="text-xs font-body tracking-wider uppercase text-muted-foreground">Position</h3>
            <div className="grid grid-cols-3 gap-2">
              {WATERMARK_POSITIONS.map(pos => (
                <button key={pos.value} onClick={() => set({ watermarkPosition: pos.value })}
                  className={`px-3 py-2 rounded-lg text-xs font-body border transition-all ${settings.watermarkPosition === pos.value || (!settings.watermarkPosition && pos.value === "tiled") ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"}`}>
                  {pos.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-body tracking-wider uppercase text-muted-foreground">Opacity</h3>
              <span className="text-xs font-body text-foreground">{settings.watermarkOpacity ?? 20}%</span>
            </div>
            <Slider value={[settings.watermarkOpacity ?? 20]} min={5} max={80} step={5}
              onValueChange={([v]) => set({ watermarkOpacity: v })} className="w-full" />
          </div>

          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-body tracking-wider uppercase text-muted-foreground">Size</h3>
              <span className="text-xs font-body text-foreground">{settings.watermarkSize ?? 40}%</span>
            </div>
            <Slider value={[settings.watermarkSize ?? 40]} min={10} max={100} step={5}
              onValueChange={([v]) => set({ watermarkSize: v })} className="w-full" />
          </div>

          <Button onClick={handleSaveSettings} disabled={saving} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2 w-full">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Watermark Settings"}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Storage ─────────────────────────────────────────────────────────────────
function TenantStorage({ slug }: { slug: string }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTenantMobileData(slug).then(d => {
      setAlbums(d.albums || []);
      setLoading(false);
    });
  }, [slug]);

  const handleClearCache = async () => {
    setCacheClearing(true);
    const { ok, cleared, error } = await clearTenantImageCache(slug);
    setCacheClearing(false);
    if (!ok) { toast.error(error || "Failed to clear cache"); return; }
    toast.success(`Cache cleared — ${cleared ?? 0} file(s) removed`);
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  const totalPhotos = albums.reduce((s, a) => s + (a.photos?.length || 0), 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Storage</h2>
      <div className="space-y-4 max-w-lg">
        <div className="grid grid-cols-2 gap-4">
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Albums</p>
            <p className="font-display text-2xl text-foreground mt-1">{albums.length}</p>
          </div>
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Total Photos</p>
            <p className="font-display text-2xl text-foreground mt-1">{totalPhotos}</p>
          </div>
        </div>

        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h3 className="font-display text-base text-foreground">Image Cache</h3>
          <p className="text-xs font-body text-muted-foreground">
            Watermarked and resized versions are cached on the server for faster delivery.
            Clear the cache to regenerate images with updated watermark settings.
          </p>
          <Button
            onClick={handleClearCache}
            disabled={cacheClearing}
            variant="outline"
            className="font-body text-xs tracking-wider uppercase gap-2 border-border text-muted-foreground hover:text-foreground"
          >
            <HardDrive className="w-3.5 h-3.5" />
            {cacheClearing ? "Clearing…" : "Clear Image Cache"}
          </Button>
        </div>

        <div className="glass-panel rounded-xl p-5 space-y-3">
          <h3 className="font-display text-base text-foreground">Albums</h3>
          {albums.length === 0 ? (
            <p className="text-sm font-body text-muted-foreground">No albums yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {albums.map(a => (
                <div key={a.id} className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50">
                  <span className="text-sm font-body text-foreground truncate">{a.title}</span>
                  <span className="text-xs font-body text-muted-foreground shrink-0 ml-3">{a.photos?.length || 0} photos</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── License ──────────────────────────────────────────────────────────────────
function TenantLicense({ slug }: { slug: string }) {
  const [licInfo, setLicInfo] = useState<{
    key: string | null;
    issuedTo?: string;
    isTrial?: boolean;
    trialMaxEvents?: number;
    trialMaxBookings?: number;
    expiresAt?: string;
    usedAt?: string;
  } | null>(null);
  const [bookingCount, setBookingCount] = useState(0);
  const [eventCount, setEventCount] = useState(0);

  useEffect(() => {
    getTenantLicenseInfo(slug).then(setLicInfo);
    fetchTenantMobileData(slug).then(d => setBookingCount((d.bookings || []).length));
    getTenantStoreKey<unknown[]>(slug, "wv_event_types").then(ets => setEventCount(Array.isArray(ets) ? ets.length : 0));
  }, [slug]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">License</h2>
      {!licInfo ? (
        <div className="py-8 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>
      ) : !licInfo.key ? (
        <div className="glass-panel rounded-xl p-6 text-center space-y-3">
          <Key className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="font-body text-sm text-muted-foreground">No license key linked to your account.</p>
          <p className="font-body text-xs text-muted-foreground/60">Contact your platform administrator.</p>
        </div>
      ) : (
        <div className="space-y-4 max-w-lg">
          <div className="glass-panel rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Key className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-mono text-sm text-foreground tracking-widest">{licInfo.key}</p>
                {licInfo.issuedTo && <p className="text-xs font-body text-muted-foreground mt-0.5">Issued to: {licInfo.issuedTo}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-secondary/50 text-center">
                <p className="font-display text-xl text-foreground">{licInfo.isTrial ? "Trial" : "Full"}</p>
                <p className="text-xs font-body text-muted-foreground">License Type</p>
              </div>
              {licInfo.expiresAt ? (
                <div className="p-3 rounded-lg bg-secondary/50 text-center">
                  <p className="font-display text-base text-foreground">{licInfo.expiresAt.slice(0, 10)}</p>
                  <p className="text-xs font-body text-muted-foreground">Expires</p>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-secondary/50 text-center">
                  <p className="font-display text-base text-green-400">Never</p>
                  <p className="text-xs font-body text-muted-foreground">Expires</p>
                </div>
              )}
            </div>

            {licInfo.isTrial && (
              <div className="space-y-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-xs font-body text-amber-500 font-medium">Free Trial Limits</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-xs font-body mb-1">
                      <span className="text-muted-foreground">Bookings</span>
                      <span className="text-foreground">{bookingCount} / {licInfo.trialMaxBookings ?? 10}</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${Math.min(100, (bookingCount / (licInfo.trialMaxBookings ?? 10)) * 100)}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-body mb-1">
                      <span className="text-muted-foreground">Event Types</span>
                      <span className="text-foreground">{eventCount} / {licInfo.trialMaxEvents ?? 1}</span>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${Math.min(100, (eventCount / (licInfo.trialMaxEvents ?? 1)) * 100)}%` }} />
                    </div>
                  </div>
                </div>
                <p className="text-[10px] font-body text-muted-foreground">Contact your platform administrator to upgrade to a full license.</p>
              </div>
            )}

            <div className="flex items-center justify-between text-xs font-body text-muted-foreground pt-2 border-t border-border/30">
              <span>Account ID</span>
              <span className="font-mono text-foreground">{slug}</span>
            </div>
            {licInfo.usedAt && (
              <div className="flex items-center justify-between text-xs font-body text-muted-foreground">
                <span>Activated</span>
                <span className="text-foreground">{new Date(licInfo.usedAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
