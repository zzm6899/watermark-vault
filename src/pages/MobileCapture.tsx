import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getBookings, getAlbums, getSettings, updateAlbum, addAlbum, updateBooking } from "@/lib/storage";
import { uploadPhotosToServer, isServerMode, sendEmail } from "@/lib/api";
import { generateThumbnail } from "@/lib/image-utils";
import CameraUsb from "@/plugins/camera-usb";
import type { CameraFile } from "@/plugins/camera-usb";
import { Capacitor } from "@capacitor/core";
import type { Booking, Album, Photo } from "@/lib/types";
import {
  Camera, ArrowLeft, FolderOpen,
  Wifi, WifiOff, Zap, Image as ImageIcon, RefreshCw,
  Usb, AlertCircle, Download, Mail, FileImage, Search,
  Clock, ChevronDown, ChevronUp, CheckCircle2, Users,
  Star, CalendarDays,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Helpers ───────────────────────────────────────────────────
function toMinutes(time: string): number {
  const [h, m] = (time || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}
function formatTime12(t: string): string {
  const [h, m] = (t || "00:00").split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}
function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const today = todayStr();
  const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
  const tmrwStr = tmrw.toISOString().split("T")[0];
  if (dateStr === today) return "Today";
  if (dateStr === tmrwStr) return "Tomorrow";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
function formatDuration(mins: number) {
  if (mins >= 60) { const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${mins}m`;
}
type SessionStatus = "next-up" | "in-progress" | "upcoming" | "done" | "past";
function getSessionStatus(bk: Booking, albums: Album[]): SessionStatus {
  const today = todayStr();
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const hasAlbum = albums.find(a => a.bookingId === bk.id);
  const hasPhotos = hasAlbum && hasAlbum.photos.length > 0;
  if (bk.status === "completed" || (hasPhotos && bk.date < today)) return "done";
  if (bk.date < today) return "past";
  if (hasPhotos && bk.date === today) return "in-progress";
  if (bk.date === today) {
    const startMins = toMinutes(bk.time);
    const endMins = startMins + (bk.duration || 60);
    if (nowMins >= startMins - 30 && nowMins <= endMins + 60) return "next-up";
  }
  return "upcoming";
}


// ── Error Boundary — prevents PTP crash from killing the whole page ──
class CameraErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error?.message || "Unknown error" };
  }
  componentDidCatch(error: Error) {
    console.error("MobileCapture crash:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="glass-panel rounded-xl p-8 max-w-sm w-full text-center space-y-4">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
            <h2 className="font-display text-lg text-foreground">Camera Error</h2>
            <p className="text-sm font-body text-muted-foreground">{this.state.error}</p>
            <p className="text-xs font-body text-muted-foreground/60">Disconnect the camera and try again. If this keeps happening, check USB-C cable and PTP mode on your Z6III.</p>
            <button
              onClick={() => this.setState({ hasError: false, error: "" })}
              className="w-full text-xs font-body tracking-wider uppercase px-4 py-2.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main Component ──────────────────────────────────────────────
function MobileCaptureInner() {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [targetAlbum, setTargetAlbum] = useState<Album | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [serverOnline, setServerOnline] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watchInputRef = useRef<HTMLInputElement>(null);

  // List UI
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "today" | "upcoming" | "done">("all");
  const [showDone, setShowDone] = useState(false);

  // USB camera
  const [cameraConnected, setCameraConnected] = useState(false);
  const [cameraName, setCameraName] = useState("");
  const [cameraFiles, setCameraFiles] = useState<CameraFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [watching, setWatching] = useState(false);
  const [notifyClient, setNotifyClient] = useState(true);
  const [jpegOnly, setJpegOnly] = useState(true);
  const emailSentRef = useRef(false);

  const sendClientNotification = useCallback(async (type: "album-created" | "photos-uploaded", photoCount?: number) => {
    if (!notifyClient || !serverOnline || !selectedBooking?.clientEmail) return;
    const clientName = selectedBooking.clientName || "Client";
    const sessionType = selectedBooking.type || "Session";
    const subject = type === "album-created"
      ? `Your ${sessionType} gallery is being prepared`
      : `${photoCount} new photo${photoCount !== 1 ? "s" : ""} added to your ${sessionType} gallery`;
    const html = type === "album-created"
      ? `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;padding:32px;color:#e5e7eb;"><h1 style="font-size:20px;margin:0 0 12px;">📸 Your Photos Are On The Way!</h1><p style="color:#6b7280;">Hi ${clientName}, we're uploading your ${sessionType} photos now. You'll receive another email when your gallery is ready.</p></div>`
      : `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;padding:32px;color:#e5e7eb;"><h1 style="font-size:20px;margin:0 0 12px;">🖼️ ${photoCount} New Photos Added!</h1><p style="color:#6b7280;">Proofing previews for your ${sessionType} session are ready. Final edited photos coming soon.</p></div>`;
    try {
      const result = await sendEmail(selectedBooking.clientEmail, subject, html);
      if (result.ok) toast.success(`Email sent to ${selectedBooking.clientEmail}`);
    } catch (e) { console.error("Email error:", e); }
  }, [notifyClient, serverOnline, selectedBooking]);

  useEffect(() => {
    setBookings(getBookings().filter(b => b.status !== "cancelled"));
    setAlbums(getAlbums());
    setServerOnline(isServerMode());
  }, []);

  // ── Filtered + grouped bookings ──────────────────────────────
  const { nextUp, todayRest, upcoming, done } = useMemo(() => {
    const q = search.toLowerCase().trim();
    const today = todayStr();

    let list = bookings.filter(bk => {
      if (!q) return true;
      return bk.clientName?.toLowerCase().includes(q) || bk.type?.toLowerCase().includes(q) || bk.date?.includes(q);
    });

    if (activeFilter === "today") list = list.filter(b => b.date === today);
    else if (activeFilter === "upcoming") list = list.filter(b => b.date > today);
    else if (activeFilter === "done") list = list.filter(b => ["done","past","completed"].includes(getSessionStatus(b, albums)));

    const sorted = [...list].sort((a, b) => a.date === b.date ? toMinutes(a.time) - toMinutes(b.time) : a.date.localeCompare(b.date));

    const nextUp: Booking[] = [], todayRest: Booking[] = [], upcoming: Booking[] = [], done: Booking[] = [];
    for (const bk of sorted) {
      const s = getSessionStatus(bk, albums);
      if (s === "next-up" || s === "in-progress") nextUp.push(bk);
      else if (s === "done" || s === "past") done.push(bk);
      else if (bk.date === today) todayRest.push(bk);
      else upcoming.push(bk);
    }
    return { nextUp, todayRest, upcoming, done };
  }, [bookings, albums, search, activeFilter]);

  // ── Camera ──────────────────────────────────────────────────
  const checkCamera = useCallback(async () => {
    if (!isNative) return;
    try {
      const result = await CameraUsb.isConnected();
      const connected = result?.connected ?? false;
      const deviceName = result?.deviceName ?? "";
      setCameraConnected(connected);
      setCameraName(deviceName);
      if (!connected) { setCameraFiles([]); return; }
      // Request permission separately — may throw if camera disconnected between steps
      let granted = false;
      try {
        const permResult = await CameraUsb.requestPermission();
        granted = permResult?.granted ?? false;
      } catch (permErr) {
        console.warn("Camera permission request failed:", permErr);
        setCameraConnected(false);
        return;
      }
      if (!granted) { console.warn("Camera permission denied"); return; }
      // List files — wrap separately so permission success isn't lost on list failure
      try {
        const { files } = await CameraUsb.listFiles({ limit: 50, jpegOnly: false });
        setCameraFiles(files ?? []);
      } catch (listErr) {
        console.warn("Camera listFiles failed:", listErr);
        setCameraFiles([]);
      }
    } catch (err) {
      console.warn("checkCamera failed:", err);
      setCameraConnected(false);
      setCameraFiles([]);
    }
  }, [isNative]);

  useEffect(() => {
    if (!isNative) return;
    checkCamera();
    const interval = setInterval(checkCamera, 5000);
    return () => clearInterval(interval);
  }, [isNative, checkCamera]);

  // Use a ref for targetAlbum so the listener always has latest value without re-subscribing
  const targetAlbumRef = useRef<Album | null>(null);
  useEffect(() => { targetAlbumRef.current = targetAlbum; }, [targetAlbum]);

  useEffect(() => {
    if (!isNative || !watching) return;
    if (!CameraUsb.addListener) return; // guard — plugin may not support event listeners
    let listenerHandle: any = null;
    const setup = async () => {
      try {
        listenerHandle = await CameraUsb.addListener("newFiles" as any, async (event: any) => {
          try {
            const newFiles: CameraFile[] = event?.files || [];
            if (newFiles.length > 0 && targetAlbumRef.current) {
              toast.info(`${newFiles.length} new photo(s) — auto-importing…`);
              await importCameraFiles(newFiles.map((f: CameraFile) => f.handle));
            }
          } catch (handlerErr) {
            console.error("Live capture handler error:", handlerErr);
          }
        });
      } catch (setupErr) {
        console.error("Failed to attach camera listener:", setupErr);
        setWatching(false);
      }
    };
    setup();
    return () => {
      try { listenerHandle?.remove?.(); } catch {}
    };
  }, [isNative, watching]); // intentionally no targetAlbum dep — use ref instead

  const getOrCreateAlbum = useCallback((booking: Booking): Album => {
    const existing = getAlbums().find(a => a.bookingId === booking.id);
    if (existing) return existing;
    const settings = getSettings();
    const newAlbum: Album = {
      id: crypto.randomUUID(), slug: `session-${booking.id.slice(0, 8)}`,
      title: `${booking.type} — ${booking.clientName}`, description: `Session on ${booking.date}`,
      coverImage: "", date: booking.date, photoCount: 0,
      freeDownloads: settings.defaultFreeDownloads, pricePerPhoto: settings.defaultPricePerPhoto,
      priceFullAlbum: settings.defaultPriceFullAlbum, isPublic: false, enabled: false, photos: [],
      clientName: booking.clientName, clientEmail: booking.clientEmail, bookingId: booking.id,
    };
    addAlbum(newAlbum);
    setAlbums(prev => [...prev, newAlbum]);
    return newAlbum;
  }, []);

  const selectBooking = (booking: Booking) => {
    setSelectedBooking(booking);
    const existing = getAlbums().find(a => a.bookingId === booking.id);
    const album = getOrCreateAlbum(booking);
    setTargetAlbum(album);
    setUploadedCount(0);
    emailSentRef.current = false;
    if (!existing) { sendClientNotification("album-created"); emailSentRef.current = true; }
    if (isNative) checkCamera();
  };

  const importCameraFiles = async (handles: number[]) => {
    if (!targetAlbum || handles.length === 0) return;
    setImporting(true); setImportProgress(0);
    try {
      const { files: imported } = await CameraUsb.importFiles({ handles });
      setImportProgress(50);
      const newPhotos: Photo[] = [];
      if (serverOnline) {
        for (let i = 0; i < imported.length; i++) {
          const f = imported[i];
          try {
            // Retry fetch up to 3x — Android may not have finished writing the file yet
            let blob: Blob | null = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const resp = await fetch(f.uri);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                blob = await resp.blob();
                break;
              } catch (fetchErr) {
                if (attempt < 2) await new Promise(r => setTimeout(r, 500));
                else console.warn("Failed to fetch file after 3 attempts:", f.uri, fetchErr);
              }
            }
            if (!blob) continue; // skip this file rather than crashing
            const file = new File([blob], f.localPath.split("/").pop() || `photo_${i}.jpg`, { type: "image/jpeg" });
            const results = await uploadPhotosToServer([file], () => {});
            for (const r of results) {
              const thumb = await generateThumbnail(r.url, 300, 0.6).catch(() => r.url);
              newPhotos.push({ id: r.id, src: r.url, thumbnail: thumb, title: r.originalName, width: 0, height: 0, proofing: true });
            }
          } catch (e) { console.error("Upload error:", e); }
          setImportProgress(50 + Math.round(((i + 1) / imported.length) * 50));
        }
      } else {
        for (const f of imported)
          newPhotos.push({ id: crypto.randomUUID(), src: f.uri, thumbnail: f.uri, title: f.localPath.split("/").pop() || "photo", width: 0, height: 0, proofing: true });
        setImportProgress(100);
      }
      if (newPhotos.length > 0) {
        const fresh = getAlbums().find(a => a.id === targetAlbum.id) || targetAlbum;
        const updated: Album = { ...fresh, photos: [...fresh.photos, ...newPhotos], photoCount: fresh.photos.length + newPhotos.length, coverImage: fresh.coverImage || newPhotos[0]?.src || "" };
        updateAlbum(updated); setTargetAlbum(updated);
        setUploadedCount(p => p + newPhotos.length);
        toast.success(`${newPhotos.length} photos imported — tagged as proofing`);
        sendClientNotification("photos-uploaded", newPhotos.length);
      }
      setCameraFiles(prev => prev.filter(f => !handles.includes(f.handle)));
    } catch { toast.error("Import error"); }
    finally { setImporting(false); }
  };

  const toggleLiveWatch = async () => {
    if (watching) {
      try { await CameraUsb.stopWatching(); } catch (err) { console.warn("stopWatching error:", err); }
      setWatching(false);
      toast.info("Live capture stopped");
    } else {
      if (!cameraConnected) { toast.error("No camera connected"); return; }
      try {
        await CameraUsb.startWatching({ intervalMs: 2000 });
        setWatching(true);
        toast.success("Live capture active — shoot away!");
      } catch (err: any) {
        console.error("startWatching failed:", err);
        toast.error(`Live capture failed: ${err?.message || "Unknown error"}`);
      }
    }
  };

  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0 || !targetAlbum) return;
    const rawExt = [".nef",".cr2",".cr3",".arw",".orf",".rw2",".dng",".raf"];
    const imageFiles = Array.from(files).filter(f => {
      if (!f.type.startsWith("image/")) return false;
      if (jpegOnly) return !rawExt.includes(f.name.toLowerCase().slice(f.name.lastIndexOf(".")));
      return true;
    });
    if (!imageFiles.length) { toast.error("No images found"); return; }
    setPendingFiles(p => [...p, ...imageFiles]);
    setUploading(true); setUploadProgress(0);
    try {
      if (serverOnline) {
        const results = await uploadPhotosToServer(imageFiles, (done, total) => setUploadProgress(Math.round(done/total*100)));
        const newPhotos: Photo[] = [];
        for (const r of results) {
          const thumb = await generateThumbnail(r.url, 300, 0.6).catch(() => r.url);
          newPhotos.push({ id: r.id, src: r.url, thumbnail: thumb, title: r.originalName, width: 0, height: 0, proofing: true });
        }
        const fresh = getAlbums().find(a => a.id === targetAlbum.id) || targetAlbum;
        const updated: Album = { ...fresh, photos: [...fresh.photos, ...newPhotos], photoCount: fresh.photos.length + newPhotos.length, coverImage: fresh.coverImage || newPhotos[0]?.src || "" };
        updateAlbum(updated); setTargetAlbum(updated);
        setUploadedCount(p => p + newPhotos.length);
        toast.success(`${newPhotos.length} photos uploaded — tagged as proofing`);
        sendClientNotification("photos-uploaded", newPhotos.length);
      } else {
        toast.info(`Offline — ${imageFiles.length} files saved locally`);
      }
    } catch { toast.error("Upload error"); }
    finally { setUploading(false); }
  };

  const filteredCameraFiles = jpegOnly
    ? cameraFiles.filter(f => f.mimeType === "image/jpeg" || f.name?.toLowerCase().match(/\.jpe?g$/))
    : cameraFiles;

  // ── Booking card ────────────────────────────────────────────
  const BookingCard = ({ bk }: { bk: Booking }) => {
    const status = getSessionStatus(bk, albums);
    const album = albums.find(a => a.bookingId === bk.id);
    const photoCount = album?.photos.length ?? 0;
    const isNextUp = status === "next-up" || status === "in-progress";

    return (
      <div
        className={`glass-panel rounded-xl overflow-hidden cursor-pointer transition-all active:scale-[0.99] ${isNextUp ? "ring-1 ring-primary/40" : ""}`}
        onClick={() => selectBooking(bk)}
      >
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isNextUp ? "bg-primary/20" : "bg-secondary"}`}>
              {isNextUp
                ? <Star className="w-3.5 h-3.5 text-primary fill-primary/50" />
                : status === "done" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                : <Users className="w-3.5 h-3.5 text-muted-foreground" />
              }
            </div>
            <div className="flex-1 min-w-0">
              {/* Name row */}
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="text-sm font-body text-foreground font-medium truncate">{bk.clientName}</h3>
                {isNextUp && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />}
              </div>
              {/* Time row — full width, never truncated by badge */}
              <p className="text-xs font-body text-muted-foreground">
                {formatDate(bk.date)}{bk.time ? ` · ${formatTime12(bk.time)}` : ""}{bk.duration ? ` · ${formatDuration(bk.duration)}` : ""}
              </p>
              {/* Type + status row */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[10px] font-body text-muted-foreground/60 truncate">{bk.type}</span>
                <span className={`text-[9px] font-body tracking-wider uppercase px-1.5 py-0.5 rounded-full border ${
                  bk.status === "confirmed" ? "border-primary/40 text-primary bg-primary/10"
                  : bk.status === "completed" ? "border-green-500/40 text-green-400 bg-green-500/10"
                  : "border-border text-muted-foreground/70 bg-secondary"
                }`}>
                  {bk.status}
                </span>
                {photoCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-body text-muted-foreground/70">
                    <ImageIcon className="w-2.5 h-2.5" /> {photoCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Section header ───────────────────────────────────────────
  const SectionLabel = ({ label, count, icon: Icon, color = "text-muted-foreground" }: { label: string; count: number; icon: any; color?: string }) => (
    <div className="flex items-center gap-2 mb-3 px-1">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className={`text-xs font-body tracking-wider uppercase ${color}`}>{label}</span>
      <span className="text-xs font-body text-muted-foreground/50">· {count}</span>
    </div>
  );

  // ── Filter pills ─────────────────────────────────────────────
  const filters: { id: typeof activeFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "today", label: "Today" },
    { id: "upcoming", label: "Upcoming" },
    { id: "done", label: "Done" },
  ];

  // ═══════════════════════════════════════════════════════════
  // ── SESSION PICKER ─────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════
  if (!selectedBooking) {
    return (
      <div className="min-h-screen bg-background">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/50">
          <div className="p-4 space-y-3">
            {/* Top row — compact so system time doesn't overlap pills */}
            <div className="flex items-center gap-2">
              <button onClick={() => navigate("/admin")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground flex-shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="font-display text-sm text-foreground flex-1 min-w-0 truncate">Capture</span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {isNative && (
                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-body px-2 py-0.5 rounded-full border ${cameraConnected ? "border-primary/50 text-primary bg-primary/10" : "border-border text-muted-foreground/60"}`}>
                    <Usb className="w-2.5 h-2.5" />
                    {cameraConnected ? (cameraName || "Z6III").split(" ")[0] : "No Cam"}
                  </span>
                )}
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-body px-2 py-0.5 rounded-full border ${serverOnline ? "border-primary/50 text-primary bg-primary/10" : "border-destructive/50 text-destructive bg-destructive/10"}`}>
                  {serverOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
                  {serverOnline ? "Online" : "Offline"}
                </span>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search client, type, date…"
                className="pl-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body text-sm h-9"
              />
            </div>

            {/* Filter pills */}
            <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
              {filters.map(f => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id)}
                  className={`flex-shrink-0 text-xs font-body tracking-wider uppercase px-3.5 py-1.5 rounded-full border transition-all ${
                    activeFilter === f.id
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Session list */}
        <div className="p-4 space-y-6">
          {/* Next Up */}
          {nextUp.length > 0 && (
            <section>
              <SectionLabel label="Next Up" count={nextUp.length} icon={Star} color="text-primary" />
              <div className="space-y-2">
                {nextUp.map(bk => <BookingCard key={bk.id} bk={bk} />)}
              </div>
            </section>
          )}

          {/* Today */}
          {todayRest.length > 0 && (
            <section>
              <SectionLabel label="Today" count={todayRest.length} icon={CalendarDays} />
              <div className="space-y-2">
                {todayRest.map(bk => <BookingCard key={bk.id} bk={bk} />)}
              </div>
            </section>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <section>
              <SectionLabel label="Upcoming" count={upcoming.length} icon={Clock} />
              <div className="space-y-2">
                {upcoming.map(bk => <BookingCard key={bk.id} bk={bk} />)}
              </div>
            </section>
          )}

          {/* Done — collapsible */}
          {done.length > 0 && (
            <section>
              <button className="flex items-center gap-2 mb-3 px-1 w-full" onClick={() => setShowDone(v => !v)}>
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Done</span>
                <span className="text-xs font-body text-muted-foreground/50">· {done.length}</span>
                <span className="ml-auto text-muted-foreground">
                  {showDone ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </button>
              <AnimatePresence>
                {showDone && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-2 overflow-hidden">
                    {done.map(bk => <BookingCard key={bk.id} bk={bk} />)}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}

          {nextUp.length === 0 && todayRest.length === 0 && upcoming.length === 0 && done.length === 0 && (
            <div className="glass-panel rounded-xl p-12 text-center">
              <Camera className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-body text-muted-foreground">
                {search ? "No sessions match your search" : "No active bookings"}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // ── CAPTURE VIEW ───────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-background p-4">
            {/* Header — compact, icons only for status to avoid overlapping system time */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => { setSelectedBooking(null); setTargetAlbum(null); if (watching) { setWatching(false); CameraUsb.stopWatching().catch(() => {}); } }}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-display text-foreground truncate leading-tight">{selectedBooking.clientName}</p>
          <p className="text-[10px] font-body text-muted-foreground truncate leading-tight">
            {selectedBooking.type} · {formatDate(selectedBooking.date)} · {formatTime12(selectedBooking.time)}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isNative && (
            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full border ${cameraConnected ? "border-primary/50 text-primary bg-primary/10" : "border-border text-muted-foreground/40"}`}>
              <Usb className="w-3 h-3" />
            </span>
          )}
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full border ${serverOnline ? "border-primary/50 text-primary bg-primary/10" : "border-destructive/50 text-destructive bg-destructive/10"}`}>
            {serverOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </span>
        </div>
      </div>, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getBookings, getAlbums, getSettings, updateAlbum, addAlbum, updateBooking } from "@/lib/storage";
import { uploadPhotosToServer, isServerMode, sendEmail } from "@/lib/api";
import { generateThumbnail } from "@/lib/image-utils";
import CameraUsb from "@/plugins/camera-usb";
import type { CameraFile } from "@/plugins/camera-usb";
import { Capacitor } from "@capacitor/core";
import type { Booking, Album, Photo } from "@/lib/types";
import {
  Camera, ArrowLeft, FolderOpen,
  Wifi, WifiOff, Zap, Image as ImageIcon, RefreshCw,
  Usb, AlertCircle, Download, Mail, FileImage, Search,
  Clock, ChevronDown, ChevronUp, CheckCircle2, Users,
  Star, CalendarDays,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Helpers ───────────────────────────────────────────────────
function toMinutes(time: string): number {
  const [h, m] = (time || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}
function formatTime12(t: string): string {
  const [h, m] = (t || "00:00").split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}
function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const today = todayStr();
  const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
  const tmrwStr = tmrw.toISOString().split("T")[0];
  if (dateStr === today) return "Today";
  if (dateStr === tmrwStr) return "Tomorrow";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
function formatDuration(mins: number) {
  if (mins >= 60) { const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${mins}m`;
}
type SessionStatus = "next-up" | "in-progress" | "upcoming" | "done" | "past";
function getSessionStatus(bk: Booking, albums: Album[]): SessionStatus {
  const today = todayStr();
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const hasAlbum = albums.find(a => a.bookingId === bk.id);
  const hasPhotos = hasAlbum && hasAlbum.photos.length > 0;
  if (bk.status === "completed" || (hasPhotos && bk.date < today)) return "done";
  if (bk.date < today) return "past";
  if (hasPhotos && bk.date === today) return "in-progress";
  if (bk.date === today) {
    const startMins = toMinutes(bk.time);
    const endMins = startMins + (bk.duration || 60);
    if (nowMins >= startMins - 30 && nowMins <= endMins + 60) return "next-up";
  }
  return "upcoming";
}


// ── Error Boundary — prevents PTP crash from killing the whole page ──
class CameraErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error?.message || "Unknown error" };
  }
  componentDidCatch(error: Error) {
    console.error("MobileCapture crash:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="glass-panel rounded-xl p-8 max-w-sm w-full text-center space-y-4">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
            <h2 className="font-display text-lg text-foreground">Camera Error</h2>
            <p className="text-sm font-body text-muted-foreground">{this.state.error}</p>
            <p className="text-xs font-body text-muted-foreground/60">Disconnect the camera and try again. If this keeps happening, check USB-C cable and PTP mode on your Z6III.</p>
            <button
              onClick={() => this.setState({ hasError: false, error: "" })}
              className="w-full text-xs font-body tracking-wider uppercase px-4 py-2.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main Component ──────────────────────────────────────────────
function MobileCaptureInner() {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [targetAlbum, setTargetAlbum] = useState<Album | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [serverOnline, setServerOnline] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watchInputRef = useRef<HTMLInputElement>(null);

  // List UI
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "today" | "upcoming" | "done">("all");
  const [showDone, setShowDone] = useState(false);

  // USB camera
  const [cameraConnected, setCameraConnected] = useState(false);
  const [cameraName, setCameraName] = useState("");
  const [cameraFiles, setCameraFiles] = useState<CameraFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [watching, setWatching] = useState(false);
  const [notifyClient, setNotifyClient] = useState(true);
  const [jpegOnly, setJpegOnly] = useState(true);
  const emailSentRef = useRef(false);

  const sendClientNotification = useCallback(async (type: "album-created" | "photos-uploaded", photoCount?: number) => {
    if (!notifyClient || !serverOnline || !selectedBooking?.clientEmail) return;
    const clientName = selectedBooking.clientName || "Client";
    const sessionType = selectedBooking.type || "Session";
    const subject = type === "album-created"
      ? `Your ${sessionType} gallery is being prepared`
      : `${photoCount} new photo${photoCount !== 1 ? "s" : ""} added to your ${sessionType} gallery`;
    const html = type === "album-created"
      ? `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;padding:32px;color:#e5e7eb;"><h1 style="font-size:20px;margin:0 0 12px;">📸 Your Photos Are On The Way!</h1><p style="color:#6b7280;">Hi ${clientName}, we're uploading your ${sessionType} photos now. You'll receive another email when your gallery is ready.</p></div>`
      : `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;padding:32px;color:#e5e7eb;"><h1 style="font-size:20px;margin:0 0 12px;">🖼️ ${photoCount} New Photos Added!</h1><p style="color:#6b7280;">Proofing previews for your ${sessionType} session are ready. Final edited photos coming soon.</p></div>`;
    try {
      const result = await sendEmail(selectedBooking.clientEmail, subject, html);
      if (result.ok) toast.success(`Email sent to ${selectedBooking.clientEmail}`);
    } catch (e) { console.error("Email error:", e); }
  }, [notifyClient, serverOnline, selectedBooking]);

  useEffect(() => {
    setBookings(getBookings().filter(b => b.status !== "cancelled"));
    setAlbums(getAlbums());
    setServerOnline(isServerMode());
  }, []);

  // ── Filtered + grouped bookings ──────────────────────────────
  const { nextUp, todayRest, upcoming, done } = useMemo(() => {
    const q = search.toLowerCase().trim();
    const today = todayStr();

    let list = bookings.filter(bk => {
      if (!q) return true;
      return bk.clientName?.toLowerCase().includes(q) || bk.type?.toLowerCase().includes(q) || bk.date?.includes(q);
    });

    if (activeFilter === "today") list = list.filter(b => b.date === today);
    else if (activeFilter === "upcoming") list = list.filter(b => b.date > today);
    else if (activeFilter === "done") list = list.filter(b => ["done","past","completed"].includes(getSessionStatus(b, albums)));

    const sorted = [...list].sort((a, b) => a.date === b.date ? toMinutes(a.time) - toMinutes(b.time) : a.date.localeCompare(b.date));

    const nextUp: Booking[] = [], todayRest: Booking[] = [], upcoming: Booking[] = [], done: Booking[] = [];
    for (const bk of sorted) {
      const s = getSessionStatus(bk, albums);
      if (s === "next-up" || s === "in-progress") nextUp.push(bk);
      else if (s === "done" || s === "past") done.push(bk);
      else if (bk.date === today) todayRest.push(bk);
      else upcoming.push(bk);
    }
    return { nextUp, todayRest, upcoming, done };
  }, [bookings, albums, search, activeFilter]);

  // ── Camera ──────────────────────────────────────────────────
  const checkCamera = useCallback(async () => {
    if (!isNative) return;
    try {
      const result = await CameraUsb.isConnected();
      const connected = result?.connected ?? false;
      const deviceName = result?.deviceName ?? "";
      setCameraConnected(connected);
      setCameraName(deviceName);
      if (!connected) { setCameraFiles([]); return; }
      // Request permission separately — may throw if camera disconnected between steps
      let granted = false;
      try {
        const permResult = await CameraUsb.requestPermission();
        granted = permResult?.granted ?? false;
      } catch (permErr) {
        console.warn("Camera permission request failed:", permErr);
        setCameraConnected(false);
        return;
      }
      if (!granted) { console.warn("Camera permission denied"); return; }
      // List files — wrap separately so permission success isn't lost on list failure
      try {
        const { files } = await CameraUsb.listFiles({ limit: 50, jpegOnly: false });
        setCameraFiles(files ?? []);
      } catch (listErr) {
        console.warn("Camera listFiles failed:", listErr);
        setCameraFiles([]);
      }
    } catch (err) {
      console.warn("checkCamera failed:", err);
      setCameraConnected(false);
      setCameraFiles([]);
    }
  }, [isNative]);

  useEffect(() => {
    if (!isNative) return;
    checkCamera();
    const interval = setInterval(checkCamera, 5000);
    return () => clearInterval(interval);
  }, [isNative, checkCamera]);

  // Use a ref for targetAlbum so the listener always has latest value without re-subscribing
  const targetAlbumRef = useRef<Album | null>(null);
  useEffect(() => { targetAlbumRef.current = targetAlbum; }, [targetAlbum]);

  useEffect(() => {
    if (!isNative || !watching) return;
    if (!CameraUsb.addListener) return; // guard — plugin may not support event listeners
    let listenerHandle: any = null;
    const setup = async () => {
      try {
        listenerHandle = await CameraUsb.addListener("newFiles" as any, async (event: any) => {
          try {
            const newFiles: CameraFile[] = event?.files || [];
            if (newFiles.length > 0 && targetAlbumRef.current) {
              toast.info(`${newFiles.length} new photo(s) — auto-importing…`);
              await importCameraFiles(newFiles.map((f: CameraFile) => f.handle));
            }
          } catch (handlerErr) {
            console.error("Live capture handler error:", handlerErr);
          }
        });
      } catch (setupErr) {
        console.error("Failed to attach camera listener:", setupErr);
        setWatching(false);
      }
    };
    setup();
    return () => {
      try { listenerHandle?.remove?.(); } catch {}
    };
  }, [isNative, watching]); // intentionally no targetAlbum dep — use ref instead

  const getOrCreateAlbum = useCallback((booking: Booking): Album => {
    const existing = getAlbums().find(a => a.bookingId === booking.id);
    if (existing) return existing;
    const settings = getSettings();
    const newAlbum: Album = {
      id: crypto.randomUUID(), slug: `session-${booking.id.slice(0, 8)}`,
      title: `${booking.type} — ${booking.clientName}`, description: `Session on ${booking.date}`,
      coverImage: "", date: booking.date, photoCount: 0,
      freeDownloads: settings.defaultFreeDownloads, pricePerPhoto: settings.defaultPricePerPhoto,
      priceFullAlbum: settings.defaultPriceFullAlbum, isPublic: false, enabled: false, photos: [],
      clientName: booking.clientName, clientEmail: booking.clientEmail, bookingId: booking.id,
    };
    addAlbum(newAlbum);
    setAlbums(prev => [...prev, newAlbum]);
    return newAlbum;
  }, []);

  const selectBooking = (booking: Booking) => {
    setSelectedBooking(booking);
    const existing = getAlbums().find(a => a.bookingId === booking.id);
    const album = getOrCreateAlbum(booking);
    setTargetAlbum(album);
    setUploadedCount(0);
    emailSentRef.current = false;
    if (!existing) { sendClientNotification("album-created"); emailSentRef.current = true; }
    if (isNative) checkCamera();
  };

  const importCameraFiles = async (handles: number[]) => {
    if (!targetAlbum || handles.length === 0) return;
    setImporting(true); setImportProgress(0);
    try {
      const { files: imported } = await CameraUsb.importFiles({ handles });
      setImportProgress(50);
      const newPhotos: Photo[] = [];
      if (serverOnline) {
        for (let i = 0; i < imported.length; i++) {
          const f = imported[i];
          try {
            // Retry fetch up to 3x — Android may not have finished writing the file yet
            let blob: Blob | null = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const resp = await fetch(f.uri);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                blob = await resp.blob();
                break;
              } catch (fetchErr) {
                if (attempt < 2) await new Promise(r => setTimeout(r, 500));
                else console.warn("Failed to fetch file after 3 attempts:", f.uri, fetchErr);
              }
            }
            if (!blob) continue; // skip this file rather than crashing
            const file = new File([blob], f.localPath.split("/").pop() || `photo_${i}.jpg`, { type: "image/jpeg" });
            const results = await uploadPhotosToServer([file], () => {});
            for (const r of results) {
              const thumb = await generateThumbnail(r.url, 300, 0.6).catch(() => r.url);
              newPhotos.push({ id: r.id, src: r.url, thumbnail: thumb, title: r.originalName, width: 0, height: 0, proofing: true });
            }
          } catch (e) { console.error("Upload error:", e); }
          setImportProgress(50 + Math.round(((i + 1) / imported.length) * 50));
        }
      } else {
        for (const f of imported)
          newPhotos.push({ id: crypto.randomUUID(), src: f.uri, thumbnail: f.uri, title: f.localPath.split("/").pop() || "photo", width: 0, height: 0, proofing: true });
        setImportProgress(100);
      }
      if (newPhotos.length > 0) {
        const fresh = getAlbums().find(a => a.id === targetAlbum.id) || targetAlbum;
        const updated: Album = { ...fresh, photos: [...fresh.photos, ...newPhotos], photoCount: fresh.photos.length + newPhotos.length, coverImage: fresh.coverImage || newPhotos[0]?.src || "" };
        updateAlbum(updated); setTargetAlbum(updated);
        setUploadedCount(p => p + newPhotos.length);
        toast.success(`${newPhotos.length} photos imported — tagged as proofing`);
        sendClientNotification("photos-uploaded", newPhotos.length);
      }
      setCameraFiles(prev => prev.filter(f => !handles.includes(f.handle)));
    } catch { toast.error("Import error"); }
    finally { setImporting(false); }
  };

  const toggleLiveWatch = async () => {
    if (watching) {
      try { await CameraUsb.stopWatching(); } catch (err) { console.warn("stopWatching error:", err); }
      setWatching(false);
      toast.info("Live capture stopped");
    } else {
      if (!cameraConnected) { toast.error("No camera connected"); return; }
      try {
        await CameraUsb.startWatching({ intervalMs: 2000 });
        setWatching(true);
        toast.success("Live capture active — shoot away!");
      } catch (err: any) {
        console.error("startWatching failed:", err);
        toast.error(`Live capture failed: ${err?.message || "Unknown error"}`);
      }
    }
  };

  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0 || !targetAlbum) return;
    const rawExt = [".nef",".cr2",".cr3",".arw",".orf",".rw2",".dng",".raf"];
    const imageFiles = Array.from(files).filter(f => {
      if (!f.type.startsWith("image/")) return false;
      if (jpegOnly) return !rawExt.includes(f.name.toLowerCase().slice(f.name.lastIndexOf(".")));
      return true;
    });
    if (!imageFiles.length) { toast.error("No images found"); return; }
    setPendingFiles(p => [...p, ...imageFiles]);
    setUploading(true); setUploadProgress(0);
    try {
      if (serverOnline) {
        const results = await uploadPhotosToServer(imageFiles, (done, total) => setUploadProgress(Math.round(done/total*100)));
        const newPhotos: Photo[] = [];
        for (const r of results) {
          const thumb = await generateThumbnail(r.url, 300, 0.6).catch(() => r.url);
          newPhotos.push({ id: r.id, src: r.url, thumbnail: thumb, title: r.originalName, width: 0, height: 0, proofing: true });
        }
        const fresh = getAlbums().find(a => a.id === targetAlbum.id) || targetAlbum;
        const updated: Album = { ...fresh, photos: [...fresh.photos, ...newPhotos], photoCount: fresh.photos.length + newPhotos.length, coverImage: fresh.coverImage || newPhotos[0]?.src || "" };
        updateAlbum(updated); setTargetAlbum(updated);
        setUploadedCount(p => p + newPhotos.length);
        toast.success(`${newPhotos.length} photos uploaded — tagged as proofing`);
        sendClientNotification("photos-uploaded", newPhotos.length);
      } else {
        toast.info(`Offline — ${imageFiles.length} files saved locally`);
      }
    } catch { toast.error("Upload error"); }
    finally { setUploading(false); }
  };

  const filteredCameraFiles = jpegOnly
    ? cameraFiles.filter(f => f.mimeType === "image/jpeg" || f.name?.toLowerCase().match(/\.jpe?g$/))
    : cameraFiles;

  // ── Booking card ────────────────────────────────────────────
  const BookingCard = ({ bk }: { bk: Booking }) => {
    const status = getSessionStatus(bk, albums);
    const album = albums.find(a => a.bookingId === bk.id);
    const photoCount = album?.photos.length ?? 0;
    const isNextUp = status === "next-up" || status === "in-progress";

    return (
      <div
        className={`glass-panel rounded-xl overflow-hidden cursor-pointer transition-all active:scale-[0.99] ${isNextUp ? "ring-1 ring-primary/40" : ""}`}
        onClick={() => selectBooking(bk)}
      >
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isNextUp ? "bg-primary/20" : "bg-secondary"}`}>
              {isNextUp
                ? <Star className="w-3.5 h-3.5 text-primary fill-primary/50" />
                : status === "done" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                : <Users className="w-3.5 h-3.5 text-muted-foreground" />
              }
            </div>
            <div className="flex-1 min-w-0">
              {/* Name row */}
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="text-sm font-body text-foreground font-medium truncate">{bk.clientName}</h3>
                {isNextUp && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />}
              </div>
              {/* Time row — full width, never truncated by badge */}
              <p className="text-xs font-body text-muted-foreground">
                {formatDate(bk.date)}{bk.time ? ` · ${formatTime12(bk.time)}` : ""}{bk.duration ? ` · ${formatDuration(bk.duration)}` : ""}
              </p>
              {/* Type + status row */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[10px] font-body text-muted-foreground/60 truncate">{bk.type}</span>
                <span className={`text-[9px] font-body tracking-wider uppercase px-1.5 py-0.5 rounded-full border ${
                  bk.status === "confirmed" ? "border-primary/40 text-primary bg-primary/10"
                  : bk.status === "completed" ? "border-green-500/40 text-green-400 bg-green-500/10"
                  : "border-border text-muted-foreground/70 bg-secondary"
                }`}>
                  {bk.status}
                </span>
                {photoCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-body text-muted-foreground/70">
                    <ImageIcon className="w-2.5 h-2.5" /> {photoCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Section header ───────────────────────────────────────────
  const SectionLabel = ({ label, count, icon: Icon, color = "text-muted-foreground" }: { label: string; count: number; icon: any; color?: string }) => (
    <div className="flex items-center gap-2 mb-3 px-1">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className={`text-xs font-body tracking-wider uppercase ${color}`}>{label}</span>
      <span className="text-xs font-body text-muted-foreground/50">· {count}</span>
    </div>
  );

  // ── Filter pills ─────────────────────────────────────────────
  const filters: { id: typeof activeFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "today", label: "Today" },
    { id: "upcoming", label: "Upcoming" },
    { id: "done", label: "Done" },
  ];

  // ═══════════════════════════════════════════════════════════
  // ── SESSION PICKER ─────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════
  if (!selectedBooking) {
    return (
      <div className="min-h-screen bg-background">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/50">
          <div className="p-4 space-y-3">
            {/* Top row — compact so system time doesn't overlap pills */}
            <div className="flex items-center gap-2">
              <button onClick={() => navigate("/admin")} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground flex-shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="font-display text-sm text-foreground flex-1 min-w-0 truncate">Capture</span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {isNative && (
                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-body px-2 py-0.5 rounded-full border ${cameraConnected ? "border-primary/50 text-primary bg-primary/10" : "border-border text-muted-foreground/60"}`}>
                    <Usb className="w-2.5 h-2.5" />
                    {cameraConnected ? (cameraName || "Z6III").split(" ")[0] : "No Cam"}
                  </span>
                )}
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-body px-2 py-0.5 rounded-full border ${serverOnline ? "border-primary/50 text-primary bg-primary/10" : "border-destructive/50 text-destructive bg-destructive/10"}`}>
                  {serverOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
                  {serverOnline ? "Online" : "Offline"}
                </span>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search client, type, date…"
                className="pl-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground/50 font-body text-sm h-9"
              />
            </div>

            {/* Filter pills */}
            <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
              {filters.map(f => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id)}
                  className={`flex-shrink-0 text-xs font-body tracking-wider uppercase px-3.5 py-1.5 rounded-full border transition-all ${
                    activeFilter === f.id
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Session list */}
        <div className="p-4 space-y-6">
          {/* Next Up */}
          {nextUp.length > 0 && (
            <section>
              <SectionLabel label="Next Up" count={nextUp.length} icon={Star} color="text-primary" />
              <div className="space-y-2">
                {nextUp.map(bk => <BookingCard key={bk.id} bk={bk} />)}
              </div>
            </section>
          )}

          {/* Today */}
          {todayRest.length > 0 && (
            <section>
              <SectionLabel label="Today" count={todayRest.length} icon={CalendarDays} />
              <div className="space-y-2">
                {todayRest.map(bk => <BookingCard key={bk.id} bk={bk} />)}
              </div>
            </section>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <section>
              <SectionLabel label="Upcoming" count={upcoming.length} icon={Clock} />
              <div className="space-y-2">
                {upcoming.map(bk => <BookingCard key={bk.id} bk={bk} />)}
              </div>
            </section>
          )}

          {/* Done — collapsible */}
          {done.length > 0 && (
            <section>
              <button className="flex items-center gap-2 mb-3 px-1 w-full" onClick={() => setShowDone(v => !v)}>
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Done</span>
                <span className="text-xs font-body text-muted-foreground/50">· {done.length}</span>
                <span className="ml-auto text-muted-foreground">
                  {showDone ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </button>
              <AnimatePresence>
                {showDone && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-2 overflow-hidden">
                    {done.map(bk => <BookingCard key={bk.id} bk={bk} />)}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}

          {nextUp.length === 0 && todayRest.length === 0 && upcoming.length === 0 && done.length === 0 && (
            <div className="glass-panel rounded-xl p-12 text-center">
              <Camera className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-body text-muted-foreground">
                {search ? "No sessions match your search" : "No active bookings"}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // ── CAPTURE VIEW ───────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-background p-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => { setSelectedBooking(null); setTargetAlbum(null); if (watching) { setWatching(false); CameraUsb.stopWatching().catch(() => {}); } }}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-lg text-foreground truncate">{selectedBooking.clientName}</h1>
          <p className="text-xs font-body text-muted-foreground truncate">
            {selectedBooking.type} · {formatDate(selectedBooking.date)} · {formatTime12(selectedBooking.time)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {isNative && (
            <span className={`inline-flex items-center gap-1 text-xs font-body px-2 py-1 rounded-full border ${cameraConnected ? "border-primary/50 text-primary bg-primary/10" : "border-border text-muted-foreground"}`}>
              <Usb className="w-3 h-3" />
            </span>
          )}
          <span className={`inline-flex items-center gap-1 text-xs font-body px-2 py-1 rounded-full border ${serverOnline ? "border-primary/50 text-primary bg-primary/10" : "border-destructive/50 text-destructive"}`}>
            {serverOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="glass-panel rounded-xl p-4 mb-4">
        <div className="grid grid-cols-3 gap-4 text-center divide-x divide-border/50">
          <div><p className="text-2xl font-display text-foreground">{targetAlbum?.photoCount || 0}</p><p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mt-0.5">In Album</p></div>
          <div><p className="text-2xl font-display text-foreground">{uploadedCount}</p><p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mt-0.5">This Session</p></div>
          <div><p className="text-2xl font-display text-foreground">{isNative ? filteredCameraFiles.length : pendingFiles.length}</p><p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground mt-0.5">{isNative ? "On Camera" : "Local"}</p></div>
        </div>
      </div>

      {/* Progress */}
      {(uploading || importing) && (
        <div className="glass-panel rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-body text-foreground">{importing ? "Importing from camera…" : "Uploading…"}</span>
            <span className="text-xs font-body text-muted-foreground ml-auto">{importing ? importProgress : uploadProgress}%</span>
          </div>
          <Progress value={importing ? importProgress : uploadProgress} className="h-1.5" />
        </div>
      )}

      {/* Toggles */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="glass-panel rounded-xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className={`w-4 h-4 ${notifyClient ? "text-primary" : "text-muted-foreground"}`} />
            <span className="text-xs font-body text-foreground">Notify</span>
          </div>
          <Switch checked={notifyClient} onCheckedChange={setNotifyClient} disabled={!selectedBooking?.clientEmail || !serverOnline} />
        </div>
        <div className="glass-panel rounded-xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileImage className={`w-4 h-4 ${jpegOnly ? "text-primary" : "text-muted-foreground"}`} />
            <span className="text-xs font-body text-foreground">JPEG Only</span>
          </div>
          <Switch checked={jpegOnly} onCheckedChange={setJpegOnly} />
        </div>
      </div>

      {/* Camera panel */}
      {isNative && (
        <div className="glass-panel rounded-xl p-4 mb-4">
          {cameraConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Usb className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-sm font-body text-foreground">{cameraName || "Camera Connected"}</p>
                    <p className="text-xs font-body text-muted-foreground">{filteredCameraFiles.length} photos{jpegOnly ? " (JPEG)" : ""}</p>
                  </div>
                </div>
                <button onClick={checkCamera} className="inline-flex items-center gap-1.5 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-full border border-border hover:bg-secondary transition-all">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>

              {/* Live capture toggle */}
              <div className="flex items-center justify-between pt-3 border-t border-border/50">
                <div className="flex items-center gap-2">
                  <Zap className={`w-4 h-4 ${watching ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-body text-foreground">Live Capture</p>
                    <p className="text-xs font-body text-muted-foreground">Auto-import as you shoot</p>
                  </div>
                </div>
                <Switch checked={watching} onCheckedChange={toggleLiveWatch} />
              </div>

              {/* Import all */}
              {filteredCameraFiles.length > 0 && !watching && (
                <Button
                  className="w-full font-body text-xs tracking-wider uppercase gap-2 h-11"
                  onClick={() => importCameraFiles(filteredCameraFiles.map(f => f.handle))}
                  disabled={importing}
                >
                  <Download className="w-4 h-4" />
                  Import All ({filteredCameraFiles.length})
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-muted-foreground/50 flex-shrink-0" />
              <div>
                <p className="text-sm font-body text-foreground">No camera detected</p>
                <p className="text-xs font-body text-muted-foreground">Connect Nikon Z6III via USB-C</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual pickers */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || importing}
          className="glass-panel rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-secondary/30 transition-colors disabled:opacity-50 active:scale-[0.98]"
        >
          <FolderOpen className="w-5 h-5 text-muted-foreground" />
          <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Browse Files</span>
        </button>
        <button
          onClick={() => watchInputRef.current?.click()}
          disabled={uploading || importing}
          className="glass-panel rounded-xl p-4 flex flex-col items-center gap-2 hover:bg-secondary/30 transition-colors disabled:opacity-50 active:scale-[0.98]"
        >
          <Camera className="w-5 h-5 text-muted-foreground" />
          <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Phone Camera</span>
        </button>
      </div>

      {/* Recent uploads */}
      {targetAlbum && targetAlbum.photos.length > 0 && (
        <div className="glass-panel rounded-xl p-4">
          <p className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-3">Recent Uploads</p>
          <div className="grid grid-cols-4 gap-2">
            {targetAlbum.photos.slice(-8).reverse().map(photo => (
              <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-secondary">
                <img src={photo.thumbnail || photo.src} alt={photo.title} className="w-full h-full object-cover" />
                {photo.proofing && (
                  <span className="absolute top-1 left-1 text-[8px] font-body tracking-wider uppercase px-1.5 py-0.5 rounded bg-primary/90 text-primary-foreground leading-tight">PROOF</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mark Complete */}
      {selectedBooking && selectedBooking.status !== "completed" && (
        <div className="mt-4">
          <button
            onClick={() => {
              updateBooking({ ...selectedBooking, status: "completed" });
              setBookings(prev => prev.map(b => b.id === selectedBooking.id ? { ...b, status: "completed" } : b));
              setSelectedBooking(prev => prev ? { ...prev, status: "completed" } : prev);
              toast.success("Session marked as completed");
            }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-green-500/30 text-green-400 bg-green-500/5 text-xs font-body tracking-wider uppercase hover:bg-green-500/10 transition-colors active:scale-[0.99]"
          >
            <CheckCircle2 className="w-4 h-4" />
            Mark Session Complete
          </button>
        </div>
      )}
      {selectedBooking && selectedBooking.status === "completed" && (
        <div className="mt-4 flex items-center justify-center gap-2 py-3 rounded-xl border border-green-500/20 text-green-500/60 bg-green-500/5 text-xs font-body tracking-wider uppercase">
          <CheckCircle2 className="w-4 h-4" />
          Session Completed
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFilePick(e.target.files)} />
      <input ref={watchInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { handleFilePick(e.target.files); if (e.target) e.target.value = ""; }} />
    </div>
  );
}

export default function MobileCapture() {
  return (
    <CameraErrorBoundary>
      <MobileCaptureInner />
    </CameraErrorBoundary>
  );
}
