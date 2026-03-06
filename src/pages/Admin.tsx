import React, { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Calendar, Settings, Plus, Upload,
  Trash2, Edit, Users, Clock, CreditCard, Building2,
  Camera, Save, X, LogOut, ChevronDown, ChevronUp,
  Image, DollarSign, Link2, Merge, Send, Copy, ExternalLink,
  MapPin, Lock, Bell, Download, Unlock, Eye, Grid, List, LayoutGrid, HardDrive, CheckSquare, XSquare, Search, RefreshCw, Mail,
  MessageSquare
, Star, CheckCircle2, Sparkles, ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import {
  getProfile, setProfile, getEventTypes, setEventTypes, addEventType,
  deleteEventType, updateEventType, getBookings, deleteBooking,
  updateBooking, getSettings, setSettings, logout, isLoggedIn, isSetupComplete,
  getAlbums, addAlbum, updateAlbum, deleteAlbum,
  getPhotoLibrary, setPhotoLibrary,
  getEmailTemplates, addEmailTemplate, updateEmailTemplate, deleteEmailTemplate,
} from "@/lib/storage";
import { compressImage, formatBytes, getLocalStorageUsage, generateThumbnail } from "@/lib/image-utils";
import { uploadPhotosToServer, isServerMode, deletePhotoFromServer, getGoogleCalendarStatus, startGoogleCalendarAuth, disconnectGoogleCalendar, getGoogleCalendars, syncAllBookingsToCalendar, syncBookingToCalendar, getServerStorageStats, syncFromServer, sendEmail, bulkDeleteFiles, syncBookingsToSheet, getBookingEmailLog, sendBookingReminder, sendCustomEmail, getWaitlistEntries, deleteWaitlistEntry, notifyWaitlistOnCancel, notifyDiscord, getCacheStats } from "@/lib/api";
import type { CacheBreakdown } from "@/lib/api";
import RichTextEditor, { RichTextDisplay } from "@/components/RichTextEditor";
import Login from "@/pages/Login";
import type {
  EventType, QuestionField, AvailabilitySlot,
  ProfileSettings, AppSettings, Booking, WatermarkPosition,
  Album, Photo, PaymentStatus, AlbumDisplaySize, AlbumDownloadRecord, DownloadHistoryEntry,
  EmailTemplate, WaitlistEntry,
} from "@/lib/types";
import WatermarkedImage from "@/components/WatermarkedImage";
import ProgressiveImg from "@/components/ProgressiveImg";
import { useBackfillThumbnails } from "@/hooks/use-backfill-thumbnails";
import { Slider } from "@/components/ui/slider";
import sampleLandscape from "@/assets/sample-landscape.jpg";
import samplePortrait from "@/assets/sample-portrait.jpg";
import sampleWedding from "@/assets/sample-wedding.jpg";
import sampleEvent from "@/assets/sample-event.jpg";
import sampleFood from "@/assets/sample-food.jpg";

type Tab = "dashboard" | "bookings" | "events" | "albums" | "photos" | "finance" | "profile" | "settings" | "storage";

const TAB_ROUTE_MAP: Record<string, Tab> = {
  dashboard: "dashboard",
  bookings: "bookings",
  events: "events",
  albums: "albums",
  photos: "photos",
  finance: "finance",
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

const WATERMARK_REBUILD_STATUS_KEY = "wm_rebuild_status_v1";

type WatermarkRebuildStatus = {
  running: boolean;
  mode: "save" | "missing" | "all" | null;
  done: number;
  total: number;
  stage: string;
  updatedAt: string;
};

function readWatermarkRebuildStatus(): WatermarkRebuildStatus {
  try {
    const raw = localStorage.getItem(WATERMARK_REBUILD_STATUS_KEY);
    if (!raw) return { running: false, mode: null, done: 0, total: 0, stage: "", updatedAt: "" };
    const parsed = JSON.parse(raw);
    return {
      running: !!parsed.running,
      mode: parsed.mode ?? null,
      done: Number(parsed.done || 0),
      total: Number(parsed.total || 0),
      stage: String(parsed.stage || ""),
      updatedAt: String(parsed.updatedAt || ""),
    };
  } catch {
    return { running: false, mode: null, done: 0, total: 0, stage: "", updatedAt: "" };
  }
}

function writeWatermarkRebuildStatus(status: Partial<WatermarkRebuildStatus>) {
  const next = { ...readWatermarkRebuildStatus(), ...status, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(WATERMARK_REBUILD_STATUS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("wm-rebuild-status"));
  } catch {}
}

function stripWmParam(src: string): string {
  return (src || "").replace(/([?&])wm=0(?=&|$)/g, "$1").replace(/[?&]$/, "");
}

/** Returns a human-readable description of how many cache files were cleared. */
function formatClearedMsg(cleared: number | null | undefined): string {
  if (cleared == null) return "";
  return ` — ${cleared} cached file${cleared !== 1 ? "s" : ""} removed`;
}

type WatermarkBakeSettings = Pick<AppSettings, "watermarkText" | "watermarkImage" | "watermarkPosition" | "watermarkOpacity" | "watermarkSize"> & {
  watermarkVersion?: number;
};

type BakedAssetKind = "thumbnail" | "medium" | "full";

function photoNeedsBakedRefresh(photo: Photo, settings: WatermarkBakeSettings, forceAll = false): boolean {
  if (forceAll) return true;
  const p = photo as any;
  const version = settings.watermarkVersion ?? 0;
  return !p.thumbnailWatermarked || !p.mediumWatermarked || !p.fullWatermarked || p.watermarkVersion !== version;
}

async function loadImageFromSrc(src: string): Promise<HTMLImageElement> {
  const response = await fetch(stripWmParam(src));
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  return await new Promise((resolve, reject) => {
    const img = document.createElement("img") as HTMLImageElement;
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

async function loadOptionalImage(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  return await new Promise((resolve) => {
    const img = document.createElement("img") as HTMLImageElement;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function computeWatermarkRect(
  position: WatermarkPosition,
  canvasWidth: number,
  canvasHeight: number,
  drawWidth: number,
  drawHeight: number,
) {
  const padX = Math.max(16, canvasWidth * 0.03);
  const padY = Math.max(16, canvasHeight * 0.03);

  switch (position) {
    case "top-left":
      return { x: padX, y: padY };
    case "top-right":
      return { x: canvasWidth - drawWidth - padX, y: padY };
    case "bottom-left":
      return { x: padX, y: canvasHeight - drawHeight - padY };
    case "bottom-right":
      return { x: canvasWidth - drawWidth - padX, y: canvasHeight - drawHeight - padY };
    case "center":
    default:
      return { x: (canvasWidth - drawWidth) / 2, y: (canvasHeight - drawHeight) / 2 };
  }
}

async function bakeWatermarkedAsset(
  src: string,
  settings: WatermarkBakeSettings,
  kind: BakedAssetKind,
): Promise<string> {
  const baseImg = await loadImageFromSrc(src);
  const watermarkImg = await loadOptionalImage(settings.watermarkImage || undefined);

  const kindConfig: Record<BakedAssetKind, { maxSide: number; targetBytes: number; quality: number }> = {
    thumbnail: { maxSide: 700, targetBytes: 180 * 1024, quality: 0.82 },
    medium: { maxSide: 2200, targetBytes: 600 * 1024, quality: 0.86 },
    full: { maxSide: 3600, targetBytes: 1600 * 1024, quality: 0.9 },
  };

  const cfg = kindConfig[kind];
  const scale = Math.min(1, cfg.maxSide / Math.max(baseImg.width, baseImg.height));
  const width = Math.max(1, Math.round(baseImg.width * scale));
  const height = Math.max(1, Math.round(baseImg.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");

  ctx.drawImage(baseImg, 0, 0, width, height);

  const opacity = Math.max(0.05, Math.min(0.95, (settings.watermarkOpacity ?? 15) / 100));
  const sizePct = Math.max(10, Math.min(100, settings.watermarkSize ?? 40));
  const position = settings.watermarkPosition ?? "center";
  const shortSide = Math.min(width, height);

  ctx.save();
  ctx.globalAlpha = opacity;

  if (position === "tiled") {
    ctx.translate(width / 2, height / 2);
    ctx.rotate((-30 * Math.PI) / 180);
    ctx.translate(-width / 2, -height / 2);

    const stepX = Math.max(140, width * 0.18);
    const stepY = Math.max(110, height * 0.16);

    if (watermarkImg) {
      const tileH = Math.max(24, shortSide * (sizePct / 100) * 0.18);
      const tileW = watermarkImg.width * (tileH / watermarkImg.height);
      for (let y = -height * 0.4; y < height * 1.4; y += stepY) {
        for (let x = -width * 0.4; x < width * 1.4; x += stepX) {
          ctx.drawImage(watermarkImg, x, y, tileW, tileH);
        }
      }
    } else {
      ctx.fillStyle = "white";
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = Math.max(1, shortSide * 0.002);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `600 ${Math.max(18, shortSide * (sizePct / 100) * 0.055)}px serif`;
      const text = settings.watermarkText || "ZACMPHOTOS";
      for (let y = -height * 0.4; y < height * 1.4; y += stepY) {
        for (let x = -width * 0.4; x < width * 1.4; x += stepX) {
          ctx.strokeText(text, x, y);
          ctx.fillText(text, x, y);
        }
      }
    }
  } else if (watermarkImg) {
    const drawWidth = Math.max(80, width * (sizePct / 100) * (position === "center" ? 0.55 : 0.3));
    const drawHeight = drawWidth * (watermarkImg.height / watermarkImg.width);
    const rect = computeWatermarkRect(position, width, height, drawWidth, drawHeight);
    if (position === "center") {
      ctx.translate(width / 2, height / 2);
      ctx.rotate((-30 * Math.PI) / 180);
      ctx.drawImage(watermarkImg, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    } else {
      ctx.drawImage(watermarkImg, rect.x, rect.y, drawWidth, drawHeight);
    }
  } else {
    const text = settings.watermarkText || "ZACMPHOTOS";
    const fontSize = Math.max(20, shortSide * (sizePct / 100) * (position === "center" ? 0.08 : 0.05));
    ctx.font = `600 ${fontSize}px serif`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "white";
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = Math.max(1, fontSize * 0.08);

    const metrics = ctx.measureText(text);
    const drawWidth = metrics.width;
    const drawHeight = fontSize;
    const rect = computeWatermarkRect(position, width, height, drawWidth, drawHeight);

    if (position === "center") {
      ctx.translate(width / 2, height / 2);
      ctx.rotate((-30 * Math.PI) / 180);
      ctx.strokeText(text, -drawWidth / 2, -drawHeight / 2);
      ctx.fillText(text, -drawWidth / 2, -drawHeight / 2);
    } else {
      ctx.strokeText(text, rect.x, rect.y);
      ctx.fillText(text, rect.x, rect.y);
    }
  }

  ctx.restore();

  let quality = cfg.quality;
  let out = canvas.toDataURL("image/jpeg", quality);
  while ((out.length * 0.75) > cfg.targetBytes && quality > 0.45) {
    quality -= 0.05;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

function persistPhotoVariants(photoId: string, patch: Record<string, any>) {
  const currentLibrary = getPhotoLibrary();
  setPhotoLibrary(currentLibrary.map((photo) => photo.id === photoId ? ({ ...photo, ...patch }) : photo));

  const currentAlbums = getAlbums();
  for (const album of currentAlbums) {
    if (!album.photos.some((photo) => photo.id === photoId)) continue;
    updateAlbum({
      ...album,
      photos: album.photos.map((photo) => photo.id === photoId ? ({ ...photo, ...patch }) : photo),
    });
  }
}

async function rebuildWatermarkedAssets(
  settings: WatermarkBakeSettings,
  forceAll: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<{ success: number; failed: number; total: number }> {
  const version = settings.watermarkVersion ?? 0;
  const currentAlbums = getAlbums();
  const currentLibrary = getPhotoLibrary();
  const photos = Array.from(new Map([...currentLibrary, ...currentAlbums.flatMap((album) => album.photos)].map((photo) => [photo.id, photo])).values()) as Photo[];
  const targets = forceAll ? photos : photos.filter((photo) => photoNeedsBakedRefresh(photo, settings, false));

  let success = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += 1) {
    const photo = targets[i];
    try {
      const [thumbnailWatermarked, mediumWatermarked, fullWatermarked] = await Promise.all([
        bakeWatermarkedAsset(photo.src, settings, "thumbnail"),
        bakeWatermarkedAsset(photo.src, settings, "medium"),
        bakeWatermarkedAsset(photo.src, settings, "full"),
      ]);
      persistPhotoVariants(photo.id, {
        thumbnailWatermarked,
        mediumWatermarked,
        fullWatermarked,
        watermarkVersion: version,
        watermarkUpdatedAt: new Date().toISOString(),
      });
      success += 1;
    } catch {
      failed += 1;
    }
    onProgress?.(i + 1, targets.length);
  }

  return { success, failed, total: targets.length };
}

export default function Admin() {
  const navigate = useNavigate();
  const { tab: routeTab } = useParams<{ tab?: string }>();
  const resolvedTab = (routeTab && TAB_ROUTE_MAP[routeTab]) || "dashboard";
  const [activeTab, setActiveTabState] = useState<Tab>(resolvedTab);
  const [authed, setAuthed] = useState(() => isLoggedIn());
  const [prefillBookingId, setPrefillBookingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSetupComplete()) navigate("/setup", { replace: true });
  }, [navigate]);

  if (!isSetupComplete()) return null;
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    navigate(`/admin/${tab}`, { replace: true });
  };

  const handleLogout = () => {
    logout();
    navigate("/admin");
  };

  // Needed for tab badges and nav-level UI
  const settings = getSettings();
  const albums = getAlbums();
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
    { id: "finance" as Tab, label: "Finance", icon: DollarSign },
    { id: "profile" as Tab, label: "Profile", icon: Camera },
    { id: "settings" as Tab, label: "Settings", icon: Settings },
    { id: "storage" as Tab, label: "Storage", icon: HardDrive },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <aside className="w-56 fixed left-0 top-0 bottom-0 border-r border-border bg-card/50 p-4 hidden lg:flex flex-col" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
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
                {tab.id === "albums" && (() => {
                  const pending = settings.proofingEnabled ? albums.filter(a => a.proofingEnabled && a.proofingStage === "selections-submitted").length : 0;
                  return pending > 0 ? <span className="ml-auto bg-orange-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{pending}</span> : null;
                })()}
              </button>
            ))}
          </nav>
          <div className="mt-auto space-y-1">
            <button onClick={() => navigate("/capture")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body text-primary hover:bg-primary/10 transition-all">
              <Upload className="w-4 h-4" />Capture
            </button>
            <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
              <LogOut className="w-4 h-4" />Logout
            </button>
          </div>
        </aside>

        <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-card/95 backdrop-blur-sm border-b border-border" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <div className="flex overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-3.5 min-h-[48px] text-[10px] font-body tracking-wider uppercase whitespace-nowrap transition-colors border-b-2 flex-shrink-0 ${
                  activeTab === tab.id ? "text-primary border-primary" : "text-muted-foreground border-transparent"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />{tab.label}
              </button>
            ))}
          </div>
        </div>

        <main className="flex-1 lg:ml-56 p-4 sm:p-6 lg:p-8 lg:pt-8" style={{ paddingTop: "calc(env(safe-area-inset-top) + 4.5rem)" }}>
          {activeTab === "dashboard" && <DashboardView />}
          {activeTab === "bookings" && <BookingsView onCreateAlbum={handleCreateAlbumForBooking} />}
          {activeTab === "events" && <EventTypesView />}
          {activeTab === "albums" && <AlbumsView prefillBookingId={prefillBookingId} onClearPrefill={() => setPrefillBookingId(null)} />}
          {activeTab === "photos" && <PhotosView />}
          {activeTab === "finance" && <FinanceView />}
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
  const depositPaidIncome = bookings.filter(b => b.paymentStatus === "deposit-paid").reduce((sum, b) => sum + (b.depositAmount || 0), 0);
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
    const req = updated.downloadRequests![reqIdx];
    updated.downloadRequests = updated.downloadRequests!.map((r, i) =>
      i === reqIdx ? { ...r, status: "approved" as const, approvedAt: new Date().toISOString() } : r
    );
    if (req?.photoIds?.length) {
      const existing = updated.paidPhotoIds || [];
      updated.paidPhotoIds = [...new Set([...existing, ...req.photoIds])];
    }
    updateAlbum(updated);
    toast.success("Download request approved — client can now download");
  };

  const totalSessionMins = bookings.reduce((sum, b) => sum + (b.duration || 0), 0);
  const totalSessionHours = Math.floor(totalSessionMins / 60);
  const totalSessionRemMins = totalSessionMins % 60;
  const totalSessionLabel = totalSessionHours > 0
    ? (totalSessionRemMins > 0 ? `${totalSessionHours}h ${totalSessionRemMins}m` : `${totalSessionHours}h`)
    : `${totalSessionMins}m`;

  const todayDateStr = new Date().toISOString().split("T")[0];
  const upcomingBookings = bookings
    .filter(b => b.status !== "cancelled" && b.date >= todayDateStr)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const recentPastBookings = bookings
    .filter(b => b.date < todayDateStr)
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
    .slice(0, 5); // last 5 past sessions

  const stats = [
    { label: "Total Bookings", value: bookings.length, icon: Calendar, color: "text-primary" },
    { label: "Paid", value: `$${paidIncome}`, icon: DollarSign, color: "text-green-400" },
    { label: "Unpaid", value: `$${unpaidIncome}`, icon: DollarSign, color: "text-destructive" },
    { label: "Pending Requests", value: allPendingRequests.length, icon: Download, color: "text-yellow-400" },
    { label: "Session Time", value: totalSessionLabel, icon: Clock, color: "text-blue-400" },
  ];

  // ── Booking Calendar ────────────────────────────────────────
  const [calView, setCalView] = useState<"month" | "week">("month");
  const [calDate, setCalDate] = useState(() => new Date());
  const [calSelectedDay, setCalSelectedDay] = useState<string | null>(null);
  const eventTypes = getEventTypes();
  const etColorMap: Record<string, string> = {};
  for (const et of eventTypes) etColorMap[et.id] = et.color || "#7c3aed";

  const bookingsByDate: Record<string, typeof bookings> = {};
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    if (!bookingsByDate[b.date]) bookingsByDate[b.date] = [];
    bookingsByDate[b.date].push(b);
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = toDateStr(new Date());

  // Month view: grid of weeks
  const monthStart = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
  const monthEnd = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7)); // Mon start
  const gridDays: Date[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= monthEnd || gridDays.length % 7 !== 0) {
    gridDays.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    if (gridDays.length > 42) break;
  }

  // Week view: 7 days from Mon of current week
  const weekStart = new Date(calDate);
  weekStart.setDate(calDate.getDate() - ((calDate.getDay() + 6) % 7));
  const weekDays: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const prevPeriod = () => {
    const d = new Date(calDate);
    calView === "month" ? d.setMonth(d.getMonth() - 1) : d.setDate(d.getDate() - 7);
    setCalDate(d);
  };
  const nextPeriod = () => {
    const d = new Date(calDate);
    calView === "month" ? d.setMonth(d.getMonth() + 1) : d.setDate(d.getDate() + 7);
    setCalDate(d);
  };
  const goToday = () => { setCalDate(new Date()); setCalSelectedDay(todayStr); };

  const selectedDayBookings = calSelectedDay ? (bookingsByDate[calSelectedDay] || []) : [];

  const monthLabel = calDate.toLocaleString("en-AU", { month: "long", year: "numeric" });
  const weekLabel = `${weekDays[0].toLocaleString("en-AU", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

  const renderDayCell = (day: Date, isCurrentMonth = true) => {
    const ds = toDateStr(day);
    const dayBookings = bookingsByDate[ds] || [];
    const isToday = ds === todayStr;
    const isSelected = ds === calSelectedDay;
    return (
      <div
        key={ds}
        onClick={() => setCalSelectedDay(calSelectedDay === ds ? null : ds)}
        className={`min-h-[72px] p-1.5 rounded-lg cursor-pointer transition-colors border ${
          isSelected ? "border-primary/60 bg-primary/10" :
          isToday ? "border-primary/30 bg-primary/5" :
          "border-transparent hover:bg-secondary/60"
        } ${!isCurrentMonth ? "opacity-35" : ""}`}
      >
        <p className={`text-[11px] font-body mb-1 w-5 h-5 flex items-center justify-center rounded-full ${
          isToday ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground"
        }`}>{day.getDate()}</p>
        <div className="space-y-0.5">
          {dayBookings.slice(0, 3).map(b => (
            <div key={b.id} className="flex items-center gap-1 overflow-hidden">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: etColorMap[b.eventTypeId] || "#7c3aed" }} />
              <p className="text-[9px] font-body truncate leading-tight" style={{ color: etColorMap[b.eventTypeId] || "#a78bfa" }}>
                {b.time} {b.clientName?.split(" ")[0]}
              </p>
            </div>
          ))}
          {dayBookings.length > 3 && (
            <p className="text-[9px] font-body text-muted-foreground/60">+{dayBookings.length - 3} more</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg sm:text-2xl text-foreground">Dashboard</h2>
        <Button onClick={() => window.location.href = "/capture"} className="gap-2 font-body text-sm h-9 px-3">
          <Upload className="w-4 h-4" /><span className="hidden sm:inline">Capture</span>
        </Button>
      </div>

      {/* ── Stats grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-panel rounded-xl p-3 sm:p-5">
            <stat.icon className={`w-4 h-4 ${stat.color} mb-2`} />
            <p className="font-display text-xl sm:text-2xl text-foreground">{stat.value}</p>
            <p className="text-[10px] font-body text-muted-foreground tracking-wider uppercase mt-0.5 leading-tight">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Booking Calendar ── */}
      <div className="glass-panel rounded-xl p-4 mb-6">
        {/* Calendar header */}
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button onClick={prevPeriod} className="w-7 h-7 rounded-lg bg-secondary hover:bg-secondary/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="font-display text-sm text-foreground min-w-[160px] text-center">
              {calView === "month" ? monthLabel : weekLabel}
            </p>
            <button onClick={nextPeriod} className="w-7 h-7 rounded-lg bg-secondary hover:bg-secondary/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={goToday} className="text-[10px] font-body px-2.5 py-1 rounded-full bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors">Today</button>
            {(["month", "week"] as const).map(v => (
              <button key={v} onClick={() => setCalView(v)} className={`text-[10px] font-body px-2.5 py-1 rounded-full transition-colors capitalize ${calView === v ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>{v}</button>
            ))}
          </div>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
            <p key={d} className="text-[10px] font-body text-center text-muted-foreground/50 tracking-wider uppercase py-1">{d}</p>
          ))}
        </div>

        {/* Month grid */}
        {calView === "month" && (
          <div className="grid grid-cols-7 gap-1">
            {gridDays.map(day => renderDayCell(day, day.getMonth() === calDate.getMonth()))}
          </div>
        )}

        {/* Week grid */}
        {calView === "week" && (
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map(day => renderDayCell(day, true))}
          </div>
        )}

        {/* Selected day detail */}
        {calSelectedDay && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-xs font-body text-muted-foreground mb-2">
              {new Date(calSelectedDay + "T12:00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
              {selectedDayBookings.length === 0 && <span className="ml-2 text-muted-foreground/50">— no bookings</span>}
            </p>
            <div className="space-y-1.5">
              {selectedDayBookings
                .slice()
                .sort((a, b) => a.time.localeCompare(b.time))
                .map(b => (
                  <div key={b.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-secondary/50">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: etColorMap[b.eventTypeId] || "#7c3aed" }} />
                    <p className="text-xs font-body text-muted-foreground w-10 shrink-0">{b.time}</p>
                    <p className="text-xs font-body text-foreground font-medium truncate flex-1">{b.clientName}</p>
                    <p className="text-xs font-body text-muted-foreground shrink-0">{b.duration}m</p>
                    <span className={`text-[9px] font-body px-1.5 py-0.5 rounded-full shrink-0 ${
                      b.status === "confirmed" ? "bg-primary/10 text-primary" :
                      b.status === "completed" ? "bg-green-500/10 text-green-400" :
                      b.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
                      "bg-destructive/10 text-destructive"
                    }`}>{b.status}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Pending Download Requests ── */}
      {allPendingRequests.length > 0 && (
        <>
          <h3 className="font-display text-base text-foreground mb-3 flex items-center gap-2">
            <Download className="w-4 h-4 text-yellow-400" /> Pending Requests
          </h3>
          <div className="space-y-2 mb-6">
            {allPendingRequests.map((req, i) => (
              <div key={i} className="glass-panel rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-body text-foreground font-medium truncate">{req._albumTitle}</p>
                  <p className="text-xs font-body text-muted-foreground">
                    {req.photoIds.length} photos · {req.method} · {new Date(req.requestedAt).toLocaleDateString()}
                  </p>
                  {req.clientNote && <p className="text-xs font-body text-muted-foreground mt-0.5 italic">"{req.clientNote}"</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => handleApproveRequest(req._albumId, req._reqIdx)}
                  className="gap-1 text-xs font-body border-green-500/30 text-green-400 hover:bg-green-500/10 flex-shrink-0 h-8">
                  <Unlock className="w-3 h-3" /> Approve
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Album Download Stats — card list on mobile, table on md+ ── */}
      {albumDownloadStats.length > 0 && (
        <>
          <h3 className="font-display text-base text-foreground mb-3 flex items-center gap-2">
            <Image className="w-4 h-4 text-primary" /> Album Stats
          </h3>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2 mb-6">
            {albumDownloadStats.map(a => (
              <div key={a.id} className="glass-panel rounded-xl p-3">
                <p className="text-sm font-body text-foreground font-medium truncate mb-2">{a.title}</p>
                <div className="flex gap-4 text-xs font-body">
                  <span className="text-muted-foreground">{a.totalPhotos} <span className="text-muted-foreground/50">photos</span></span>
                  <span className="text-primary font-medium">{a.totalDownloaded} <span className="text-muted-foreground/50">dl</span></span>
                  <span className="text-muted-foreground">{a.sessions} <span className="text-muted-foreground/50">sessions</span></span>
                  {a.lastDownload && <span className="text-muted-foreground/60">{new Date(a.lastDownload).toLocaleDateString()}</span>}
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block glass-panel rounded-xl overflow-hidden mb-6">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Album","Photos","Downloads","Sessions","Last Download"].map(h => (
                    <th key={h} className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">{h}</th>
                  ))}
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
        </>
      )}

      {/* ── Upcoming Bookings — compact cards on mobile, table on md+ ── */}
      {upcomingBookings.length > 0 && (
        <>
          <h3 className="font-display text-base text-foreground mb-3">Upcoming Bookings</h3>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2 mb-6">
            {upcomingBookings.map((b) => (
              <div key={b.id} className="glass-panel rounded-xl p-3">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-sm font-body text-foreground font-medium truncate">{b.clientName}</p>
                    {b.instagramHandle && <p className="text-xs font-body text-primary">@{b.instagramHandle.replace("@","")}</p>}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    <span className={`text-[9px] font-body tracking-wider uppercase px-1.5 py-0.5 rounded-full ${
                      b.paymentStatus === "paid" ? "bg-green-500/10 text-green-400" :
                      b.paymentStatus === "cash" ? "bg-yellow-500/10 text-yellow-400" :
                      b.paymentStatus === "pending-confirmation" ? "bg-blue-500/10 text-blue-400" :
                      "bg-destructive/10 text-destructive"
                    }`}>{b.paymentStatus || "unpaid"}</span>
                    <span className={`text-[9px] font-body tracking-wider uppercase px-1.5 py-0.5 rounded-full ${
                      b.status === "completed" ? "bg-green-500/10 text-green-400" :
                      b.status === "confirmed" ? "bg-primary/10 text-primary" :
                      b.status === "pending" ? "bg-yellow-500/10 text-yellow-400" :
                      "bg-destructive/10 text-destructive"
                    }`}>{b.status}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs font-body text-muted-foreground">
                  <span>{b.type}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{b.date} {b.time}</span>
                  {(b.paymentAmount || 0) > 0 && <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-foreground">${b.paymentAmount}</span>
                  </>}
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block glass-panel rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Client</th>
                    {settings.instagramFieldEnabled && <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Instagram</th>}
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Type</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Date & Time</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Amount</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Deposit</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Payment</th>
                    <th className="text-left text-[10px] font-body tracking-wider uppercase text-muted-foreground p-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingBookings.map((b) => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="p-4 text-sm font-body text-foreground">{b.clientName}</td>
                      {settings.instagramFieldEnabled && <td className="p-4 text-sm font-body text-muted-foreground">{b.instagramHandle || "—"}</td>}
                      <td className="p-4 text-sm font-body text-muted-foreground">{b.type}</td>
                      <td className="p-4 text-sm font-body text-muted-foreground">{b.date} {b.time}</td>
                      <td className="p-4 text-sm font-body text-foreground">${b.paymentAmount || 0}</td>
                      <td className="p-4">
                        {b.depositRequired ? (
                          <span className={`text-xs font-body px-2 py-0.5 rounded-full ${b.depositPaidAt ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                            ${b.depositAmount || 0} {b.depositPaidAt ? "✓ Paid" : `(${b.depositMethod || "pending"})`}
                          </span>
                        ) : <span className="text-xs font-body text-muted-foreground/50">—</span>}
                      </td>
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

      {/* ── Recent Past Bookings ── */}
      {recentPastBookings.length > 0 && (
        <>
          <h3 className="font-display text-base text-foreground mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground/50" /> Recent Past
          </h3>
          <div className="space-y-2 mb-6">
            {recentPastBookings.map(b => (
              <div key={b.id} className="glass-panel rounded-xl p-3 opacity-60">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-body text-foreground font-medium truncate">{b.clientName}</p>
                    <p className="text-xs font-body text-muted-foreground">{b.date} · {b.time} · {b.type}</p>
                  </div>
                  <span className={`text-[9px] font-body px-1.5 py-0.5 rounded-full shrink-0 ${
                    b.status === "completed" ? "bg-green-500/10 text-green-400" :
                    b.status === "cancelled" ? "bg-destructive/10 text-destructive" :
                    "bg-primary/10 text-primary"
                  }`}>{b.status}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}
// ─── Bookings ────────────────────────────────────────
type BookingSortKey = "date" | "name" | "type" | "instagram" | "status" | "payment" | "booked";
type AlbumSortKey = "date" | "name" | "photos" | "client";
type SortDir = "asc" | "desc";

function BookingsView({ onCreateAlbum }: { onCreateAlbum?: (bookingId: string) => void }) {
  const [bookings, setBookingsState] = useState<Booking[]>(getBookings());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetsSyncing, setSheetsSyncing] = useState(false);
  const [sortKey, setSortKey] = useState<BookingSortKey>("date");

  // Waitlist state
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(false);

  useEffect(() => {
    getWaitlistEntries().then(r => setWaitlist(r.entries || []));
  }, []);

  const handleRemoveWaitlistEntry = async (id: string) => {
    await deleteWaitlistEntry(id);
    setWaitlist(prev => prev.filter(e => e.id !== id));
    toast.success("Removed from waitlist");
  };

  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [bookingSearch, setBookingSearch] = useState("");
  const [emailLogs, setEmailLogs] = useState<Record<string, { id: string; type: string; sentAt: string; openedAt?: string; subject: string; to: string }[]>>({});
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [customEmailTarget, setCustomEmailTarget] = useState<string | null>(null);
  const [customEmailSubject, setCustomEmailSubject] = useState("");
  const [customEmailBody, setCustomEmailBody] = useState("");
  const [sendingCustomEmail, setSendingCustomEmail] = useState(false);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [selectedBookingIds, setSelectedBookingIds] = useState<Set<string>>(new Set());
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkEmailSubject, setBulkEmailSubject] = useState("");
  const [bulkEmailBody, setBulkEmailBody] = useState("");
  const [sendingBulkEmail, setSendingBulkEmail] = useState(false);
  const [showBulkPreview, setShowBulkPreview] = useState(false);
  const [bulkEmailProgress, setBulkEmailProgress] = useState<{ sent: number; total: number } | null>(null);
  const emailTemplates = getEmailTemplates();
  const settings = getSettings();
  const eventTypes = getEventTypes();

  const fetchEmailLog = async (bookingId: string) => {
    const log = await getBookingEmailLog(bookingId);
    setEmailLogs(prev => ({ ...prev, [bookingId]: log }));
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this booking?")) return;
    deleteBooking(id);
    setBookingsState(getBookings());
    toast.success("Booking deleted");
  };

  const handleStatusChange = (bk: Booking, status: Booking["status"]) => {
    const updated = { ...bk, status };
    updateBooking(updated);
    setBookingsState(getBookings());
    toast.success(`Booking ${status}`);
    // Discord notification
    notifyDiscord({ type: "booking-update", booking: updated, oldStatus: bk.status, newStatus: status }).catch(() => {});
    // Push status change to Google Calendar (updates event color)
    if (bk.gcalEventId || status !== "cancelled") {
      syncBookingToCalendar(updated).then(res => {
        if (res?.eventId) updateBooking({ ...updated, gcalEventId: res.eventId });
      }).catch(() => {});
    }
    // If cancelled, check waitlist and notify anyone waiting for this slot
    if (status === "cancelled") {
      notifyWaitlistOnCancel(updated).catch(() => {});
    }
  };

  const handlePaymentChange = async (bk: Booking, paymentStatus: PaymentStatus) => {
    updateBooking({ ...bk, paymentStatus });
    setBookingsState(getBookings());
    toast.success(`Payment marked as ${paymentStatus}`);
  };

  const handleSheetsSync = async () => {
    setSheetsSyncing(true);
    const result = await syncBookingsToSheet(bookings, getEventTypes());
    setSheetsSyncing(false);
    if (result.ok && result.url) {
      toast.success(`Synced ${result.rows} bookings to Google Sheets (${result.columns || ""} columns)`);
      window.open(result.url, "_blank");
    } else if (result.needsReauth) {
      toast.error("Please reconnect Google (Settings → Google Calendar) to grant Sheets permission");
    } else {
      toast.error(result.error || "Failed to sync to Sheets");
    }
  };

  const toggleSort = (key: BookingSortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "date" ? "desc" : "asc"); }
  };

  const filteredBookings = bookings.filter(bk => {
    if (!bookingSearch) return true;
    const q = bookingSearch.toLowerCase();
    return (bk.clientName || "").toLowerCase().includes(q)
      || (bk.clientEmail || "").toLowerCase().includes(q)
      || (bk.instagramHandle || "").toLowerCase().includes(q)
      || (bk.type || "").toLowerCase().includes(q)
      || (bk.status || "").toLowerCase().includes(q)
      || (bk.date || "").includes(q)
      || (bk.notes || "").toLowerCase().includes(q)
      || (bk.createdAt ? new Date(bk.createdAt).toLocaleDateString("en-AU") : "").includes(q);
  });

  const sortedBookings = [...filteredBookings].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "date": return dir * ((new Date(`${a.date}T${a.time || "00:00"}:00`).getTime()) - (new Date(`${b.date}T${b.time || "00:00"}:00`).getTime()));
      case "name": return dir * (a.clientName || "").localeCompare(b.clientName || "");
      case "type": return dir * (a.type || "").localeCompare(b.type || "");
      case "instagram": return dir * (a.instagramHandle || "").localeCompare(b.instagramHandle || "");
      case "status": return dir * (a.status || "").localeCompare(b.status || "");
      case "payment": return dir * (a.paymentStatus || "").localeCompare(b.paymentStatus || "");
      case "booked": return dir * (new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
      default: return 0;
    }
  });

  const SortBtn = ({ k, label }: { k: BookingSortKey; label: string }) => (
    <button onClick={() => toggleSort(k)} className={`text-[10px] font-body tracking-wider uppercase px-2 py-1 rounded transition-colors ${sortKey === k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
      {label} {sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </button>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>

      {/* ── Waitlist panel ── */}
      {waitlist.length > 0 && (
        <div className="glass-panel rounded-xl p-4 mb-5 border border-primary/10">
          <button
            onClick={() => setShowWaitlist(!showWaitlist)}
            className="flex items-center justify-between w-full"
          >
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <span className="text-sm font-display text-foreground">Waitlist</span>
              <span className="bg-primary/15 text-primary text-[10px] font-body px-2 py-0.5 rounded-full">{waitlist.length}</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showWaitlist ? "rotate-180" : ""}`} />
          </button>
          {showWaitlist && (
            <div className="mt-3 space-y-2">
              {waitlist
                .slice()
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map(entry => (
                  <div key={entry.id} className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-secondary/50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-body text-foreground font-medium">{entry.clientName}</p>
                        <p className="text-xs font-body text-muted-foreground">{entry.clientEmail}</p>
                        {entry.notifiedAt && (
                          <span className="text-[9px] font-body bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded-full">Notified</span>
                        )}
                      </div>
                      <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">
                        {entry.eventTypeTitle} · {new Date(entry.date + "T12:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                        {entry.note && ` · "${entry.note}"`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveWaitlistEntry(entry.id)}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0 mt-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h2 className="font-display text-2xl text-foreground">Bookings</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {bookings.length > 0 && (
            <>
              <Button size="sm" variant={selectMode ? "default" : "outline"}
                onClick={() => { setSelectMode(!selectMode); setSelectedBookingIds(new Set()); setBulkEmailOpen(false); }}
                className="gap-1.5 font-body text-xs">
                <CheckSquare className="w-3.5 h-3.5" />
                {selectMode ? "Cancel" : "Select"}
              </Button>
              {selectMode && (
                <Button size="sm" variant="outline" onClick={() => {
                  const allIds = new Set(sortedBookings.filter(b => b.clientEmail).map(b => b.id));
                  setSelectedBookingIds(prev => prev.size === allIds.size ? new Set() : allIds);
                }} className="gap-1.5 font-body text-xs">
                  {selectedBookingIds.size === sortedBookings.filter(b => b.clientEmail).length ? "Deselect All" : "Select All"}
                </Button>
              )}
            </>
          )}
          {selectedBookingIds.size > 0 && isServerMode() && (
            <Button size="sm" variant="outline" onClick={() => setBulkEmailOpen(!bulkEmailOpen)}
              className="gap-1.5 font-body text-xs border-primary/30 text-primary hover:bg-primary/10">
              <Mail className="w-3.5 h-3.5" /> Bulk Email ({selectedBookingIds.size})
            </Button>
          )}
          {bookings.length > 0 && isServerMode() && (
            <Button size="sm" variant="outline" onClick={handleSheetsSync} disabled={sheetsSyncing} className="font-body text-xs">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              {sheetsSyncing ? "Syncing…" : "Export to Sheets"}
            </Button>
          )}
        </div>
      </div>

      {/* Bulk Email Panel */}
      {bulkEmailOpen && selectedBookingIds.size > 0 && (
        <div className="glass-panel rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-body text-muted-foreground">
              Bulk email to <span className="text-foreground font-medium">{selectedBookingIds.size} clients</span>
            </p>
            <Button size="sm" variant="ghost" onClick={() => setBulkEmailOpen(false)} className="h-7 w-7 p-0">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          {emailTemplates.length > 0 && (
            <div>
              <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Load Template</label>
              <div className="flex flex-wrap gap-1.5">
                {emailTemplates.map(t => (
                  <button key={t.id} onClick={() => {
                    setBulkEmailSubject(t.subject);
                    setBulkEmailBody(t.body);
                    setShowBulkPreview(false);
                  }} className="text-[10px] font-body px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Input value={bulkEmailSubject} onChange={e => { setBulkEmailSubject(e.target.value); setShowBulkPreview(false); }} placeholder="Email subject… (supports {{clientName}}, {{eventTitle}}, etc.)" className="bg-secondary border-border text-foreground font-body text-sm" />
          <Textarea value={bulkEmailBody} onChange={e => { setBulkEmailBody(e.target.value); setShowBulkPreview(false); }} placeholder="Email body… Variables will be replaced per recipient." className="bg-secondary border-border text-foreground font-body text-sm min-h-[100px]" />

          {/* Bulk Preview — shows first selected booking as example */}
          {showBulkPreview && bulkEmailSubject.trim() && bulkEmailBody.trim() && (() => {
            const sample = bookings.find(b => selectedBookingIds.has(b.id));
            if (!sample) return null;
            const replaceVars = (text: string, bk: Booking) => text.replace(/\{\{clientName\}\}/g, bk.clientName).replace(/\{\{eventTitle\}\}/g, bk.type || "").replace(/\{\{date\}\}/g, bk.date).replace(/\{\{time\}\}/g, bk.time).replace(/\{\{amount\}\}/g, String(bk.paymentAmount || 0));
            return (
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 border-b border-border/50">
                  <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Preview (showing: {sample.clientName})</p>
                </div>
                <div className="p-4 bg-background/50">
                  <p className="text-xs font-body text-muted-foreground mb-1">To: <span className="text-foreground">{sample.clientEmail}</span></p>
                  <p className="text-xs font-body text-muted-foreground mb-3">Subject: <span className="text-foreground font-medium">{replaceVars(bulkEmailSubject, sample)}</span></p>
                  <div className="rounded-lg p-4" style={{ background: "#0a0a0a", color: "#f5f5f5", fontFamily: "sans-serif", maxWidth: 520 }}>
                    <p style={{ color: "#ccc", lineHeight: 1.8, whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: replaceVars(bulkEmailBody, sample).replace(/\n/g, "<br/>") }} />
                  </div>
                </div>
              </div>
            );
          })()}

          {bulkEmailProgress && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(bulkEmailProgress.sent / bulkEmailProgress.total) * 100}%` }} />
              </div>
              <span className="text-[10px] font-body text-muted-foreground">{bulkEmailProgress.sent}/{bulkEmailProgress.total}</span>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setShowBulkPreview(!showBulkPreview)}
              disabled={!bulkEmailSubject.trim() || !bulkEmailBody.trim()}
              className="gap-1.5 font-body text-xs border-border text-foreground hover:bg-secondary">
              <Eye className="w-3 h-3" /> {showBulkPreview ? "Hide Preview" : "Preview"}
            </Button>
            <Button size="sm" disabled={sendingBulkEmail || !bulkEmailSubject.trim() || !bulkEmailBody.trim()}
              className="gap-1.5 bg-primary text-primary-foreground font-body text-xs"
              onClick={async () => {
                const selected = bookings.filter(b => selectedBookingIds.has(b.id) && b.clientEmail);
                if (selected.length === 0) return;
                if (!confirm(`Send email to ${selected.length} clients?`)) return;
                setSendingBulkEmail(true);
                setBulkEmailProgress({ sent: 0, total: selected.length });
                let sent = 0;
                for (const bk of selected) {
                  const subj = bulkEmailSubject.replace(/\{\{clientName\}\}/g, bk.clientName).replace(/\{\{eventTitle\}\}/g, bk.type || "").replace(/\{\{date\}\}/g, bk.date).replace(/\{\{time\}\}/g, bk.time).replace(/\{\{amount\}\}/g, String(bk.paymentAmount || 0));
                  const body = bulkEmailBody.replace(/\{\{clientName\}\}/g, bk.clientName).replace(/\{\{eventTitle\}\}/g, bk.type || "").replace(/\{\{date\}\}/g, bk.date).replace(/\{\{time\}\}/g, bk.time).replace(/\{\{amount\}\}/g, String(bk.paymentAmount || 0));
                  const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0a0a0a;color:#f5f5f5;border-radius:12px;"><p style="color:#ccc;line-height:1.8;white-space:pre-wrap;">${body.replace(/\n/g, "<br/>")}</p></div>`;
                  await sendCustomEmail(bk.clientEmail, subj, html, body, bk.id);
                  sent++;
                  setBulkEmailProgress({ sent, total: selected.length });
                }
                setSendingBulkEmail(false);
                setBulkEmailProgress(null);
                toast.success(`Sent ${sent} emails successfully`);
                setBulkEmailOpen(false);
                setSelectedBookingIds(new Set());
                setBulkEmailSubject("");
                setBulkEmailBody("");
              }}>
              <Send className="w-3 h-3" />
              {sendingBulkEmail ? "Sending…" : `Send to ${selectedBookingIds.size} Clients`}
            </Button>
          </div>
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <Calendar className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-body text-muted-foreground">No bookings yet.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={bookingSearch} onChange={e => setBookingSearch(e.target.value)} placeholder="Search bookings…" className="pl-8 h-8 text-xs font-body" />
            </div>
            <div className="flex items-center gap-1 flex-wrap overflow-x-auto">
              <span className="text-[10px] font-body text-muted-foreground/50 mr-1">Sort:</span>
              <SortBtn k="date" label="Session Date" />
              <SortBtn k="booked" label="Booked On" />
              <SortBtn k="type" label="Type" />
              <SortBtn k="name" label="Name" />
              <SortBtn k="instagram" label="Instagram" />
              <SortBtn k="status" label="Status" />
              <SortBtn k="payment" label="Payment" />
            </div>
          </div>
          <div className="space-y-3">
          {sortedBookings.map((bk) => {
            const isExpanded = expandedId === bk.id;
            const et = eventTypes.find(e => e.id === bk.eventTypeId);
            return (
              <div key={bk.id} className="glass-panel rounded-xl overflow-hidden">
                <div className="p-4 cursor-pointer hover:bg-secondary/20 transition-colors" onClick={() => {
                    const willExpand = expandedId !== bk.id;
                    setExpandedId(willExpand ? bk.id : null);
                    if (willExpand) {
                      syncFromServer().then(() => setBookingsState(getBookings())).catch(() => {});
                      fetchEmailLog(bk.id);
                    }
                  }}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {selectMode && (
                        <button className="flex-shrink-0" onClick={(e) => {
                          e.stopPropagation();
                          setSelectedBookingIds(prev => {
                            const next = new Set(prev);
                            if (next.has(bk.id)) next.delete(bk.id); else next.add(bk.id);
                            return next;
                          });
                        }}>
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            selectedBookingIds.has(bk.id) ? "bg-primary border-primary" : "border-border"
                          }`}>
                            {selectedBookingIds.has(bk.id) && <CheckSquare className="w-3 h-3 text-primary-foreground" />}
                          </div>
                        </button>
                      )}
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Users className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-body text-foreground font-medium">{bk.clientName}</h3>
                          {bk.instagramHandle && <span className="text-xs font-body text-primary">@{bk.instagramHandle.replace("@", "")}</span>}
                        </div>
                        <p className="text-xs font-body text-muted-foreground">{bk.type} · {bk.date} at {bk.time} · {formatDuration(bk.duration)}</p>
                        {bk.createdAt && (
                          <p className="text-[10px] font-body text-muted-foreground/50">Booked {new Date(bk.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap pl-13 sm:pl-0" onClick={(e) => e.stopPropagation()}>
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
                        <option value="deposit-paid">Deposit Paid</option>
                        <option value="paid">Paid in Full</option>
                        <option value="cash">Cash</option>
                        <option value="pending-confirmation">Bank Transfer Pending</option>
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
                        <p className="text-sm font-body text-foreground">{bk.paymentStatus === "paid" ? "Paid in Full" : bk.paymentStatus === "deposit-paid" ? "Deposit Paid" : bk.paymentStatus === "pending-confirmation" ? "Bank Transfer Pending" : bk.paymentStatus || "Unpaid"}</p>
                      </div>
                    </div>
                    {bk.answers && Object.keys(bk.answers).length > 0 && (
                      <div>
                        <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-2">Questionnaire Answers</p>
                        <div className="space-y-2">
                          {Object.entries(bk.answers).map(([qId, answer]) => {
                            const question = et?.questions.find(q => q.id === qId);
                            const label = bk.answerLabels?.[qId] || question?.label || qId.replace(/^q\d+$/, "Custom Question");
                            return (
                              <div key={qId} className="p-2 rounded-lg bg-secondary/30 border border-border/30">
                                <p className="text-[10px] font-body text-muted-foreground">{label}</p>
                                <p className="text-sm font-body text-foreground">{answer}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Email Log — fetched from server */}
                    {(() => {
                      const logs = emailLogs[bk.id] || bk.emailLog || [];
                      return logs.length > 0 ? (
                        <div>
                          <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                            <Mail className="w-3 h-3" /> Email History ({logs.length})
                          </p>
                          <div className="space-y-1.5">
                            {logs.map((log, i) => {
                              const typeLabel: Record<string, string> = {
                                "booking-confirmation": "Booking Confirmation",
                                "payment-update": "Payment Update",
                                "payment-reminder": "Payment Reminder",
                                "booking-reminder": "Booking Reminder",
                              };
                              return (
                                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 border border-border/30">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-1.5 h-1.5 rounded-full ${log.openedAt ? "bg-green-400" : "bg-muted-foreground/40"}`} />
                                    <div>
                                      <p className="text-xs font-body text-foreground">{typeLabel[log.type || ""] || log.type || "Email"}</p>
                                      <p className="text-[10px] font-body text-muted-foreground">
                                        {log.to || ""}{log.to && log.sentAt ? " · " : ""}{log.sentAt ? new Date(log.sentAt).toLocaleString() : ""}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    {log.openedAt ? (
                                      <span className="text-[10px] font-body text-green-400">✓ Opened {log.openedAt ? new Date(log.openedAt).toLocaleString() : ""}</span>
                                    ) : (
                                      <span className="text-[10px] font-body text-muted-foreground/50">Not opened</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] font-body text-muted-foreground/50 flex items-center gap-1.5">
                          <Mail className="w-3 h-3" /> No emails sent yet
                        </p>
                      );
                    })()}

                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      {/* Reminder buttons */}
                      {bk.clientEmail && isServerMode() && (
                        <>
                          {(bk.paymentStatus !== "paid" && (bk.paymentAmount || 0) > 0) && (
                            <Button size="sm" variant="outline" disabled={sendingReminder === bk.id}
                              className="gap-1.5 font-body text-xs border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                              onClick={async () => {
                                setSendingReminder(bk.id);
                                const result = await sendBookingReminder(bk.id, "payment");
                                setSendingReminder(null);
                                if (result.ok) {
                                  toast.success("Payment reminder sent");
                                  await fetchEmailLog(bk.id);
                                  syncFromServer().then(() => setBookingsState(getBookings())).catch(() => {});
                                } else toast.error(result.error || "Failed to send reminder");
                              }}>
                              <DollarSign className="w-3 h-3" />
                              {sendingReminder === bk.id ? "Sending…" : "Payment Reminder"}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" disabled={sendingReminder === bk.id}
                            className="gap-1.5 font-body text-xs border-primary/30 text-primary hover:bg-primary/10"
                            onClick={async () => {
                              setSendingReminder(bk.id);
                              const result = await sendBookingReminder(bk.id, "booking");
                              setSendingReminder(null);
                              if (result.ok) {
                                toast.success("Booking reminder sent");
                                await fetchEmailLog(bk.id);
                                syncFromServer().then(() => setBookingsState(getBookings())).catch(() => {});
                              } else toast.error(result.error || "Failed to send reminder");
                            }}>
                            <Bell className="w-3 h-3" />
                            {sendingReminder === bk.id ? "Sending…" : "Booking Reminder"}
                          </Button>
                          <Button size="sm" variant="outline"
                            className="gap-1.5 font-body text-xs border-border text-foreground hover:bg-secondary"
                            onClick={() => {
                              setCustomEmailTarget(customEmailTarget === bk.id ? null : bk.id);
                              setCustomEmailSubject("");
                              setCustomEmailBody("");
                            }}>
                            <MessageSquare className="w-3 h-3" />
                            Custom Email
                          </Button>
                        </>
                      )}

                      {/* Custom Email Form */}
                      {customEmailTarget === bk.id && bk.clientEmail && (
                        <AnimatePresence>
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="w-full mt-2 p-4 rounded-lg bg-secondary/50 border border-border/50 space-y-3">
                            <p className="text-xs font-body text-muted-foreground">Send custom email to <span className="text-foreground font-medium">{bk.clientEmail}</span></p>
                            
                            {/* Template Picker */}
                            {emailTemplates.length > 0 && (
                              <div>
                                <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Load Template</label>
                                <div className="flex flex-wrap gap-1.5">
                                  {emailTemplates.map(t => (
                                    <button key={t.id} onClick={() => {
                                      const et2 = eventTypes.find(e => e.id === bk.eventTypeId);
                                      const sub = t.subject.replace(/\{\{clientName\}\}/g, bk.clientName).replace(/\{\{eventTitle\}\}/g, bk.type || et2?.title || "").replace(/\{\{date\}\}/g, bk.date).replace(/\{\{time\}\}/g, bk.time).replace(/\{\{amount\}\}/g, String(bk.paymentAmount || 0));
                                      const bod = t.body.replace(/\{\{clientName\}\}/g, bk.clientName).replace(/\{\{eventTitle\}\}/g, bk.type || et2?.title || "").replace(/\{\{date\}\}/g, bk.date).replace(/\{\{time\}\}/g, bk.time).replace(/\{\{amount\}\}/g, String(bk.paymentAmount || 0));
                                      setCustomEmailSubject(sub);
                                      setCustomEmailBody(bod);
                                      setShowEmailPreview(false);
                                    }} className="text-[10px] font-body px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                                      {t.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            <Input value={customEmailSubject} onChange={e => { setCustomEmailSubject(e.target.value); setShowEmailPreview(false); }} placeholder="Email subject…" className="bg-secondary border-border text-foreground font-body text-sm" />
                            <Textarea value={customEmailBody} onChange={e => { setCustomEmailBody(e.target.value); setShowEmailPreview(false); }} placeholder="Write your message… (supports basic formatting)" className="bg-secondary border-border text-foreground font-body text-sm min-h-[100px]" />
                            
                            {/* Email Preview */}
                            {showEmailPreview && customEmailSubject.trim() && customEmailBody.trim() && (
                              <div className="rounded-lg border border-border/50 overflow-hidden">
                                <div className="px-3 py-2 bg-muted/30 border-b border-border/50">
                                  <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Email Preview</p>
                                </div>
                                <div className="p-4 bg-background/50">
                                  <p className="text-xs font-body text-muted-foreground mb-1">To: <span className="text-foreground">{bk.clientEmail}</span></p>
                                  <p className="text-xs font-body text-muted-foreground mb-3">Subject: <span className="text-foreground font-medium">{customEmailSubject}</span></p>
                                  <div className="rounded-lg p-4" style={{ background: "#0a0a0a", color: "#f5f5f5", fontFamily: "sans-serif", maxWidth: 520 }}>
                                    <p style={{ color: "#ccc", lineHeight: 1.8, whiteSpace: "pre-wrap" }} dangerouslySetInnerHTML={{ __html: customEmailBody.replace(/\n/g, "<br/>") }} />
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="flex items-center gap-2 flex-wrap">
                              <Button size="sm" variant="outline" onClick={() => setShowEmailPreview(!showEmailPreview)}
                                disabled={!customEmailSubject.trim() || !customEmailBody.trim()}
                                className="gap-1.5 font-body text-xs border-border text-foreground hover:bg-secondary">
                                <Eye className="w-3 h-3" />
                                {showEmailPreview ? "Hide Preview" : "Preview"}
                              </Button>
                              <Button size="sm" disabled={sendingCustomEmail || !customEmailSubject.trim() || !customEmailBody.trim()}
                                className="gap-1.5 bg-primary text-primary-foreground font-body text-xs"
                                onClick={async () => {
                                  setSendingCustomEmail(true);
                                  const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0a0a0a;color:#f5f5f5;border-radius:12px;"><p style="color:#ccc;line-height:1.8;white-space:pre-wrap;">${customEmailBody.replace(/\n/g, "<br/>")}</p></div>`;
                                  const result = await sendCustomEmail(bk.clientEmail, customEmailSubject, html, customEmailBody, bk.id);
                                  setSendingCustomEmail(false);
                                  if (result.ok) {
                                    toast.success(`Custom email sent to ${bk.clientEmail}`);
                                    setCustomEmailTarget(null);
                                    setCustomEmailSubject("");
                                    setCustomEmailBody("");
                                    setShowEmailPreview(false);
                                    await fetchEmailLog(bk.id);
                                  } else toast.error(result.error || "Failed to send");
                                }}>
                                <Send className="w-3 h-3" />
                                {sendingCustomEmail ? "Sending…" : "Send Email"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setCustomEmailTarget(null); setShowEmailPreview(false); }} className="font-body text-xs text-muted-foreground">
                                Cancel
                              </Button>
                            </div>
                          </motion.div>
                        </AnimatePresence>
                      )}

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
        </>
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
          <div key={et.id} className={`glass-panel rounded-xl p-4 sm:p-5 border transition-all ${et.active ? "border-border/50" : "border-border/20 opacity-60"}`}>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className={`w-1.5 h-12 rounded-full mt-0.5 bg-primary flex-shrink-0 ${!et.active ? "opacity-30" : ""}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-display text-base text-foreground">{et.title}</h3>
                    <span className="text-xs font-body text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {et.durations.map((d) => formatDuration(d)).join(", ")}
                    </span>
                  </div>
                  {et.description && <p className="text-sm font-body text-muted-foreground mt-1 line-clamp-2">{et.description}</p>}
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {et.price > 0 && <p className="text-sm font-body text-primary font-medium">${et.price}</p>}
                    <span className="text-xs font-body text-muted-foreground">{et.questions.length} questions</span>
                    <span className="text-xs font-body text-muted-foreground">
                      {et.availability.recurring.length} days + {et.availability.specificDates.length} specific
                    </span>
                    {et.location && <span className="text-xs font-body text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{et.location}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 pl-5 sm:pl-0">
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
  const [prices, setPrices] = useState<Record<number, number>>(eventType?.prices || {});
  const [requiresConfirmation, setRequiresConfirmation] = useState(eventType?.requiresConfirmation || false);
  const [depositEnabled, setDepositEnabled] = useState(eventType?.depositEnabled || false);
  const [depositAmount, setDepositAmount] = useState(eventType?.depositAmount || 0);
  const [depositType, setDepositType] = useState<"fixed" | "percentage">(eventType?.depositType || "fixed");
  const [depositMethods, setDepositMethods] = useState<("stripe" | "bank")[]>(eventType?.depositMethods || ["stripe", "bank"]);
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
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-secondary border-border text-foreground font-body" />
        </div>
        <div>
          <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Price ($)</label>
          <div className="space-y-2">
            <Input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="bg-secondary border-border text-foreground font-body" placeholder="Default / fallback price" />
            {durations.length > 1 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Per-Duration Prices (override)</p>
                {durations.map(d => (
                  <div key={d} className="flex items-center gap-2">
                    <span className="text-xs font-body text-muted-foreground w-10 flex-shrink-0">{formatDuration(d)}</span>
                    <Input type="number" placeholder={String(price || 0)} value={prices[d] ?? ""} onChange={(e) => { const v = e.target.value === "" ? undefined : Number(e.target.value); setPrices(prev => { const n = {...prev}; if (v === undefined) delete n[d]; else n[d] = v; return n; }); }} className="bg-secondary border-border text-foreground font-body h-8 text-sm" />
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
        <RichTextEditor value={description} onChange={setDescription} minHeight="80px" />
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

      {/* Deposit Section */}
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
                  <Switch checked={depositMethods.includes("stripe")} onCheckedChange={v => {
                    setDepositMethods(v ? [...depositMethods, "stripe"] : depositMethods.filter(m => m !== "stripe"));
                  }} />Stripe
                </label>
                <label className="flex items-center gap-2 text-xs font-body text-muted-foreground cursor-pointer">
                  <Switch checked={depositMethods.includes("bank")} onCheckedChange={v => {
                    setDepositMethods(v ? [...depositMethods, "bank"] : depositMethods.filter(m => m !== "bank"));
                  }} />Bank Transfer
                </label>
              </div>
            </div>
            {price > 0 && (
              <p className="text-[10px] font-body text-muted-foreground">
                Deposit: ${depositType === "percentage" ? ((price * depositAmount) / 100).toFixed(2) : depositAmount} 
                {depositType === "percentage" ? ` (${depositAmount}% of $${price})` : ""}
              </p>
            )}
          </div>
        )}
      </div>

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
  const [albumSortKey, setAlbumSortKey] = useState<AlbumSortKey>("date");
  const [albumSortDir, setAlbumSortDir] = useState<SortDir>("desc");
  const [albumSearch, setAlbumSearch] = useState("");

  useEffect(() => {
    if (prefillBookingId) {
      setShowNew(true);
    }
  }, [prefillBookingId]);

  const refresh = () => setAlbumsState(getAlbums());

  // Poll server for proofing updates (client submissions won't be in localStorage)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await syncFromServer();
      if (cancelled) return;
      const fresh = getAlbums();
      setAlbumsState(fresh);
      // If an album editor is open, refresh it too so proofing picks appear live
      setEditing(prev => {
        if (!prev) return prev;
        const updated = fresh.find(a => a.id === prev.id);
        return updated ?? prev;
      });
    };
    poll(); // immediate on mount
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Backfill missing thumbnails for all album photos
  const allAlbumPhotos = albums.flatMap(a => a.photos);
  useBackfillThumbnails(allAlbumPhotos, useCallback((photoId, thumb) => {
    setAlbumsState(prev => prev.map(a => ({
      ...a,
      photos: a.photos.map(p => p.id === photoId ? { ...p, thumbnail: thumb } : p),
    })));
    // Persist
    const current = getAlbums();
    for (const alb of current) {
      const photo = alb.photos.find(p => p.id === photoId);
      if (photo) {
        updateAlbum({ ...alb, photos: alb.photos.map(p => p.id === photoId ? { ...p, thumbnail: thumb } : p) });
        break;
      }
    }
  }, []));

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

  const handleSendNotification = async (album: Album) => {
    if (!album.clientEmail) { toast.error("No client email on this album"); return; }
    const template = settings.notificationEmailTemplate || "Hey {name}, your photos are ready! Check them out here: {link}";
    const tok = (album as any).clientToken;
    const link = `${window.location.origin}/gallery/${album.slug}${tok ? `?token=${tok}` : ""}`;
    const message = template.replace("{name}", album.clientName || "there").replace("{link}", link).replace("{instagram}", (album as any).instagramHandle || album.clientEmail || "");
    const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0a0a0a;color:#f5f5f5;border-radius:12px;"><h2 style="font-size:22px;margin:0 0 16px;">📸 Your photos are ready!</h2><p style="color:#aaa;line-height:1.6;">${message.replace(link, "")}</p><a href="${link}" style="display:inline-block;margin-top:24px;padding:12px 28px;background:#fff;color:#000;border-radius:8px;text-decoration:none;font-weight:600;">View Your Gallery →</a><p style="margin-top:32px;font-size:11px;color:#555;">${link}</p></div>`;
    try {
      const result = await sendEmail(album.clientEmail, `Your photos are ready — ${album.clientName || "Gallery"}`, html, message);
      if (result.ok) toast.success(`Email sent to ${album.clientEmail}`);
      else toast.error(`Failed: ${result.error || "Unknown error"}`);
    } catch { toast.error("Email send failed — check SMTP settings"); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h2 className="font-display text-2xl text-foreground">Albums</h2>
        <div className="flex gap-2 flex-wrap">
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
          onUpdate={(alb) => { updateAlbum(alb); setAlbumsState(prev => prev.map(a => a.id === alb.id ? alb : a)); setEditing(alb); }}
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

      {(() => {
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
            case "photos": return dir * (a.photos.length - b.photos.length);
            case "client": return dir * (a.clientName || "").localeCompare(b.clientName || "");
            default: return 0;
          }
        });
        const AlbumSortBtn = ({ k, label }: { k: AlbumSortKey; label: string }) => (
          <button onClick={() => toggleAlbumSort(k)} className={`text-[10px] font-body tracking-wider uppercase px-2 py-1 rounded transition-colors ${albumSortKey === k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {label} {albumSortKey === k ? (albumSortDir === "asc" ? "↑" : "↓") : ""}
          </button>
        );
        return albums.length === 0 ? (
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
          {sortedAlbums.map((alb) => (
            <div key={alb.id} className={`glass-panel rounded-xl overflow-hidden transition-all ${mergeMode ? "cursor-pointer" : ""} ${mergeSelection.has(alb.id) ? "ring-2 ring-primary" : ""} ${alb.enabled === false ? "opacity-50" : ""}`}
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
                {/* Download expiry badge */}
                {alb.downloadExpiresAt && alb.allUnlocked && (() => {
                  const expired = new Date(alb.downloadExpiresAt + "T12:00:00") < new Date();
                  const daysLeft = Math.ceil((new Date(alb.downloadExpiresAt + "T12:00:00").getTime() - Date.now()) / 86400000);
                  if (expired) return (
                    <span className="inline-flex items-center gap-1 text-[10px] font-body px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
                      ⏱ Expired
                    </span>
                  );
                  if (daysLeft <= 7) return (
                    <span className="inline-flex items-center gap-1 text-[10px] font-body px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
                      ⏱ Expires in {daysLeft}d
                    </span>
                  );
                  return null;
                })()}
                {/* Proofing stage badge */}
                {settings.proofingEnabled && alb.proofingEnabled && alb.proofingStage && alb.proofingStage !== "not-started" && (
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
                {alb.mergedFrom && <p className="text-[10px] font-body text-muted-foreground/50">Merged from {alb.mergedFrom.length} albums</p>}
                {!mergeMode && (
                  <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                    <Switch
                      checked={alb.enabled !== false}
                      onCheckedChange={(v) => {
                        updateAlbum({ ...alb, enabled: v });
                        refresh();
                        toast.success(v ? "Album enabled" : "Album disabled");
                      }}
                    />
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
                    {(() => {
                      const starredPhotos = alb.photos.filter((p: any) => p.starred);
                      if (starredPhotos.length === 0) return null;
                      return (
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-yellow-500 hover:text-yellow-400"
                          title={`Export ${starredPhotos.length} starred filenames for Lightroom`}
                          onClick={() => {
                            const lines = [
                              `# Starred photos — ${alb.title}`,
                              `# Album: ${alb.slug}`,
                              `# Exported: ${new Date().toISOString().slice(0,10)}`,
                              `# ${starredPhotos.length} of ${alb.photos.length} photos starred`,
                              `#`,
                              `# Drop this file into the PowerShell script to copy matching NEFs`,
                              `# and write 5-star XMP sidecars for Lightroom / Capture One.`,
                              ``,
                              ...starredPhotos.map((p: any) => p.title || p.id),
                            ];
                            const blob = new Blob([lines.join("\n")], { type: "text/plain" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `starred_${alb.slug}_${new Date().toISOString().slice(0,10)}.txt`;
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
                )}
              </div>
            </div>
          ))}
          </div>
        </>
      );
      })()}

    </motion.div>
  );
}

// ─── Album Editor ────────────────────────────────────
function AlbumEditor({ album, bookings, settings, prefillBookingId, onSave, onUpdate, onCancel }: {
  album: Album | null;
  bookings: Booking[];
  settings: AppSettings;
  prefillBookingId?: string | null;
  onSave: (alb: Album) => void;
  onUpdate?: (alb: Album) => void;
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
  const [watermarkDisabled, setWatermarkDisabled] = useState((album as any)?.watermarkDisabled || false);
  const [purchasingDisabled, setPurchasingDisabled] = useState((album as any)?.purchasingDisabled || false);
  const [albumProofingEnabled, setAlbumProofingEnabled] = useState(album?.proofingEnabled || false);
  // Live album state for proofing panel — keeps UI in sync when proofing actions mutate the album
  const [liveAlbum, setLiveAlbum] = useState<Album | null>(album);
  const updateLiveAlbum = (updated: Album) => { updateAlbum(updated); setLiveAlbum(updated); };
  // Sync liveAlbum when parent refreshes the album prop (e.g. from server polling)
  // But only update if the incoming album has newer/more data to avoid overwriting live edits
  useEffect(() => {
    if (!album) return;
    setLiveAlbum(prev => {
      if (!prev) return album;
      // Prefer whichever has more proofing round data (more picks = server has caught up)
      const prevPicks = prev.proofingRounds?.flatMap(r => r.selectedPhotoIds || []).length ?? 0;
      const newPicks = album.proofingRounds?.flatMap(r => r.selectedPhotoIds || []).length ?? 0;
      const prevStage = prev.proofingStage ?? "not-started";
      const newStage = album.proofingStage ?? "not-started";
      const stageOrder = ["not-started", "proofing", "selections-submitted", "editing", "finals-delivered"];
      const prevStageIdx = stageOrder.indexOf(prevStage);
      const newStageIdx = stageOrder.indexOf(newStage);
      // Accept incoming if it has more picks OR is at a later stage
      if (newPicks > prevPicks || newStageIdx > prevStageIdx) return album;
      return prev;
    });
  }, [album]);
  const [downloadExpiresAt, setDownloadExpiresAt] = useState(album?.downloadExpiresAt || "");
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
      // Add all photos immediately — use server-side thumbnails (no heavy client-side canvas work)
      const newPhotos: Photo[] = results.map(r => ({
        id: r.id, src: r.url, thumbnail: r.url + "?size=thumb", title: r.originalName.replace(/\.[^.]+$/, ""), width: 800, height: 600, uploadedAt: new Date().toISOString(),
      }));
      const allPhotos = [...photos, ...newPhotos];
      setPhotos(allPhotos);
      const newCover = coverImage || (allPhotos[0]?.src ?? "");
      if (!coverImage && newPhotos.length > 0) setCoverImage(newPhotos[0].src);
      setUploadStats(prev => prev ? { ...prev, done: fileArr.length, errors: fileArr.length - results.length, savedBytes: 0 } : null);
      if (results.length > 0) {
        toast.success(`${results.length} photos uploaded to server`);
        window.dispatchEvent(new CustomEvent("storage-synced"));
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
      downloadExpiresAt: downloadExpiresAt || undefined,
      proofingEnabled: albumProofingEnabled,
      watermarkDisabled,
      purchasingDisabled,
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

          {/* Watermark toggle */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs font-body text-muted-foreground flex items-center gap-2">
              <Camera className="w-3.5 h-3.5" /> Watermarks Disabled
            </span>
            <Switch checked={watermarkDisabled} onCheckedChange={setWatermarkDisabled} />
          </div>
          <p className="text-[10px] font-body text-muted-foreground/50 mt-1">Turn off watermarks for this album (e.g. trusted client, gifted session)</p>

          {/* Purchasing toggle */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-xs font-body text-muted-foreground flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5" /> Purchasing Disabled (Gallery Lock) (Gallery Lock)
            </span>
            <Switch checked={purchasingDisabled} onCheckedChange={setPurchasingDisabled} />
          </div>
          <p className="text-[10px] font-body text-muted-foreground/50 mt-1">Photos stay watermarked and undownloadable, but no payment UI is shown. Use when payment is handled separately (invoice, in-person) or gallery is for review only.</p>
          {allUnlocked && (
            <div className="mt-3 space-y-1">
              <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground block">
                Download Expires On <span className="text-muted-foreground/40 normal-case">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={downloadExpiresAt}
                  onChange={e => setDownloadExpiresAt(e.target.value)}
                  className="bg-secondary border-border text-foreground font-body text-xs h-8"
                />
                {downloadExpiresAt && (
                  <button onClick={() => setDownloadExpiresAt("")} className="text-muted-foreground/50 hover:text-muted-foreground text-xs font-body">Clear</button>
                )}
              </div>
              {downloadExpiresAt && (() => {
                const expired = new Date(downloadExpiresAt + "T12:00:00") < new Date();
                const daysLeft = Math.ceil((new Date(downloadExpiresAt + "T12:00:00").getTime() - Date.now()) / 86400000);
                return (
                  <p className={`text-[10px] font-body mt-1 ${expired ? "text-destructive" : daysLeft <= 7 ? "text-yellow-400" : "text-muted-foreground/50"}`}>
                    {expired ? "⚠ Already expired — gallery is locked" : `Locks in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`}
                  </p>
                );
              })()}
            </div>
          )}
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

      {/* ── Per-album proofing toggle (only visible when global proofing is on) ── */}
      {album && settings.proofingEnabled && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
          <div>
            <p className="text-xs font-body text-foreground font-medium">Proofing for this album</p>
            <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">Let this client star and submit picks before editing</p>
          </div>
          <button
            onClick={() => {
              setAlbumProofingEnabled(!albumProofingEnabled);
              toast.success(!albumProofingEnabled ? "Proofing enabled for this album" : "Proofing disabled for this album");
            }}
            className={`relative rounded-full transition-colors shrink-0 ${albumProofingEnabled ? "bg-primary" : "bg-border"}`}
            style={{ height: "22px", width: "40px" }}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${albumProofingEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
      )}

      {/* ── Proofing Controls ─────────────────────────────── */}
      {liveAlbum && settings.proofingEnabled && albumProofingEnabled && (() => {
        const stage = liveAlbum!.proofingStage || "not-started";
        const rounds = liveAlbum!.proofingRounds || [];
        const latest = rounds[rounds.length - 1];
        const clientEmail = liveAlbum!.clientEmail;
        const isFreeAlbum = !liveAlbum!.pricePerPhoto && !liveAlbum!.priceFullAlbum;

        const startProofing = async () => {
          const note = (document.getElementById("proofing-admin-note") as HTMLInputElement)?.value || "";
          const clientToken = liveAlbum!.clientToken || `ct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const newRound = { roundNumber: rounds.length + 1, sentAt: new Date().toISOString(), selectedPhotoIds: [], adminNote: note || undefined };
          const updated = { ...liveAlbum!, proofingEnabled: true, proofingStage: "proofing" as const, proofingRounds: [...rounds, newRound], clientToken };
          updateLiveAlbum(updated);
          if (clientEmail) {
            const galleryUrl = `${window.location.origin}/gallery/${liveAlbum!.slug}?token=${clientToken}`;
            fetch("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: clientEmail, subject: `📸 Your proofing gallery is ready — ${liveAlbum!.title}`, html: `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;"><h2 style="margin:0 0 16px;font-size:20px;">Your photos are ready to review!</h2><p style="color:#9ca3af;margin:0 0 12px;">Hi ${liveAlbum!.clientName || "there"},</p><p style="color:#9ca3af;margin:0 0 12px;">Your proofing gallery for <strong style="color:#e5e7eb;">${liveAlbum!.title}</strong> is ready. Browse and star the ones you love, then hit Submit Picks.</p>${note ? `<p style="color:#9ca3af;margin:0 0 20px;padding:12px;background:#1f1f1f;border-radius:8px;"><em>"${note}"</em></p>` : ""}<a href="${galleryUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View Your Gallery →</a></div>` }) }).catch(() => {});
          }
          toast.success("Proofing round started" + (clientEmail ? " — invite sent to client" : " (no client email on file)"));
          onUpdate?.(updated);
        };

        const approveSelections = (free: boolean) => {
          if (!latest?.selectedPhotoIds?.length) { toast.error("No selections to approve yet"); return; }
          const selectedSet = new Set(latest.selectedPhotoIds);
          const updatedPhotos = liveAlbum!.photos.map((p: any) => ({ ...p, hidden: !selectedSet.has(p.id) }));
          const updated = { ...liveAlbum!, photos: updatedPhotos, proofingStage: "editing" as const, allUnlocked: free ? true : liveAlbum!.allUnlocked };
          updateLiveAlbum(updated);
          toast.success(`${latest.selectedPhotoIds.length} photos kept, ${liveAlbum!.photos.length - latest.selectedPhotoIds.length} hidden — ${free ? "album unlocked" : "moving to editing"}`);
          onUpdate?.(updated);
        };

        const sendEditingEmail = async () => {
          if (!clientEmail) { toast.error("No client email on file"); return; }
          const tok = liveAlbum!.clientToken;
          const galleryUrl = `${window.location.origin}/gallery/${liveAlbum!.slug}${tok ? `?token=${tok}` : ""}`;
          await fetch("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: clientEmail, subject: `✏️ Your photos are being edited — ${liveAlbum!.title}`, html: `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;"><h2 style="margin:0 0 16px;font-size:20px;">Your photos are being edited ✏️</h2><p style="color:#9ca3af;margin:0 0 12px;">Hi ${liveAlbum!.clientName || "there"},</p><p style="color:#9ca3af;margin:0 0 20px;">Your selections for <strong style="color:#e5e7eb;">${liveAlbum!.title}</strong> are confirmed and editing has begun. We'll send you another email as soon as your final photos are ready.</p><a href="${galleryUrl}" style="display:inline-block;background:#374151;color:#e5e7eb;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Preview Gallery →</a></div>` }) }).catch(() => {});
          toast.success("Editing notification sent to client");
        };

        const deliverFinals = async (free: boolean) => {
          const updated = { ...liveAlbum!, proofingStage: "finals-delivered" as const, allUnlocked: free ? true : liveAlbum!.allUnlocked };
          updateLiveAlbum(updated);
          if (clientEmail) {
            const tok = liveAlbum!.clientToken;
            const galleryUrl = `${window.location.origin}/gallery/${liveAlbum!.slug}${tok ? `?token=${tok}` : ""}`;
            fetch("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: clientEmail, subject: `✨ Your final photos are ready — ${liveAlbum!.title}`, html: free ? `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;"><h2 style="margin:0 0 16px;font-size:20px;">Your edited photos are ready! ✨</h2><p style="color:#9ca3af;margin:0 0 12px;">Hi ${liveAlbum!.clientName || "there"},</p><p style="color:#9ca3af;margin:0 0 20px;">Your final edited photos for <strong style="color:#e5e7eb;">${liveAlbum!.title}</strong> are ready — no payment needed, they're all yours to download!</p><a href="${galleryUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Download Your Photos →</a></div>` : `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;"><h2 style="margin:0 0 16px;font-size:20px;">Your edited photos are ready! ✨</h2><p style="color:#9ca3af;margin:0 0 12px;">Hi ${liveAlbum!.clientName || "there"},</p><p style="color:#9ca3af;margin:0 0 20px;">Your final edited photos for <strong style="color:#e5e7eb;">${liveAlbum!.title}</strong> are now available to view and download.</p><a href="${galleryUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View &amp; Download Photos →</a></div>` }) }).catch(() => {});
          }
          toast.success("Finals delivered!" + (clientEmail ? " — client notified" : ""));
          onUpdate?.(updated);
        };

        const resetProofing = () => {
          if (!confirm("Reset proofing? This will un-hide all photos and clear the proofing stage.")) return;
          const updatedPhotos = liveAlbum!.photos.map((p: any) => ({ ...p, hidden: false }));
          const resetUpdated = { ...liveAlbum!, photos: updatedPhotos, proofingStage: "not-started" as const, proofingRounds: [] };
          updateLiveAlbum(resetUpdated);
          toast.success("Proofing reset");
          onUpdate?.(resetUpdated);
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

            {/* NOT STARTED */}
            {stage === "not-started" && (
              <div className="space-y-2">
                <textarea id="proofing-admin-note" placeholder="Optional message to client (e.g. 'Please pick your top 30')" rows={2} className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs font-body text-foreground placeholder:text-muted-foreground/50 resize-none" />
                <button onClick={startProofing} className="flex items-center gap-2 w-full justify-center bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-400 border border-yellow-500/30 rounded-lg px-4 py-2 text-xs font-body tracking-wider uppercase transition-colors">
                  <Star className="w-3.5 h-3.5" /> Start Proofing Round {rounds.length + 1}
                </button>
              </div>
            )}

            {/* AWAITING PICKS */}
            {stage === "proofing" && (
              <p className="text-xs font-body text-muted-foreground">
                Waiting for {liveAlbum!.clientName || "client"} to star photos and submit picks.
                {latest?.adminNote && <span className="block mt-1 text-muted-foreground/70">Your note: "{latest.adminNote}"</span>}
              </p>
            )}

            {/* PICKS SUBMITTED — paid vs free decision */}
            {stage === "selections-submitted" && latest && (
              <div className="space-y-3">
                <div className="bg-secondary rounded-lg p-3 space-y-1">
                  <p className="text-xs font-body text-foreground font-medium">{latest.selectedPhotoIds.length} photos selected by client</p>
                  {latest.clientNote && <p className="text-xs font-body text-muted-foreground italic">"{latest.clientNote}"</p>}
                  <p className="text-[10px] font-body text-muted-foreground/60">{latest.submittedAt ? new Date(latest.submittedAt).toLocaleString() : ""}</p>
                </div>
                <p className="text-[10px] font-body text-muted-foreground/70 uppercase tracking-wider">Does this album require payment?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => approveSelections(true)} className="flex flex-col items-center gap-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg px-3 py-2.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                    <Unlock className="w-3.5 h-3.5" />
                    No — Free
                    <span className="text-[9px] text-green-400/60 normal-case tracking-normal">Unlock immediately</span>
                  </button>
                  <button onClick={() => approveSelections(false)} className="flex flex-col items-center gap-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg px-3 py-2.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                    <CreditCard className="w-3.5 h-3.5" />
                    Yes — Paid
                    <span className="text-[9px] text-blue-400/60 normal-case tracking-normal">Client pays to download</span>
                  </button>
                </div>
              </div>
            )}

            {/* EDITING */}
            {stage === "editing" && (
              <div className="space-y-2">
                <p className="text-xs font-body text-muted-foreground">
                  {liveAlbum!.photos.filter((p: any) => !p.hidden).length} visible · {liveAlbum!.photos.filter((p: any) => p.hidden).length} hidden
                </p>
                {clientEmail && (
                  <button onClick={sendEditingEmail} className="flex items-center gap-2 w-full justify-center bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-border rounded-lg px-4 py-2 text-xs font-body tracking-wider uppercase transition-colors">
                    <Mail className="w-3.5 h-3.5" /> Notify — Photos Being Edited
                  </button>
                )}
                <p className="text-[10px] font-body text-muted-foreground/70 uppercase tracking-wider pt-1">Finished editing?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => deliverFinals(true)} className="flex flex-col items-center gap-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg px-3 py-2.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                    <Unlock className="w-3.5 h-3.5" />
                    Deliver Free
                    <span className="text-[9px] text-green-400/60 normal-case tracking-normal">Unlock + notify client</span>
                  </button>
                  <button onClick={() => deliverFinals(false)} className="flex flex-col items-center gap-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg px-3 py-2.5 text-[10px] font-body tracking-wider uppercase transition-colors">
                    <CreditCard className="w-3.5 h-3.5" />
                    Deliver Paid
                    <span className="text-[9px] text-purple-400/60 normal-case tracking-normal">Notify, client pays</span>
                  </button>
                </div>
              </div>
            )}

            {/* FINALS DELIVERED */}
            {stage === "finals-delivered" && (
              <p className={`text-xs font-body flex items-center gap-1.5 ${liveAlbum!.allUnlocked ? "text-green-400/80" : "text-purple-400/80"}`}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                {liveAlbum!.allUnlocked ? "Delivered free — album unlocked" : "Delivered — client pays to download"}
              </p>
            )}

            {stage !== "not-started" && (
              <button onClick={resetProofing} className="text-[10px] font-body text-muted-foreground/50 hover:text-muted-foreground underline">
                Reset proofing
              </button>
            )}
          </div>
        );
      })()}

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
                      const req2 = updated.downloadRequests![idx];
                      updated.downloadRequests = updated.downloadRequests!.map((r, i) => i === idx ? { ...r, status: "approved" as const, approvedAt: new Date().toISOString() } : r);
                      if (req2?.photoIds?.length) {
                        const ex = updated.paidPhotoIds || [];
                        updated.paidPhotoIds = [...new Set([...ex, ...req2.photoIds])];
                      }
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
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1.5 max-h-48 overflow-y-auto">
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
  const [starredOnly, setStarredOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Backfill missing thumbnails for library photos
  useBackfillThumbnails(libraryPhotos, useCallback((photoId, thumb) => {
    setLibraryPhotosState(prev => {
      const updated = prev.map(p => p.id === photoId ? { ...p, thumbnail: thumb } : p);
      setPhotoLibrary(updated);
      return updated;
    });
  }, []));

  // Reconcile: find files on server storage that aren't tracked in any album or library
  // Also repair albums that have broken photo references
  const handleSyncFromStorage = async () => {
    if (!isServerMode()) { toast.error("Server not available"); return; }
    setSyncing(true);
    try {
      const stats = await getServerStorageStats();
      if (!stats || !stats.allFileNames) { toast.info("No storage data"); setSyncing(false); return; }

      const serverFileNames = new Set(stats.allFileNames);
      let repairedAlbums = 0;

      // Step 1: Check albums for broken photo references and repair them
      for (const alb of albums) {
        const brokenPhotos = alb.photos.filter(p => {
          const filename = p.src.split("/").pop();
          return filename && !serverFileNames.has(filename) && p.src.startsWith("/uploads/");
        });
        if (brokenPhotos.length > 0) {
          // Remove broken references
          const repairedPhotos = alb.photos.filter(p => !brokenPhotos.includes(p));
          updateAlbum({ ...alb, photos: repairedPhotos, photoCount: repairedPhotos.length });
          repairedAlbums++;
        }
      }

      // Step 2: Collect all known filenames (normalised) to prevent ghost duplicates
      const knownFilenames = new Set<string>();
      for (const p of libraryPhotos) {
        const fn = p.src.split("/").pop();
        if (fn) knownFilenames.add(fn);
      }
      for (const alb of getAlbums()) {
        for (const p of alb.photos) {
          const fn = p.src.split("/").pop();
          if (fn) knownFilenames.add(fn);
        }
      }

      // Step 3: Find orphaned files on disk not tracked anywhere
      const orphanedFileNames = stats.allFileNames.filter(f => !knownFilenames.has(f));

      const messages: string[] = [];
      if (repairedAlbums > 0) messages.push(`Repaired ${repairedAlbums} album(s) with missing file references`);
      if (orphanedFileNames.length > 0) {
        // Actually delete the orphaned files from disk
        try {
          await bulkDeleteFiles(orphanedFileNames);
          messages.push(`Deleted ${orphanedFileNames.length} untracked file(s) from disk`);
        } catch {
          messages.push(`Found ${orphanedFileNames.length} untracked file(s) but failed to delete them`);
        }
      }

      if (messages.length === 0) {
        toast.info("All storage files are tracked — nothing to fix");
      } else {
        toast.success(messages.join(" · "));
      }

      // Refresh albums state and notify StorageView to refresh its stats
      setAlbumsState(getAlbums());
      window.dispatchEvent(new CustomEvent("storage-synced"));
    } catch { toast.error("Failed to sync from storage"); }
    setSyncing(false);
  };

  const handleClearDuplicates = () => {
    // Always use fresh data from storage to avoid acting on stale component state
    const freshAlbums = getAlbums();
    const freshLibrary = getPhotoLibrary();
    let totalRemoved = 0;

    for (const alb of freshAlbums) {
      const seen = new Set<string>();
      const deduped = alb.photos.filter(p => {
        const key = p.id + "|" + p.src; // dedup by both id and src
        if (seen.has(p.id) || seen.has(p.src)) return false;
        seen.add(p.id); seen.add(p.src);
        return true;
      });
      if (deduped.length < alb.photos.length) {
        totalRemoved += alb.photos.length - deduped.length;
        updateAlbum({ ...alb, photos: deduped, photoCount: deduped.length });
      }
    }

    const seenLib = new Set<string>();
    const dedupLib = freshLibrary.filter(p => {
      if (seenLib.has(p.id) || seenLib.has(p.src)) return false;
      seenLib.add(p.id); seenLib.add(p.src);
      return true;
    });
    if (dedupLib.length < freshLibrary.length) {
      totalRemoved += freshLibrary.length - dedupLib.length;
      setPhotoLibrary(dedupLib);
      setLibraryPhotosState(dedupLib);
    }

    // Refresh from storage after all writes
    setAlbumsState(getAlbums());

    if (totalRemoved === 0) toast.info("No duplicates found");
    else toast.success(`Removed ${totalRemoved} duplicate photo${totalRemoved !== 1 ? "s" : ""}`);
  };

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

  const starredPhotos = allPhotos.filter(p => (p as any).starred);
  const sourcePhotos = viewSource === "all" ? allPhotos : viewSource === "library" ? libraryPhotos.map(p => ({ ...p, source: "Library" })) : getAlbumPhotos(viewSource);
  const unfilteredPhotos = starredOnly ? sourcePhotos.filter(p => (p as any).starred) : sourcePhotos;
  const displayPhotos = searchQuery.trim()
    ? unfilteredPhotos.filter(p => p.title.toLowerCase().includes(searchQuery.trim().toLowerCase()) || p.src.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : unfilteredPhotos;

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
      // Add all photos immediately — use server-side thumbnails (no heavy client-side canvas work)
      const newPhotos: Photo[] = results.map(r => ({
        id: r.id, src: r.url, thumbnail: r.url + "?size=thumb", title: r.originalName.replace(/\.[^.]+$/, ""), width: 800, height: 600, uploadedAt: new Date().toISOString(),
      }));
      for (const photo of newPhotos) addPhotoToTarget(photo);
      setUploadStats(prev => prev ? { ...prev, done: fileArr.length, errors: fileArr.length - results.length } : null);
      const target = selectedAlbum ? `"${selectedAlbum.title}"` : "library";
      if (results.length > 0) {
        toast.success(`${results.length} photos uploaded to ${target}`);
        window.dispatchEvent(new CustomEvent("storage-synced"));
      }
    } else {
      for (const file of fileArr) {
        try {
          const result = await compressImage(file);
          const thumb = await generateThumbnail(result.src).catch(() => undefined);
          const photo: Photo = { id: generateId("ph"), src: result.src, thumbnail: thumb, title: file.name.replace(/\.[^.]+$/, ""), width: result.width, height: result.height, uploadedAt: new Date().toISOString() };
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-2xl text-foreground">Photo Library</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <Button size="sm" variant="outline" onClick={handleClearDuplicates} className="gap-2 font-body text-xs border-border text-foreground">
            <XSquare className="w-4 h-4" /> Clear Dupes
          </Button>
          <Button size="sm" variant="outline" onClick={handleSyncFromStorage} disabled={syncing} className="gap-2 font-body text-xs border-border text-foreground">
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync Storage"}
          </Button>
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

      {/* Search bar */}
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

      {/* Source filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setViewSource("all")} className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${viewSource === "all" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          All ({allPhotos.length})
        </button>
        <button onClick={() => setViewSource("library")} className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${viewSource === "library" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          Library ({libraryPhotos.length})
        </button>
        {starredPhotos.length > 0 && (
          <button onClick={() => setStarredOnly(p => !p)} className={`text-xs font-body px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${starredOnly ? "bg-yellow-500 text-black" : "bg-secondary text-yellow-400 hover:text-yellow-300"}`}>
            ⭐ Starred ({starredPhotos.length})
          </button>
        )}
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
        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1.5">
          {displayPhotos.map(p => (
            <div key={p.id + p.source} className={`relative group aspect-square rounded-md overflow-hidden bg-secondary cursor-pointer border-2 transition-all ${selectedIds.has(p.id) ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-border"}`}
              onClick={() => toggleSelect(p.id)}>
              <ProgressiveImg thumbSrc={p.thumbnail} fullSrc={p.src} alt={p.title} className="w-full h-full object-cover" loading="lazy" />
              {(p as any).starred && (
                <span className="absolute top-1 left-1 text-[10px] leading-none">⭐</span>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[9px] font-body text-foreground font-medium truncate">{p.title}</p>
                <p className="text-[8px] font-body text-muted-foreground truncate">{p.source}</p>
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
// ─── Finance ───────────────────────────────────────────
function FinanceView() {
  const [albumsState, setAlbumsState] = React.useState(() => getAlbums());
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [expandedDownloadKeys, setExpandedDownloadKeys] = React.useState<Set<string>>(new Set());

  const toggleDownloadThumbs = (key: string) => {
    setExpandedDownloadKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  type PaymentRecord = {
    id: string;
    date: string;
    clientName: string;
    albumTitle: string;
    albumId: string;
    sessionKey?: string;
    purchaserEmail?: string;
    method: "stripe" | "bank-transfer";
    amount: number;
    status: "completed" | "pending";
    description: string;
    requestedAt?: string; // for bank-transfer deletion key
  };

  const payments: PaymentRecord[] = [];

  for (const alb of albumsState) {
    // Stripe — per-session purchases
    for (const [sKey, sp] of Object.entries((alb as any).sessionPurchases || {})) {
      const s = sp as any;
      const photoCount = s.fullAlbum ? (alb.photos?.length || 0) : (s.photoIds?.length || 0);
      const amount = s.fullAlbum ? (alb.priceFullAlbum || 0) : photoCount * (alb.pricePerPhoto || 0);
      payments.push({
        id: `session-${alb.id}-${sKey}`,
        date: s.paidAt || new Date().toISOString(),
        clientName: s.purchaserEmail || alb.clientName || "Unknown",
        albumTitle: alb.title,
        albumId: alb.id,
        sessionKey: sKey,
        purchaserEmail: s.purchaserEmail,
        method: "stripe",
        amount,
        status: "completed",
        description: s.fullAlbum ? `Full album — ${photoCount} photos` : `${photoCount} photo${photoCount !== 1 ? "s" : ""} — Stripe`,
      });
    }
    // Legacy stripe full-album (pre-session-purchase)
    if (alb.stripePaidAt && alb.priceFullAlbum && !Object.keys((alb as any).sessionPurchases || {}).length) {
      payments.push({
        id: `stripe-legacy-${alb.id}`,
        date: alb.stripePaidAt,
        clientName: alb.clientName || "Unknown",
        albumTitle: alb.title,
        albumId: alb.id,
        method: "stripe",
        amount: alb.priceFullAlbum,
        status: "completed",
        description: `Full album — ${alb.photos?.length || 0} photos (legacy)`,
      });
    }
    // Bank transfer requests
    for (const req of alb.downloadRequests || []) {
      if (req.method === "bank-transfer") {
        const photoCount = req.photoIds?.length || 0;
        const amount = photoCount * (alb.pricePerPhoto || 0);
        payments.push({
          id: `bank-${alb.id}-${req.requestedAt}`,
          date: req.approvedAt || req.requestedAt,
          clientName: req.purchaserEmail || alb.clientName || "Unknown",
          albumTitle: alb.title,
          albumId: alb.id,
          purchaserEmail: req.purchaserEmail,
          method: "bank-transfer",
          amount,
          status: (req.status === "completed" || req.status === "approved") ? "completed" : "pending",
          description: `${photoCount} photo${photoCount !== 1 ? "s" : ""} — bank transfer`,
          requestedAt: req.requestedAt,
        });
      }
    }
  }

  payments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalRevenue = payments.filter(p => p.status === "completed").reduce((s, p) => s + p.amount, 0);
  const pendingRevenue = payments.filter(p => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const stripeTotal = payments.filter(p => p.method === "stripe" && p.status === "completed").reduce((s, p) => s + p.amount, 0);
  const bankTotal = payments.filter(p => p.method === "bank-transfer" && p.status === "completed").reduce((s, p) => s + p.amount, 0);

  const handleDelete = (p: PaymentRecord) => {
    if (!confirm(`Delete this payment record? This will revoke the client's access to the purchased photos.`)) return;
    const albums = getAlbums();
    const alb = albums.find(a => a.id === p.albumId);
    if (!alb) return;
    const updated = { ...alb } as any;

    if (p.method === "stripe" && p.sessionKey) {
      // Remove the session purchase entry — revokes their access
      const sp = { ...(updated.sessionPurchases || {}) };
      delete sp[p.sessionKey];
      updated.sessionPurchases = sp;
      // If it was the legacy stripe flag, clear that too
      if (p.id.startsWith("stripe-legacy-")) {
        updated.stripePaidAt = undefined;
        updated.allUnlocked = false;
      }
    } else if (p.method === "bank-transfer" && p.requestedAt) {
      // Remove the download request entry
      updated.downloadRequests = (updated.downloadRequests || []).filter(
        (r: any) => r.requestedAt !== p.requestedAt
      );
    }

    updateAlbum(updated);
    setAlbumsState(getAlbums());
    toast.success("Payment record deleted — client access revoked");
  };

  const methodLabel = (m: string) => m === "stripe" ? "Stripe" : "Bank Transfer";
  const methodColor = (m: string) => m === "stripe" ? "text-purple-400 bg-purple-500/10" : "text-blue-400 bg-blue-500/10";
  const statusColor = (s: string) => s === "completed" ? "text-green-400 bg-green-500/10" : "text-yellow-400 bg-yellow-500/10";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl text-foreground mb-1">Finance</h2>
        <p className="text-sm font-body text-muted-foreground">Payment history and revenue summary</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-panel rounded-xl p-5">
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">Total Revenue</p>
          <p className="font-display text-2xl text-green-400">${totalRevenue.toFixed(2)}</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">{payments.filter(p => p.status === "completed").length} completed payments</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">Pending</p>
          <p className="font-display text-2xl text-yellow-400">${pendingRevenue.toFixed(2)}</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">{payments.filter(p => p.status === "pending").length} awaiting payment</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">Stripe</p>
          <p className="font-display text-2xl text-purple-400">${stripeTotal.toFixed(2)}</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">{payments.filter(p => p.method === "stripe" && p.status === "completed").length} transactions</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">Bank Transfer</p>
          <p className="font-display text-2xl text-blue-400">${bankTotal.toFixed(2)}</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">{payments.filter(p => p.method === "bank-transfer" && p.status === "completed").length} transfers</p>
        </div>
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-display text-base text-foreground">Payment History</h3>
        </div>
        {payments.length === 0 ? (
          <div className="p-12 text-center">
            <DollarSign className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-body text-muted-foreground">No payments recorded yet</p>
            <p className="text-xs font-body text-muted-foreground/60 mt-1">Stripe and bank transfer payments will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {payments.map(p => (
              <div key={p.id} className="flex items-center gap-4 px-4 py-3 hover:bg-secondary/30 transition-colors group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-body text-foreground truncate">{p.clientName}</p>
                    <span className="text-muted-foreground/40 text-xs">·</span>
                    <p className="text-xs font-body text-muted-foreground truncate">{p.albumTitle}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <p className="text-[10px] font-body text-muted-foreground/60">{p.description} · {new Date(p.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p>
                    {p.purchaserEmail && (
                      <span className="text-[10px] font-body text-primary/60 bg-primary/5 px-1.5 py-0.5 rounded">{p.purchaserEmail}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${methodColor(p.method)}`}>{methodLabel(p.method)}</span>
                  <span className={`text-[10px] font-body px-2 py-0.5 rounded-full capitalize ${statusColor(p.status)}`}>{p.status}</span>
                  <p className="text-sm font-display text-foreground w-16 text-right">${p.amount.toFixed(2)}</p>
                  <button
                    onClick={() => handleDelete(p)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400"
                    title="Delete & revoke access"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {payments.length > 0 && (
          <div className="p-4 border-t border-border flex justify-between items-center">
            <p className="text-xs font-body text-muted-foreground">{payments.length} total records</p>
            <p className="text-sm font-body text-foreground">Total collected: <span className="text-green-400 font-medium">${totalRevenue.toFixed(2)}</span></p>
          </div>
        )}
      </div>

      {/* Download Log */}
      {(() => {
        const allDownloads = albumsState.flatMap(alb =>
          (alb.downloadHistory || []).map((h: any) => ({
            ...h,
            albumTitle: alb.title,
            albumId: alb.id,
            clientName: alb.clientName || "Unknown",
          }))
        ).sort((a: any, b: any) => new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime());

        if (allDownloads.length === 0) return null;

        const handleDeleteDownloadEntry = (albumId: string, downloadedAt: string) => {
          const albums = getAlbums();
          const album = albums.find(a => a.id === albumId);
          if (!album) return;
          const updated = { ...album, downloadHistory: (album.downloadHistory || []).filter((entry: any) => entry.downloadedAt !== downloadedAt) };
          updateAlbum(updated);
          setAlbumsState(getAlbums());
          toast.success("Download log entry removed");
        };

        const handleClearAllDownloadLog = () => {
          if (!confirm(`Clear all ${allDownloads.length} download log entries? This cannot be undone.`)) return;
          const albums = getAlbums();
          const updated = albums.map(a => ({ ...a, downloadHistory: [] }));
          updated.forEach(a => updateAlbum(a));
          setAlbumsState(getAlbums());
          toast.success("Download log cleared");
        };

        return (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-display text-base text-foreground">Download Log</h3>
                <p className="text-xs font-body text-muted-foreground mt-0.5">{allDownloads.length} download event{allDownloads.length !== 1 ? "s" : ""}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearAllDownloadLog}
                className="gap-1.5 font-body text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-3 h-3" /> Clear All
              </Button>
            </div>
            <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
              {allDownloads.map((d: any, i: number) => {
                const entryKey = `${d.albumId}-${d.downloadedAt}`;
                const showThumbs = expandedDownloadKeys.has(entryKey);
                const alb = showThumbs ? albumsState.find(a => a.id === d.albumId) : null;
                const downloadedPhotos = showThumbs && d.photoIds?.length
                  ? (d.photoIds as string[]).map((id: string) => alb?.photos.find((p: any) => p.id === id)).filter(Boolean)
                  : [];
                const photoCount: number = d.photoCount ?? d.photoIds?.length ?? 0;
                return (
                  <div key={i} className="px-4 py-2.5 hover:bg-secondary/30 transition-colors group">
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-body text-foreground">{d.clientName}</p>
                          <span className="text-muted-foreground/40 text-xs">·</span>
                          <p className="text-xs font-body text-muted-foreground truncate">{d.albumTitle}</p>
                          {d.email && <span className="text-[10px] font-body text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded">{d.email}</span>}
                        </div>
                        <p className="text-[10px] font-body text-muted-foreground/60 mt-0.5">
                          {new Date(d.downloadedAt).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {" · "}{d.quality || "original"}
                          {d.sessionKey && <span className="ml-1 opacity-40">({d.sessionKey.slice(0, 16)}…)</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {photoCount > 0 && (
                          <button
                            onClick={() => toggleDownloadThumbs(entryKey)}
                            className={`flex items-center gap-1 text-[10px] font-body px-2 py-1 rounded border transition-all ${showThumbs ? "border-primary/40 text-primary bg-primary/10" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                            title={showThumbs ? "Hide photos" : "Show photos"}
                          >
                            <Grid className="w-2.5 h-2.5" />
                            {photoCount}
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteDownloadEntry(d.albumId, d.downloadedAt)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400"
                          title="Remove log entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {showThumbs && downloadedPhotos.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2 pb-1">
                        {(downloadedPhotos as any[]).slice(0, 24).map((p: any) => (
                          <img
                            key={p.id}
                            src={p.thumbnail || p.src}
                            alt={p.title}
                            className="w-10 h-10 rounded object-cover border border-border/50"
                            loading="lazy"
                          />
                        ))}
                        {downloadedPhotos.length > 24 && (
                          <span className="w-10 h-10 rounded bg-secondary/50 border border-border/50 flex items-center justify-center text-[10px] font-body text-muted-foreground">
                            +{downloadedPhotos.length - 24}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

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
            <RichTextEditor value={profile.bio} onChange={(val) => setProfileState({ ...profile, bio: val })} minHeight="80px" />
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
  const [rebuildProgress, setRebuildProgress] = useState<{ running: boolean; done: number; total: number; stage: string } | null>(null);

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

  const handleSave = async () => {
    const nextSettings = {
      ...settings,
      watermarkVersion: ((settings as any).watermarkVersion || 0) + 1,
      watermarkUpdatedAt: new Date().toISOString(),
    } as AppSettings & { watermarkVersion: number; watermarkUpdatedAt: string };

    setSettings(nextSettings as AppSettings);
    setSettingsState(nextSettings as AppSettings);

    if (isServerMode()) {
      // Server mode: just clear the server image cache so fresh watermarked images are served
      setRebuildProgress({ running: true, done: 0, total: 1, stage: "Clearing server image cache…" });
      writeWatermarkRebuildStatus({ running: true, mode: "save", done: 0, total: 1, stage: "Clearing server image cache…" });
      try {
        const cacheRes = await fetch("/api/cache/clear", { method: "POST" });
        const cacheData = cacheRes.ok ? await cacheRes.json() : null;
        const clearedMsg = formatClearedMsg(cacheData?.cleared);
        toast.success(`Settings saved — server cache cleared${clearedMsg}, gallery will serve fresh watermarked images.`);
        writeWatermarkRebuildStatus({ running: false, mode: "save", done: 1, total: 1, stage: `Server cache cleared${clearedMsg}.` });
      } catch {
        toast.error("Settings saved, but failed to clear server cache. Run 'Clear Server Image Cache' manually.");
        writeWatermarkRebuildStatus({ running: false, mode: "save", stage: "Cache clear failed." });
      }
      setRebuildProgress({ running: false, done: 1, total: 1, stage: "" });
      return;
    }

    // localStorage mode: bake watermark previews client-side
    setRebuildProgress({ running: true, done: 0, total: 0, stage: "Regenerating baked watermark previews…" });
    writeWatermarkRebuildStatus({
      running: true,
      mode: "save",
      done: 0,
      total: 0,
      stage: "Regenerating baked thumbnail / medium / full assets…",
    });
    toast.info("Saving settings and regenerating baked watermark previews…");

    try {
      const { success, failed, total } = await rebuildWatermarkedAssets(nextSettings, true, (done, totalCount) => {
        setRebuildProgress({ running: true, done, total: totalCount, stage: "Regenerating baked watermark previews…" });
        writeWatermarkRebuildStatus({
          running: true,
          mode: "save",
          done,
          total: totalCount,
          stage: "Regenerating baked thumbnail / medium / full assets…",
        });
      });

      if (total === 0) toast.success("Settings saved!");
      else if (failed === 0) toast.success(`Settings saved — rebuilt ${success} protected preview${success !== 1 ? "s" : ""}.`);
      else if (success > 0) toast.success(`Settings saved — rebuilt ${success}/${total} protected previews (${failed} failed).`);
      else toast.error("Settings saved, but preview regeneration failed.");

      setRebuildProgress({ running: false, done: total, total, stage: "" });
      writeWatermarkRebuildStatus({
        running: false,
        mode: "save",
        done: total,
        total,
        stage: total > 0 ? "Watermark regeneration complete." : "Settings saved.",
      });
    } catch {
      setRebuildProgress(null);
      writeWatermarkRebuildStatus({
        running: false,
        mode: "save",
        stage: "Watermark regeneration failed.",
      });
      toast.error("Settings saved, but preview regeneration failed.");
    }
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
            <Slider value={[settings.watermarkOpacity]} onValueChange={(v) => setSettingsState({ ...settings, watermarkOpacity: v[0] })} min={5} max={80} step={1} className="mb-4" />
          </div>
          <div>
            <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3 block">Size ({settings.watermarkSize ?? 40}%)</label>
            <Slider value={[settings.watermarkSize ?? 40]} onValueChange={(v) => setSettingsState({ ...settings, watermarkSize: v[0] })} min={10} max={100} step={1} className="mb-4" />
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

        {/* Email Templates Manager */}
        <EmailTemplatesManager />

        {/* Discord Webhook */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" /> Discord Webhooks
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Webhook URL</label>
              <Input value={settings.discordWebhookUrl} onChange={(e) => setSettingsState({ ...settings, discordWebhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/..." className="bg-secondary border-border text-foreground font-body" />
              <p className="text-[10px] font-body text-muted-foreground/50 mt-1">Receive notifications for new bookings, status changes and payments.</p>
            </div>
            {settings.discordWebhookUrl && (
              <Button
                variant="outline"
                size="sm"
                className="font-body text-xs gap-2"
                onClick={async () => {
                  try {
                    const res = await fetch("/api/discord/test", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ webhookUrl: settings.discordWebhookUrl }),
                    });
                    const data = await res.json();
                    if (data.ok) toast.success("Test message sent to Discord ✓");
                    else toast.error(`Discord error: ${data.error || "Unknown"}`);
                  } catch {
                    toast.error("Failed to reach server");
                  }
                }}
              >
                <Bell className="w-3.5 h-3.5" /> Send Test Message
              </Button>
            )}
          </div>
        </div>

        {/* Client Proofing */}
        <div className="glass-panel rounded-xl p-6 space-y-4">
          <h3 className="font-display text-base text-foreground flex items-center gap-2">
            <Star className="w-4 h-4 text-primary" /> Client Proofing
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-body text-foreground font-medium">Enable Client Proofing</p>
              <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">Allow clients to star and submit photo picks before editing</p>
            </div>
            <Switch
              checked={!!settings.proofingEnabled}
              onCheckedChange={(v) => setSettingsState({ ...settings, proofingEnabled: v })}
            />
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

        {/* Watermark rebuild / cache clear progress */}
        {rebuildProgress && (
          <div className="p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center justify-between text-xs font-body text-muted-foreground mb-1.5">
              <span className="flex items-center gap-1.5">
                <RefreshCw className={`w-3 h-3 ${rebuildProgress.running ? "animate-spin" : "text-green-500"}`} />
                {rebuildProgress.running ? (rebuildProgress.stage || "Processing…") : "Done"}
              </span>
              {rebuildProgress.total > 0 && (
                <span>{rebuildProgress.done}/{rebuildProgress.total}</span>
              )}
            </div>
            {rebuildProgress.running && (
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: rebuildProgress.total > 0 ? `${Math.max(8, (rebuildProgress.done / rebuildProgress.total) * 100)}%` : "30%" }}
                />
              </div>
            )}
          </div>
        )}

        <Button onClick={handleSave} disabled={!!rebuildProgress?.running} className="bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
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
          renderWatermarkOverlay={true}
          watermarkPosition={settings.watermarkPosition}
          watermarkText={settings.watermarkText}
          watermarkImage={settings.watermarkImage}
          watermarkOpacity={settings.watermarkOpacity}
          watermarkSize={settings.watermarkSize ?? 40}
          index={0}
        />
      </div>
    </div>
  );
}

// ─── Email Templates Manager ─────────────────────────
function EmailTemplatesManager() {
  const [templates, setTemplates] = useState<EmailTemplate[]>(getEmailTemplates());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [showForm, setShowForm] = useState(false);

  const handleSave = () => {
    if (!newName.trim() || !newSubject.trim()) return;
    if (editingId) {
      const updated: EmailTemplate = { id: editingId, name: newName, subject: newSubject, body: newBody, createdAt: templates.find(t => t.id === editingId)?.createdAt || new Date().toISOString() };
      updateEmailTemplate(updated);
    } else {
      const t: EmailTemplate = { id: generateId("tpl"), name: newName, subject: newSubject, body: newBody, createdAt: new Date().toISOString() };
      addEmailTemplate(t);
    }
    setTemplates(getEmailTemplates());
    setShowForm(false);
    setEditingId(null);
    setNewName("");
    setNewSubject("");
    setNewBody("");
    toast.success(editingId ? "Template updated" : "Template saved");
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this template?")) return;
    deleteEmailTemplate(id);
    setTemplates(getEmailTemplates());
    toast.success("Template deleted");
  };

  const handleEdit = (t: EmailTemplate) => {
    setEditingId(t.id);
    setNewName(t.name);
    setNewSubject(t.subject);
    setNewBody(t.body);
    setShowForm(true);
  };

  return (
    <div className="glass-panel rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base text-foreground">Email Templates</h3>
        <Button size="sm" variant="outline" onClick={() => { setShowForm(!showForm); setEditingId(null); setNewName(""); setNewSubject(""); setNewBody(""); }}
          className="gap-1.5 font-body text-xs">
          <Plus className="w-3 h-3" /> {showForm ? "Cancel" : "New Template"}
        </Button>
      </div>
      <p className="text-[10px] font-body text-muted-foreground/50">
        Create reusable templates for custom emails. Variables: {"{{clientName}}"}, {"{{eventTitle}}"}, {"{{date}}"}, {"{{time}}"}, {"{{amount}}"}
      </p>

      {showForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-3 p-4 rounded-lg bg-secondary/50 border border-border/50">
          <div>
            <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1 block">Template Name</label>
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Follow Up, Thank You…" className="bg-secondary border-border text-foreground font-body text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1 block">Subject Line</label>
            <Input value={newSubject} onChange={e => setNewSubject(e.target.value)} placeholder="e.g. Your {{eventTitle}} session on {{date}}" className="bg-secondary border-border text-foreground font-body text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mb-1 block">Body</label>
            <Textarea value={newBody} onChange={e => setNewBody(e.target.value)} placeholder="Hey {{clientName}},&#10;&#10;Thanks for your booking…" className="bg-secondary border-border text-foreground font-body text-sm min-h-[120px]" />
          </div>
          <Button size="sm" onClick={handleSave} disabled={!newName.trim() || !newSubject.trim()} className="gap-1.5 bg-primary text-primary-foreground font-body text-xs">
            <Save className="w-3 h-3" /> {editingId ? "Update Template" : "Save Template"}
          </Button>
        </motion.div>
      )}

      {templates.length > 0 ? (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="p-3 rounded-lg bg-secondary/30 border border-border/30 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-body text-foreground font-medium">{t.name}</p>
                <p className="text-xs font-body text-muted-foreground truncate">Subject: {t.subject}</p>
                <p className="text-[10px] font-body text-muted-foreground/50 mt-1 line-clamp-2">{t.body}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(t)}>
                  <Edit className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(t.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs font-body text-muted-foreground/50">No templates yet. Create one to speed up your email workflow.</p>
      )}
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
const VALID_PREVIEW_MODES = new Set<string>(["missing", "all", "save"]);
function safePreviewMode(mode: string | null | undefined): "missing" | "all" | "save" | null {
  return mode && VALID_PREVIEW_MODES.has(mode) ? (mode as "missing" | "all" | "save") : null;
}

function StorageView() {
  const [albums, setAlbumsState] = useState(getAlbums());
  const [libraryPhotos, setLibraryPhotosState] = useState(getPhotoLibrary());
  const bookings = getBookings();
  const eventTypes = getEventTypes();
  const [previewJob, setPreviewJob] = useState<{ running: boolean; mode: "missing" | "all" | "save" | null; done: number; total: number; stage?: string }>(() => {
    const saved = readWatermarkRebuildStatus();
    return { running: saved.running, mode: safePreviewMode(saved.mode), done: saved.done, total: saved.total, stage: saved.stage };
  });
  const [cacheStats, setCacheStats] = useState<{ total: number; breakdown: CacheBreakdown } | null>(null);
  const [lastClearStats, setLastClearStats] = useState<{ cleared: number; breakdown: CacheBreakdown } | null>(null);
  const clearAbortRef = useRef<AbortController | null>(null);

  const refreshStorageState = useCallback(async () => {
    const nextAlbums = getAlbums();
    const nextLibrary = getPhotoLibrary();
    setAlbumsState(nextAlbums);
    setLibraryPhotosState(nextLibrary);
    if (isServerMode()) {
      try {
        const s = await getServerStorageStats();
        setServerStats(s);
      } catch {}
      try {
        const cs = await getCacheStats();
        setCacheStats(cs);
      } catch {}
    }
  }, []);

  // Listen for storage sync events so counts refresh after uploads or syncs from anywhere
  useEffect(() => {
    const handler = () => { refreshStorageState(); };
    window.addEventListener("storage-synced", handler);
    return () => window.removeEventListener("storage-synced", handler);
  }, [refreshStorageState]);

  // Mirror watermark rebuild / cache-clear progress that originates from any tab (e.g. Settings)
  useEffect(() => {
    const handler = () => {
      const status = readWatermarkRebuildStatus();
      setPreviewJob({ running: status.running, mode: safePreviewMode(status.mode), done: status.done, total: status.total, stage: status.stage });
      // Once a rebuild finishes, refresh server stats so file counts stay current
      if (!status.running) refreshStorageState();
    };
    window.addEventListener("wm-rebuild-status", handler);
    return () => window.removeEventListener("wm-rebuild-status", handler);
  }, [refreshStorageState]);

  // Poll server stats every 1 s while Storage tab is open so counts stay current
  useEffect(() => {
    if (!isServerMode()) return;
    const id = setInterval(() => { refreshStorageState(); }, 1_000);
    return () => clearInterval(id);
  }, [refreshStorageState]);

  const applyThumbnailToStores = useCallback((photoId: string, thumb?: string) => {
    if (!thumb) return;

    setLibraryPhotosState(prev => {
      let changed = false;
      const updated = prev.map(p => {
        if (p.id !== photoId) return p;
        changed = true;
        return { ...p, thumbnail: thumb };
      });
      if (changed) setPhotoLibrary(updated);
      return changed ? updated : prev;
    });

    setAlbumsState(prev => {
      let changed = false;
      const updatedAlbums = prev.map(a => {
        let albumChanged = false;
        const photos = a.photos.map(p => {
          if (p.id !== photoId) return p;
          albumChanged = true;
          return { ...p, thumbnail: thumb };
        });
        if (!albumChanged) return a;
        changed = true;
        const updatedAlbum = { ...a, photos, photoCount: photos.length };
        updateAlbum(updatedAlbum);
        return updatedAlbum;
      });
      return changed ? updatedAlbums : prev;
    });
  }, []);

  const handleRebuildPreviews = useCallback(async (forceAll: boolean) => {
    if (isServerMode()) {
      // In server mode the server watermarks on demand — just clear the cache so
      // fresh variants are served on the next gallery load.
      const ctrl = new AbortController();
      clearAbortRef.current = ctrl;
      const jobState = { running: true, mode: (forceAll ? "all" : "missing") as "all" | "missing", done: 1, total: 1, stage: "Clearing server image cache…" };
      setPreviewJob(jobState);
      setLastClearStats(null);
      writeWatermarkRebuildStatus(jobState);
      try {
        const cacheRes = await fetch("/api/cache/clear", { method: "POST", signal: ctrl.signal });
        const cacheData = cacheRes.ok ? await cacheRes.json() : null;
        const cleared: number = cacheData?.cleared ?? 0;
        const breakdown: CacheBreakdown | null = cacheData?.breakdown ?? null;
        if (breakdown) setLastClearStats({ cleared, breakdown });
        const clearedMsg = formatClearedMsg(cleared);
        toast.success(`Server image cache cleared${clearedMsg} — gallery will fetch fresh watermarked images`);
        writeWatermarkRebuildStatus({ running: false, mode: forceAll ? "all" : "missing", done: 1, total: 1, stage: `Cache cleared${clearedMsg}.` });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          toast.info("Cache clear cancelled");
          writeWatermarkRebuildStatus({ running: false, stage: "Cancelled." });
        } else {
          toast.error("Failed to clear server cache");
          writeWatermarkRebuildStatus({ running: false, stage: "Cache clear failed." });
        }
      }
      clearAbortRef.current = null;
      setPreviewJob({ running: false, mode: null, done: 0, total: 0 });
      await refreshStorageState();
      return;
    }

    // localStorage mode: bake client-side previews
    const currentSettings = getSettings() as AppSettings & { watermarkVersion?: number };
    const currentAlbums = getAlbums();
    const currentLibrary = getPhotoLibrary();
    const photos = Array.from(new Map([...currentLibrary, ...currentAlbums.flatMap(a => a.photos)].map(p => [p.id, p])).values()) as Photo[];
    const targets = forceAll ? photos : photos.filter((photo) => photoNeedsBakedRefresh(photo, currentSettings, false));

    if (targets.length === 0) {
      toast.info(forceAll ? "All previews are already up to date" : "No stale previews found");
      return;
    }

    setPreviewJob({ running: true, mode: forceAll ? "all" : "missing", done: 0, total: targets.length });

    const result = await rebuildWatermarkedAssets(currentSettings, forceAll, (done, total) => {
      setPreviewJob({ running: true, mode: forceAll ? "all" : "missing", done, total });
    });

    setPreviewJob({ running: false, mode: null, done: 0, total: 0 });
    await refreshStorageState();

    if (result.failed === 0) toast.success(`${forceAll ? "Rebuilt" : "Generated"} ${result.success} protected preview${result.success !== 1 ? "s" : ""}`);
    else if (result.success > 0) toast.success(`${forceAll ? "Rebuilt" : "Generated"} ${result.success} protected preview${result.success !== 1 ? "s" : ""} (${result.failed} failed)`);
    else toast.error(`Failed to ${forceAll ? "rebuild" : "generate"} previews`);
  }, [refreshStorageState]);

  // Refresh from storage on mount so we always show current counts
  useEffect(() => {
    refreshStorageState();
  }, [refreshStorageState]);

  const [serverStats, setServerStats] = useState<{
    totalBytes: number;
    photoCount: number;
    dbSizeBytes: number;
    uploadsSizeBytes: number;
    photoFiles: { name: string; size: number; modified: string }[];
    allFileNames: string[];
    disk: { totalBytes: number; usedBytes: number; availableBytes: number; mountPoint: string } | null;
    dataDir: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteAllState, setDeleteAllState] = useState<"idle" | "confirming" | "deleting">("idle");

  useEffect(() => {
    getServerStorageStats().then(s => { setServerStats(s); setLoading(false); });
  }, []);

  const handleDeleteAllPhotos = async () => {
    if (deleteAllState === "idle") { setDeleteAllState("confirming"); return; }
    if (deleteAllState !== "confirming") return;
    setDeleteAllState("deleting");
    try {
      const res = await fetch("/api/upload/all", { method: "DELETE" });
      if (!res.ok) throw new Error("Server error");
      const { deleted } = await res.json();
      // Clear local state
      setAlbumsState(getAlbums());
      setLibraryPhotosState(getPhotoLibrary());
      await refreshStorageState();
      toast.success(`Deleted ${deleted} photo file${deleted !== 1 ? "s" : ""} and cleared all album photo records`);
    } catch {
      toast.error("Failed to delete all photos");
    }
    setDeleteAllState("idle");
  };

  // Backfill thumbnails and track progress
  const allPhotos = [...libraryPhotos, ...albums.flatMap(a => a.photos)];
  const uniquePhotos = Array.from(new Map(allPhotos.map(p => [p.id, p])).values());
  const totalPhotos = uniquePhotos.length;
  const withThumbnails = uniquePhotos.filter(p => !!p.thumbnail).length;
  const thumbnailPct = totalPhotos > 0 ? Math.round((withThumbnails / totalPhotos) * 100) : 100;

  // Run backfill from storage view
  const allAlbumPhotos = albums.flatMap(a => a.photos);
  useBackfillThumbnails([...libraryPhotos, ...allAlbumPhotos], useCallback((photoId, thumb) => {
    // Update library
    setLibraryPhotosState(prev => {
      const idx = prev.findIndex(p => p.id === photoId);
      if (idx >= 0) {
        const updated = prev.map(p => p.id === photoId ? { ...p, thumbnail: thumb } : p);
        setPhotoLibrary(updated);
        return updated;
      }
      return prev;
    });
    // Update albums
    setAlbumsState(prev => {
      let changed = false;
      const updated = prev.map(a => {
        const idx = a.photos.findIndex(p => p.id === photoId);
        if (idx >= 0) {
          changed = true;
          const photos = a.photos.map(p => p.id === photoId ? { ...p, thumbnail: thumb } : p);
          updateAlbum({ ...a, photos });
          return { ...a, photos };
        }
        return a;
      });
      return changed ? updated : prev;
    });
  }, []));

  const { used: lsUsed, limit: lsLimit } = getLocalStorageUsage();
  const totalAlbumPhotos = albums.reduce((sum, a) => sum + a.photos.length, 0);
  const totalLibraryPhotos = libraryPhotos.length;
  const totalDownloads = albums.reduce((sum, a) => sum + (a.downloadHistory || []).reduce((s, h) => s + h.photoIds.length, 0), 0);
  const totalRequests = albums.reduce((sum, a) => sum + (a.downloadRequests || []).length, 0);
  const pendingRequests = albums.reduce((sum, a) => sum + (a.downloadRequests || []).filter(r => r.status === "pending").length, 0);

  const disk = serverStats?.disk;
  const diskUsedPct = disk ? Math.min(100, (disk.usedBytes / disk.totalBytes) * 100) : 0;

  // Cache status derived values (server mode only)
  const cacheExpectedVariants = (serverStats?.photoCount ?? 0) * 3;
  const cachedTotal = cacheStats?.total ?? 0;
  const cachePct = previewJob.running
    ? 60
    : cacheExpectedVariants > 0
      ? Math.min(100, Math.round((cachedTotal / cacheExpectedVariants) * 100))
      : (cachedTotal > 0 ? 100 : 0);
  const cacheBarColor = previewJob.running ? "bg-primary" : cachePct === 0 ? "bg-muted-foreground/30" : cachePct < 100 ? "bg-yellow-500" : "bg-green-500";
  const cacheStatusLabel = previewJob.running
    ? (previewJob.stage || "Clearing cache...")
    : cachedTotal === 0
      ? "No cached renders yet - renders on first request"
      : `${cachedTotal} file${cachedTotal !== 1 ? "s" : ""} cached${cacheExpectedVariants > 0 ? ` (${cachePct}%)` : ""}`;

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
        {isServerMode() ? (
          <div className="glass-panel rounded-xl p-5">
            <p className="font-display text-2xl text-foreground">{cacheStats?.total ?? 0}</p>
            <p className="text-xs font-body text-muted-foreground tracking-wider uppercase">Cached Renders</p>
            {cacheStats && cacheStats.total > 0 && (
              <p className="text-[10px] font-body text-muted-foreground/50 mt-1">{formatBytes(cacheStats.breakdown.totalBytes)}</p>
            )}
          </div>
        ) : (
          <div className="glass-panel rounded-xl p-5">
            <p className="font-display text-2xl text-foreground">{bookings.length}</p>
            <p className="text-xs font-body text-muted-foreground tracking-wider uppercase">Bookings</p>
          </div>
        )}
      </div>

      {/* Preview & Watermark Rendering */}
      <div className="glass-panel rounded-xl p-6 mb-6">
        <h3 className="font-display text-base text-foreground mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> Preview & Watermark Rendering
        </h3>
        {isServerMode() ? (
          <>
            <div className="flex items-center justify-between text-xs font-body text-muted-foreground mb-1.5">
              <span>{cacheStatusLabel}</span>
              <span className={previewJob.running ? "text-primary" : cachedTotal > 0 ? "text-green-500" : "text-muted-foreground/50"}>
                {previewJob.running ? "Working..." : cachedTotal > 0 ? "✓ Live" : "Empty"}
              </span>
            </div>
            <div className="h-3 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full rounded-full ${cacheBarColor} transition-all duration-500`} style={{ width: `${Math.max(0, cachePct)}%` }} />
            </div>
            <p className="text-[10px] font-body text-muted-foreground/50 mt-2">
              Watermarks are applied by the server on every image request. Cache grows as images are viewed. Clear after changing watermark settings.
            </p>
            {/* Last clear result — exact stats */}
            {lastClearStats && !previewJob.running && (
              <div className="mt-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-[10px] font-body text-muted-foreground space-y-1">
                <p className="text-green-400 font-medium">✓ Cleared {lastClearStats.cleared} cached file{lastClearStats.cleared !== 1 ? "s" : ""}</p>
                <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 mt-1">
                  <span>Thumbs (WM): <span className="text-foreground">{lastClearStats.breakdown.thumb_wm}</span></span>
                  <span>Medium (WM): <span className="text-foreground">{lastClearStats.breakdown.medium_wm}</span></span>
                  <span>Full (WM): <span className="text-foreground">{lastClearStats.breakdown.full_wm}</span></span>
                  <span>Thumbs (clean): <span className="text-foreground">{lastClearStats.breakdown.thumb_clean}</span></span>
                  <span>Medium (clean): <span className="text-foreground">{lastClearStats.breakdown.medium_clean}</span></span>
                  <span>Full (clean): <span className="text-foreground">{lastClearStats.breakdown.full_clean}</span></span>
                </div>
              </div>
            )}
            {/* Current cache stats */}
            {cacheStats && cacheStats.total > 0 && !previewJob.running && (
              <div className="mt-3 p-3 rounded-lg bg-secondary/50 border border-border/30 text-[10px] font-body text-muted-foreground">
                <p className="text-xs font-body text-foreground mb-1.5">Current Cache — {cacheStats.total} file{cacheStats.total !== 1 ? "s" : ""} · {formatBytes(cacheStats.breakdown.totalBytes)}</p>
                <div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
                  <span>Thumbs watermarked: <span className="text-foreground">{cacheStats.breakdown.thumb_wm}</span></span>
                  <span>Medium watermarked: <span className="text-foreground">{cacheStats.breakdown.medium_wm}</span></span>
                  <span>Full watermarked: <span className="text-foreground">{cacheStats.breakdown.full_wm}</span></span>
                  <span>Thumbs clean: <span className="text-foreground">{cacheStats.breakdown.thumb_clean}</span></span>
                  <span>Medium clean: <span className="text-foreground">{cacheStats.breakdown.medium_clean}</span></span>
                  <span>Full clean: <span className="text-foreground">{cacheStats.breakdown.full_clean}</span></span>
                </div>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                onClick={() => handleRebuildPreviews(true)}
                disabled={previewJob.running}
                className="gap-2 font-body text-xs"
              >
                <RefreshCw className={`w-4 h-4 ${previewJob.running ? "animate-spin" : ""}`} />
                {previewJob.running ? "Clearing…" : "Clear Server Image Cache"}
              </Button>
              {previewJob.running && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { clearAbortRef.current?.abort(); }}
                  className="gap-2 font-body text-xs border-border text-foreground"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </Button>
              )}
            </div>
            <p className="text-[10px] font-body text-muted-foreground/50 mt-2">
              Run this after updating watermark settings so the gallery fetches fresh watermarked images.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs font-body text-muted-foreground mb-1.5">
              <span>
                {previewJob.running
                  ? (previewJob.stage || "Regenerating baked previews…")
                  : (thumbnailPct === 100
                    ? "Baked previews are ready"
                    : `${withThumbnails} of ${totalPhotos} photos optimised`)}
              </span>
              <span className={previewJob.running ? "text-primary" : (thumbnailPct === 100 ? "text-green-500" : "text-primary")}>
                {previewJob.running
                  ? (previewJob.total > 0 ? `${previewJob.done}/${previewJob.total}` : "Working…")
                  : `${thumbnailPct}%`}
              </span>
            </div>
            <div className="h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${previewJob.running ? "bg-primary" : (thumbnailPct === 100 ? "bg-green-500" : "bg-primary")}`}
                style={{ width: `${previewJob.running ? (previewJob.total > 0 ? Math.max(4, (previewJob.done / previewJob.total) * 100) : 12) : thumbnailPct}%` }}
              />
            </div>
            <p className="text-[10px] font-body text-muted-foreground/50 mt-2">
              {previewJob.running
                ? `${previewJob.stage || "Regenerating baked previews…"}${previewJob.total > 0 ? ` ${previewJob.done}/${previewJob.total}` : ""}`
                : (thumbnailPct === 100
                  ? "✓ All photos have baked thumbnail, medium and protected preview variants ready for gallery and lightbox use."
                  : `Generating ${totalPhotos - withThumbnails} missing preview(s) in background…`)}
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <Button size="sm" variant="outline" onClick={() => handleRebuildPreviews(false)} disabled={previewJob.running} className="gap-2 font-body text-xs border-border text-foreground">
                <RefreshCw className={`w-4 h-4 ${previewJob.running && previewJob.mode === "missing" ? "animate-spin" : ""}`} />
                {previewJob.running && previewJob.mode === "missing" ? `Generating… ${previewJob.done}/${previewJob.total || "?"}` : "Regenerate Missing Baked Previews"}
              </Button>
              <Button size="sm" onClick={() => handleRebuildPreviews(true)} disabled={previewJob.running} className="gap-2 font-body text-xs">
                <Sparkles className={`w-4 h-4 ${previewJob.running && (previewJob.mode === "all" || previewJob.mode === "save") ? "animate-pulse" : ""}`} />
                {previewJob.running && (previewJob.mode === "all" || previewJob.mode === "save") ? `Rebuilding… ${previewJob.done}/${previewJob.total || "?"}` : "Force Rebuild All Baked Previews"}
              </Button>
            </div>
            <p className="text-[10px] font-body text-muted-foreground/50 mt-2">
              Use this after changing watermark text, image, size, position or opacity so gallery thumbnails and lightbox previews match the saved admin watermark config.
            </p>
          </>
        )}
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

            {/* Danger zone: Delete all photos */}
            <div className="mt-4 pt-4 border-t border-destructive/20">
              <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-2">Danger Zone</p>
              {deleteAllState === "confirming" ? (
                <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/5 space-y-2">
                  <p className="text-xs font-body text-destructive">This will permanently delete all {serverStats.photoCount} photo files from disk and clear all photo records from every album. This cannot be undone.</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={handleDeleteAllPhotos} disabled={deleteAllState as string === "deleting"} className="font-body text-xs gap-1.5">
                      <Trash2 className="w-3.5 h-3.5" /> Yes, Delete Everything
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDeleteAllState("idle")} className="font-body text-xs border-border text-foreground">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDeleteAllPhotos}
                  disabled={deleteAllState === "deleting" || !isServerMode()}
                  className="gap-2 font-body text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-4 h-4" />
                  {deleteAllState === "deleting" ? "Deleting…" : "Delete All Photos"}
                </Button>
              )}
              <p className="text-[10px] font-body text-muted-foreground/50 mt-1">Removes all uploaded photos from disk and clears album photo records. Album metadata (titles, clients, bookings) is preserved.</p>
            </div>

            {/* Largest files */}
            {serverStats.photoFiles.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border/30">
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
            <p className="text-[10px] font-body text-muted-foreground">{totalAlbumPhotos} in albums</p>
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
