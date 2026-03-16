import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Calendar, Clock, Image, Receipt,
  Users, Settings, Key, LogOut, Camera, Plus, Edit, Trash2,
  Save, X, ChevronDown, ChevronUp, Globe, Upload, Search, Copy,
  DollarSign, MessageSquare, HardDrive, User, RefreshCw, Webhook, Star,
  ExternalLink, Mail, Send, Unlock, CreditCard, CheckCircle2, Download,
  XSquare, CheckSquare, Bell, Wifi, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import WatermarkedImage from "@/components/WatermarkedImage";
import { toast } from "sonner";
import { getMobileTenantSession, setMobileTenantSession, hashPassword } from "@/lib/storage";
import { generateThumbnail, compressImage, formatBytes, formatSpeed } from "@/lib/image-utils";
import {
  fetchTenantMobileData, getTenantSettings, saveTenantSettings,
  deleteTenantBooking, updateTenantBookingFull,
  getTenantLicenseInfo, deleteTenantAlbum,
  getTenantStoreKey, saveTenantStoreKey, updateTenant,
  clearTenantImageCache, tenantPhotoSrc, saveTenantAlbum,
  uploadPhotosToServer, isServerMode, notifyTenantDiscord,
  getSuperAdminWebhooks, sendTenantEmail,
  getServerStorageStats, bulkDeleteFiles, deletePhotoFromServer,
  getTenantGoogleCalendarStatus, startTenantGoogleCalendarAuth,
  disconnectTenantGoogleCalendar, getTenantGoogleCalendars,
  saveTenantCalendarSettings, getTenantStorageStats, upsertTenantBookingAdmin,
  syncTenantBookingToCalendar,
  testTenantFtpConnection,
  submitEventSlotRequest, getTenantEventSlotRequest, createEventSlotCheckout,testTenantFtpConnection, ftpUploadAlbum, ftpMoveToStarred,
  getActiveLicensePlans, getLicensePlanCheckout, createBankLicensePurchase,
} from "@/lib/api";
import ProgressiveImg from "@/components/ProgressiveImg";
import RichTextEditor from "@/components/RichTextEditor";
import type {
  Booking, Album, Photo, AlbumDisplaySize, EventType, Invoice, InvoiceItem, InvoiceParty,
  Contact, TenantSettings, AvailabilitySlot, QuestionField, WatermarkPosition, SpecificDateSlot, EventSlotRequest, LicensePlan,
} from "@/lib/types";
import sampleLandscape from "@/assets/sample-landscape.jpg";
import samplePortrait from "@/assets/sample-portrait.jpg";
import sampleWedding from "@/assets/sample-wedding.jpg";
import sampleEvent from "@/assets/sample-event.jpg";
import sampleFood from "@/assets/sample-food.jpg";

type Tab = "dashboard" | "bookings" | "events" | "albums" | "photos" | "finance" | "invoices" | "contacts" | "enquiries" | "profile" | "settings" | "storage" | "license";
type AlbumSortKey = "date" | "name" | "photos" | "client";
type SortDir = "asc" | "desc";
type BookingSortKey = "date" | "name" | "type" | "status" | "payment" | "booked";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

