import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { getBookings, getAlbums, getSettings, updateAlbum, addAlbum } from "@/lib/storage";
import { uploadPhotosToServer, isServerMode, sendEmail } from "@/lib/api";
import { generateThumbnail } from "@/lib/image-utils";
import CameraUsb from "@/plugins/camera-usb";
import type { CameraFile } from "@/plugins/camera-usb";
import { Capacitor } from "@capacitor/core";
import type { Booking, Album, Photo } from "@/lib/types";
import {
  Camera, Upload, CheckCircle, ArrowLeft, FolderOpen,
  Wifi, WifiOff, Zap, Image as ImageIcon, RefreshCw,
  Usb, AlertCircle, Download, Mail, FileImage, Search,
  Clock, ChevronDown, ChevronUp, CalendarCheck, Star,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────
function toMinutes(time: string): number {
  const [h, m] = (time || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function formatTime(time: string): string {
  const [h, m] = (time || "00:00").split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const today = todayStr();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  if (dateStr === today) return "Today";
  if (dateStr === tomorrowStr) return "Tomorrow";
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function getSessionStatus(bk: Booking, albums: Album[]): "next-up" | "in-progress" | "done" | "upcoming" | "past" {
  const today = todayStr();
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const hasAlbum = albums.find(a => a.bookingId === bk.id);
  const hasPhotos = hasAlbum && hasAlbum.photos.length > 0;

  if (bk.status === "completed" || (hasPhotos && bk.date < today)) return "done";
  if (hasPhotos && bk.date === today) return "in-progress";
  if (bk.date < today) return "past";
  if (bk.date === today) {
    const startMins = toMinutes(bk.time);
    const endMins = startMins + (bk.duration || 60);
    if (nowMins >= startMins - 30 && nowMins <= endMins + 60) return "next-up";
    return "upcoming";
  }
  return "upcoming";
}

// ── Component ──────────────────────────────────────────────────
export default function MobileCapture() {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();

  // ── State ──
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [targetAlbum, setTargetAlbum] = useState<Album | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [serverOnline, setServerOnline] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watchInputRef = useRef<HTMLInputElement>(null);

  // Session list UI state
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);

  // USB camera state
  const [cameraConnected, setCameraConnected] = useState(false);
  const [cameraName, setCameraName] = useState("");
  const [cameraFiles, setCameraFiles] = useState<CameraFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [watching, setWatching] = useState(false);
  const [notifyClient, setNotifyClient] = useState(true);
  const [jpegOnly, setJpegOnly] = useState(true);
  const emailSentRef = useRef(false);

  // ── Email notification helper ──
  const sendClientNotification = useCallback(async (type: "album-created" | "photos-uploaded", photoCount?: number) => {
    if (!notifyClient || !serverOnline || !selectedBooking?.clientEmail) return;
    const clientName = selectedBooking.clientName || "Client";
    const sessionType = selectedBooking.type || "Session";
    const sessionDate = selectedBooking.date || "";
    let subject: string;
    let html: string;
    if (type === "album-created") {
      subject = `Your ${sessionType} gallery is being prepared`;
      html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;"><div style="max-width:560px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;border-bottom:1px solid #1f1f1f;"><div style="font-size:32px;margin-bottom:12px;">📸</div><h1 style="color:#e5e7eb;font-size:20px;margin:0 0 6px;">Your Photos Are On The Way!</h1><p style="color:#6b7280;font-size:14px;margin:0;">Hi ${clientName}, we're uploading your photos now.</p></div><div style="padding:28px 32px;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Session</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;font-weight:600;">${sessionType}</td></tr><tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Date</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${sessionDate}</td></tr></table><p style="color:#6b7280;font-size:13px;margin:20px 0 0;line-height:1.6;">We're uploading and reviewing your photos. You'll receive another email when your gallery is ready.</p></div></div></body></html>`;
    } else {
      subject = `${photoCount} new photo${photoCount !== 1 ? "s" : ""} added to your ${sessionType} gallery`;
      html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;"><div style="max-width:560px;margin:40px auto;background:#111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;border-bottom:1px solid #1f1f1f;"><div style="font-size:32px;margin-bottom:12px;">🖼️</div><h1 style="color:#e5e7eb;font-size:20px;margin:0 0 6px;">New Photos Uploaded!</h1><p style="color:#6b7280;font-size:14px;margin:0;">${photoCount} photo${photoCount !== 1 ? "s" : ""} added.</p></div><div style="padding:28px 32px;"><p style="color:#6b7280;font-size:13px;margin:0;line-height:1.6;">These are proofing previews — final edited photos will be available soon.</p></div></div></body></html>`;
    }
    try {
      const result = await sendEmail(selectedBooking.clientEmail, subject, html);
      if (result.ok) toast({ title: "Client notified", description: `Email sent to ${selectedBooking.clientEmail}` });
    } catch (e) { console.error("Email error:", e); }
  }, [notifyClient, serverOnline, selectedBooking]);

  useEffect(() => {
    const bks = getBookings().filter(b => b.status !== "cancelled");
    setBookings(bks);
    setAlbums(getAlbums());
    setServerOnline(isServerMode());
  }, []);

  // ── Categorised + filtered bookings ──
  const { nextUp, upcoming, done } = useMemo(() => {
    const today = todayStr();
    const q = search.toLowerCase().trim();

    const filtered = bookings.filter(bk => {
      if (!q) return true;
      return (
        bk.clientName?.toLowerCase().includes(q) ||
        bk.type?.toLowerCase().includes(q) ||
        bk.date?.includes(q) ||
        bk.time?.includes(q)
      );
    });

    // Sort by date then time
    const sorted = [...filtered].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return toMinutes(a.time) - toMinutes(b.time);
    });

    const nextUpList: Booking[] = [];
    const upcomingList: Booking[] = [];
    const doneList: Booking[] = [];

    for (const bk of sorted) {
      const status = getSessionStatus(bk, albums);
      if (status === "next-up" || status === "in-progress") nextUpList.push(bk);
      else if (status === "done" || status === "past") doneList.push(bk);
      else upcomingList.push(bk);
    }

    return { nextUp: nextUpList, upcoming: upcomingList, done: doneList };
  }, [bookings, albums, search]);

  // ── Camera helpers ──
  const checkCamera = useCallback(async () => {
    if (!isNative) return;
    try {
      const { connected, deviceName } = await CameraUsb.isConnected();
      setCameraConnected(connected);
      setCameraName(deviceName);
      if (connected) {
        const { granted } = await CameraUsb.requestPermission();
        if (granted) {
          const { files } = await CameraUsb.listFiles({ limit: 50 });
          setCameraFiles(files);
        }
      }
    } catch { setCameraConnected(false); }
  }, [isNative]);

  useEffect(() => {
    if (!isNative) return;
    checkCamera();
    const interval = setInterval(checkCamera, 5000);
    return () => clearInterval(interval);
  }, [isNative, checkCamera]);

  useEffect(() => {
    if (!isNative || !watching) return;
    const listener = CameraUsb.addListener?.("newFiles" as any, async (event: any) => {
      const newFiles: CameraFile[] = event.files || [];
      if (newFiles.length > 0 && targetAlbum) {
        toast({ title: `${newFiles.length} new photo(s) detected`, description: "Auto-importing…" });
        await importCameraFiles(newFiles.map(f => f.handle));
      }
    });
    return () => { listener?.then?.((l: any) => l.remove?.()); };
  }, [isNative, watching, targetAlbum]);

  const getOrCreateAlbum = useCallback((booking: Booking): Album => {
    const existing = getAlbums().find(a => a.bookingId === booking.id);
    if (existing) return existing;
    const settings = getSettings();
    const newAlbum: Album = {
      id: crypto.randomUUID(),
      slug: `session-${booking.id.slice(0, 8)}`,
      title: `${booking.type} — ${booking.clientName}`,
      description: `Session on ${booking.date}`,
      coverImage: "",
      date: booking.date,
      photoCount: 0,
      freeDownloads: settings.defaultFreeDownloads,
      pricePerPhoto: settings.defaultPricePerPhoto,
      priceFullAlbum: settings.defaultPriceFullAlbum,
      isPublic: false,
      enabled: false,
      photos: [],
      clientName: booking.clientName,
      clientEmail: booking.clientEmail,
      bookingId: booking.id,
    };
    addAlbum(newAlbum);
    setAlbums(prev => [...prev, newAlbum]);
    return newAlbum;
  }, []);

  const selectBooking = (booking: Booking) => {
    setSelectedBooking(booking);
    const existingAlbum = getAlbums().find(a => a.bookingId === booking.id);
    const album = getOrCreateAlbum(booking);
    setTargetAlbum(album);
    setUploadedCount(0);
    emailSentRef.current = false;
    if (!existingAlbum) {
      sendClientNotification("album-created");
      emailSentRef.current = true;
    }
    if (isNative) checkCamera();
  };

  // ── Import from USB Camera ──
  const importCameraFiles = async (handles: number[]) => {
    if (!targetAlbum || handles.length === 0) return;
    setImporting(true);
    setImportProgress(0);
    try {
      const { files: imported } = await CameraUsb.importFiles({ handles });
      setImportProgress(50);
      const newPhotos: Photo[] = [];
      if (serverOnline) {
        for (let i = 0; i < imported.length; i++) {
          const f = imported[i];
          try {
            const response = await fetch(f.uri);
            const blob = await response.blob();
            const file = new File([blob], f.localPath.split("/").pop() || `photo_${i}.jpg`, { type: "image/jpeg" });
            const results = await uploadPhotosToServer([file], () => {});
            for (const r of results) {
              const thumb = await generateThumbnail(r.url, 300, 0.6).catch(() => r.url);
              newPhotos.push({ id: r.id, src: r.url, thumbnail: thumb, title: r.originalName, width: 0, height: 0, proofing: true });
            }
          } catch (e) { console.error("Upload error:", f.localPath, e); }
          setImportProgress(50 + Math.round(((i + 1) / imported.length) * 50));
        }
      } else {
        for (const f of imported) {
          newPhotos.push({ id: crypto.randomUUID(), src: f.uri, thumbnail: f.uri, title: f.localPath.split("/").pop() || "photo", width: 0, height: 0, proofing: true });
        }
        setImportProgress(100);
      }
      if (newPhotos.length > 0) {
        const freshAlbum = getAlbums().find(a => a.id === targetAlbum.id) || targetAlbum;
        const updated: Album = { ...freshAlbum, photos: [...freshAlbum.photos, ...newPhotos], photoCount: freshAlbum.photos.length + newPhotos.length, coverImage: freshAlbum.coverImage || (newPhotos[0]?.src ?? "") };
        updateAlbum(updated);
        setTargetAlbum(updated);
        setUploadedCount(prev => prev + newPhotos.length);
        toast({ title: `${newPhotos.length} photos imported`, description: "Tagged as proofing" });
        sendClientNotification("photos-uploaded", newPhotos.length);
      }
      setCameraFiles(prev => prev.filter(f => !handles.includes(f.handle)));
    } catch (err) {
      console.error(err);
      toast({ title: "Import error", variant: "destructive" });
    } finally { setImporting(false); }
  };

  const toggleLiveWatch = async () => {
    if (watching) {
      await CameraUsb.stopWatching();
      setWatching(false);
      toast({ title: "Live capture stopped" });
    } else {
      await CameraUsb.startWatching({ intervalMs: 2000 });
      setWatching(true);
      toast({ title: "Live capture started", description: "New photos will auto-import" });
    }
  };

  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0 || !targetAlbum) return;
    const rawExtensions = [".nef", ".cr2", ".cr3", ".arw", ".orf", ".rw2", ".dng", ".raf"];
    const imageFiles = Array.from(files).filter(f => {
      if (!f.type.startsWith("image/")) return false;
      if (jpegOnly) { const ext = f.name.toLowerCase().slice(f.name.lastIndexOf(".")); return !rawExtensions.includes(ext); }
      return true;
    });
    if (imageFiles.length === 0) { toast({ title: "No images found", variant: "destructive" }); return; }
    setPendingFiles(prev => [...prev, ...imageFiles]);
    setUploading(true);
    setUploadProgress(0);
    try {
      if (serverOnline) {
        const results = await uploadPhotosToServer(imageFiles, (done, total) => { setUploadProgress(Math.round((done / total) * 100)); });
        const newPhotos: Photo[] = [];
        for (const r of results) {
          const thumb = await generateThumbnail(r.url, 300, 0.6).catch(() => r.url);
          newPhotos.push({ id: r.id, src: r.url, thumbnail: thumb, title: r.originalName, width: 0, height: 0, proofing: true });
        }
        const freshAlbum = getAlbums().find(a => a.id === targetAlbum.id) || targetAlbum;
        const updated: Album = { ...freshAlbum, photos: [...freshAlbum.photos, ...newPhotos], photoCount: freshAlbum.photos.length + newPhotos.length, coverImage: freshAlbum.coverImage || (newPhotos[0]?.src ?? "") };
        updateAlbum(updated);
        setTargetAlbum(updated);
        setUploadedCount(prev => prev + newPhotos.length);
        toast({ title: `${newPhotos.length} photos uploaded`, description: "Tagged as proofing" });
        sendClientNotification("photos-uploaded", newPhotos.length);
      } else {
        toast({ title: "Offline — saved locally", description: `${imageFiles.length} files queued` });
      }
    } catch (err) { console.error(err); toast({ title: "Upload error", variant: "destructive" }); }
    finally { setUploading(false); }
  };

  // ── Booking card ──
  const BookingCard = ({ bk, highlight }: { bk: Booking; highlight?: boolean }) => {
    const status = getSessionStatus(bk, albums);
    const hasAlbum = albums.find(a => a.bookingId === bk.id);
    const photoCount = hasAlbum?.photos.length ?? 0;
    const isToday = bk.date === todayStr();

    return (
      <Card
        className={`p-4 cursor-pointer transition-all active:scale-[0.98] ${
          highlight
            ? "border-primary/50 bg-primary/5 hover:bg-primary/10"
            : "hover:bg-accent/40"
        }`}
        onClick={() => selectBooking(bk)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {highlight && <Star className="w-3.5 h-3.5 text-primary fill-primary flex-shrink-0" />}
              <p className="font-display text-foreground truncate">{bk.clientName}</p>
            </div>
            <p className="text-sm text-muted-foreground font-body truncate">{bk.type}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="flex items-center gap-1 text-xs text-muted-foreground font-body">
                <Clock className="w-3 h-3" />
                {isToday ? formatTime(bk.time) : `${formatDate(bk.date)} · ${formatTime(bk.time)}`}
              </span>
              {bk.duration && (
                <span className="text-xs text-muted-foreground font-body">{bk.duration}min</span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <Badge
              variant={bk.status === "confirmed" ? "default" : "secondary"}
              className="text-xs"
            >
              {bk.status}
            </Badge>
            {photoCount > 0 && (
              <Badge variant="outline" className="text-xs gap-1">
                <ImageIcon className="w-3 h-3" /> {photoCount}
              </Badge>
            )}
            {status === "done" && (
              <CheckCircle className="w-4 h-4 text-green-500" />
            )}
            {status === "in-progress" && (
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            )}
          </div>
        </div>
      </Card>
    );
  };

  // ── Session Picker ──
  if (!selectedBooking) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3 mb-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-display text-foreground flex-1">Mobile Capture</h1>
            <div className="flex items-center gap-1.5">
              {isNative && (
                <Badge variant={cameraConnected ? "default" : "outline"} className="gap-1 text-xs">
                  <Usb className="w-3 h-3" />
                  {cameraConnected ? cameraName || "Z6III" : "No Camera"}
                </Badge>
              )}
              <Badge variant={serverOnline ? "default" : "destructive"} className="gap-1 text-xs">
                {serverOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {serverOnline ? "Online" : "Offline"}
              </Badge>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, type, date…"
              className="pl-9 bg-secondary border-border font-body text-sm h-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">

            {/* ── Next Up ── */}
            {nextUp.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <h2 className="text-xs font-body tracking-wider uppercase text-primary font-semibold">Next Up</h2>
                  <span className="text-xs text-muted-foreground font-body">· {nextUp.length}</span>
                </div>
                <div className="space-y-2">
                  {nextUp.map(bk => <BookingCard key={bk.id} bk={bk} highlight />)}
                </div>
              </section>
            )}

            {/* ── Upcoming ── */}
            {upcoming.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <CalendarCheck className="w-3.5 h-3.5 text-muted-foreground" />
                  <h2 className="text-xs font-body tracking-wider uppercase text-muted-foreground">Upcoming</h2>
                  <span className="text-xs text-muted-foreground font-body">· {upcoming.length}</span>
                </div>
                <div className="space-y-2">
                  {upcoming.map(bk => <BookingCard key={bk.id} bk={bk} />)}
                </div>
              </section>
            )}

            {/* ── Done ── */}
            {done.length > 0 && (
              <section>
                <button
                  className="flex items-center gap-2 mb-3 w-full text-left"
                  onClick={() => setShowDone(v => !v)}
                >
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  <h2 className="text-xs font-body tracking-wider uppercase text-muted-foreground">Done</h2>
                  <span className="text-xs text-muted-foreground font-body">· {done.length}</span>
                  <span className="ml-auto">
                    {showDone ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </span>
                </button>
                {showDone && (
                  <div className="space-y-2">
                    {done.map(bk => <BookingCard key={bk.id} bk={bk} />)}
                  </div>
                )}
              </section>
            )}

            {nextUp.length === 0 && upcoming.length === 0 && done.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Camera className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-body text-sm">{search ? "No sessions match your search" : "No active bookings"}</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ── Capture View (unchanged from original) ──
  const filteredCameraFiles = jpegOnly
    ? cameraFiles.filter(f => f.mimeType === "image/jpeg" || f.name?.toLowerCase().endsWith(".jpg") || f.name?.toLowerCase().endsWith(".jpeg"))
    : cameraFiles;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => { setSelectedBooking(null); setTargetAlbum(null); setWatching(false); CameraUsb.stopWatching().catch(() => {}); }}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-display text-foreground truncate">{selectedBooking.clientName}</h1>
          <p className="text-xs text-muted-foreground font-body">{selectedBooking.type} · {formatDate(selectedBooking.date)} · {formatTime(selectedBooking.time)}</p>
        </div>
        <div className="flex items-center gap-2">
          {isNative && <Badge variant={cameraConnected ? "default" : "outline"} className="gap-1"><Usb className="w-3 h-3" /></Badge>}
          <Badge variant={serverOnline ? "default" : "destructive"} className="gap-1">
            {serverOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-display text-foreground">{targetAlbum?.photoCount || 0}</p>
            <p className="text-xs text-muted-foreground font-body">In Album</p>
          </div>
          <div>
            <p className="text-2xl font-display text-foreground">{uploadedCount}</p>
            <p className="text-xs text-muted-foreground font-body">This Session</p>
          </div>
          <div>
            <p className="text-2xl font-display text-foreground">{isNative ? filteredCameraFiles.length : pendingFiles.length}</p>
            <p className="text-xs text-muted-foreground font-body">{isNative ? "On Camera" : "Local"}</p>
          </div>
        </div>
      </Card>

      {/* Progress */}
      {(uploading || importing) && (
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-body text-foreground">{importing ? "Importing from camera…" : "Uploading…"}</span>
            <span className="text-sm font-body text-muted-foreground ml-auto">{importing ? importProgress : uploadProgress}%</span>
          </div>
          <Progress value={importing ? importProgress : uploadProgress} className="h-2" />
        </Card>
      )}

      {/* Notify + JPEG toggles */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className={`w-4 h-4 ${notifyClient ? "text-primary" : "text-muted-foreground"}`} />
              <p className="text-xs font-display text-foreground">Notify</p>
            </div>
            <Switch checked={notifyClient} onCheckedChange={setNotifyClient} disabled={!selectedBooking?.clientEmail || !serverOnline} />
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileImage className={`w-4 h-4 ${jpegOnly ? "text-primary" : "text-muted-foreground"}`} />
              <p className="text-xs font-display text-foreground">JPEG Only</p>
            </div>
            <Switch checked={jpegOnly} onCheckedChange={setJpegOnly} />
          </div>
        </Card>
      </div>

      {/* Camera section */}
      {isNative && (
        <Card className="p-4 mb-4">
          {cameraConnected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Usb className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-sm font-display text-foreground">{cameraName || "Camera Connected"}</p>
                    <p className="text-xs text-muted-foreground font-body">{filteredCameraFiles.length} photos{jpegOnly ? " (JPEG)" : ""}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={checkCamera}><RefreshCw className="w-3 h-3 mr-1" /> Refresh</Button>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <Zap className={`w-4 h-4 ${watching ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-display text-foreground">Live Capture</p>
                    <p className="text-xs text-muted-foreground font-body">Auto-import new shots</p>
                  </div>
                </div>
                <Switch checked={watching} onCheckedChange={toggleLiveWatch} />
              </div>
              {filteredCameraFiles.length > 0 && !watching && (
                <Button className="w-full" onClick={() => importCameraFiles(filteredCameraFiles.map(f => f.handle))} disabled={importing}>
                  <Download className="w-4 h-4 mr-2" /> Import All ({filteredCameraFiles.length})
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-muted-foreground">
              <AlertCircle className="w-5 h-5" />
              <div>
                <p className="text-sm font-display text-foreground">No camera detected</p>
                <p className="text-xs font-body">Connect your Nikon Z6III via USB-C</p>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Manual file pickers */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Button size="lg" variant="secondary" className="h-16 flex-col gap-2" onClick={() => fileInputRef.current?.click()} disabled={uploading || importing}>
          <FolderOpen className="w-5 h-5" />
          <span className="text-xs font-body">Browse Files</span>
        </Button>
        <Button size="lg" variant="secondary" className="h-16 flex-col gap-2" onClick={() => watchInputRef.current?.click()} disabled={uploading || importing}>
          <Camera className="w-5 h-5" />
          <span className="text-xs font-body">Phone Camera</span>
        </Button>
      </div>

      {/* Recent uploads */}
      {targetAlbum && targetAlbum.photos.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-display text-foreground mb-3">Recent Uploads</p>
          <div className="grid grid-cols-4 gap-2">
            {targetAlbum.photos.slice(-8).reverse().map(photo => (
              <div key={photo.id} className="relative aspect-square rounded-md overflow-hidden bg-muted">
                <img src={photo.thumbnail || photo.src} alt={photo.title} className="w-full h-full object-cover" />
                {photo.proofing && (
                  <Badge className="absolute top-1 left-1 text-[9px] px-1 py-0 bg-primary/90 text-primary-foreground border-0">PROOF</Badge>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFilePick(e.target.files)} />
      <input ref={watchInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { handleFilePick(e.target.files); if (e.target) e.target.value = ""; }} />
    </div>
  );
}