const TENANT_TAB_LABELS: Record<Tab, string> = {
  dashboard: "Dashboard",
  bookings: "Bookings",
  events: "Events",
  albums: "Albums",
  photos: "Photos",
  finance: "Finance",
  invoices: "Invoices",
  contacts: "Contacts",
  enquiries: "Enquiries",
  profile: "Profile",
  settings: "Settings",
  storage: "Storage",
  license: "License",
};

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

  usePageTitle(session ? `${session.displayName} — ${TENANT_TAB_LABELS[activeTab]}` : "Login");

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
            <button onClick={handleLogout} aria-label="Log out" className="flex items-center gap-1.5 text-xs font-body text-muted-foreground px-2.5 py-1.5 rounded-lg hover:bg-secondary">
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
                  <span className="text-[10px] font-body tracking-wide whitespace-nowrap">{tab.label}</span>
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
  const [calView, setCalView] = useState<"month" | "week">("month");
  const [calDate, setCalDate] = useState(() => new Date());
  const [calSelectedDay, setCalSelectedDay] = useState<string | null>(null);

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
  const paidIncome = bookings.filter(b => b.paymentStatus === "paid").reduce((s, b) => s + (b.paymentAmount || 0), 0);

  const stats = [
    { label: "Total Bookings", value: bookings.length, icon: Calendar, color: "text-primary" },
    { label: "Upcoming", value: upcoming.length, icon: Clock, color: "text-blue-400" },
    { label: "Pending Approval", value: pending.length, icon: Calendar, color: "text-yellow-400" },
    { label: "Albums", value: albums.length, icon: Image, color: "text-purple-400" },
    { label: "Photos", value: totalPhotos, icon: Camera, color: "text-green-400" },
    { label: "Paid Income", value: `$${paidIncome}`, icon: DollarSign, color: "text-green-400" },
  ];

  // Calendar helpers
  const pad = (n: number) => String(n).padStart(2, "0");
  const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = toDateStr(new Date());

  const bookingsByDate: Record<string, Booking[]> = {};
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    if (!bookingsByDate[b.date]) bookingsByDate[b.date] = [];
    bookingsByDate[b.date].push(b);
  }

  const monthStart = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
  const monthEnd = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
  const gridDays: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= monthEnd || gridDays.length % 7 !== 0) {
    gridDays.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (gridDays.length > 42) break;
  }

  const weekStart = new Date(calDate);
  weekStart.setDate(calDate.getDate() - ((calDate.getDay() + 6) % 7));
  const weekDays: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const prevPeriod = () => {
    const d = new Date(calDate);
    if (calView === "month") d.setMonth(d.getMonth() - 1);
    else d.setDate(d.getDate() - 7);
    setCalDate(d);
  };
  const nextPeriod = () => {
    const d = new Date(calDate);
    if (calView === "month") d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + 7);
    setCalDate(d);
  };
  const goToday = () => { setCalDate(new Date()); setCalSelectedDay(todayStr); };

  const selectedDayBookings = calSelectedDay ? (bookingsByDate[calSelectedDay] || []) : [];
  const monthLabel = calDate.toLocaleString("en-AU", { month: "long", year: "numeric" });
  const weekLabel = `${weekDays[0].toLocaleString("en-AU", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

  const DayCell = ({ date, inMonth }: { date: Date; inMonth: boolean }) => {
    const ds = toDateStr(date);
    const bks = bookingsByDate[ds] || [];
    const isToday = ds === todayStr;
    const isSelected = ds === calSelectedDay;
    return (
      <div
        onClick={() => setCalSelectedDay(ds === calSelectedDay ? null : ds)}
        className={`relative min-h-[56px] p-1 rounded-lg border cursor-pointer transition-all
          ${isSelected ? "border-primary bg-primary/10" : "border-transparent hover:border-border/50 hover:bg-secondary/40"}
          ${!inMonth ? "opacity-30" : ""}`}
      >
        <span className={`text-[11px] font-body block mb-0.5 ${isToday ? "bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center font-medium" : "text-muted-foreground"}`}>
          {date.getDate()}
        </span>
        <div className="space-y-0.5">
          {bks.slice(0, 2).map(b => (
            <div key={b.id} className={`text-[9px] font-body truncate px-1 rounded ${
              b.status === "confirmed" ? "bg-green-500/20 text-green-400" :
              b.status === "pending" ? "bg-yellow-500/20 text-yellow-400" :
              "bg-primary/20 text-primary"
            }`}>{b.clientName}</div>
          ))}
          {bks.length > 2 && <div className="text-[9px] font-body text-muted-foreground/60 pl-1">+{bks.length - 2}</div>}
        </div>
      </div>
    );
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="mb-6">
        <h2 className="font-display text-2xl text-foreground">Welcome back, {session.displayName}</h2>
        <p className="text-sm font-body text-muted-foreground mt-1">Your photographer dashboard</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {stats.map(s => (
          <div key={s.label} className="glass-panel rounded-xl p-4 space-y-1">
            <s.icon className={`w-4 h-4 ${s.color}`} />
            <p className="font-display text-2xl text-foreground">{s.value}</p>
            <p className="text-xs font-body text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <div className="glass-panel rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={prevPeriod} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"><ChevronDown className="w-4 h-4 rotate-90" /></button>
            <span className="font-display text-sm text-foreground min-w-[160px] text-center">{calView === "month" ? monthLabel : weekLabel}</span>
            <button type="button" onClick={nextPeriod} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"><ChevronDown className="w-4 h-4 -rotate-90" /></button>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={goToday} className="text-[10px] font-body px-2.5 py-1 rounded-full bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors">Today</button>
            {(["month", "week"] as const).map(v => (
              <button type="button" key={v} onClick={() => setCalView(v)}
                className={`px-2.5 py-1 rounded text-xs font-body transition-colors capitalize ${calView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
            <div key={d} className="text-[10px] font-body text-muted-foreground/50 text-center py-1">{d}</div>
          ))}
        </div>

        {calView === "month" ? (
          <div className="grid grid-cols-7 gap-0.5">
            {gridDays.map((d, i) => <DayCell key={i} date={d} inMonth={d.getMonth() === calDate.getMonth()} />)}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-0.5">
            {weekDays.map((d, i) => <DayCell key={i} date={d} inMonth={true} />)}
          </div>
        )}

        {calSelectedDay && selectedDayBookings.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-border/30 pt-3">
            <p className="text-xs font-body text-muted-foreground">{new Date(calSelectedDay + "T12:00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}</p>
            {selectedDayBookings.map(bk => (
              <div key={bk.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-secondary/50">
                <div>
                  <p className="text-sm font-body text-foreground">{bk.clientName}</p>
                  <p className="text-xs font-body text-muted-foreground">{bk.time} · {formatDuration(bk.duration)} · {bk.type}</p>
                </div>
                <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${
                  bk.status === "confirmed" ? "bg-green-500/10 text-green-400" :
                  bk.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
                  "bg-secondary text-muted-foreground"
                }`}>{bk.status}</span>
              </div>
            ))}
          </div>
        )}
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
function TenantBookingEditor({ slug, booking, onSave, onCancel }: {
  slug: string;
  booking: Booking | null;
  onSave: (bk: Booking) => void;
  onCancel: () => void;
}) {
  const isNew = !booking;
  const [clientName, setClientName] = useState(booking?.clientName || "");
  const [clientEmail, setClientEmail] = useState(booking?.clientEmail || "");
  const [date, setDate] = useState(booking?.date || "");
  const [time, setTime] = useState(booking?.time || "");
  const [duration, setDuration] = useState(String(booking?.duration || 60));
  const [type, setType] = useState(booking?.type || "");
  const [notes, setNotes] = useState(booking?.notes || "");
  const [status, setStatus] = useState<Booking["status"]>(booking?.status || "pending");
  const [paymentStatus, setPaymentStatus] = useState(booking?.paymentStatus || "unpaid");
  const [paymentAmount, setPaymentAmount] = useState(String(booking?.paymentAmount || ""));
  const [instagramHandle, setInstagramHandle] = useState(booking?.instagramHandle || "");

  const handleSave = () => {
    if (!clientName.trim()) { toast.error("Client name is required"); return; }
    if (!date) { toast.error("Date is required"); return; }
    const bk: Booking = {
      id: booking?.id || generateId("bk"),
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      date,
      time,
      duration: parseInt(duration) || 60,
      type: type.trim(),
      notes: notes.trim(),
      status,
      paymentStatus: paymentStatus as Booking["paymentStatus"],
      paymentAmount: paymentAmount ? parseFloat(paymentAmount) : undefined,
      instagramHandle: instagramHandle.trim() || undefined,
      createdAt: booking?.createdAt || new Date().toISOString(),
      tenantSlug: slug,
      answers: booking?.answers,
      answerLabels: booking?.answerLabels,
      albumId: booking?.albumId,
      gcalEventId: booking?.gcalEventId,
      eventTypeId: booking?.eventTypeId || "",
      modifyToken: booking?.modifyToken,
    };
    onSave(bk);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg text-foreground">{isNew ? "New Booking" : "Edit Booking"}</h3>
        <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></Button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Client Name *</label>
          <Input value={clientName} onChange={e => setClientName(e.target.value)} className="bg-secondary border-border text-foreground font-body" autoFocus />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Email</label>
          <Input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Date *</label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Time</label>
          <Input type="time" value={time} onChange={e => setTime(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Duration (min)</label>
          <Input type="number" value={duration} onChange={e => setDuration(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Type / Event</label>
          <Input value={type} onChange={e => setType(e.target.value)} placeholder="e.g. Portrait Session" className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Instagram</label>
          <Input value={instagramHandle} onChange={e => setInstagramHandle(e.target.value)} placeholder="username" className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Amount ($)</label>
          <Input type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="0.00" className="bg-secondary border-border text-foreground font-body" />
        </div>
      </div>
      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Notes</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="bg-secondary border-border text-foreground font-body resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value as Booking["status"])} className="w-full bg-secondary border border-border text-foreground font-body text-sm rounded-md px-3 py-2">
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Payment</label>
          <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)} className="w-full bg-secondary border border-border text-foreground font-body text-sm rounded-md px-3 py-2">
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
            <option value="cash">Cash</option>
            <option value="deposit-paid">Deposit Paid</option>
          </select>
        </div>
      </div>
      <div className="flex gap-3 pt-2 border-t border-border/50">
        <Button variant="outline" onClick={onCancel} className="font-body text-xs border-border text-foreground">Cancel</Button>
        <Button onClick={handleSave} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
          <Save className="w-4 h-4" /> {isNew ? "Create Booking" : "Save Changes"}
        </Button>
      </div>
    </motion.div>
  );
}

function TenantBookings({ slug }: { slug: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "confirmed" | "completed" | "cancelled">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<BookingSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showCreate, setShowCreate] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [licInfo, setLicInfo] = useState<{ maxBookings?: number | null } | null>(null);

  const load = useCallback(() => {
    fetchTenantMobileData(slug).then(d => { setBookings(d.bookings || []); setLoading(false); });
  }, [slug]);

  useEffect(() => {
    load();
    getTenantLicenseInfo(slug).then(setLicInfo);
  }, [load, slug]);

  const handleStatusChange = async (bk: Booking, status: Booking["status"]) => {
    const { ok, error } = await updateTenantBookingFull(slug, bk.id, { status });
    if (!ok) { toast.error(error || "Failed to update"); return; }
    toast.success(`Booking ${status}`);
    // Push status change to Google Calendar
    const updated = { ...bk, status };
    if (bk.gcalEventId || status !== "cancelled") {
      syncTenantBookingToCalendar(slug, updated).catch(() => {});
    }
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

  const toggleSort = (key: BookingSortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "date" ? "desc" : "asc"); }
  };

  const filtered = bookings.filter(bk => {
    if (statusFilter !== "all" && bk.status !== statusFilter) return false;
    if (search && !`${bk.clientName} ${bk.clientEmail} ${bk.type}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "date": return dir * ((new Date(`${a.date}T${a.time || "00:00"}:00`).getTime()) - (new Date(`${b.date}T${b.time || "00:00"}:00`).getTime()));
      case "name": return dir * (a.clientName || "").localeCompare(b.clientName || "");
      case "type": return dir * (a.type || "").localeCompare(b.type || "");
      case "status": return dir * (a.status || "").localeCompare(b.status || "");
      case "payment": return dir * (a.paymentStatus || "").localeCompare(b.paymentStatus || "");
      case "booked": return dir * (new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
      default: return 0;
    }
  });

  const handleExportCsv = () => {
    const headers = ["Name", "Email", "Date", "Time", "Duration (min)", "Type", "Status", "Payment", "Amount ($)", "Notes", "Booked At"];
    const rows = sorted.map(bk => [
      bk.clientName, bk.clientEmail, bk.date, bk.time, String(bk.duration || ""),
      bk.type || "", bk.status || "", bk.paymentStatus || "", String(bk.paymentAmount || ""),
      bk.notes || "", bk.createdAt ? new Date(bk.createdAt).toLocaleDateString("en-AU") : "",
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bookings-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortBtn = ({ k, label }: { k: BookingSortKey; label: string }) => (
    <button onClick={() => toggleSort(k)} className={`text-[10px] font-body tracking-wider uppercase px-2 py-1 rounded transition-colors ${sortKey === k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
      {label} {sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </button>
  );

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  const trialLimitReached = !!(licInfo?.maxBookings != null && bookings.length >= licInfo.maxBookings);

  if (showCreate || editingBooking) {
    return (
      <TenantBookingEditor
        slug={slug}
        booking={editingBooking}
        onSave={async (bk) => {
          const { ok, error } = editingBooking
            ? await updateTenantBookingFull(slug, bk.id, bk)
            : await upsertTenantBookingAdmin(slug, bk);
          if (!ok) { toast.error(error || "Failed to save"); return; }
          toast.success(editingBooking ? "Booking updated" : "Booking created");
          setEditingBooking(null);
          setShowCreate(false);
          load();
        }}
        onCancel={() => { setEditingBooking(null); setShowCreate(false); }}
      />
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display text-2xl text-foreground">Bookings</h2>
          <span className="text-sm font-body text-muted-foreground">{bookings.length} total</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setShowCreate(true)} disabled={trialLimitReached} title={trialLimitReached ? `Limit: ${licInfo?.maxBookings} bookings` : undefined} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase disabled:opacity-50 disabled:cursor-not-allowed">
            <Plus className="w-4 h-4" /> New
          </Button>
          {bookings.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleExportCsv} className="font-body text-xs gap-1.5 border-border">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          )}
        </div>
      </div>

      {trialLimitReached && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs font-body text-amber-500">
          Booking limit reached ({licInfo?.maxBookings} bookings). Contact your platform administrator to upgrade your plan.
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
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

      <div className="flex items-center gap-1 flex-wrap mb-4">
        <span className="text-[10px] font-body text-muted-foreground/50 mr-1">Sort:</span>
        <SortBtn k="date" label="Date" />
        <SortBtn k="name" label="Name" />
        <SortBtn k="type" label="Type" />
        <SortBtn k="status" label="Status" />
        <SortBtn k="payment" label="Payment" />
        <SortBtn k="booked" label="Booked" />
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-body text-sm">{bookings.length === 0 ? "No bookings yet" : "No bookings match your filter"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(bk => (
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
                    {bk.instagramHandle && <div><span className="text-muted-foreground">Instagram: </span><span className="text-foreground">{bk.instagramHandle}</span></div>}
                    {bk.notes && <div className="col-span-2"><span className="text-muted-foreground">Notes: </span><span className="text-foreground">{bk.notes}</span></div>}
                    {bk.paymentStatus && <div><span className="text-muted-foreground">Payment: </span><span className="text-foreground">{bk.paymentStatus}</span></div>}
                    {bk.paymentAmount && <div><span className="text-muted-foreground">Amount: </span><span className="text-foreground">${bk.paymentAmount}</span></div>}
                    {bk.createdAt && <div><span className="text-muted-foreground">Booked: </span><span className="text-foreground">{new Date(bk.createdAt).toLocaleDateString("en-AU")}</span></div>}
                    {bk.albumId && <div><span className="text-muted-foreground">Album: </span><a href={`/gallery/${bk.albumId}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{bk.albumId}</a></div>}
                  </div>

                  {/* Custom question answers */}
                  {bk.answers && Object.keys(bk.answers).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Booking Answers</p>
                      {Object.entries(bk.answers).map(([key, val]) => (
                        <div key={key} className="text-xs font-body">
                          <span className="text-muted-foreground">{(bk.answerLabels?.[key] || key)}: </span>
                          <span className="text-foreground">{String(val)}</span>
                        </div>
                      ))}
                    </div>
                  )}

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

                  <div className="flex flex-wrap gap-3 items-center">
                    {bk.clientEmail && (
                      <button
                        onClick={() => {
                          const subject = `Your session is confirmed — ${bk.clientName}`;
                          const link = `mailto:${bk.clientEmail}?subject=${encodeURIComponent(subject)}`;
                          window.open(link);
                        }}
                        className="flex items-center gap-1.5 text-xs font-body text-primary hover:text-primary/80 transition-colors"
                      >
                        <Mail className="w-3.5 h-3.5" /> Email client
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        let token = bk.modifyToken;
                        if (!token) {
                          token = `mod-${crypto.randomUUID()}`;
                          const { ok } = await updateTenantBookingFull(slug, bk.id, { modifyToken: token });
                          if (!ok) { toast.error("Failed to generate booking link"); return; }
                          setBookings(prev => prev.map(b => b.id === bk.id ? { ...b, modifyToken: token! } : b));
                        }
                        navigator.clipboard.writeText(`${window.location.origin}/booking/modify/${token}`)
                          .then(() => toast.success("Booking link copied to clipboard"))
                          .catch(() => toast.error("Failed to copy link"));
                      }}
                      className="flex items-center gap-1.5 text-xs font-body text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Link2 className="w-3.5 h-3.5" /> Copy link
                    </button>
                    <button onClick={() => { setEditingBooking(bk); setExpandedId(null); }} className="flex items-center gap-1.5 text-xs font-body text-muted-foreground hover:text-foreground transition-colors">
                      <Edit className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button onClick={() => handleDelete(bk)} className="flex items-center gap-1.5 text-xs font-body text-destructive hover:text-destructive/80 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" /> Delete booking
                    </button>
                  </div>
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
  const [licInfo, setLicInfo] = useState<{
    isTrial?: boolean; maxEvents?: number | null; extraEventPrice?: number | null;
    extraEventSlots?: number; eventCount?: number;
  } | null>(null);
  const [pendingSlotRequest, setPendingSlotRequest] = useState<EventSlotRequest | null>(null);
  const [slotRequestLoading, setSlotRequestLoading] = useState(false);
  const [showSlotPayment, setShowSlotPayment] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, lic, pending] = await Promise.all([
        getTenantStoreKey<EventType[]>(slug, "wv_event_types"),
        getTenantLicenseInfo(slug),
        getTenantEventSlotRequest(slug),
      ]);
      setEts(Array.isArray(data) ? data : []);
      setLicInfo(lic);
      setPendingSlotRequest(pending);
    } catch {
      toast.error("Failed to load event types");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  // Use the lifetime event counter from server (never decremented on deletion).
  // Falls back to current array length before the server counter is initialized.
  const effectiveEventCount = licInfo?.eventCount ?? eventTypes.length;
  const maxEvents = licInfo?.maxEvents ?? null;
  const extraSlots = licInfo?.extraEventSlots ?? 0;
  const effectiveLimit = maxEvents != null ? maxEvents + extraSlots : null;
  const limitReached = effectiveLimit != null && effectiveEventCount >= effectiveLimit;
  const extraEventPrice = licInfo?.extraEventPrice ?? null;

  const save = async (ets: EventType[]) => {
    const result = await saveTenantStoreKey(slug, "wv_event_types", ets);
    if (!result.ok) {
      if (result.limitReached && result.extraEventPrice != null) {
        toast.error("Event type limit reached. Purchase an extra slot to add more.");
        setShowSlotPayment(true);
      } else {
        toast.error(result.error || "Failed to save");
      }
      return false;
    }
    // Refresh license info to get updated event count
    getTenantLicenseInfo(slug).then(setLicInfo);
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

  const handleRequestSlot = async (paymentMethod: "stripe" | "bank") => {
    setSlotRequestLoading(true);
    const result = await submitEventSlotRequest(slug, paymentMethod);
    if (!result.ok) { toast.error(result.error || "Failed to submit request"); setSlotRequestLoading(false); return; }
    setPendingSlotRequest(result.request!);
    toast.success("Request submitted! You'll be notified once it's approved.");
    if (paymentMethod === "stripe") {
      setCheckoutLoading(true);
      const checkout = await createEventSlotCheckout(slug);
      setCheckoutLoading(false);
      if (checkout.url) {
        window.location.href = checkout.url;
      } else {
        toast.error(checkout.error || "Stripe checkout failed. Contact your administrator.");
      }
    } else {
      setShowSlotPayment(false);
    }
    setSlotRequestLoading(false);
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl text-foreground">Event Types</h2>
        <Button size="sm" onClick={() => setShowNew(true)} disabled={limitReached} title={limitReached ? `Limit reached: ${effectiveLimit} event type${effectiveLimit !== 1 ? "s" : ""}` : undefined} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase disabled:opacity-50 disabled:cursor-not-allowed">
          <Plus className="w-4 h-4" /> New
        </Button>
      </div>

      {limitReached && !pendingSlotRequest && extraEventPrice != null && (
        <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-3">
          <p className="text-xs font-body text-amber-500 font-medium">Event type limit reached ({effectiveLimit})</p>
          <p className="text-xs font-body text-muted-foreground">You can add an extra event type slot for <span className="text-foreground font-medium">{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(extraEventPrice)}</span>. Your platform administrator will approve the request.</p>
          {showSlotPayment ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <Button size="sm" onClick={() => handleRequestSlot("stripe")} disabled={slotRequestLoading || checkoutLoading} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
                <CreditCard className="w-3.5 h-3.5" /> {checkoutLoading ? "Redirecting…" : "Pay by Card"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleRequestSlot("bank")} disabled={slotRequestLoading} className="gap-2 font-body text-xs tracking-wider uppercase border-border">
                <DollarSign className="w-3.5 h-3.5" /> Pay by Bank Transfer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowSlotPayment(false)} className="font-body text-xs text-muted-foreground">
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setShowSlotPayment(true)} className="gap-2 bg-amber-500 hover:bg-amber-600 text-white font-body text-xs tracking-wider uppercase">
              <Plus className="w-3.5 h-3.5" /> Get Extra Slot — {new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(extraEventPrice)}
            </Button>
          )}
        </div>
      )}

      {limitReached && !pendingSlotRequest && extraEventPrice == null && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs font-body text-amber-500">
          Event type limit reached ({effectiveLimit}). Contact your platform administrator to upgrade your plan.
        </div>
      )}

      {pendingSlotRequest && ["pending", "paid"].includes(pendingSlotRequest.status) && (
        <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs font-body space-y-1">
          <p className="text-blue-400 font-medium">Extra slot request pending approval</p>
          {pendingSlotRequest.paymentMethod === "bank" ? (
            <p className="text-muted-foreground">Please transfer <span className="text-foreground font-medium">${pendingSlotRequest.amount}</span> via bank transfer and notify your administrator. Your slot will be granted once confirmed.</p>
          ) : (
            <p className="text-muted-foreground">Payment {pendingSlotRequest.status === "paid" ? "received" : "submitted"}. Awaiting administrator approval.</p>
          )}
        </div>
      )}

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
            {!limitReached && (
              <Button onClick={() => setShowNew(true)} variant="outline" className="mt-4 gap-2 font-body text-sm">
                <Plus className="w-4 h-4" /> Create First Event Type
              </Button>
            )}
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

// ─── Event Type Editor (full-featured) ───────────────────────────────────────
function TenantEventEditor({ eventType, onSave, onCancel }: { eventType: EventType | null; onSave: (et: EventType) => void; onCancel: () => void }) {
  const isNew = !eventType;
  const [title, setTitle] = useState(eventType?.title || "");
  const [description, setDescription] = useState(eventType?.description || "");
  const [location, setLocation] = useState(eventType?.location || "");
  const [durations, setDurations] = useState<number[]>(eventType?.durations || [60]);
  const [price, setPrice] = useState(eventType?.price || 0);
  const [prices, setPrices] = useState<Record<number, number>>(eventType?.prices || {});
  const [requiresConfirmation, setRequiresConfirmation] = useState(eventType?.requiresConfirmation || false);
  const [depositEnabled, setDepositEnabled] = useState(eventType?.depositEnabled || false);
  const [depositAmount, setDepositAmount] = useState(eventType?.depositAmount || 0);
  const [depositType, setDepositType] = useState<"fixed" | "percentage">(eventType?.depositType || "fixed");
  const [depositMethods, setDepositMethods] = useState<("stripe" | "bank")[]>(eventType?.depositMethods || ["stripe", "bank"]);
  const [recurring, setRecurring] = useState<AvailabilitySlot[]>(eventType?.availability?.recurring || []);
  const [specificDates, setSpecificDates] = useState<SpecificDateSlot[]>(eventType?.availability?.specificDates || []);
  const [blockedDates, setBlockedDates] = useState<string[]>(eventType?.availability?.blockedDates || []);
  const [durationInput, setDurationInput] = useState("");
  const [blockedInput, setBlockedInput] = useState("");
  const [specificDateInput, setSpecificDateInput] = useState("");
  const [specificStartInput, setSpecificStartInput] = useState("09:00");
  const [specificEndInput, setSpecificEndInput] = useState("17:00");
  const [expandAvailability, setExpandAvailability] = useState(false);
  const [expandQuestions, setExpandQuestions] = useState(false);
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
      prices: Object.keys(prices).length > 0 ? prices : undefined,
      active: eventType?.active ?? true,
      requiresConfirmation,
      depositEnabled,
      depositAmount: depositEnabled ? depositAmount : undefined,
      depositType: depositEnabled ? depositType : undefined,
      depositMethods: depositEnabled ? depositMethods : undefined,
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
          <Input value={title} onChange={e => setTitle(e.target.value)} className="bg-secondary border-border text-foreground font-body" autoFocus />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Price ($)</label>
          <div className="space-y-2">
            <Input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" placeholder="Default / fallback price" />
            {durations.length > 1 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Per-Duration Prices (override)</p>
                {durations.map(d => (
                  <div key={d} className="flex items-center gap-2">
                    <span className="text-xs font-body text-muted-foreground w-10 flex-shrink-0">{formatDuration(d)}</span>
                    <Input type="number" placeholder={String(price || 0)} value={prices[d] ?? ""} onChange={e => { const v = e.target.value === "" ? undefined : Number(e.target.value); setPrices(prev => { const n = { ...prev }; if (v === undefined) delete n[d]; else n[d] = v; return n; }); }} className="bg-secondary border-border text-foreground font-body h-8 text-sm" />
                    {prices[d] !== undefined && <span className="text-[10px] text-primary">custom</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
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

      {/* Deposit */}
      <div className="space-y-3 p-4 rounded-lg bg-secondary/30 border border-border/50">
        <div className="flex items-center justify-between">
          <span className="text-xs font-body text-muted-foreground font-medium">Require Deposit</span>
          <Switch checked={depositEnabled} onCheckedChange={setDepositEnabled} />
        </div>
        {depositEnabled && (
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1 block">Amount</label>
                <Input type="number" value={depositAmount} onChange={e => setDepositAmount(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1 block">Type</label>
                <select value={depositType} onChange={e => setDepositType(e.target.value as "fixed" | "percentage")} className="w-full bg-secondary border border-border text-foreground font-body text-xs rounded-md px-2 py-2">
                  <option value="fixed">Fixed ($)</option>
                  <option value="percentage">Percentage (%)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Payment Methods</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs font-body text-muted-foreground cursor-pointer">
                  <Switch checked={depositMethods.includes("stripe")} onCheckedChange={v => setDepositMethods(v ? (depositMethods.includes("stripe") ? depositMethods : [...depositMethods, "stripe"]) : depositMethods.filter(m => m !== "stripe"))} />Stripe
                </label>
                <label className="flex items-center gap-2 text-xs font-body text-muted-foreground cursor-pointer">
                  <Switch checked={depositMethods.includes("bank")} onCheckedChange={v => setDepositMethods(v ? (depositMethods.includes("bank") ? depositMethods : [...depositMethods, "bank"]) : depositMethods.filter(m => m !== "bank"))} />Bank Transfer
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Availability */}
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
                const slot = recurring.find(s => s.day === i);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <Switch checked={!!slot} onCheckedChange={() => toggleDay(i)} />
                    <span className="text-sm font-body text-foreground w-24">{dayName}</span>
                    {slot ? (
                      <div className="flex items-center gap-2">
                        <Input type="time" value={slot.startTime} onChange={e => setRecurring(recurring.map(s => s.day === i ? { ...s, startTime: e.target.value } : s))} className="bg-secondary border-border text-foreground font-body w-28 text-xs" />
                        <span className="text-xs text-muted-foreground">—</span>
                        <Input type="time" value={slot.endTime} onChange={e => setRecurring(recurring.map(s => s.day === i ? { ...s, endTime: e.target.value } : s))} className="bg-secondary border-border text-foreground font-body w-28 text-xs" />
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
                <Input type="date" value={specificDateInput} onChange={e => setSpecificDateInput(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs w-36" />
                <Input type="time" value={specificStartInput} onChange={e => setSpecificStartInput(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs w-28" />
                <Input type="time" value={specificEndInput} onChange={e => setSpecificEndInput(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs w-28" />
                <Button variant="outline" size="sm" onClick={() => { if (!specificDateInput) return; setSpecificDates([...specificDates, { date: specificDateInput, startTime: specificStartInput, endTime: specificEndInput }]); setSpecificDateInput(""); }} className="font-body text-xs border-border text-foreground">Add</Button>
              </div>
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
                  <Input value={q.label} onChange={e => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, label: e.target.value } : qq))} placeholder="Question label" className="bg-secondary border-border text-foreground font-body text-sm flex-1" />
                  <select value={q.type} onChange={e => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, type: e.target.value as QuestionField["type"] } : qq))} className="bg-secondary border border-border text-foreground font-body text-xs rounded-md px-2 py-2">
                    <option value="text">Text</option>
                    <option value="textarea">Long Text</option>
                    <option value="select">Select</option>
                    <option value="boolean">Yes/No</option>
                    <option value="image-upload">Image Upload</option>
                    <option value="instagram">Instagram Handle</option>
                  </select>
                  <button onClick={() => setQuestions(questions.filter((_, i) => i !== idx))} className="p-1.5 text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-body text-muted-foreground cursor-pointer">
                    <Switch checked={q.required} onCheckedChange={v => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, required: v } : qq))} />Required
                  </label>
                  <Input value={q.placeholder || ""} onChange={e => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, placeholder: e.target.value } : qq))} placeholder="Placeholder text" className="bg-secondary border-border text-foreground font-body text-xs flex-1" />
                </div>
                {q.type === "select" && (
                  <Input value={q.options?.join(", ") || ""} onChange={e => setQuestions(questions.map((qq, i) => i === idx ? { ...qq, options: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } : qq))} placeholder="Options (comma separated)" className="bg-secondary border-border text-foreground font-body text-xs" />
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
        <Button onClick={handleSave} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
          <Save className="w-4 h-4" /> {isNew ? "Create" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ─── Albums ───────────────────────────────────────────────────────────────────
function TenantAlbums({ slug }: { slug: string }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Album | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [albumSortKey, setAlbumSortKey] = useState<AlbumSortKey>("date");
  const [albumSortDir, setAlbumSortDir] = useState<SortDir>("desc");
  const [albumSearch, setAlbumSearch] = useState("");

  const load = useCallback(async () => {
    const data = await fetchTenantMobileData(slug);
    setAlbums(data.albums || []);
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const photoUrl = (src: string) => tenantPhotoSrc(src, slug);

  const handleDelete = async (albumId: string) => {
    if (!confirm("Delete this album and all its photos?")) return;
    const { ok, error } = await deleteTenantAlbum(slug, albumId);
    if (!ok) { toast.error(error || "Failed to delete"); return; }
    toast.success("Album deleted");
    load();
  };

  const handleToggle = async (alb: Album) => {
    const updated = { ...alb, enabled: alb.enabled === false ? true : false };
    const { ok, error } = await saveTenantAlbum(slug, updated);
    if (!ok) { toast.error(error || "Failed to update"); return; }
    setAlbums(prev => prev.map(a => a.id === alb.id ? updated : a));
    toast.success(updated.enabled !== false ? "Album enabled" : "Album disabled");
  };

  const copyLink = (album: Album) => {
    const tok = album.clientToken;
    const url = `${window.location.origin}/gallery/${album.slug}${tok ? `?token=${tok}` : ""}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Gallery link copied!")).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast.success("Gallery link copied!");
    });
  };

  const handleSendNotification = async (alb: Album) => {
    if (!alb.clientEmail) { toast.error("No client email on this album"); return; }
    const tok = (alb as any).clientToken;
    const link = `${window.location.origin}/gallery/${alb.slug}${tok ? `?token=${tok}` : ""}`;
    const message = `Hey ${alb.clientName || "there"}, your photos are ready! Check them out here: ${link}`;
    const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0a0a0a;color:#f5f5f5;border-radius:12px;"><h2 style="font-size:22px;margin:0 0 16px;">📸 Your photos are ready!</h2><p style="color:#aaa;line-height:1.6;">${message.replace(link, "")}</p><a href="${link}" style="display:inline-block;margin-top:24px;padding:12px 28px;background:#fff;color:#000;border-radius:8px;text-decoration:none;font-weight:600;">View Your Gallery →</a><p style="margin-top:32px;font-size:11px;color:#555;">${link}</p></div>`;
    const result = await sendTenantEmail(slug, alb.clientEmail, `Your photos are ready — ${alb.clientName || "Gallery"}`, html, message);
    if (result.ok) toast.success(`Email sent to ${alb.clientEmail}`);
    else toast.error(`Failed: ${result.error || "Unknown error"}`);
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  if (showNew || editing) {
    return (
      <TenantAlbumEditor
        slug={slug}
        album={editing}
        onSave={async (alb) => {
          const { ok, error } = await saveTenantAlbum(slug, alb);
          if (!ok) { toast.error(error || "Failed to save album"); return; }
          await load();
          setEditing(null);
          setShowNew(false);
          toast.success(editing ? "Album updated" : "Album created");
        }}
        onCancel={() => { setEditing(null); setShowNew(false); }}
      />
    );
  }

  const toggleAlbumSort = (key: AlbumSortKey) => {
    if (albumSortKey === key) setAlbumSortDir(d => d === "asc" ? "desc" : "asc");
    else { setAlbumSortKey(key); setAlbumSortDir(key === "date" ? "desc" : "asc"); }
  };

  const filteredAlbums = albums.filter(a => {
    if (!albumSearch) return true;
    const q = albumSearch.toLowerCase();
    return a.title.toLowerCase().includes(q)
      || (a.clientName || "").toLowerCase().includes(q)
      || (a.clientEmail || "").toLowerCase().includes(q)
      || (a.description || "").toLowerCase().includes(q)
      || (a.slug || "").toLowerCase().includes(q);
  });

  const sortedAlbums = [...filteredAlbums].sort((a, b) => {
    const dir = albumSortDir === "asc" ? 1 : -1;
    switch (albumSortKey) {
      case "date": return dir * (new Date(a.date).getTime() - new Date(b.date).getTime());
      case "name": return dir * a.title.localeCompare(b.title);
      case "photos": return dir * ((a.photos?.length || 0) - (b.photos?.length || 0));
      case "client": return dir * (a.clientName || "").localeCompare(b.clientName || "");
      default: return 0;
    }
  });

  const AlbumSortBtn = ({ k, label }: { k: AlbumSortKey; label: string }) => (
    <button onClick={() => toggleAlbumSort(k)} className={`text-[10px] font-body tracking-wider uppercase px-2 py-1 rounded transition-colors ${albumSortKey === k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
      {label} {albumSortKey === k ? (albumSortDir === "asc" ? "↑" : "↓") : ""}
    </button>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h2 className="font-display text-2xl text-foreground">Albums</h2>
        <Button size="sm" onClick={() => setShowNew(true)} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase">
          <Plus className="w-4 h-4" /> New Album
        </Button>
      </div>

      {albums.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <Image className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-body text-muted-foreground">No albums yet. Create one to get started.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={albumSearch} onChange={e => setAlbumSearch(e.target.value)} placeholder="Search albums…" className="pl-8 h-8 text-xs font-body" />
            </div>
            <div className="flex items-center gap-1 flex-wrap overflow-x-auto">
              <span className="text-[10px] font-body text-muted-foreground/50 mr-1">Sort:</span>
              <AlbumSortBtn k="date" label="Date" />
              <AlbumSortBtn k="name" label="Name" />
              <AlbumSortBtn k="photos" label="Photos" />
              <AlbumSortBtn k="client" label="Client" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {sortedAlbums.map((alb) => {
              const coverSrc = alb.coverImage && !alb.coverImage.startsWith("file://")
                ? photoUrl(alb.coverImage.startsWith("/uploads/") ? `${alb.coverImage}?size=thumb` : alb.coverImage)
                : alb.photos?.[0] && !alb.photos[0].src.startsWith("file://")
                  ? photoUrl(alb.photos[0].thumbnail || (alb.photos[0].src.startsWith("/uploads/") ? `${alb.photos[0].src}?size=thumb` : alb.photos[0].src))
                  : null;
              return (
                <div key={alb.id} className={`glass-panel rounded-xl overflow-hidden transition-all ${alb.enabled === false ? "opacity-50" : ""}`}>
                  {coverSrc && (
                    <div className="aspect-[16/9] bg-secondary overflow-hidden">
                      <img src={coverSrc} alt={alb.title} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  )}
                  <div className="p-3 space-y-1">
                    <h3 className="font-display text-base text-foreground">{alb.title}</h3>
                    <p className="text-xs font-body text-muted-foreground">
                      {alb.photos?.length || 0} photos · {alb.freeDownloads ?? 0} free · ${alb.pricePerPhoto ?? 0}/photo
                    </p>
                    {alb.clientName && <p className="text-xs font-body text-primary">{alb.clientName}</p>}
                    {alb.expiresAt && (() => {
                      const expired = new Date(alb.expiresAt + "T23:59:59") < new Date();
                      const daysLeft = Math.ceil((new Date(alb.expiresAt + "T23:59:59").getTime() - Date.now()) / 86400000);
                      if (expired) return <span className="inline-flex items-center gap-1 text-[10px] font-body px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">🔒 Gallery expired</span>;
                      if (daysLeft <= 14) return <span className="inline-flex items-center gap-1 text-[10px] font-body px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">⏳ Expires in {daysLeft}d</span>;
                      return null;
                    })()}
                    {alb.proofingEnabled && alb.proofingStage && alb.proofingStage !== "not-started" && (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-body px-2 py-0.5 rounded-full ${
                        alb.proofingStage === "proofing" ? "bg-yellow-500/15 text-yellow-400" :
                        alb.proofingStage === "selections-submitted" ? "bg-orange-500/15 text-orange-400" :
                        alb.proofingStage === "editing" ? "bg-blue-500/15 text-blue-400" :
                        alb.proofingStage === "finals-delivered" ? "bg-green-500/15 text-green-400" : ""
                      }`}>
                        {alb.proofingStage === "proofing" && "★ Proofing"}
                        {alb.proofingStage === "selections-submitted" && "⏳ Picks submitted"}
                        {alb.proofingStage === "editing" && "✏️ Editing"}
                        {alb.proofingStage === "finals-delivered" && "✓ Finals delivered"}
                      </span>
                    )}
                    <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                      <Switch
                        checked={alb.enabled !== false}
                        onCheckedChange={() => handleToggle(alb)}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" title="Copy gallery link" onClick={() => copyLink(alb)}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" title="Email client" onClick={() => handleSendNotification(alb)}>
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                      <a href={`/gallery/${alb.slug}`} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" title="View gallery">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                      {(() => {
                        const starredPhotos = (alb.photos || []).filter(p => p.starred);
                        if (starredPhotos.length === 0) return null;
                        return (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-yellow-500 hover:text-yellow-400"
                            title={`Export ${starredPhotos.length} starred filenames`}
                            onClick={() => {
                              const lines = [
                                `# Starred photos — ${alb.title}`,
                                `# Album: ${alb.slug}`,
                                `# Exported: ${new Date().toISOString().slice(0, 10)}`,
                                `# ${starredPhotos.length} of ${alb.photos.length} photos starred`,
                                ``,
                                ...starredPhotos.map(p => p.title?.trim() || p.id),
                              ];
                              const blob = new Blob([lines.join("\n")], { type: "text/plain" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `starred_${alb.slug}_${new Date().toISOString().slice(0, 10)}.txt`;
                              a.click();
                              URL.revokeObjectURL(url);
                              toast.success(`Exported ${starredPhotos.length} starred filenames`);
                            }}
                          >
                            <Star className="w-3.5 h-3.5 fill-yellow-500/40" />
                          </Button>
                        );
                      })()}
                      <div className="flex-1" />
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setEditing(alb)}>
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(alb.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </motion.div>
  );
}

// ─── Album Editor (tenant) ────────────────────────────────────────────────────
function TenantAlbumEditor({ slug, album, onSave, onCancel }: {
  slug: string;
  album: Album | null;
  onSave: (alb: Album) => void;
  onCancel: () => void;
}) {
  const isNew = !album;
  const [title, setTitle] = useState(album?.title || "");
  const [albumSlug, setAlbumSlug] = useState(album?.slug || "");
  const [description, setDescription] = useState(album?.description || "");
  const [clientName, setClientName] = useState(album?.clientName || "");
  const [clientEmail, setClientEmail] = useState(album?.clientEmail || "");
  const [freeDownloads, setFreeDownloads] = useState(album?.freeDownloads ?? 0);
  const [pricePerPhoto, setPricePerPhoto] = useState(album?.pricePerPhoto ?? 0);
  const [priceFullAlbum, setPriceFullAlbum] = useState(album?.priceFullAlbum ?? 0);
  const [accessCode, setAccessCode] = useState(album?.accessCode || "");
  const [allUnlocked, setAllUnlocked] = useState(album?.allUnlocked || false);
  const [watermarkDisabled, setWatermarkDisabled] = useState((album as any)?.watermarkDisabled || false);
  const [purchasingDisabled, setPurchasingDisabled] = useState((album as any)?.purchasingDisabled || false);
  const [proofingEnabled, setProofingEnabled] = useState(album?.proofingEnabled || false);
  const [expiresAt, setExpiresAt] = useState(album?.expiresAt || "");
  const [downloadExpiresAt, setDownloadExpiresAt] = useState(album?.downloadExpiresAt || "");
  const [displaySize, setDisplaySize] = useState<AlbumDisplaySize>(album?.displaySize || "medium");
  const [liveAlbum, setLiveAlbum] = useState<Album | null>(album);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState<number | null>(null);
  const [ftpUploadProgress, setFtpUploadProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [ftpUploading, setFtpUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  // Poll for proofing stage changes while waiting for client picks.
  // The tenant admin has no background poll, so we add one here to detect
  // when a client submits their selections.
  useEffect(() => {
    if (!album?.id || !slug) return;
    if (liveAlbum?.proofingStage !== "proofing") return;
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      try {
        const data = await fetchTenantMobileData(slug);
        if (cancelled || !data) { if (!cancelled) timerId = setTimeout(poll, 5000); return; }
        const fresh = data.albums.find(a => a.id === album!.id);
        if (fresh && fresh.proofingStage !== liveAlbum?.proofingStage) {
          setLiveAlbum(prev => {
            if (!prev) return fresh;
            // Use server photos (which carry correct starred flags) when available;
            // fall back to local photos with starred flags synced from selectedPhotoIds.
            if (fresh.photos?.length) return fresh;
            const latestRound = fresh.proofingRounds?.[fresh.proofingRounds.length - 1];
            const selectedIds = latestRound?.selectedPhotoIds;
            if (selectedIds?.length) {
              const selectedSet = new Set(selectedIds);
              return { ...fresh, photos: prev.photos.map(p => ({ ...p, starred: selectedSet.has(p.id) })) };
            }
            return { ...fresh, photos: prev.photos };
          });
          return; // stop polling once stage has changed
        }
      } catch { /* non-critical — keep polling */ }
      if (!cancelled) timerId = setTimeout(poll, 5000);
    };
    timerId = setTimeout(poll, 5000);
    return () => { cancelled = true; clearTimeout(timerId); };
  }, [album?.id, liveAlbum?.proofingStage, slug]);

  const updateLiveAlbum = async (updated: Album) => {
    const { ok, error } = await saveTenantAlbum(slug, updated);
    if (!ok) { toast.error(error || "Failed to update album"); return; }
    setLiveAlbum(updated);
  };

  const handleFtpReupload = async () => {
    if (!album?.slug || ftpUploading) return;
    setFtpUploading(true);
    setFtpUploadProgress({ done: 0, total: 0, failed: 0 });
    const result = await ftpUploadAlbum(
      album.slug,
      (done, total, failed) => setFtpUploadProgress({ done, total, failed }),
      slug,
    );
    setFtpUploading(false);
    if (result.ok) {
      toast.success(`FTP upload complete: ${result.done} photo${result.done !== 1 ? "s" : ""} uploaded`);
      // Refresh liveAlbum photos state so the "Upload to FTP" button disappears
      setLiveAlbum(prev => prev ? { ...prev, photos: (prev.photos || []).map(p => ({ ...p, ftpUploaded: true })) } : prev);
    } else {
      toast.error(result.error || `FTP upload failed (${result.failed} error${result.failed !== 1 ? "s" : ""})`);
    }
    setTimeout(() => setFtpUploadProgress(null), 4000);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!liveAlbum) { toast.error("Save the album first before uploading photos"); return; }
    setUploading(true);
    setUploadProgress(0);
    setUploadSpeed(null);
    const fileArr = Array.from(files);
    const results = await uploadPhotosToServer(fileArr, (done, total, bytesPerSecond) => {
      setUploadProgress(Math.round((done / total) * 100));
      if (bytesPerSecond != null) setUploadSpeed(bytesPerSecond);
    }, slug, 3, title || undefined);
    if (results.length === 0) {
      setUploading(false);
      setUploadSpeed(null);
      toast.error("Upload failed — check server connection");
      if (e.target) e.target.value = "";
      return;
    }
    const newPhotos: Photo[] = results.map(r => ({
      id: r.id, src: r.url, thumbnail: r.url + "?size=thumb&wm=0",
      title: r.originalName.replace(/\.[^.]+$/, "").replace(/^_+/, ""), width: 800, height: 600,
      uploadedAt: new Date().toISOString(),
      ...(r.ftpUploaded ? { ftpUploaded: true } : {}),
    }));
    const updatedAlbum = { ...liveAlbum, photos: [...(liveAlbum.photos || []), ...newPhotos] };
    await updateLiveAlbum(updatedAlbum);
    setUploading(false);
    setUploadSpeed(null);
    if (results.length > 0) toast.success(`${results.length} photos uploaded`);
    if (e.target) e.target.value = "";
  };

  const handleSave = () => {
    if (!title.trim()) { toast.error("Title required"); return; }
    const finalSlug = albumSlug.trim() || slugify(title);
    const albumId = album?.id || generateId("alb");
    onSave({
      id: albumId,
      slug: finalSlug,
      title: title.trim(),
      description: description.trim(),
      coverImage: album?.coverImage || (liveAlbum?.photos?.[0]?.src || ""),
      date: album?.date || new Date().toISOString().split("T")[0],
      photoCount: liveAlbum?.photos?.length || 0,
      freeDownloads,
      pricePerPhoto,
      priceFullAlbum,
      isPublic: true,
      photos: liveAlbum?.photos || [],
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      accessCode: accessCode || undefined,
      allUnlocked,
      watermarkDisabled,
      purchasingDisabled,
      proofingEnabled,
      expiresAt: expiresAt || undefined,
      downloadExpiresAt: downloadExpiresAt || undefined,
      displaySize,
      mergedFrom: album?.mergedFrom,
      usedFreeDownloads: album?.usedFreeDownloads,
      downloadRequests: liveAlbum?.downloadRequests ?? album?.downloadRequests,
      proofingStage: liveAlbum?.proofingStage,
      proofingRounds: liveAlbum?.proofingRounds,
      clientToken: liveAlbum?.clientToken,
      proofingExpiresAt: liveAlbum?.proofingExpiresAt,
    } as Album);
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
          <Input value={title} onChange={e => { setTitle(e.target.value); if (!albumSlug || albumSlug === slugify(album?.title || "")) setAlbumSlug(slugify(e.target.value)); }} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Custom URL Slug</label>
          <div className="flex items-center gap-2">
            <span className="text-xs font-body text-muted-foreground">/gallery/</span>
            <Input value={albumSlug} onChange={e => setAlbumSlug(slugify(e.target.value))} className="bg-secondary border-border text-foreground font-body flex-1" />
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Description</label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} className="bg-secondary border-border text-foreground font-body min-h-[50px]" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Client Name</label>
          <Input value={clientName} onChange={e => setClientName(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Client Email</label>
          <Input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
      </div>

      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Album PIN (optional)</label>
        <Input value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="Leave empty for no PIN" className="bg-secondary border-border text-foreground font-body" />
      </div>

      <div>
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Gallery Expires On <span className="text-muted-foreground/40 normal-case">(optional)</span></label>
        <div className="flex items-center gap-2">
          <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs h-8 w-44" />
          {expiresAt && <button onClick={() => setExpiresAt("")} className="text-muted-foreground/50 hover:text-muted-foreground text-xs font-body">Clear</button>}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-secondary/50 border border-border/50 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-body text-muted-foreground flex items-center gap-2"><Unlock className="w-3.5 h-3.5" /> All Downloads Unlocked</span>
            <Switch checked={allUnlocked} onCheckedChange={setAllUnlocked} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-body text-muted-foreground flex items-center gap-2"><Camera className="w-3.5 h-3.5" /> Watermarks Disabled</span>
            <Switch checked={watermarkDisabled} onCheckedChange={setWatermarkDisabled} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-body text-muted-foreground flex items-center gap-2"><CreditCard className="w-3.5 h-3.5" /> Purchasing Disabled</span>
            <Switch checked={purchasingDisabled} onCheckedChange={setPurchasingDisabled} />
          </div>
          {allUnlocked && (
            <div className="space-y-1 pt-2 border-t border-border/30">
              <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground block">Download Expires On <span className="text-muted-foreground/40 normal-case">(optional)</span></label>
              <div className="flex items-center gap-2">
                <Input type="date" value={downloadExpiresAt} onChange={e => setDownloadExpiresAt(e.target.value)} className="bg-secondary border-border text-foreground font-body text-xs h-8" />
                {downloadExpiresAt && <button onClick={() => setDownloadExpiresAt("")} className="text-muted-foreground/50 hover:text-muted-foreground text-xs font-body">Clear</button>}
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Display Size</label>
          <div className="flex gap-2 flex-wrap">
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
          <Input type="number" value={freeDownloads} onChange={e => setFreeDownloads(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">$/Photo</label>
          <Input type="number" value={pricePerPhoto} onChange={e => setPricePerPhoto(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Full Album $</label>
          <Input type="number" value={priceFullAlbum} onChange={e => setPriceFullAlbum(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" />
        </div>
      </div>

      {/* Proofing toggle */}
      {album && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
          <div>
            <p className="text-xs font-body text-foreground font-medium">Proofing for this album</p>
            <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">Let this client star and submit picks before editing</p>
          </div>
          <Switch checked={proofingEnabled} onCheckedChange={v => { setProofingEnabled(v); toast.success(v ? "Proofing enabled" : "Proofing disabled"); }} />
        </div>
      )}

      {/* Proofing controls */}
      {liveAlbum && proofingEnabled && album && (() => {
        const stage = liveAlbum.proofingStage || "not-started";
        const rounds = liveAlbum.proofingRounds || [];
        const latest = rounds[rounds.length - 1];
        const email = liveAlbum.clientEmail;

        const buildProofingEmailHtml = (galleryUrl: string, expiryDateStr: string, adminNote?: string) =>
          `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;"><h2 style="margin:0 0 16px;font-size:20px;">Your photos are ready to review!</h2><p style="color:#9ca3af;margin:0 0 12px;">Hi ${liveAlbum.clientName || "there"},</p><p style="color:#9ca3af;margin:0 0 12px;">Your proofing gallery for <strong style="color:#e5e7eb;">${liveAlbum.title}</strong> is ready. Browse and star the ones you love, then hit Submit Picks.</p>${expiryDateStr ? `<p style="color:#ef4444;margin:0 0 12px;padding:10px 14px;background:#1f1f1f;border-radius:8px;font-size:13px;">⏰ <strong>Proofing window closes: ${expiryDateStr}</strong></p>` : ""}${adminNote ? `<p style="color:#9ca3af;margin:0 0 20px;padding:12px;background:#1f1f1f;border-radius:8px;"><em>"${adminNote}"</em></p>` : ""}<a href="${galleryUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View Your Gallery →</a></div>`;

        const startProofing = async () => {
          const noteEl = document.getElementById("t-proofing-note") as HTMLTextAreaElement;
          const expiryEl = document.getElementById("t-proofing-expiry") as HTMLInputElement;
          const note = noteEl?.value || "";
          const expiryHours = expiryEl && expiryEl.value !== "" ? Math.max(1, parseInt(expiryEl.value, 10) || 48) : 48;
          const proofingExpiresAt = new Date(Date.now() + expiryHours * 3600 * 1000).toISOString();
          const clientToken = liveAlbum.clientToken || `ct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const newRound = { roundNumber: rounds.length + 1, sentAt: new Date().toISOString(), selectedPhotoIds: [], adminNote: note || undefined };
          const updated = { ...liveAlbum, proofingEnabled: true, proofingStage: "proofing" as const, proofingRounds: [...rounds, newRound], clientToken, proofingExpiresAt };
          await updateLiveAlbum(updated);
          if (email) {
            const galleryUrl = `${window.location.origin}/gallery/${liveAlbum.slug}?token=${clientToken}`;
            const expiryDateStr = new Date(proofingExpiresAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
            sendTenantEmail(slug, email, `📸 Your proofing gallery is ready — ${liveAlbum.title}`, buildProofingEmailHtml(galleryUrl, expiryDateStr, note || undefined)).catch(() => {});
          }
          toast.success("Proofing round started" + (email ? " — invite sent to client" : " (no client email on file)"));
        };

        const resendProofingEmail = () => {
          if (!email) return;
          const tok = liveAlbum.clientToken;
          const galleryUrl = `${window.location.origin}/gallery/${liveAlbum.slug}${tok ? `?token=${tok}` : ""}`;
          const expiryDateStr = liveAlbum.proofingExpiresAt
            ? new Date(liveAlbum.proofingExpiresAt as string).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            : "";
          sendTenantEmail(slug, email, `📸 Your proofing gallery is ready — ${liveAlbum.title}`, buildProofingEmailHtml(galleryUrl, expiryDateStr, latest?.adminNote)).catch(() => {});
          toast.success("Proofing invite resent to client");
        };

        const approveSelections = async (free: boolean) => {
          if (!latest?.selectedPhotoIds?.length) { toast.error("No selections to approve yet"); return; }
          const selectedSet = new Set(latest.selectedPhotoIds);
          const updatedPhotos = (liveAlbum.photos || []).map(p => ({ ...p, hidden: !selectedSet.has(p.id) }));
          const updated = { ...liveAlbum, photos: updatedPhotos, proofingStage: "editing" as const, allUnlocked: free ? true : liveAlbum.allUnlocked };
          await updateLiveAlbum(updated);
          toast.success(`${latest.selectedPhotoIds.length} photos kept — ${free ? "album unlocked" : "moving to editing"}`);
        };

        const sendEditingEmail = async () => {
          if (!email) { toast.error("No client email on file"); return; }
          const tok = liveAlbum.clientToken;
          const galleryUrl = `${window.location.origin}/gallery/${liveAlbum.slug}${tok ? `?token=${tok}` : ""}`;
          const html = `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;"><h2 style="margin:0 0 16px;font-size:20px;">Your photos are being edited ✏️</h2><p style="color:#9ca3af;margin:0 0 12px;">Hi ${liveAlbum.clientName || "there"},</p><p style="color:#9ca3af;margin:0 0 20px;">Your selections for <strong style="color:#e5e7eb;">${liveAlbum.title}</strong> are confirmed and editing has begun.</p><a href="${galleryUrl}" style="display:inline-block;background:#374151;color:#e5e7eb;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Preview Gallery →</a></div>`;
          await sendTenantEmail(slug, email, `✏️ Your photos are being edited — ${liveAlbum.title}`, html);
          toast.success("Editing notification sent");
        };

        const deliverFinals = async (free: boolean) => {
          const updated = { ...liveAlbum, proofingStage: "finals-delivered" as const, allUnlocked: free ? true : liveAlbum.allUnlocked };
          await updateLiveAlbum(updated);
          if (email) {
            const tok = liveAlbum.clientToken;
            const galleryUrl = `${window.location.origin}/gallery/${liveAlbum.slug}${tok ? `?token=${tok}` : ""}`;
            const html = `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;"><h2 style="margin:0 0 16px;font-size:20px;">Your edited photos are ready! ✨</h2><p style="color:#9ca3af;margin:0 0 12px;">Hi ${liveAlbum.clientName || "there"},</p><p style="color:#9ca3af;margin:0 0 20px;">Your final edited photos for <strong style="color:#e5e7eb;">${liveAlbum.title}</strong> are now available.</p><a href="${galleryUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">${free ? "Download Your Photos →" : "View & Download Photos →"}</a></div>`;
            sendTenantEmail(slug, email, `✨ Your final photos are ready — ${liveAlbum.title}`, html).catch(() => {});
          }
          toast.success("Finals delivered!" + (email ? " — client notified" : ""));
        };

        const resetProofing = async () => {
          if (!confirm("Reset proofing? This will un-hide all photos and clear the proofing stage.")) return;
          const updatedPhotos = (liveAlbum.photos || []).map(p => ({ ...p, hidden: false }));
          await updateLiveAlbum({ ...liveAlbum, photos: updatedPhotos, proofingStage: "not-started" as const, proofingRounds: [] });
          toast.success("Proofing reset");
        };

        return (
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground">
                Proofing{rounds.length > 0 ? ` — Round ${rounds.length}` : ""}
              </label>
              <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${
                stage === "not-started" ? "bg-secondary text-muted-foreground" :
                stage === "proofing" ? "bg-yellow-500/15 text-yellow-400" :
                stage === "selections-submitted" ? "bg-orange-500/15 text-orange-400" :
                stage === "editing" ? "bg-blue-500/15 text-blue-400" :
                "bg-green-500/15 text-green-400"
              }`}>
                {stage === "not-started" && "Not started"}
                {stage === "proofing" && "★ Awaiting picks"}
                {stage === "selections-submitted" && `⏳ ${latest?.selectedPhotoIds?.length || 0} picks submitted`}
                {stage === "editing" && "✏️ Editing"}
                {stage === "finals-delivered" && "✓ Delivered"}
              </span>
            </div>

            {stage === "not-started" && (
              <div className="space-y-2">
                <textarea id="t-proofing-note" placeholder="Optional message to client (e.g. 'Please pick your top 30')" rows={2} className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs font-body text-foreground placeholder:text-muted-foreground/50 resize-none" />
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-body text-muted-foreground shrink-0">Window open for</label>
                  <input id="t-proofing-expiry" type="number" min={1} max={720} defaultValue={48} className="w-20 bg-secondary border border-border rounded px-2 py-1 text-xs font-body text-foreground text-center" />
                  <label className="text-[11px] font-body text-muted-foreground">hours</label>
                </div>
                <button onClick={startProofing} className="flex items-center gap-2 w-full justify-center bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-400 border border-yellow-500/30 rounded-lg px-4 py-2 text-xs font-body tracking-wider uppercase transition-colors">
                  <Star className="w-3.5 h-3.5" /> Start Proofing Round {rounds.length + 1}
                </button>
              </div>
            )}

            {stage === "proofing" && (
              <div className="space-y-1.5">
                <p className="text-xs font-body text-muted-foreground">Waiting for {liveAlbum.clientName || "client"} to star photos and submit picks.</p>
                {liveAlbum.proofingExpiresAt && (() => {
                  const exp = new Date(liveAlbum.proofingExpiresAt as string);
                  const isExpired = new Date() > exp;
                  return isExpired ? (
                    <p className="text-[11px] font-body text-destructive flex items-center gap-1"><Clock className="w-3 h-3" /> Proofing window closed</p>
                  ) : (
                    <p className="text-[11px] font-body text-yellow-400/80 flex items-center gap-1"><Clock className="w-3 h-3" /> Closes {exp.toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  );
                })()}
                <div className="flex gap-2 pt-0.5">
                  {email && (
                    <button onClick={resendProofingEmail} className="flex items-center gap-1.5 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                      <Mail className="w-3 h-3" /> Resend invite
                    </button>
                  )}
                  <button onClick={() => copyLink(liveAlbum)} className="flex items-center gap-1.5 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                    <Copy className="w-3 h-3" /> Copy link
                  </button>
                </div>
              </div>
            )}

            {stage === "selections-submitted" && latest && (
              <div className="space-y-3">
                <div className="bg-secondary rounded-lg p-3 space-y-1">
                  <p className="text-xs font-body text-foreground font-medium">{latest.selectedPhotoIds.length} photos selected by client</p>
                  {latest.clientNote && <p className="text-xs font-body text-muted-foreground italic">"{latest.clientNote}"</p>}
                  <button
                    onClick={() => {
                      const photoMap = new Map((liveAlbum.photos || []).map(p => [p.id, p]));
                      const lines = [
                        `# Client picks — ${liveAlbum.title}`,
                        `# Album: ${liveAlbum.slug}`,
                        `# Exported: ${new Date().toISOString().slice(0, 10)}`,
                        `# ${latest.selectedPhotoIds.length} of ${(liveAlbum.photos || []).length} photos selected`,
                        ``,
                        ...latest.selectedPhotoIds.map((id: string) => {
                          const p = photoMap.get(id);
                          return p?.title?.trim() || p?.originalName || id;
                        }),
                      ];
                      const blob = new Blob([lines.join("\n")], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `picks_${liveAlbum.slug}_${new Date().toISOString().slice(0, 10)}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success(`Exported ${latest.selectedPhotoIds.length} picks`);
                    }}
                    className="flex items-center gap-1.5 text-[10px] font-body text-muted-foreground hover:text-foreground transition-colors mt-1"
                  >
                    <Download className="w-3 h-3" /> Export picks list
                  </button>
                </div>
                <p className="text-[10px] font-body text-muted-foreground/70 uppercase tracking-wider">Does this album require payment?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => approveSelections(true)} className="flex flex-col items-center gap-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg px-3 py-2.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                    <Unlock className="w-3.5 h-3.5" />No — Free<span className="text-[9px] text-green-400/60 normal-case tracking-normal">Unlock immediately</span>
                  </button>
                  <button onClick={() => approveSelections(false)} className="flex flex-col items-center gap-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg px-3 py-2.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                    <CreditCard className="w-3.5 h-3.5" />Yes — Paid<span className="text-[9px] text-blue-400/60 normal-case tracking-normal">Client pays to download</span>
                  </button>
                </div>
              </div>
            )}

            {stage === "editing" && (
              <div className="space-y-2">
                <p className="text-xs font-body text-muted-foreground">
                  {(liveAlbum.photos || []).filter(p => !p.hidden).length} visible · {(liveAlbum.photos || []).filter(p => p.hidden).length} hidden
                </p>
                {email && (
                  <button onClick={sendEditingEmail} className="flex items-center gap-2 w-full justify-center bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-border rounded-lg px-4 py-2 text-xs font-body tracking-wider uppercase transition-colors">
                    <Mail className="w-3.5 h-3.5" /> Notify — Photos Being Edited
                  </button>
                )}
                <p className="text-[10px] font-body text-muted-foreground/70 uppercase tracking-wider pt-1">Finished editing?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => deliverFinals(true)} className="flex flex-col items-center gap-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg px-3 py-2.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                    <Unlock className="w-3.5 h-3.5" />Deliver Free<span className="text-[9px] text-green-400/60 normal-case tracking-normal">Unlock + notify client</span>
                  </button>
                  <button onClick={() => deliverFinals(false)} className="flex flex-col items-center gap-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg px-3 py-2.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                    <CreditCard className="w-3.5 h-3.5" />Deliver Paid<span className="text-[9px] text-purple-400/60 normal-case tracking-normal">Notify, client pays</span>
                  </button>
                </div>
              </div>
            )}

            {stage === "finals-delivered" && (
              <p className={`text-xs font-body flex items-center gap-1.5 ${liveAlbum.allUnlocked ? "text-green-400/80" : "text-purple-400/80"}`}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                {liveAlbum.allUnlocked ? "Delivered free — album unlocked" : "Delivered — client pays to download"}
              </p>
            )}

            {stage !== "not-started" && (
              <button onClick={resetProofing} className="text-[10px] font-body text-muted-foreground/50 hover:text-muted-foreground underline">Reset proofing</button>
            )}
          </div>
        );
      })()}

      {/* Bank Transfer / Download Requests */}
      {liveAlbum?.downloadRequests && liveAlbum.downloadRequests.length > 0 && (
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">
            Download Requests ({liveAlbum.downloadRequests.filter(r => r.status === "pending").length} pending)
          </label>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {liveAlbum.downloadRequests.map((req, idx) => (
              <div key={idx} className={`p-3 rounded-lg border ${req.status === "pending" ? "bg-yellow-500/5 border-yellow-500/20" : req.status === "approved" ? "bg-green-500/5 border-green-500/20" : "bg-secondary/50 border-border/50"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-body text-foreground">{req.photoIds.length} photos · {req.method}</p>
                    <p className="text-[10px] font-body text-muted-foreground">{new Date(req.requestedAt).toLocaleString()}</p>
                    {req.clientNote && <p className="text-[10px] font-body text-muted-foreground mt-1">Note: {req.clientNote}</p>}
                  </div>
                  {req.status === "pending" && (
                    <Button size="sm" variant="outline" onClick={async () => {
                      const updated = { ...liveAlbum };
                      updated.downloadRequests = updated.downloadRequests!.map((r, i) => i === idx ? { ...r, status: "approved" as const, approvedAt: new Date().toISOString() } : r);
                      if (req.photoIds?.length) {
                        const ex = updated.paidPhotoIds || [];
                        updated.paidPhotoIds = [...new Set([...ex, ...req.photoIds])];
                      }
                      await updateLiveAlbum(updated);
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
        <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Photos ({liveAlbum?.photos?.length || 0})</label>
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/30 transition-colors cursor-pointer relative mb-3">
          <Upload className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-xs font-body text-muted-foreground">Click to upload photos</p>
          <input ref={uploadRef} type="file" accept="image/*" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handlePhotoUpload} />
        </div>
        {/* Camera / gallery shortcuts — shown on touch/mobile devices only */}
        <div className="mb-3 flex gap-2 sm:hidden">
          <label className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg border border-border/50 text-xs font-body text-muted-foreground cursor-pointer hover:bg-secondary/50 transition-colors">
            <Camera className="w-4 h-4" /> Take a photo
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handlePhotoUpload} />
          </label>
          <label className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg border border-border/50 text-xs font-body text-muted-foreground cursor-pointer hover:bg-secondary/50 transition-colors">
            <Upload className="w-4 h-4" /> Choose photos
            <input type="file" accept="image/*" multiple className="sr-only" onChange={handlePhotoUpload} />
          </label>
        </div>
        {uploading && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs font-body text-muted-foreground mb-1">
              <span>{uploadProgress}%</span>
              {uploadSpeed != null && uploadSpeed > 0 && (
                <span className="text-primary font-medium">{formatSpeed(uploadSpeed)}</span>
              )}
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}
        {/* FTP upload progress / re-upload */}
        {isServerMode() && album && (
          <div className="mb-3">
            {ftpUploadProgress ? (
              <div className="p-3 rounded-lg bg-secondary/50 border border-border space-y-1.5">
                <div className="flex items-center justify-between text-xs font-body text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Upload className="w-3 h-3 text-primary" />
                    FTP: {ftpUploadProgress.done}/{ftpUploadProgress.total} uploaded
                    {ftpUploadProgress.failed > 0 && <span className="text-destructive">({ftpUploadProgress.failed} failed)</span>}
                  </span>
                  <span className="text-primary font-medium">{ftpUploadProgress.total > 0 ? Math.round(ftpUploadProgress.done / ftpUploadProgress.total * 100) : 0}%</span>
                </div>
                {ftpUploadProgress.total > 0 && (
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.round(ftpUploadProgress.done / ftpUploadProgress.total * 100)}%` }} />
                  </div>
                )}
              </div>
            ) : (
              (() => {
                const ftpCount = (liveAlbum?.photos || []).filter(p => (p as any).ftpUploaded).length;
                const total = liveAlbum?.photos?.length || 0;
                return total > 0 ? (
                  <div className="flex items-center justify-between text-xs font-body text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Upload className="w-3 h-3" />
                      FTP: {ftpCount}/{total} uploaded ({total > 0 ? Math.round(ftpCount / total * 100) : 0}%)
                    </span>
                    {ftpCount < total && (
                      <button
                        onClick={handleFtpReupload}
                        disabled={ftpUploading}
                        className="inline-flex items-center gap-1 text-[10px] font-body tracking-wider uppercase px-2 py-1 rounded border border-border hover:bg-secondary transition-all disabled:opacity-50"
                      >
                        <Upload className="w-3 h-3" /> {ftpUploading ? "Uploading…" : "Upload to FTP"}
                      </button>
                    )}
                  </div>
                ) : null;
              })()
            )}
          </div>
        )}
        {liveAlbum && liveAlbum.photos && liveAlbum.photos.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 max-h-48 overflow-y-auto rounded-lg">
            {liveAlbum.photos.map(photo => (
              <div key={photo.id} className={`aspect-square rounded overflow-hidden bg-secondary relative ${photo.hidden ? "opacity-40" : ""}`}>
                <img
                  src={tenantPhotoSrc(photo.thumbnail || (photo.src.startsWith("/uploads/") ? `${photo.src}?size=thumb` : photo.src), slug)}
                  alt={photo.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-2 border-t border-border/50">
        <Button variant="outline" onClick={onCancel} className="font-body text-xs border-border text-foreground">Cancel</Button>
        <Button onClick={handleSave} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2">
          <Save className="w-4 h-4" /> {isNew ? "Create" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}


// ─── Photos ──────────────────────────────────────────────────────────────────
const TENANT_LIBRARY_INITIAL_BATCH = 60;
const TENANT_LIBRARY_BATCH_SIZE = 60;

function TenantPhotos({ slug }: { slug: string }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [libraryPhotos, setLibraryPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewSource, setViewSource] = useState<"all" | "library" | string>("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [showAddToAlbum, setShowAddToAlbum] = useState(false);
  const [uploadStats, setUploadStats] = useState<{ total: number; done: number; errors: number; savedBytes: number } | null>(null);
  const [visibleCount, setVisibleCount] = useState(TENANT_LIBRARY_INITIAL_BATCH);
  const libSentinelRef = useRef<HTMLDivElement>(null);

  const photoUrl = (src: string) => tenantPhotoSrc(src, slug);

  // ── Load data ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const [mobileData, lib] = await Promise.all([
      fetchTenantMobileData(slug),
      getTenantStoreKey<Photo[]>(slug, "wv_photo_library"),
    ]);
    setAlbums(mobileData.albums || []);
    setLibraryPhotos(Array.isArray(lib) ? lib : []);
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  // Batch rendering: load more photos as user scrolls
  useEffect(() => {
    const sentinel = libSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisibleCount(c => c + TENANT_LIBRARY_BATCH_SIZE); },
      { rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Reset visible count when filter changes
  useEffect(() => { setVisibleCount(TENANT_LIBRARY_INITIAL_BATCH); }, [viewSource, starredOnly, searchQuery]);

  // ── Persist library ────────────────────────────────────────────────────────
  const saveLibrary = async (photos: Photo[]) => {
    await saveTenantStoreKey(slug, "wv_photo_library", photos);
  };

  // ── Build unified photo list ───────────────────────────────────────────────
  // Photos are keyed by src to avoid cross-source duplicates in "All" view
  const allPhotos: (Photo & { source: string })[] = [];
  const seenSrc = new Set<string>();
  for (const p of libraryPhotos) {
    if (!seenSrc.has(p.src)) { allPhotos.push({ ...p, source: "Library" }); seenSrc.add(p.src); }
  }
  for (const alb of albums) {
    for (const p of alb.photos || []) {
      if (!seenSrc.has(p.src)) { allPhotos.push({ ...p, source: alb.title }); seenSrc.add(p.src); }
    }
  }

  // For per-album filter, pull directly from that album's photos array
  const getAlbumPhotos = (albumTitle: string): (Photo & { source: string })[] => {
    const alb = albums.find(a => a.title === albumTitle);
    return alb ? (alb.photos || []).map(p => ({ ...p, source: alb.title })) : [];
  };

  const starredPhotos = allPhotos.filter(p => p.starred);
  const sourcePhotos =
    viewSource === "all" ? allPhotos
    : viewSource === "library" ? libraryPhotos.map(p => ({ ...p, source: "Library" }))
    : getAlbumPhotos(viewSource);
  const unfilteredPhotos = starredOnly ? sourcePhotos.filter(p => p.starred) : sourcePhotos;
  const displayPhotos = searchQuery.trim()
    ? unfilteredPhotos.filter(p =>
        p.title.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
        p.src.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : unfilteredPhotos;

  // Album corresponding to the current view source (for upload targeting)
  const selectedAlbum =
    viewSource !== "all" && viewSource !== "library"
      ? albums.find(a => a.title === viewSource)
      : null;

  // ── Toolbar actions ────────────────────────────────────────────────────────
  const handleClearDuplicates = async () => {
    let totalRemoved = 0;

    // Deduplicate photos within each album
    const updatedAlbums: Album[] = [];
    for (const alb of albums) {
      const seen = new Set<string>();
      const deduped = (alb.photos || []).filter(p => {
        if (seen.has(p.id) || seen.has(p.src)) return false;
        seen.add(p.id); seen.add(p.src);
        return true;
      });
      if (deduped.length < (alb.photos || []).length) {
        totalRemoved += (alb.photos || []).length - deduped.length;
        const updated = { ...alb, photos: deduped, photoCount: deduped.length };
        await saveTenantAlbum(slug, updated);
        updatedAlbums.push(updated);
      } else {
        updatedAlbums.push(alb);
      }
    }

    // Deduplicate library
    const seenLib = new Set<string>();
    const dedupLib = libraryPhotos.filter(p => {
      if (seenLib.has(p.id) || seenLib.has(p.src)) return false;
      seenLib.add(p.id); seenLib.add(p.src);
      return true;
    });
    if (dedupLib.length < libraryPhotos.length) {
      totalRemoved += libraryPhotos.length - dedupLib.length;
      setLibraryPhotos(dedupLib);
      await saveLibrary(dedupLib);
    }

    if (updatedAlbums.some((a, i) => a !== albums[i])) setAlbums(updatedAlbums);
    if (totalRemoved === 0) toast.info("No duplicates found");
    else toast.success(`Removed ${totalRemoved} duplicate photo${totalRemoved !== 1 ? "s" : ""}`);
  };

  const handleSyncStorage = async () => {
    if (!isServerMode()) { toast.error("Server not available"); return; }
    setSyncing(true);
    try {
      const stats = await getServerStorageStats();
      if (!stats || !stats.allFileNames) { toast.info("No storage data"); setSyncing(false); return; }

      const serverFileNames = new Set(stats.allFileNames);
      let repairedAlbums = 0;

      // Repair albums with broken photo references (files missing from server)
      const updatedAlbums: Album[] = [];
      for (const alb of albums) {
        const brokenPhotos = (alb.photos || []).filter(p => {
          const fn = p.src.split("/").pop()?.split("?")[0];
          return fn && !serverFileNames.has(fn) && p.src.startsWith("/uploads/");
        });
        if (brokenPhotos.length > 0) {
          const repaired = (alb.photos || []).filter(p => !brokenPhotos.includes(p));
          const updated = { ...alb, photos: repaired, photoCount: repaired.length };
          await saveTenantAlbum(slug, updated);
          updatedAlbums.push(updated);
          repairedAlbums++;
        } else {
          updatedAlbums.push(alb);
        }
      }
      if (repairedAlbums > 0) setAlbums(updatedAlbums);

      const messages: string[] = [];
      if (repairedAlbums > 0) messages.push(`Repaired ${repairedAlbums} album(s) with missing file references`);
      // Note: we intentionally do NOT delete server files here, as they may belong to other tenants
      if (messages.length === 0) toast.info("All album references are valid — nothing to fix");
      else toast.success(messages.join(" · "));
    } catch { toast.error("Failed to sync from storage"); }
    setSyncing(false);
  };

  // ── Toggle selection ───────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Toggle star ────────────────────────────────────────────────────────────
  const handleToggleStar = async (photo: Photo & { source: string }) => {
    const nowStarred = !photo.starred;
    if (photo.source === "Library") {
      const updated = libraryPhotos.map(p => p.id === photo.id ? { ...p, starred: nowStarred } : p);
      setLibraryPhotos(updated);
      await saveLibrary(updated);
    } else {
      const alb = albums.find(a => a.title === photo.source);
      if (!alb) return;
      const updatedAlb: Album = {
        ...alb,
        photos: (alb.photos || []).map(p => p.id === photo.id ? { ...p, starred: nowStarred } : p),
      };
      setAlbums(prev => prev.map(a => a.id === alb.id ? updatedAlb : a));
      await saveTenantAlbum(slug, updatedAlb);
      if (nowStarred) {
        ftpMoveToStarred({ photoSrc: photo.src, albumTitle: alb.title, albumSlug: alb.slug, tenantSlug: slug, originalName: photo.originalName }).catch(() => {});
      }
    }
  };

  // ── Delete single photo ────────────────────────────────────────────────────
  const handleDeletePhoto = async (id: string, source: string, src: string) => {
    if (source === "Library") {
      const updated = libraryPhotos.filter(p => p.id !== id);
      setLibraryPhotos(updated);
      await saveLibrary(updated);
      if (isServerMode()) deletePhotoFromServer(src);
    } else {
      const alb = albums.find(a => a.title === source);
      if (alb) {
        const updatedAlb = { ...alb, photos: (alb.photos || []).filter(p => p.id !== id), photoCount: Math.max(0, (alb.photos || []).length - 1) };
        setAlbums(prev => prev.map(a => a.id === alb.id ? updatedAlb : a));
        await saveTenantAlbum(slug, updatedAlb);
      }
    }
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  // ── Mass delete ────────────────────────────────────────────────────────────
  const handleMassDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected photo(s)? This cannot be undone.`)) return;

    const libToDelete = new Set<string>();
    const albumUpdates = new Map<string, Set<string>>();

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

    if (libToDelete.size > 0) {
      const remaining = libraryPhotos.filter(p => !libToDelete.has(p.id));
      setLibraryPhotos(remaining);
      await saveLibrary(remaining);
    }

    for (const [albumId, photoIds] of albumUpdates) {
      const alb = albums.find(a => a.id === albumId);
      if (alb) {
        const filteredPhotos = (alb.photos || []).filter(p => !photoIds.has(p.id));
        const updatedAlb = { ...alb, photos: filteredPhotos, photoCount: filteredPhotos.length };
        await saveTenantAlbum(slug, updatedAlb);
        setAlbums(prev => prev.map(a => a.id === albumId ? updatedAlb : a));
      }
    }

    setSelectedIds(new Set());
    toast.success(`Deleted ${selectedIds.size} photo${selectedIds.size !== 1 ? "s" : ""}`);
  };

  // ── Create album from selection ────────────────────────────────────────────
  const handleCreateAlbumFromSelection = async () => {
    if (selectedIds.size === 0) { toast.error("Select photos first"); return; }
    const selectedPhotos = allPhotos.filter(p => selectedIds.has(p.id));
    const newAlbum: Album = {
      id: generateId("alb"),
      slug: slugify(`album-${Date.now()}`),
      title: "New Album",
      description: "",
      coverImage: selectedPhotos[0]?.src || "",
      date: new Date().toISOString().split("T")[0],
      photoCount: selectedPhotos.length,
      freeDownloads: 0,
      pricePerPhoto: 0,
      priceFullAlbum: 0,
      isPublic: true,
      photos: selectedPhotos,
    };
    const { ok, error } = await saveTenantAlbum(slug, newAlbum);
    if (!ok) { toast.error(error || "Failed to create album"); return; }
    setAlbums(prev => [...prev, newAlbum]);
    setSelectedIds(new Set());
    toast.success(`Album created with ${selectedPhotos.length} photos — go to Albums tab to edit`);
  };

  // ── Add selection to existing album ───────────────────────────────────────
  const handleAddToAlbum = async (albumId: string) => {
    const selectedPhotos = allPhotos.filter(p => selectedIds.has(p.id));
    const alb = albums.find(a => a.id === albumId);
    if (!alb) return;
    const existingSrcs = new Set((alb.photos || []).map(p => p.src));
    const newPhotos = selectedPhotos.filter(p => !existingSrcs.has(p.src));
    if (newPhotos.length === 0) { toast.info("All selected photos are already in this album"); return; }
    const updatedAlb = { ...alb, photos: [...(alb.photos || []), ...newPhotos], photoCount: (alb.photos || []).length + newPhotos.length };
    if (!updatedAlb.coverImage && newPhotos[0]) updatedAlb.coverImage = newPhotos[0].src;
    const { ok, error } = await saveTenantAlbum(slug, updatedAlb);
    if (!ok) { toast.error(error || "Failed to update album"); return; }
    setAlbums(prev => prev.map(a => a.id === albumId ? updatedAlb : a));
    setSelectedIds(new Set());
    setShowAddToAlbum(false);
    toast.success(`Added ${newPhotos.length} photo${newPhotos.length !== 1 ? "s" : ""} to "${alb.title}"`);
  };

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    setUploadStats({ total: fileArr.length, done: 0, errors: 0, savedBytes: 0 });

    if (isServerMode()) {
      const results = await uploadPhotosToServer(fileArr, (done, total) => {
        setUploadStats(prev => prev ? { ...prev, done, total } : null);
      }, slug);
      const newPhotos: Photo[] = results.map(r => ({
        id: r.id, src: r.url, thumbnail: r.url + "?size=thumb&wm=0",
        title: r.originalName.replace(/\.[^.]+$/, "").replace(/^_+/, ""), width: 0, height: 0,
        uploadedAt: new Date().toISOString(),
        ...(r.ftpUploaded ? { ftpUploaded: true } : {}),
      }));
      if (newPhotos.length > 0) {
        if (selectedAlbum) {
          const alb = albums.find(a => a.id === selectedAlbum.id);
          if (alb) {
            const updatedPhotos = [...(alb.photos || []), ...newPhotos];
            const updatedAlb = { ...alb, photos: updatedPhotos, photoCount: updatedPhotos.length };
            if (!updatedAlb.coverImage) updatedAlb.coverImage = newPhotos[0].src;
            await saveTenantAlbum(slug, updatedAlb);
            setAlbums(prev => prev.map(a => a.id === alb.id ? updatedAlb : a));
          }
        } else {
          const updated = [...libraryPhotos, ...newPhotos];
          setLibraryPhotos(updated);
          await saveLibrary(updated);
        }
      }
      setUploadStats(prev => prev ? { ...prev, done: fileArr.length, errors: fileArr.length - results.length } : null);
      const target = selectedAlbum ? `"${selectedAlbum.title}"` : "library";
      if (results.length > 0) toast.success(`${results.length} photos uploaded to ${target}`);
    } else {
      for (const file of fileArr) {
        try {
          const result = await compressImage(file);
          const thumb = await generateThumbnail(result.src).catch(() => undefined);
          const photo: Photo = {
            id: generateId("ph"), src: result.src, thumbnail: thumb,
            title: file.name.replace(/\.[^.]+$/, "").replace(/^_+/, ""), width: result.width, height: result.height,
            uploadedAt: new Date().toISOString(),
          };
          if (selectedAlbum) {
            const alb = albums.find(a => a.id === selectedAlbum.id);
            if (alb) {
              const updatedAlb = { ...alb, photos: [...(alb.photos || []), photo], photoCount: (alb.photos || []).length + 1 };
              await saveTenantAlbum(slug, updatedAlb);
              setAlbums(prev => prev.map(a => a.id === alb.id ? updatedAlb : a));
            }
          } else {
            setLibraryPhotos(prev => {
              const u = [...prev, photo];
              saveLibrary(u);
              return u;
            });
          }
          setUploadStats(prev => prev ? { ...prev, done: prev.done + 1, savedBytes: prev.savedBytes + (result.originalSize - result.compressedSize) } : null);
        } catch {
          setUploadStats(prev => prev ? { ...prev, done: prev.done + 1, errors: prev.errors + 1 } : null);
          toast.error(`Failed to process: ${file.name}`);
        }
      }
    }
    if (e.target) e.target.value = "";
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* ── Toolbar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-2xl text-foreground shrink-0">Photo Library</h2>
        <div className="flex gap-2 items-center overflow-x-auto scrollbar-hide pb-1">
          <Button size="sm" variant="outline" onClick={handleClearDuplicates} className="gap-2 font-body text-xs border-border text-foreground flex-shrink-0">
            <XSquare className="w-4 h-4" /> Clear Dupes
          </Button>
          <Button size="sm" variant="outline" onClick={handleSyncStorage} disabled={syncing} className="gap-2 font-body text-xs border-border text-foreground flex-shrink-0">
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync Storage"}
          </Button>
          {selectedIds.size > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={handleMassDelete}
                className="gap-2 font-body text-xs border-destructive/30 text-destructive hover:bg-destructive/10 flex-shrink-0">
                <Trash2 className="w-4 h-4" /> Delete ({selectedIds.size})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}
                className="gap-1 font-body text-xs text-muted-foreground flex-shrink-0">
                <XSquare className="w-4 h-4" /> Clear
              </Button>
              <div className="relative flex-shrink-0">
                <Button size="sm" variant="outline" onClick={() => setShowAddToAlbum(v => !v)}
                  className="gap-2 font-body text-xs border-border text-foreground">
                  <Plus className="w-4 h-4" /> Add to Album ({selectedIds.size})
                </Button>
                {showAddToAlbum && albums.length > 0 && (
                  <div className="absolute top-full right-0 mt-1 z-50 glass-panel rounded-lg border border-border shadow-lg min-w-[200px]">
                    {albums.map(alb => (
                      <button key={alb.id} onClick={() => handleAddToAlbum(alb.id)}
                        className="w-full text-left px-4 py-2.5 text-sm font-body text-foreground hover:bg-secondary transition-colors first:rounded-t-lg last:rounded-b-lg">
                        {alb.title} ({(alb.photos || []).length} photos)
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button size="sm" onClick={handleCreateAlbumFromSelection}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase flex-shrink-0">
                <Plus className="w-4 h-4" /> Create Album ({selectedIds.size})
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost"
            onClick={() => {
              if (selectedIds.size === displayPhotos.length && displayPhotos.length > 0) setSelectedIds(new Set());
              else setSelectedIds(new Set(displayPhotos.map(p => p.id)));
            }}
            className="gap-1 font-body text-xs text-muted-foreground flex-shrink-0">
            <CheckSquare className="w-4 h-4" />
            {selectedIds.size === displayPhotos.length && displayPhotos.length > 0 ? "Deselect All" : "Select All"}
          </Button>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by filename…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-9 h-9 text-sm font-body bg-secondary/50 border-border"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Source filter pills ── */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
        <button onClick={() => setViewSource("all")}
          className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${viewSource === "all" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          All ({allPhotos.length})
        </button>
        <button onClick={() => setViewSource("library")}
          className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${viewSource === "library" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          Library ({libraryPhotos.length})
        </button>
        {starredPhotos.length > 0 && (
          <button onClick={() => setStarredOnly(v => !v)}
            className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${starredOnly ? "bg-yellow-500 text-black" : "bg-secondary text-yellow-400 hover:text-yellow-300"}`}>
            ⭐ Starred ({starredPhotos.length})
          </button>
        )}
        {albums.map(a => (
          <button key={a.id} onClick={() => setViewSource(a.title)}
            className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${viewSource === a.title ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
            {a.title} ({(a.photos || []).length})
          </button>
        ))}
      </div>

      {/* ── Upload zone ── */}
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
        {/* Camera / gallery shortcuts — shown on touch/mobile devices only */}
        <div className="mt-3 flex gap-2 sm:hidden">
          <label className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg border border-border/50 text-xs font-body text-muted-foreground cursor-pointer hover:bg-secondary/50 transition-colors">
            <Camera className="w-4 h-4" /> Take a photo
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleUpload} />
          </label>
          <label className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg border border-border/50 text-xs font-body text-muted-foreground cursor-pointer hover:bg-secondary/50 transition-colors">
            <Upload className="w-4 h-4" /> Choose photos
            <input type="file" accept="image/*" multiple className="sr-only" onChange={handleUpload} />
          </label>
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
          {allPhotos.length === 0 ? (
            <>
              <p className="text-sm font-body text-muted-foreground">No photos yet</p>
              <p className="text-xs font-body text-muted-foreground/60 mt-1">Upload photos to your library or select an album filter.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-body text-muted-foreground">No photos match the current filter</p>
              <button onClick={() => { setViewSource("all"); setStarredOnly(false); setSearchQuery(""); }}
                className="text-xs font-body text-primary hover:underline mt-2">Clear filters</button>
            </>
          )}
        </div>
      ) : (
        <>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
          {displayPhotos.slice(0, visibleCount).map(p => (
            <div
              key={`${p.id}::${p.source}`}
              className={`relative group aspect-square rounded-md overflow-hidden bg-secondary cursor-pointer border-2 transition-all ${selectedIds.has(p.id) ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-border"}`}
              onClick={() => toggleSelect(p.id)}
            >
              <ProgressiveImg
                thumbSrc={photoUrl(p.thumbnail || (p.src.startsWith("/uploads/") ? `${p.src}?size=thumb` : p.src))}
                fullSrc={photoUrl(p.src)}
                alt={p.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <button
                onClick={e => { e.stopPropagation(); handleToggleStar(p); }}
                className={`absolute top-1 left-1 w-6 h-6 rounded-full flex items-center justify-center transition-opacity sm:opacity-0 sm:group-hover:opacity-100 ${p.starred ? "opacity-100 bg-yellow-500/80" : "opacity-60 bg-black/40"}`}
                title={p.starred ? "Unstar" : "Star"}
              >
                <span className="text-[10px] leading-none">{p.starred ? "★" : "☆"}</span>
              </button>
              {selectedIds.has(p.id) && (
                <div className="absolute top-1 right-1 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">✓</div>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent p-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <p className="text-[9px] font-body text-foreground font-medium truncate">{p.title}</p>
                <p className="text-[8px] font-body text-muted-foreground truncate">{p.source}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); handleDeletePhoto(p.id, p.source, p.src); }}
                className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        {visibleCount < displayPhotos.length && (
          <div ref={libSentinelRef} className="flex justify-center py-6">
            <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}
        </>
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
                <button onClick={() => setEditing({ ...c })} className="p-2 rounded hover:bg-secondary text-muted-foreground/60 hover:text-foreground transition-colors"><Edit className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(c.id)} className="p-2 rounded hover:bg-red-500/10 text-muted-foreground/60 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
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
  const [customDomain, setCustomDomain] = useState<string | undefined>(undefined);
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    fetch(`/api/tenant/${encodeURIComponent(slug)}/public`)
      .then(r => r.json())
      .then(d => { if (d.tenant) { setBio(d.tenant.bio || ""); setCustomDomain(d.tenant.customDomain); } })
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
            <RichTextEditor value={bio} onChange={setBio} minHeight="120px" placeholder="Short bio shown on your booking page — supports bold, italic, headings" />
          </div>
          <div className="p-3 rounded-lg bg-secondary/50 border border-border/50">
            <p className="text-xs font-body text-muted-foreground">Booking page URL:</p>
            <a href={`/book/${slug}`} target="_blank" rel="noopener noreferrer" className="text-sm font-body text-primary hover:underline">{window.location.origin}/book/{slug}</a>
            {customDomain && (
              <div className="mt-2 pt-2 border-t border-border/30">
                <p className="text-xs font-body text-muted-foreground">Custom domain:</p>
                <a href={`https://${customDomain}`} target="_blank" rel="noopener noreferrer" className="text-sm font-body text-blue-400 hover:underline font-mono">
                  {customDomain}
                </a>
                <p className="text-[10px] font-body text-muted-foreground mt-1">
                  Point your domain's DNS A/CNAME record to this server and configure your reverse proxy to forward requests here.
                  See the <code className="bg-secondary px-1 rounded">Caddyfile</code> in the project for an example.
                </p>
              </div>
            )}
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
// ─── Watermark Preview ────────────────────────────────────────────────────────
const TENANT_SAMPLE_IMAGES = [
  { src: sampleLandscape, label: "Landscape" },
  { src: samplePortrait, label: "Portrait" },
  { src: sampleWedding, label: "Wedding" },
  { src: sampleEvent, label: "Event" },
  { src: sampleFood, label: "Food" },
];
function TenantWatermarkPreview({ settings }: { settings: TenantSettings }) {
  const [selectedSample, setSelectedSample] = useState(0);
  const currentSrc = TENANT_SAMPLE_IMAGES[selectedSample].src;
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {TENANT_SAMPLE_IMAGES.map((img, i) => (
          <button key={i} onClick={() => setSelectedSample(i)}
            className={`text-[10px] font-body px-2.5 py-1 rounded-full transition-all ${selectedSample === i ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
            {img.label}
          </button>
        ))}
      </div>
      <div className="rounded-lg overflow-hidden bg-secondary">
        <WatermarkedImage
          src={currentSrc}
          title="Preview"
          renderWatermarkOverlay={true}
          watermarkPosition={settings.watermarkPosition ?? "tiled"}
          watermarkText={settings.watermarkText ?? "© Your Studio"}
          watermarkImage={settings.watermarkImage}
          watermarkOpacity={settings.watermarkOpacity ?? 20}
          watermarkSize={settings.watermarkSize ?? 40}
          index={0}
        />
      </div>
    </div>
  );
}

function TenantSettingsView({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<TenantSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<"general" | "payments" | "notifications" | "watermark" | "integrations">("general");
  const [wmUploading, setWmUploading] = useState(false);

  // Google Calendar state
  const [gcalStatus, setGcalStatus] = useState<{ configured: boolean; connected: boolean; email: string | null; calendarId: string } | null>(null);
  const [gcalCalendars, setGcalCalendars] = useState<{ id: string; summary: string; primary?: boolean }[]>([]);
  const [gcalCalendarId, setGcalCalendarId] = useState("primary");
  const [gcalSaving, setGcalSaving] = useState(false);

  useEffect(() => {
    getTenantSettings(slug).then(s => { setSettings(s); setLoading(false); });
  }, [slug]);

  // Load Google Calendar status when integrations tab opens
  useEffect(() => {
    if (activeSection !== "integrations") return;
    getTenantGoogleCalendarStatus(slug).then(s => {
      setGcalStatus(s);
      setGcalCalendarId(s.calendarId || "primary");
      if (s.connected) getTenantGoogleCalendars(slug).then(setGcalCalendars);
    });
  }, [activeSection, slug]);

  // Handle redirect back from Google OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (gcal === "connected") {
      toast.success("Google Calendar connected successfully!");
      setActiveSection("integrations");
      navigate(`/tenant-admin/${slug}`, { replace: true });
    } else if (gcal === "error") {
      toast.error("Google Calendar connection failed. Check your credentials.");
      setActiveSection("integrations");
      navigate(`/tenant-admin/${slug}`, { replace: true });
    }
  }, [slug, navigate]);

  const set = (patch: Partial<TenantSettings>) => setSettings(s => ({ ...s, ...patch }));

  const handleSaveSettings = async () => {
    setSaving(true);
    const { ok, error } = await saveTenantSettings(slug, settings);
    setSaving(false);
    if (!ok) { toast.error(error || "Failed to save"); return; }
    toast.success("Settings saved");
  };

  const [testingFtp, setTestingFtp] = useState(false);
  const handleTestFtp = async () => {
    setTestingFtp(true);
    const { ok, error } = await testTenantFtpConnection(slug);
    setTestingFtp(false);
    if (ok) toast.success("FTP connection successful ✓");
    else toast.error(error || "FTP connection failed");
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

  const handleGcalConnect = async () => {
    // First save the credentials if they've been changed (new value entered)
    if (settings.googleApiCredentials) {
      await saveTenantSettings(slug, settings);
    }
    const url = await startTenantGoogleCalendarAuth(slug);
    if (url) {
      window.location.href = url;
    } else {
      toast.error("Google credentials not configured. Paste your Google API credentials JSON first, then save.");
    }
  };

  const handleGcalDisconnect = async () => {
    if (!confirm("Disconnect Google Calendar?")) return;
    await disconnectTenantGoogleCalendar(slug);
    setGcalStatus(s => s ? { ...s, connected: false, email: null } : s);
    setGcalCalendars([]);
    toast.success("Google Calendar disconnected");
  };

  const handleGcalSaveSettings = async () => {
    setGcalSaving(true);
    await saveTenantCalendarSettings(slug, { calendarId: gcalCalendarId });
    setGcalSaving(false);
    toast.success("Calendar settings saved");
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  const sectionTabs = [
    { id: "general" as const, label: "General" },
    { id: "payments" as const, label: "Payments" },
    { id: "notifications" as const, label: "Notifications" },
    { id: "watermark" as const, label: "Watermark" },
    { id: "integrations" as const, label: "Integrations" },
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

      <div className="flex gap-1 mb-6 bg-secondary rounded-xl p-1 max-w-full overflow-x-auto scrollbar-hide">
        {sectionTabs.map(t => (
          <button key={t.id} onClick={() => setActiveSection(t.id)}
            className={`px-4 py-2 rounded-lg text-xs font-body tracking-wider uppercase whitespace-nowrap flex-shrink-0 transition-all ${activeSection === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >{t.label}</button>
        ))}
      </div>

      {activeSection === "general" && (
        <div className="space-y-5 max-w-lg">
          {/* Default Album Settings */}
          <div className="glass-panel rounded-xl p-5 space-y-4">
            <h3 className="font-display text-base text-foreground flex items-center gap-2">
              <Image className="w-4 h-4 text-primary" /> Default Album Settings
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Free Downloads</label>
                <Input type="number" value={settings.defaultFreeDownloads ?? 5} onChange={e => set({ defaultFreeDownloads: Number(e.target.value) })} className="bg-background border-border text-foreground font-body w-32" />
              </div>
              <div>
                <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Price per Photo ($)</label>
                <Input type="number" value={settings.defaultPricePerPhoto ?? 0} onChange={e => set({ defaultPricePerPhoto: Number(e.target.value) })} className="bg-background border-border text-foreground font-body w-32" />
              </div>
              <div>
                <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Full Album Price ($)</label>
                <Input type="number" value={settings.defaultPriceFullAlbum ?? 0} onChange={e => set({ defaultPriceFullAlbum: Number(e.target.value) })} className="bg-background border-border text-foreground font-body w-32" />
              </div>
            </div>
          </div>

          {/* Invoice Defaults */}
          <div className="glass-panel rounded-xl p-5 space-y-4">
            <h3 className="font-display text-base text-foreground flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" /> Invoice Defaults
            </h3>
            <p className="text-[10px] font-body text-muted-foreground/60">Pre-filled in the "From" section when creating invoices.</p>
            {(() => {
              const from = settings.invoiceFrom || { name: "", email: "", address: "", abn: "" };
              const setFrom = (patch: Partial<InvoiceParty>) => set({ invoiceFrom: { ...from, ...patch } });
              return (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Business Name</label>
                    <Input value={from.name} onChange={e => setFrom({ name: e.target.value })} placeholder="Your business name" className="bg-background border-border text-foreground font-body" />
                  </div>
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">ABN</label>
                    <Input value={from.abn || ""} onChange={e => setFrom({ abn: e.target.value })} placeholder="12 345 678 901" className="bg-background border-border text-foreground font-body" />
                  </div>
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Email</label>
                    <Input type="email" value={from.email} onChange={e => setFrom({ email: e.target.value })} className="bg-background border-border text-foreground font-body" />
                  </div>
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Address</label>
                    <Textarea value={from.address} onChange={e => setFrom({ address: e.target.value })} placeholder="Street address" className="bg-background border-border text-foreground font-body min-h-[60px]" />
                  </div>
                  <div>
                    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Default Invoice Notes</label>
                    <Textarea value={settings.invoiceNotes || ""} onChange={e => set({ invoiceNotes: e.target.value })} placeholder="e.g. Payment due within 30 days. Thank you for your business." className="bg-background border-border text-foreground font-body min-h-[60px]" />
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Booking Settings */}
          <div className="glass-panel rounded-xl p-5 space-y-4">
            <h3 className="font-display text-base text-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" /> Booking Settings
            </h3>
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Booking Timer (minutes)</label>
              <Input type="number" value={settings.bookingTimerMinutes ?? 15} onChange={e => set({ bookingTimerMinutes: Number(e.target.value) })} className="bg-background border-border text-foreground font-body w-32" />
              <p className="text-[10px] font-body text-muted-foreground/50 mt-1">How long a client has to complete their booking after selecting a time</p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-body text-muted-foreground">Show Instagram Handle Field</span>
              <Switch checked={!!settings.instagramFieldEnabled} onCheckedChange={v => set({ instagramFieldEnabled: v })} />
            </div>
            <div className="border-t border-border/30 pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-body text-foreground font-medium">Enable Client Enquiries</p>
                  <p className="text-[10px] font-body text-muted-foreground/60 mt-0.5">Show an enquiry form on the booking page for custom requests</p>
                </div>
                <Switch checked={!!settings.enquiryEnabled} onCheckedChange={v => set({ enquiryEnabled: v })} />
              </div>
              {settings.enquiryEnabled && (
                <div>
                  <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Enquiry Button Label</label>
                  <Input value={settings.enquiryLabel ?? "Make an Enquiry"} onChange={e => set({ enquiryLabel: e.target.value })} placeholder="Make an Enquiry" className="bg-background border-border text-foreground font-body" />
                </div>
              )}
            </div>
          </div>

          {/* Notification Email Template */}
          <div className="glass-panel rounded-xl p-5 space-y-4">
            <h3 className="font-display text-base text-foreground flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" /> Notification Email Template
            </h3>
            <Textarea value={settings.notificationEmailTemplate || ""} onChange={e => set({ notificationEmailTemplate: e.target.value })} className="bg-background border-border text-foreground font-body min-h-[80px]" placeholder="Hey {name}, your photos are ready! {link}" />
            <p className="text-[10px] font-body text-muted-foreground/50">Variables: {"{name}"}, {"{link}"}, {"{instagram}"}. Requires SMTP backend to send.</p>
          </div>

          {/* Client Proofing */}
          <div className="glass-panel rounded-xl p-5 space-y-4">
            <h3 className="font-display text-base text-foreground flex items-center gap-2">
              <Star className="w-4 h-4 text-primary" /> Client Proofing
            </h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-body text-foreground font-medium">Enable Client Proofing</p>
                <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">Allow clients to star and submit photo picks before editing</p>
              </div>
              <Switch checked={!!settings.proofingEnabled} onCheckedChange={v => set({ proofingEnabled: v })} />
            </div>
            {settings.proofingEnabled && (
              <div className="flex items-center gap-3 pt-1 border-t border-border/50">
                <div className="flex-1">
                  <p className="text-sm font-body text-foreground font-medium">Default Proofing Window</p>
                  <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">How long clients have to submit picks after a round is started. Can be overridden per album.</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input type="number" min={1} max={720} value={settings.defaultProofingExpiryHours ?? 48} onChange={e => set({ defaultProofingExpiryHours: Math.min(720, Math.max(1, parseInt(e.target.value) || 48)) })} className="w-20 bg-background border border-border rounded-md px-2 py-1.5 text-sm font-body text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring" />
                  <span className="text-xs font-body text-muted-foreground">hours</span>
                </div>
              </div>
            )}
          </div>

          <Button onClick={handleSaveSettings} disabled={saving} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2 w-full">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save General Settings"}
          </Button>
        </div>
      )}

      {activeSection === "payments" && (
        <div className="space-y-5 max-w-lg">
          {/* Stripe */}
          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Stripe</span>
              <Switch checked={settings.stripeEnabled !== false && !!(settings.stripePublishableKey || settings.stripeSecretKey || settings.stripeSecretKeySet)} onCheckedChange={v => set({ stripeEnabled: v })} />
              <span className="text-xs font-body text-muted-foreground">{settings.stripeEnabled !== false && (settings.stripePublishableKey || settings.stripeSecretKey || settings.stripeSecretKeySet) ? "Enabled" : "Disabled"}</span>
            </div>
            <div><label className="text-xs font-body text-muted-foreground mb-1 block">Publishable Key</label>
              <Input value={settings.stripePublishableKey || ""} onChange={e => set({ stripePublishableKey: e.target.value, stripeEnabled: true })} placeholder="pk_live_..." className="bg-background border-border text-foreground font-body text-xs font-mono" /></div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-body text-muted-foreground">Secret Key</label>
                {settings.stripeSecretKeySet && !settings.stripeSecretKey && (
                  <span className="text-[10px] font-body text-green-400">✓ Configured</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input type="password" value={settings.stripeSecretKey || ""} onChange={e => set({ stripeSecretKey: e.target.value, stripeEnabled: true })} placeholder={settings.stripeSecretKeySet ? "Enter new key to replace" : "sk_live_..."} className="bg-background border-border text-foreground font-body text-xs font-mono flex-1" />
                {settings.stripeSecretKeySet && !settings.stripeSecretKey && (
                  <button onClick={() => set({ stripeSecretKey: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-body text-muted-foreground">Webhook Secret</label>
                {settings.stripeWebhookSecretSet && !settings.stripeWebhookSecret && (
                  <span className="text-[10px] font-body text-green-400">✓ Configured</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input type="password" value={settings.stripeWebhookSecret || ""} onChange={e => set({ stripeWebhookSecret: e.target.value })} placeholder={settings.stripeWebhookSecretSet ? "Enter new secret to replace" : "whsec_..."} className="bg-background border-border text-foreground font-body text-xs font-mono flex-1" />
                {settings.stripeWebhookSecretSet && !settings.stripeWebhookSecret && (
                  <button onClick={() => set({ stripeWebhookSecret: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
                )}
              </div>
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
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-body text-muted-foreground">Webhook URL</label>
                {settings.discordWebhookUrlSet && !settings.discordWebhookUrl && (
                  <span className="text-[10px] font-body text-green-400">✓ Configured</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input value={settings.discordWebhookUrl || ""} onChange={e => set({ discordWebhookUrl: e.target.value })} placeholder={settings.discordWebhookUrlSet ? "Enter new URL to replace" : "https://discord.com/api/webhooks/..."} className="bg-background border-border text-foreground font-body text-xs flex-1" />
                {settings.discordWebhookUrlSet && !settings.discordWebhookUrl && (
                  <button onClick={() => set({ discordWebhookUrl: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
                )}
              </div>
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
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-body text-muted-foreground">Password</label>
                  {settings.smtpPasswordSet && !settings.smtpPassword && (
                    <span className="text-[10px] font-body text-green-400">✓ Configured</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input type="password" value={settings.smtpPassword || ""} onChange={e => set({ smtpPassword: e.target.value })} placeholder={settings.smtpPasswordSet ? "Enter new password to replace" : "••••••••"} className="bg-background border-border text-foreground font-body text-xs flex-1" />
                  {settings.smtpPasswordSet && !settings.smtpPassword && (
                    <button onClick={() => set({ smtpPassword: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
                  )}
                </div>
              </div>
              <div><label className="text-xs font-body text-muted-foreground mb-1 block">From Address</label><Input value={settings.smtpFrom || ""} onChange={e => set({ smtpFrom: e.target.value })} placeholder="Jane <jane@example.com>" className="bg-background border-border text-foreground font-body text-xs" /></div>
              <div className="flex items-center gap-2 pt-5"><Switch checked={!!settings.smtpSecure} onCheckedChange={v => set({ smtpSecure: v })} /><label className="text-xs font-body text-foreground">Use TLS (port 465)</label></div>
            </div>
          </div>

          {/* FTP Upload */}
          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">FTP Upload</span>
              <Switch checked={!!settings.ftpEnabled} onCheckedChange={v => set({ ftpEnabled: v })} />
            </div>
            <p className="text-[10px] font-body text-muted-foreground -mt-1">Automatically send uploaded photos to an FTP server. Tagged photos will show an FTP badge.</p>
            {settings.ftpEnabled && (
              <>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-xs font-body text-muted-foreground mb-1 block">FTP Host / IP</label>
                    <Input value={settings.ftpHost || ""} onChange={e => set({ ftpHost: e.target.value })}
                      placeholder="192.168.1.100" className="bg-background border-border text-foreground font-body text-xs" />
                  </div>
                  <div>
                    <label className="text-xs font-body text-muted-foreground mb-1 block">Port</label>
                    <Input type="number" value={settings.ftpPort || ""} onChange={e => set({ ftpPort: parseInt(e.target.value) || undefined })}
                      placeholder="21" className="bg-background border-border text-foreground font-body text-xs" />
                  </div>
                  <div>
                    <label className="text-xs font-body text-muted-foreground mb-1 block">Username</label>
                    <Input value={settings.ftpUser || ""} onChange={e => set({ ftpUser: e.target.value })}
                      placeholder="ftpuser" className="bg-background border-border text-foreground font-body text-xs" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-body text-muted-foreground">Password</label>
                      {settings.ftpPasswordSet && !settings.ftpPassword && (
                        <span className="text-[10px] font-body text-green-400">✓ Configured</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Input type="password" value={settings.ftpPassword || ""} onChange={e => set({ ftpPassword: e.target.value })}
                        placeholder={settings.ftpPasswordSet ? "Enter new password to replace" : "••••••••"}
                        className="bg-background border-border text-foreground font-body text-xs flex-1" />
                      {settings.ftpPasswordSet && !settings.ftpPassword && (
                        <button onClick={() => set({ ftpPassword: "" })} className="text-[10px] font-body text-destructive hover:text-destructive/80 px-2 shrink-0">Clear</button>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-body text-muted-foreground mb-1 block">Remote Path</label>
                    <Input value={settings.ftpRemotePath || ""} onChange={e => set({ ftpRemotePath: e.target.value })}
                      placeholder="/photos" className="bg-background border-border text-foreground font-body text-xs" />
                  </div>
                </div>
                {/* Folder organisation options */}
                <div className="space-y-2 pt-2 border-t border-border/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-body text-foreground">Organise by Album / Booking Type</p>
                      <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">Upload each album's photos into a sub-folder named after the album (e.g. <code>/photos/AlbumName/</code>).</p>
                    </div>
                    <Switch checked={!!settings.ftpOrganizeByAlbum} onCheckedChange={v => set({ ftpOrganizeByAlbum: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-body text-foreground">Starred Photos → Separate Folder</p>
                      <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">When a photo is starred, move it on FTP to a <code>AlbumName-starred</code> sub-folder for easy sorting.</p>
                    </div>
                    <Switch checked={!!settings.ftpStarredFolder} onCheckedChange={v => set({ ftpStarredFolder: v })} />
                  </div>
                </div>
                {settings.ftpHost && (
                  <Button onClick={handleTestFtp} disabled={testingFtp} variant="outline" size="sm" className="font-body text-xs gap-2 mt-1">
                    <Wifi className="w-3.5 h-3.5" /> {testingFtp ? "Testing…" : "Test Connection"}
                  </Button>
                )}
              </>
            )}
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

          {/* Live Preview */}
          <div className="space-y-3 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <h3 className="text-xs font-body tracking-wider uppercase text-muted-foreground">Preview</h3>
            <TenantWatermarkPreview settings={settings} />
          </div>

          <Button onClick={handleSaveSettings} disabled={saving} className="bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase gap-2 w-full">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Watermark Settings"}
          </Button>
        </div>
      )}

      {activeSection === "integrations" && (
        <div className="space-y-5 max-w-lg">
          {/* Google Calendar */}
          <div className="space-y-4 p-4 rounded-lg bg-secondary/40 border border-border/50">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Google Calendar</span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-body text-muted-foreground block">
                  Google API Credentials JSON
                </label>
                {settings.googleApiCredentialsSet && !settings.googleApiCredentials && (
                  <span className="text-[10px] font-body text-green-400">✓ Configured</span>
                )}
              </div>
              <Textarea
                value={settings.googleApiCredentials || ""}
                onChange={e => set({ googleApiCredentials: e.target.value })}
                placeholder={settings.googleApiCredentialsSet ? "Paste new credentials JSON to replace" : `{"web":{"client_id":"...","client_secret":"...","redirect_uris":["https://your-domain.com/api/tenant/${slug}/integrations/googlecalendar/callback"]}}`}
                rows={5}
                className="bg-background border-border text-foreground font-body text-xs font-mono resize-none"
              />
              <p className="text-[10px] font-body text-muted-foreground">
                Paste the JSON from your Google Cloud Console OAuth2 client (Web application type).
                Set the redirect URI to:{" "}
                <code className="bg-secondary px-1 rounded text-[10px] break-all">
                  {window.location.origin}/api/tenant/{slug}/integrations/googlecalendar/callback
                </code>
              </p>
            </div>

            <Button onClick={handleSaveSettings} disabled={saving} variant="outline" size="sm" className="font-body text-xs gap-1.5 border-border">
              <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save Credentials"}
            </Button>

            {gcalStatus === null ? (
              <p className="text-xs font-body text-muted-foreground animate-pulse">Checking status…</p>
            ) : gcalStatus.configured && !gcalStatus.connected ? (
              <div className="pt-1">
                <Button onClick={handleGcalConnect} size="sm" className="gap-2 bg-primary text-primary-foreground font-body text-xs">
                  <Calendar className="w-3.5 h-3.5" /> Connect Google Calendar
                </Button>
              </div>
            ) : gcalStatus.connected ? (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                  <div>
                    <p className="text-sm font-body text-foreground font-medium">✓ Connected</p>
                    {gcalStatus.email && <p className="text-xs font-body text-muted-foreground">{gcalStatus.email}</p>}
                  </div>
                  <Button onClick={handleGcalDisconnect} variant="ghost" size="sm" className="text-xs font-body text-destructive hover:bg-destructive/10">
                    Disconnect
                  </Button>
                </div>

                {gcalCalendars.length > 0 && (
                  <div>
                    <label className="text-xs font-body text-muted-foreground mb-1.5 block">Target Calendar</label>
                    <select
                      value={gcalCalendarId}
                      onChange={e => setGcalCalendarId(e.target.value)}
                      className="w-full bg-background border border-border text-foreground font-body text-sm rounded-md px-3 py-2"
                    >
                      {gcalCalendars.map(c => (
                        <option key={c.id} value={c.id}>{c.summary}{c.primary ? " (Primary)" : ""}</option>
                      ))}
                    </select>
                    <Button onClick={handleGcalSaveSettings} disabled={gcalSaving} variant="outline" size="sm" className="mt-2 font-body text-xs gap-1.5 border-border">
                      <Save className="w-3.5 h-3.5" /> {gcalSaving ? "Saving…" : "Save Calendar"}
                    </Button>
                  </div>
                )}
                <p className="text-[10px] font-body text-muted-foreground/60">New bookings will automatically sync to your Google Calendar when created.</p>
              </div>
            ) : !gcalStatus.configured && (
              <p className="text-xs font-body text-muted-foreground/70 pt-1">Save your Google API credentials above to connect.</p>
            )}
          </div>
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
  const [cacheStats, setCacheStats] = useState<{ count: number; sizeBytes: number } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [storageStats, setStorageStats] = useState<{ totalBytes: number; fileCount: number; albumCount: number } | null>(null);
  const [storageStatsLoading, setStorageStatsLoading] = useState(false);
  const [ftpEnabled, setFtpEnabled] = useState<boolean | null>(null);
  const [ftpSyncJob, setFtpSyncJob] = useState<{
    running: boolean;
    albumsDone: number;
    albumsTotal: number;
    filesDone: number;
    filesTotal: number;
    filesFailed: number;
    currentAlbum: string;
    startTime: number;
    elapsed: number;
    results: Array<{ album: string; done: number; total: number; failed: number; error?: string }>;
  } | null>(null);
  const ftpAbortRef = useRef(false);

  const loadData = useCallback(async () => {
    const d = await fetchTenantMobileData(slug);
    setAlbums(d.albums || []);
    setLoading(false);
  }, [slug]);

  const loadCacheStats = useCallback(() => {
    setStatsLoading(true);
    fetch(`/api/tenant/${encodeURIComponent(slug)}/cache/stats`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setCacheStats({ count: d.count ?? 0, sizeBytes: d.sizeBytes ?? 0 }); })
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [slug]);

  const loadStorageStats = useCallback(() => {
    setStorageStatsLoading(true);
    getTenantStorageStats(slug)
      .then(d => { if (d?.ok) setStorageStats({ totalBytes: d.totalBytes, fileCount: d.fileCount, albumCount: d.albumCount }); })
      .catch(() => {})
      .finally(() => setStorageStatsLoading(false));
  }, [slug]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadCacheStats(); }, [loadCacheStats]);
  useEffect(() => { loadStorageStats(); }, [loadStorageStats]);
  useEffect(() => {
    getTenantSettings(slug).then(s => setFtpEnabled(!!(s.ftpEnabled && s.ftpHost)));
  }, [slug]);

  const handleFtpSyncAll = useCallback(async () => {
    ftpAbortRef.current = false;
    const settings = await getTenantSettings(slug);
    if (!settings.ftpEnabled || !settings.ftpHost) {
      toast.error("FTP is not enabled. Configure FTP in Settings → FTP Upload first.");
      return;
    }
    const syncAlbums = albums.filter(a => a.slug && (a.photos?.length || 0) > 0);
    if (syncAlbums.length === 0) {
      toast.info("No albums with photos to sync to FTP.");
      return;
    }
    const startTime = Date.now();
    const results: Array<{ album: string; done: number; total: number; failed: number; error?: string }> = [];
    let totalFilesDone = 0;
    let totalFilesFailed = 0;
    let grandTotal = 0;
    setFtpSyncJob({
      running: true, albumsDone: 0, albumsTotal: syncAlbums.length,
      filesDone: 0, filesTotal: 0, filesFailed: 0,
      currentAlbum: syncAlbums[0]?.title || syncAlbums[0]?.slug || "",
      startTime, elapsed: 0, results: [],
    });
    for (let i = 0; i < syncAlbums.length; i++) {
      if (ftpAbortRef.current) break;
      const album = syncAlbums[i];
      setFtpSyncJob(prev => prev ? {
        ...prev, albumsDone: i, currentAlbum: album.title || album.slug,
        elapsed: (Date.now() - startTime) / 1000,
      } : null);
      const result = await ftpUploadAlbum(
        album.slug,
        (done, total, failed) => {
          if (ftpAbortRef.current) return;
          const elapsed = (Date.now() - startTime) / 1000;
          setFtpSyncJob(prev => prev ? {
            ...prev, filesDone: totalFilesDone + done, filesTotal: grandTotal + total,
            filesFailed: totalFilesFailed + failed, elapsed,
          } : null);
        },
        slug,
      );
      grandTotal += result.total;
      totalFilesDone += result.done;
      totalFilesFailed += result.failed;
      // A connection-level error (result.ok=false, result.error set) means no files
      // were uploaded due to an FTP failure (auth error, unreachable server, or
      // permission denied).  Count the album's total as "failed" so that the
      // overall status reflects the failure.
      if (!result.ok && result.error) totalFilesFailed += result.total || 1;
      results.push({ album: album.title || album.slug, done: result.done, total: result.total, failed: result.failed, error: result.error });
      setFtpSyncJob(prev => prev ? {
        ...prev, albumsDone: i + 1,
        filesDone: totalFilesDone, filesTotal: grandTotal, filesFailed: totalFilesFailed,
        elapsed: (Date.now() - startTime) / 1000, results: [...results],
      } : null);
    }
    const elapsed = (Date.now() - startTime) / 1000;
    setFtpSyncJob(prev => prev ? { ...prev, running: false, elapsed, results } : null);
    if (ftpAbortRef.current) {
      toast.info("FTP sync cancelled");
    } else if (totalFilesFailed === 0) {
      toast.success(`FTP sync complete — ${totalFilesDone} file${totalFilesDone !== 1 ? "s" : ""} synced across ${results.length} album${results.length !== 1 ? "s" : ""}`);
    } else {
      toast.error(`FTP sync done with errors — ${totalFilesDone} uploaded, ${totalFilesFailed} failed`);
    }
  }, [slug, albums]);

  const handleClearCache = async () => {
    setCacheClearing(true);
    const { ok, cleared, error } = await clearTenantImageCache(slug);
    setCacheClearing(false);
    if (!ok) { toast.error(error || "Failed to clear cache"); return; }
    toast.success(`Cache cleared — ${cleared ?? 0} file(s) removed`);
    setCacheStats(null);
    loadCacheStats();
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>;

  const totalPhotos = albums.reduce((s, a) => s + (a.photos?.length || 0), 0);
  const totalStarred = albums.reduce((s, a) => s + (a.photos?.filter(p => p.starred)?.length || 0), 0);

  function fmtBytes(b: number) {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">Storage</h2>
      <div className="space-y-4 max-w-lg">
        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Albums</p>
            <p className="font-display text-2xl text-foreground mt-1">{albums.length}</p>
          </div>
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Photos</p>
            <p className="font-display text-2xl text-foreground mt-1">{totalPhotos}</p>
          </div>
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Starred</p>
            <p className="font-display text-2xl text-foreground mt-1">{totalStarred}</p>
          </div>
          <div className="glass-panel rounded-xl p-4">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Storage Used</p>
            <p className="font-display text-lg text-foreground mt-1">
              {storageStatsLoading ? <span className="text-base animate-pulse">…</span> : storageStats ? fmtBytes(storageStats.totalBytes) : "—"}
            </p>
          </div>
        </div>

        {/* Image Cache panel */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h3 className="font-display text-base text-foreground flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary" /> Image Cache
          </h3>
          <p className="text-xs font-body text-muted-foreground">
            Watermarked and resized versions are cached on the server for faster delivery.
            Clear the cache to regenerate images with updated watermark settings.
          </p>
          {cacheStats && (
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-secondary/60">
                <p className="text-xs font-body text-muted-foreground">Cached files</p>
                <p className="font-display text-lg text-foreground">{cacheStats.count}</p>
                <p className="text-[10px] font-body text-muted-foreground/60">thumbnails &amp; medium</p>
              </div>
              <div className="p-3 rounded-lg bg-secondary/60">
                <p className="text-xs font-body text-muted-foreground">Cache size</p>
                <p className="font-display text-lg text-foreground">{fmtBytes(cacheStats.sizeBytes)}</p>
                <p className="text-[10px] font-body text-muted-foreground/60">on-disk</p>
              </div>
            </div>
          )}
          <Button
            onClick={handleClearCache}
            disabled={cacheClearing}
            variant="outline"
            className="font-body text-xs tracking-wider uppercase gap-2 border-border text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${cacheClearing ? "animate-spin" : ""}`} />
            {cacheClearing ? "Clearing…" : "Clear Image Cache"}
          </Button>
          <p className="text-[10px] font-body text-muted-foreground/60">
            Cache uses your tenant watermark settings. Clearing regenerates with latest settings.
          </p>
        </div>

        {/* Per-album breakdown */}
        <div className="glass-panel rounded-xl p-5 space-y-3">
          <h3 className="font-display text-base text-foreground">Album Breakdown</h3>
          {albums.length === 0 ? (
            <p className="text-sm font-body text-muted-foreground">No albums yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {albums.map(a => {
                const count = a.photos?.length || 0;
                const starred = a.photos?.filter(p => p.starred)?.length || 0;
                const pct = totalPhotos > 0 ? Math.round((count / totalPhotos) * 100) : 0;
                return (
                  <div key={a.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-body text-foreground truncate flex-1 mr-2">{a.title}</span>
                      <span className="text-xs font-body text-muted-foreground shrink-0">{count} photos{starred > 0 ? ` · ★ ${starred}` : ""}</span>
                    </div>
                    {totalPhotos > 0 && (
                      <div className="h-1 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary/50 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* FTP Sync */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h3 className="font-display text-base text-foreground flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" /> FTP Sync
          </h3>
          {ftpEnabled === false ? (
            <p className="text-xs font-body text-muted-foreground">
              FTP is not configured. Enable and configure it in <strong className="text-foreground">Settings → FTP Upload</strong>.
            </p>
          ) : (
            <>
              {ftpSyncJob && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-body text-muted-foreground">
                    <span className="truncate max-w-[60%]">
                      {ftpSyncJob.running ? `Syncing: ${ftpSyncJob.currentAlbum}` : "Sync complete"}
                    </span>
                    <span className={ftpSyncJob.running ? "text-primary" : ftpSyncJob.filesFailed > 0 ? "text-destructive" : "text-green-500"}>
                      {ftpSyncJob.running
                        ? `Album ${Math.min(ftpSyncJob.albumsDone + 1, ftpSyncJob.albumsTotal)}/${ftpSyncJob.albumsTotal}`
                        : ftpSyncJob.filesFailed > 0 ? "Completed with errors" : "✓ Done"}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${ftpSyncJob.running ? "bg-primary" : ftpSyncJob.filesFailed > 0 ? "bg-destructive" : "bg-green-500"}`}
                      style={{ width: ftpSyncJob.albumsTotal > 0 ? `${(ftpSyncJob.albumsDone / ftpSyncJob.albumsTotal) * 100}%` : "0%" }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="p-2 rounded-lg bg-secondary/60">
                      <p className="text-[10px] font-body text-muted-foreground">Files Transferred</p>
                      <p className="font-display text-lg text-foreground">{ftpSyncJob.filesDone}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-secondary/60">
                      <p className="text-[10px] font-body text-muted-foreground">Failed</p>
                      <p className={`font-display text-lg ${ftpSyncJob.filesFailed > 0 ? "text-destructive" : "text-foreground"}`}>{ftpSyncJob.filesFailed}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-secondary/60">
                      <p className="text-[10px] font-body text-muted-foreground">Albums</p>
                      <p className="font-display text-lg text-foreground">{ftpSyncJob.albumsDone}/{ftpSyncJob.albumsTotal}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-secondary/60">
                      <p className="text-[10px] font-body text-muted-foreground">Elapsed</p>
                      <p className="font-display text-lg text-foreground">
                        {ftpSyncJob.elapsed < 60
                          ? `${ftpSyncJob.elapsed.toFixed(1)}s`
                          : `${Math.floor(ftpSyncJob.elapsed / 60)}m ${Math.floor(ftpSyncJob.elapsed % 60)}s`}
                      </p>
                    </div>
                  </div>
                  {ftpSyncJob.running && ftpSyncJob.elapsed > 1 && ftpSyncJob.filesDone > 0 && (
                    <p className="text-[10px] font-body text-muted-foreground">
                      Speed: <span className="text-primary font-medium">{(ftpSyncJob.filesDone / ftpSyncJob.elapsed).toFixed(1)} files/s</span>
                    </p>
                  )}
                  {ftpSyncJob.results.length > 0 && (
                    <div className="space-y-1 mt-1 max-h-28 overflow-y-auto">
                      {ftpSyncJob.results.map((r, i) => (
                        <div key={i} className="flex items-center justify-between text-[10px] font-body text-muted-foreground px-1">
                          <span className="truncate flex-1 mr-2">{r.album}</span>
                          <span className={r.failed > 0 || r.error ? "text-destructive" : "text-green-400"}>
                            {r.done}/{r.total}{r.failed > 0 ? ` (${r.failed} failed)` : r.error ? ` (error)` : " ✓"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleFtpSyncAll}
                  disabled={!!ftpSyncJob?.running}
                  variant="outline"
                  className="font-body text-xs tracking-wider uppercase gap-2 border-border text-muted-foreground hover:text-foreground"
                >
                  <Upload className={`w-3.5 h-3.5 ${ftpSyncJob?.running ? "animate-pulse" : ""}`} />
                  {ftpSyncJob?.running ? "Syncing…" : "Sync All Albums to FTP"}
                </Button>
                {ftpSyncJob?.running && (
                  <Button
                    variant="outline"
                    onClick={() => { ftpAbortRef.current = true; }}
                    className="font-body text-xs tracking-wider uppercase gap-2 border-border text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </Button>
                )}
              </div>
              <p className="text-[10px] font-body text-muted-foreground/60">
                Upload all album photos to the configured FTP server. Uses your tenant FTP settings.
              </p>
            </>
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
    maxEvents?: number | null;
    maxBookings?: number | null;
    extraEventPrice?: number | null;
    extraEventSlots?: number;
    eventCount?: number;
    expiresAt?: string;
    usedAt?: string;
    keyPurchaseEnabled?: boolean;
  } | null>(null);
  const [bookingCount, setBookingCount] = useState(0);
  const [pendingSlotRequest, setPendingSlotRequest] = useState<EventSlotRequest | null>(null);
  const [showSlotPayment, setShowSlotPayment] = useState(false);
  const [slotRequestLoading, setSlotRequestLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [plans, setPlans] = useState<LicensePlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [showPlanPurchase, setShowPlanPurchase] = useState(false);
  const [planCheckoutLoading, setPlanCheckoutLoading] = useState(false);
  const [showPlanPaymentOptions, setShowPlanPaymentOptions] = useState(false);

  useEffect(() => {
    getTenantLicenseInfo(slug).then(info => {
      setLicInfo(info);
      if (info?.issuedTo) setBuyerName(info.issuedTo);
    });
    fetchTenantMobileData(slug).then(d => setBookingCount((d.bookings || []).length));
    getTenantEventSlotRequest(slug).then(setPendingSlotRequest);
    getActiveLicensePlans().then(setPlans);
  }, [slug]);

  const handleRequestSlot = async (paymentMethod: "stripe" | "bank") => {
    setSlotRequestLoading(true);
    const result = await submitEventSlotRequest(slug, paymentMethod);
    if (!result.ok) { toast.error(result.error || "Failed to submit request"); setSlotRequestLoading(false); return; }
    setPendingSlotRequest(result.request!);
    toast.success("Request submitted! You'll be notified once it's approved.");
    if (paymentMethod === "stripe") {
      setCheckoutLoading(true);
      const checkout = await createEventSlotCheckout(slug);
      setCheckoutLoading(false);
      if (checkout.url) {
        window.location.href = checkout.url;
      } else {
        toast.error(checkout.error || "Stripe checkout failed. Contact your administrator.");
      }
    } else {
      setShowSlotPayment(false);
    }
    setSlotRequestLoading(false);
  };

  const handlePlanStripeCheckout = async () => {
    if (!selectedPlanId || !buyerEmail) { toast.error("Please enter your email address."); return; }
    setPlanCheckoutLoading(true);
    const result = await getLicensePlanCheckout(selectedPlanId, buyerEmail, buyerName || undefined);
    setPlanCheckoutLoading(false);
    if (result.url) {
      window.location.href = result.url;
    } else {
      toast.error(result.error || "Checkout failed. Please try again.");
    }
  };

  const handlePlanBankPurchase = async () => {
    if (!selectedPlanId || !buyerEmail) { toast.error("Please enter your email address."); return; }
    setPlanCheckoutLoading(true);
    const result = await createBankLicensePurchase(selectedPlanId, buyerEmail, buyerName || undefined);
    setPlanCheckoutLoading(false);
    if (result.ok) {
      toast.success("Bank transfer request submitted! Contact your administrator with payment confirmation.");
      setShowPlanPurchase(false);
      setShowPlanPaymentOptions(false);
    } else {
      toast.error(result.error || "Failed to submit request.");
    }
  };

  const selectedPlan = plans.find(p => p.id === selectedPlanId);
  const extraEventPrice = licInfo?.extraEventPrice ?? null;
  const effectiveEventLimit = licInfo != null && licInfo.maxEvents != null
    ? licInfo.maxEvents + (licInfo.extraEventSlots ?? 0)
    : null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h2 className="font-display text-2xl text-foreground mb-6">License</h2>
      {!licInfo ? (
        <div className="py-8 text-center text-muted-foreground font-body text-sm animate-pulse">Loading…</div>
      ) : !licInfo.key ? (
        <div className="space-y-4 max-w-lg">
          <div className="glass-panel rounded-xl p-6 text-center space-y-3">
            <Key className="w-10 h-10 text-muted-foreground/30 mx-auto" />
            <p className="font-body text-sm text-muted-foreground">No license key linked to your account.</p>
            <p className="font-body text-xs text-muted-foreground/60">Contact your platform administrator.</p>
          </div>
          {plans.filter(p => p.active !== false).length > 0 && licInfo?.keyPurchaseEnabled && (
            <div className="glass-panel rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />
                <p className="font-display text-base text-foreground">Purchase a License</p>
              </div>
              <p className="text-xs font-body text-muted-foreground">Choose a plan to get started.</p>
              <div className="space-y-2">
                {plans.filter(p => p.active !== false).map(plan => (
                  <button key={plan.id} onClick={() => { setSelectedPlanId(plan.id); setShowPlanPurchase(true); setShowPlanPaymentOptions(false); }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedPlanId === plan.id ? "border-primary bg-primary/10" : "border-border bg-secondary/50 hover:border-primary/50"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm text-foreground">{plan.name}</span>
                      <span className="font-mono text-sm text-primary">{new Intl.NumberFormat("en-AU", { style: "currency", currency: plan.currency || "AUD" }).format(plan.price)}{plan.type !== "one-time" ? `/${plan.type === "monthly" ? "mo" : "yr"}` : ""}</span>
                    </div>
                    {plan.description && <p className="text-xs font-body text-muted-foreground mt-0.5">{plan.description}</p>}
                  </button>
                ))}
              </div>
              {showPlanPurchase && selectedPlan && (
                <div className="space-y-3 p-3 rounded-lg bg-secondary/50 border border-border/40">
                  <p className="text-xs font-body text-muted-foreground font-medium">Your details</p>
                  <Input value={buyerName} onChange={e => setBuyerName(e.target.value)} placeholder="Your name" className="bg-background border-border text-foreground font-body text-sm h-8" />
                  <Input type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} placeholder="Your email address *" className="bg-background border-border text-foreground font-body text-sm h-8" />
                  {showPlanPaymentOptions ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button size="sm" onClick={handlePlanStripeCheckout} disabled={planCheckoutLoading || !buyerEmail} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
                        <CreditCard className="w-3.5 h-3.5" /> {planCheckoutLoading ? "Redirecting…" : "Pay by Card"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={handlePlanBankPurchase} disabled={planCheckoutLoading || !buyerEmail} className="gap-2 font-body text-xs tracking-wider uppercase border-border">
                        <DollarSign className="w-3.5 h-3.5" /> Pay by Bank Transfer
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowPlanPaymentOptions(false); }} className="font-body text-xs text-muted-foreground">
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" onClick={() => setShowPlanPaymentOptions(true)} disabled={!buyerEmail} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
                      <CreditCard className="w-3.5 h-3.5" /> Purchase {selectedPlan.name} — {new Intl.NumberFormat("en-AU", { style: "currency", currency: selectedPlan.currency || "AUD" }).format(selectedPlan.price)}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
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

            {(licInfo.maxEvents != null || licInfo.maxBookings != null) && (
              <div className="space-y-3 p-3 rounded-lg bg-secondary/50 border border-border/40">
                <p className="text-xs font-body text-muted-foreground font-medium">Plan Limits</p>
                <div className="grid grid-cols-2 gap-3">
                  {licInfo.maxBookings != null && (
                    <div>
                      <div className="flex justify-between text-xs font-body mb-1">
                        <span className="text-muted-foreground">Bookings</span>
                        <span className="text-foreground">{bookingCount} / {licInfo.maxBookings}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, (bookingCount / licInfo.maxBookings) * 100)}%` }} />
                      </div>
                    </div>
                  )}
                  {licInfo.maxEvents != null && effectiveEventLimit != null && (
                    <div>
                      <div className="flex justify-between text-xs font-body mb-1">
                        <span className="text-muted-foreground">Event Types</span>
                        <span className="text-foreground">{licInfo.eventCount ?? 0} / {effectiveEventLimit}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, ((licInfo.eventCount ?? 0) / effectiveEventLimit) * 100)}%` }} />
                      </div>
                      {(licInfo.extraEventSlots ?? 0) > 0 && (
                        <p className="text-[10px] font-body text-primary mt-0.5">+{licInfo.extraEventSlots} purchased</p>
                      )}
                    </div>
                  )}
                </div>
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

          {/* Extra event slot purchase — available proactively before the limit is reached */}
          {extraEventPrice != null && !pendingSlotRequest && (
            <div className="glass-panel rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                <p className="font-display text-base text-foreground">Extra Event Type Slot</p>
              </div>
              <p className="text-xs font-body text-muted-foreground">
                Purchase an additional event type slot for{" "}
                <span className="text-foreground font-medium">
                  {new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(extraEventPrice)}
                </span>. Your administrator will approve the request.
              </p>
              {showSlotPayment ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button size="sm" onClick={() => handleRequestSlot("stripe")} disabled={slotRequestLoading || checkoutLoading} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
                    <CreditCard className="w-3.5 h-3.5" /> {checkoutLoading ? "Redirecting…" : "Pay by Card"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleRequestSlot("bank")} disabled={slotRequestLoading} className="gap-2 font-body text-xs tracking-wider uppercase border-border">
                    <DollarSign className="w-3.5 h-3.5" /> Pay by Bank Transfer
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowSlotPayment(false)} className="font-body text-xs text-muted-foreground">
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={() => setShowSlotPayment(true)} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
                  <Plus className="w-3.5 h-3.5" /> Get Extra Slot — {new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(extraEventPrice)}
                </Button>
              )}
            </div>
          )}

          {pendingSlotRequest && ["pending", "paid"].includes(pendingSlotRequest.status) && (
            <div className="glass-panel rounded-xl p-4 space-y-1 border border-blue-500/20">
              <p className="text-xs font-body text-blue-400 font-medium">Extra slot request pending approval</p>
              {pendingSlotRequest.paymentMethod === "bank" ? (
                <p className="text-xs font-body text-muted-foreground">Please transfer <span className="text-foreground font-medium">${pendingSlotRequest.amount}</span> via bank transfer and notify your administrator. Your slot will be granted once confirmed.</p>
              ) : (
                <p className="text-xs font-body text-muted-foreground">Payment {pendingSlotRequest.status === "paid" ? "received" : "submitted"}. Awaiting administrator approval.</p>
              )}
            </div>
          )}

          {/* License plan upgrade */}
          {licInfo.keyPurchaseEnabled && plans.filter(p => p.active !== false).length > 0 && (
            <div className="glass-panel rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />
                <p className="font-display text-base text-foreground">Upgrade Your Plan</p>
              </div>
              <p className="text-xs font-body text-muted-foreground">Purchase a new license key to expand your limits.</p>
              <div className="space-y-2">
                {plans.filter(p => p.active !== false).map(plan => (
                  <button key={plan.id} onClick={() => { setSelectedPlanId(plan.id); setShowPlanPurchase(true); setShowPlanPaymentOptions(false); }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedPlanId === plan.id ? "border-primary bg-primary/10" : "border-border bg-secondary/50 hover:border-primary/50"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm text-foreground">{plan.name}</span>
                      <span className="font-mono text-sm text-primary">{new Intl.NumberFormat("en-AU", { style: "currency", currency: plan.currency || "AUD" }).format(plan.price)}{plan.type !== "one-time" ? `/${plan.type === "monthly" ? "mo" : "yr"}` : ""}</span>
                    </div>
                    {plan.description && <p className="text-xs font-body text-muted-foreground mt-0.5">{plan.description}</p>}
                    {plan.features.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {plan.features.map((f, i) => (
                          <li key={i} className="flex items-center gap-1.5 text-[11px] font-body text-muted-foreground">
                            <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" /> {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                ))}
              </div>
              {showPlanPurchase && selectedPlan && (
                <div className="space-y-3 p-3 rounded-lg bg-secondary/50 border border-border/40">
                  <p className="text-xs font-body text-muted-foreground font-medium">Your details</p>
                  <Input value={buyerName} onChange={e => setBuyerName(e.target.value)} placeholder="Your name" className="bg-background border-border text-foreground font-body text-sm h-8" />
                  <Input type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} placeholder="Your email address *" className="bg-background border-border text-foreground font-body text-sm h-8" />
                  {showPlanPaymentOptions ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button size="sm" onClick={handlePlanStripeCheckout} disabled={planCheckoutLoading || !buyerEmail} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
                        <CreditCard className="w-3.5 h-3.5" /> {planCheckoutLoading ? "Redirecting…" : "Pay by Card"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={handlePlanBankPurchase} disabled={planCheckoutLoading || !buyerEmail} className="gap-2 font-body text-xs tracking-wider uppercase border-border">
                        <DollarSign className="w-3.5 h-3.5" /> Pay by Bank Transfer
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowPlanPaymentOptions(false)} className="font-body text-xs text-muted-foreground">
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" onClick={() => setShowPlanPaymentOptions(true)} disabled={!buyerEmail} className="gap-2 bg-primary text-primary-foreground font-body text-xs tracking-wider uppercase">
                      <CreditCard className="w-3.5 h-3.5" /> Purchase {selectedPlan.name} — {new Intl.NumberFormat("en-AU", { style: "currency", currency: selectedPlan.currency || "AUD" }).format(selectedPlan.price)}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
