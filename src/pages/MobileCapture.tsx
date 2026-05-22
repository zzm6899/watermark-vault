import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getBookings, getAlbums, getSettings, updateAlbum, addAlbum, updateBooking, getMobileTenantSession, setMobileTenantSession, isLoggedIn } from "@/lib/storage";
import { uploadPhotosToServer, isSupportedUploadFile, isSupportedPhotoSource, recheckServer, sendEmail, fetchTenantMobileData, saveTenantAlbum, autoCullAlbum, NATIVE_API_ORIGIN, type UploadedPhotoResult } from "@/lib/api";
import { queueOfflineCapture, getOfflineQueue, useOfflineUploadQueue, type OfflineCaptureItem } from "@/lib/usePwa";
import { generateThumbnail, formatSpeed } from "@/lib/image-utils";
import CameraUsb from "@/plugins/camera-usb";
import type { CameraFile } from "@/plugins/camera-usb";
import CameraFtp from "@/plugins/camera-ftp";
import type { CameraFtpCandidate, CameraFtpFile, CameraFtpStatus } from "@/plugins/camera-ftp";
import { Capacitor } from "@capacitor/core";
import type { Booking, Album, Photo, CullStatus } from "@/lib/types";
import {
  Camera, ArrowLeft,
  Wifi, WifiOff, Zap, Image as ImageIcon, RefreshCw,
  Usb, AlertCircle, Download, Mail, FileImage, Search,
  Clock, ChevronDown, ChevronUp, CheckCircle2, Users,
  Star, CalendarDays, ChevronLeft, ChevronRight,
  AlertTriangle, RotateCcw, Settings2, LogOut,
  Pause, Play,
  Activity, CircleDot, FolderOpen, ListFilter, RadioTower, ShieldCheck, UploadCloud,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Helpers ───────────────────────────────────────────────────
function toMinutes(time: string): number {
  const [h, m] = (time || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const FTP_SETTINGS_KEY = "cameraFtpSettings:v1";
const FTP_JPEG_EXTENSIONS = new Set([".jpg", ".jpeg"]);
const FTP_PROOF_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"]);
const FTP_RAW_EXTENSIONS = new Set([".nef", ".nrw", ".raw", ".cr2", ".cr3", ".arw", ".dng", ".raf", ".orf", ".rw2"]);

function loadFtpSettings(): { username: string; password: string; port: number } {
  try {
    const parsed = JSON.parse(localStorage.getItem(FTP_SETTINGS_KEY) || "{}");
    const port = Number(parsed.port);
    return {
      username: typeof parsed.username === "string" && parsed.username.trim() ? parsed.username : "camera",
      password: typeof parsed.password === "string" && parsed.password.trim() ? parsed.password : "camera",
      port: Number.isFinite(port) && port > 0 && port <= 65535 ? port : 2121,
    };
  } catch {
    return { username: "camera", password: "camera", port: 2121 };
  }
}
function saveFtpSettings(settings: { username: string; password: string; port: number }) {
  localStorage.setItem(FTP_SETTINGS_KEY, JSON.stringify(settings));
}

function extensionForName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function filenameFromFtpPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function isProofableFtpName(name: string, jpegOnly: boolean): boolean {
  const ext = extensionForName(name);
  return jpegOnly ? FTP_JPEG_EXTENSIONS.has(ext) : FTP_PROOF_EXTENSIONS.has(ext);
}

function isRawFtpName(name: string): boolean {
  return FTP_RAW_EXTENSIONS.has(extensionForName(name));
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
  const tmrwStr = `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, "0")}-${String(tmrw.getDate()).padStart(2, "0")}`;
  if (dateStr === today) return "Today";
  if (dateStr === tmrwStr) return "Tomorrow";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}
function formatDuration(mins: number) {
  if (mins >= 60) { const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${mins}m`;
}
/** Returns the best thumbnail URL for a photo, optionally scoped to a tenant watermark. */
function getThumbSrc(photo: Photo, tenantSlug?: string | null): string {
  if (!isSupportedPhotoSource(photo.src)) return "";
  const base = photo.thumbnail || (photo.src.startsWith("/uploads/") ? photo.src + "?size=thumb" : photo.src);
  let url = base;
  if (tenantSlug && url.startsWith("/uploads/")) {
    url = url + (url.includes("?") ? "&" : "?") + `tenant=${encodeURIComponent(tenantSlug)}`;
  }
  return Capacitor.isNativePlatform() && url.startsWith("/uploads/") ? `${NATIVE_API_ORIGIN}${url}` : url;
}
/** Returns a medium-resolution URL suitable for the lightbox, optionally scoped to a tenant watermark. */
function getMediumSrc(photo: Photo, tenantSlug?: string | null): string {
  const base = photo.src.startsWith("/uploads/") ? photo.src + "?size=medium" : photo.src;
  let url = base;
  if (tenantSlug && url.startsWith("/uploads/")) {
    url = url + (url.includes("?") ? "&" : "?") + `tenant=${encodeURIComponent(tenantSlug)}`;
  }
  return Capacitor.isNativePlatform() && url.startsWith("/uploads/") ? `${NATIVE_API_ORIGIN}${url}` : url;
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


// ── Upload queue item ──────────────────────────────────────────
type UploadQueueItem = {
  id: string;
  file: File;
  preview: string;   // object URL — revoked after upload completes
  status: "pending" | "uploading" | "done" | "failed";
};

type CaptureTransport = "usb" | "ftp" | "wifi-control";
type CullFilter = "best" | "review" | "reject" | "all";
type CaptureTab = "capture" | "review" | "publish";
type CaptureStatusTone = "idle" | "active" | "success" | "warning";
type CaptureStatus = {
  label: string;
  detail: string;
  tone: CaptureStatusTone;
  updatedAt: number;
};
type CullCountSummary = Partial<Record<"all" | "pick" | "review" | "reject" | "unscored", number>>;
type CaptureBatchSummary = {
  added: number;
  queued: number;
  held: number;
  cullCounts: CullCountSummary | null;
};

function emptyCaptureBatch(): CaptureBatchSummary {
  return { added: 0, queued: 0, held: 0, cullCounts: null };
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function numericCount(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeCullCounts(counts: CullCountSummary) {
  const pick = numericCount(counts.pick);
  const review = numericCount(counts.review) + numericCount(counts.unscored);
  const reject = numericCount(counts.reject);
  return {
    pick,
    review,
    reject,
    bestOf: pick,
  };
}

function formatCullSummary(counts: CullCountSummary): string {
  const normalized = normalizeCullCounts(counts);
  return `${normalized.bestOf} Best of · ${normalized.review} needs review · ${normalized.reject} reject${normalized.reject === 1 ? "" : "s"}`;
}

type CaptureUploadResult = UploadedPhotoResult & {
  cull?: Photo["cull"];
  blurScore?: number;
  duplicateGroupId?: string;
  duplicateRank?: number;
};

function photoFromUploadResult(r: CaptureUploadResult, uploadedAt: string): Photo {
  if (!isSupportedPhotoSource(r.url)) throw new Error(`Unsupported uploaded photo source: ${r.url}`);
  return {
    id: r.id,
    src: r.url,
    thumbnail: r.url + "?size=thumb&wm=0",
    title: r.originalName.replace(/\.[^.]+$/, "").replace(/^_+/, ""),
    originalName: r.originalName,
    width: r.width ?? 800,
    height: r.height ?? 600,
    proofing: true,
    uploadedAt,
    ...(r.takenAt ? { takenAt: r.takenAt } : {}),
    fileSize: r.size,
    ...(r.cull ? { cull: r.cull } : {}),
    ...(r.blurScore != null ? { blurScore: r.blurScore } : {}),
    ...(r.duplicateGroupId ? { duplicateGroupId: r.duplicateGroupId } : {}),
    ...(r.duplicateRank != null ? { duplicateRank: r.duplicateRank } : {}),
  };
}

function matchUploadResultsToFiles(files: File[], results: UploadedPhotoResult[]) {
  const buckets = new Map<string, UploadedPhotoResult[]>();
  for (const result of results) {
    const key = result.originalName || "";
    const list = buckets.get(key) || [];
    list.push(result);
    buckets.set(key, list);
  }
  return files
    .map(file => {
      const list = buckets.get(file.name);
      const result = list?.shift();
      return result ? { file, result } : null;
    })
    .filter((pair): pair is { file: File; result: UploadedPhotoResult } => Boolean(pair));
}

function isBestOfCull(photo: Photo): boolean {
  const status = photo.cull?.status;
  return status === "pick";
}

function buildMobileCullFallback(album: Album): { album: Album; counts: Record<string, number> } {
  const analysedAt = new Date().toISOString();
  const duplicateSignatures = new Map<string, { groupId: string; count: number }>();
  const photos = (album.photos || []).map((photo, index) => {
    const manualPick = !!photo.starred || photo.cull?.status === "pick";
    const signature = [
      (photo.originalName || photo.title || "").toLowerCase(),
      photo.fileSize ? String(photo.fileSize) : "",
      photo.width && photo.height ? `${photo.width}x${photo.height}` : "",
    ].filter(Boolean).join("|");
    let status: CullStatus = manualPick ? "pick" : "review";
    let score = manualPick ? 0.95 : 0.62;
    let duplicateGroupId = photo.duplicateGroupId;
    let duplicateRank = photo.duplicateRank;
    const reasons = new Set(photo.cull?.reasons || []);
    reasons.add("server-analyzer-unavailable");

    if (signature && photo.fileSize) {
      const existing = duplicateSignatures.get(signature);
      if (existing) {
        existing.count += 1;
        duplicateGroupId = existing.groupId;
        duplicateRank = existing.count;
        reasons.add("duplicate");
        if (!manualPick) {
          status = "reject";
          score = 0.25;
        }
      } else {
        duplicateSignatures.set(signature, { groupId: `mobile-dupe-${album.id}-${index}`, count: 1 });
      }
    }

    return {
      ...photo,
      duplicateGroupId,
      duplicateRank,
      cull: {
        ...photo.cull,
        status,
        score,
        reasons: Array.from(reasons),
        duplicateGroupId,
        duplicateRank,
        analysedAt,
      },
    };
  });

  return {
    album: { ...album, photos, photoCount: photos.length },
    counts: {
      pick: photos.filter(photo => photo.cull?.status === "pick").length,
      review: photos.filter(photo => photo.cull?.status === "review").length,
      reject: photos.filter(photo => photo.cull?.status === "reject").length,
      unscored: photos.filter(photo => !photo.cull?.status || photo.cull?.status === "unscored").length,
    },
  };
}

/**
 * Create a temporary Photo backed by a local blob URL for immediate display
 * while the file is being uploaded to the server.
 * Returns both the Photo object and the blob URL so the caller can track the
 * URL for later revocation.
 */
function createLocalPreviewPhoto(file: File): { photo: Photo; blobUrl: string } {
  const blobUrl = URL.createObjectURL(file);
  return {
    blobUrl,
    photo: {
      id: `lp-${crypto.randomUUID()}`,
      src: blobUrl,
      thumbnail: blobUrl,
      title: file.name.replace(/\.[^.]+$/, "").replace(/^_+/, ""),
      width: 0,
      height: 0,
      uploadedAt: new Date().toISOString(),
      localPreview: true,
    },
  };
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

// ── Lightbox image component — shows thumbnail immediately, upgrades to medium ──
function CaptureLightboxImage({ photo, cache, onCacheUpdate, tenantSlug }: {
  photo: Photo;
  cache: Record<string, string>;
  onCacheUpdate: (id: string, url: string) => void;
  tenantSlug?: string | null;
}) {
  const thumbSrc = getThumbSrc(photo, tenantSlug);
  const mediumSrc = getMediumSrc(photo, tenantSlug);
  const [src, setSrc] = useState(cache[photo.id] || thumbSrc);
  const [loaded, setLoaded] = useState(!!cache[photo.id]);

  useEffect(() => {
    if (cache[photo.id]) {
      setSrc(cache[photo.id]);
      setLoaded(true);
      return;
    }
    setSrc(thumbSrc);
    setLoaded(false);
    if (mediumSrc === thumbSrc) { setLoaded(true); return; }
    const img = new window.Image();
    img.onload = () => {
      onCacheUpdate(photo.id, mediumSrc);
      setSrc(mediumSrc);
      setLoaded(true);
    };
    img.onerror = () => setLoaded(true);
    img.src = mediumSrc;
  }, [cache, photo.id, thumbSrc, mediumSrc, onCacheUpdate]);

  return (
    <div className="relative flex items-center justify-center w-full h-full">
      <img
        src={src}
        alt={photo.title}
        className={`max-w-full max-h-[88vh] w-full object-contain rounded transition-all duration-300 ${loaded ? "opacity-100 blur-0" : "opacity-70 blur-[2px]"}`}
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <RefreshCw className="w-6 h-6 text-white/40 animate-spin" />
        </div>
      )}
    </div>
  );
}

// ── Lightbox zoom constants ──────────────────────────────────────
const LIGHTBOX_MIN_ZOOM = 1;
const LIGHTBOX_MAX_ZOOM = 5;
const LIGHTBOX_DOUBLE_TAP_ZOOM = 2.5;
const LIGHTBOX_DOUBLE_TAP_MS = 300;

// ── Main Component ──────────────────────────────────────────────
function AlbumEditModal({ album, onClose, onSave }: { album: Album; onClose: () => void; onSave: (updated: Album) => void }) {
  const [editTitle, setEditTitle] = useState(album.title || "");
  const [editNotes, setEditNotes] = useState((album as any).notes || "");
  const [editClient, setEditClient] = useState(album.clientName || "");
  const [lockDownloads, setLockDownloads] = useState(album.lockDownloadsDuringProofing || false);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-lg bg-background rounded-t-2xl p-5 space-y-4" style={{paddingBottom:"max(20px,env(safe-area-inset-bottom))"}} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display text-base text-foreground">Edit Album</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 text-lg">✕</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Album Title</label>
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Client Name</label>
            <input value={editClient} onChange={e => setEditClient(e.target.value)} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs font-body text-muted-foreground mb-1 block">Notes</label>
            <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3} className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-body text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
          </div>
          {album.proofingEnabled && (
            <div className="flex items-center justify-between py-2 border-t border-border/50">
              <div>
                <p className="text-xs font-body text-foreground">Lock downloads during proofing</p>
                <p className="text-[10px] font-body text-muted-foreground/60 mt-0.5">Block downloads until finals are delivered</p>
              </div>
              <Switch checked={lockDownloads} onCheckedChange={setLockDownloads} />
            </div>
          )}
        </div>
        <button
          onClick={() => onSave({ ...album, title: editTitle, clientName: editClient, notes: editNotes, lockDownloadsDuringProofing: lockDownloads || undefined } as any)}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-body text-sm font-medium tracking-wide"
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}

function MobileCaptureInner() {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();

  // Tenant session — set when a tenant logs in via /login
  const [tenantSession] = useState(() => getMobileTenantSession());

  // Auth guard — redirect to /login if neither admin nor tenant is logged in
  useEffect(() => {
    if (!tenantSession && !isLoggedIn()) {
      navigate("/login", { replace: true });
    }
  }, [tenantSession, navigate]);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [targetAlbum, setTargetAlbum] = useState<Album | null>(null);
  // Event listeners and queued imports need the latest album without re-subscribing.
  const targetAlbumRef = useRef<Album | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState<number | null>(null);
  const [importSpeed, setImportSpeed] = useState<number | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const uploadPendingCount = useMemo(() => uploadQueue.filter(q => q.status === "pending").length, [uploadQueue]);
  const [uploadPaused, setUploadPaused] = useState(false);
  const uploadPausedRef = useRef(false);
  const [liveCapturePaused, setLiveCapturePaused] = useState(false);
  const liveCapturePausedRef = useRef(false);
  const [serverOnline, setServerOnline] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const [idbQueue, setIdbQueue] = useState<OfflineCaptureItem[]>([]);
  const [showIdbQueue, setShowIdbQueue] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watchInputRef = useRef<HTMLInputElement>(null);

  // List UI
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "today" | "upcoming" | "done">("all");
  const [showDone, setShowDone] = useState(false);
  const [captureTab, setCaptureTab] = useState<CaptureTab>("capture");

  // USB camera
  const [captureTransport, setCaptureTransport] = useState<CaptureTransport>("ftp");
  const [cameraConnected, setCameraConnected] = useState(false);
  const [cameraName, setCameraName] = useState("");
  const [cameraFiles, setCameraFiles] = useState<CameraFile[]>([]);
  const [ftpStatus, setFtpStatus] = useState<CameraFtpStatus | null>(null);
  const [ftpAddresses, setFtpAddresses] = useState<string[]>([]);
  const [ftpHotspotAddress, setFtpHotspotAddress] = useState<string>("");
  const [ftpUsername, setFtpUsername] = useState(() => loadFtpSettings().username);
  const [ftpPassword, setFtpPassword] = useState(() => loadFtpSettings().password);
  const [ftpPort, setFtpPort] = useState(() => String(loadFtpSettings().port));
  const [cameraScanBusy, setCameraScanBusy] = useState(false);
  const [cameraScanCandidates, setCameraScanCandidates] = useState<CameraFtpCandidate[]>([]);
  const [selectedCameraCandidate, setSelectedCameraCandidate] = useState<CameraFtpCandidate | null>(null);
  const [ftpSetupOpen, setFtpSetupOpen] = useState(false);
  const [heldRawCount, setHeldRawCount] = useState(0);
  const [lastHeldRawName, setLastHeldRawName] = useState("");
  const [ftpQueueSize, setFtpQueueSize] = useState(0);
  const [culling, setCulling] = useState(false);
  const [cullFilter, setCullFilter] = useState<CullFilter>("best");
  const [showRejectsToClient, setShowRejectsToClient] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [liveQueueSize, setLiveQueueSize] = useState(0);
  const [watching, setWatching] = useState(false);
  const [notifyClient, setNotifyClient] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxSrcCache, setLightboxSrcCache] = useState<Record<string, string>>({});
  const updateLightboxCache = useCallback((id: string, url: string) => {
    setLightboxSrcCache(prev => ({ ...prev, [id]: url }));
  }, []);
  const [viewAllMode, setViewAllMode] = useState(false);
  const [viewAllStarFilter, setViewAllStarFilter] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const lastTapTime = useRef(0);
  const [jpegOnly, setJpegOnly] = useState(true);
  const [importLabel, setImportLabel] = useState(""); // e.g. "3 / 11 — DSC_0042.JPG"
  const [failedHandles, setFailedHandles] = useState<number[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<File[]>([]);
  const [starFilter, setStarFilter] = useState(false);
  const [showAlbumEdit, setShowAlbumEdit] = useState(false);
  const [sendingProofing, setSendingProofing] = useState(false);
  const emailSentRef = useRef(false);
  const sessionUploadedRef = useRef(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>(() => ({
    label: "Ready",
    detail: "Choose an intake mode or import photos.",
    tone: "idle",
    updatedAt: Date.now(),
  }));
  const [lastCullSummary, setLastCullSummary] = useState("No review pass yet");
  const captureBatchRef = useRef<CaptureBatchSummary>(emptyCaptureBatch());
  const captureBatchTimerRef = useRef<number | null>(null);

  // Local-preview photos — shown immediately from blob URLs while server upload is in-flight.
  // Never persisted; cleared and blob URLs revoked once server upload completes.
  const [localPreviewPhotos, setLocalPreviewPhotos] = useState<Photo[]>([]);
  const localPreviewUrlsRef = useRef<string[]>([]);

  // Camera check loading state — used for the manual "Scan" button in the disconnected panel
  const [cameraChecking, setCameraChecking] = useState(false);

  const setQuietCaptureStatus = useCallback((label: string, detail: string, tone: CaptureStatusTone = "idle") => {
    setCaptureStatus({ label, detail, tone, updatedAt: Date.now() });
  }, []);

  const flushCaptureSummary = useCallback(() => {
    captureBatchTimerRef.current = null;
    const batch = captureBatchRef.current;
    captureBatchRef.current = emptyCaptureBatch();

    const parts: string[] = [];
    if (batch.added > 0) parts.push(`${countLabel(batch.added, "photo")} added`);
    if (batch.queued > 0) parts.push(`${countLabel(batch.queued, "file")} queued`);
    if (batch.held > 0) parts.push(`${countLabel(batch.held, "file")} held`);
    if (batch.cullCounts) {
      const summary = formatCullSummary(batch.cullCounts);
      setLastCullSummary(summary);
      parts.push(summary);
    }
    if (parts.length === 0) return;

    const detail = parts.join(" · ");
    const label = batch.added > 0
      ? "Capture synced"
      : batch.cullCounts
        ? "Review updated"
        : batch.queued > 0
          ? "Queued offline"
          : "Capture notice";
    const tone: CaptureStatusTone = batch.queued > 0 || batch.held > 0 ? "warning" : "success";
    setQuietCaptureStatus(label, detail, tone);

    if (batch.queued > 0 && batch.added === 0) {
      toast.info(detail, { id: "capture-batch-summary" });
    } else {
      toast.success(detail, { id: "capture-batch-summary" });
    }
  }, [setQuietCaptureStatus]);

  const queueCaptureSummary = useCallback((summary: Partial<CaptureBatchSummary>) => {
    const current = captureBatchRef.current;
    current.added += summary.added || 0;
    current.queued += summary.queued || 0;
    current.held += summary.held || 0;
    if (summary.cullCounts) current.cullCounts = summary.cullCounts;

    if (captureBatchTimerRef.current != null) window.clearTimeout(captureBatchTimerRef.current);
    captureBatchTimerRef.current = window.setTimeout(flushCaptureSummary, 2600);
  }, [flushCaptureSummary]);

  useEffect(() => () => {
    if (captureBatchTimerRef.current != null) window.clearTimeout(captureBatchTimerRef.current);
  }, []);

  /** Persist an album — uses tenant API in tenant mode, localStorage otherwise. */
  const saveAlbum = useCallback(async (album: Album) => {
    if (tenantSession) {
      const result = await saveTenantAlbum(tenantSession.slug, album);
      if (!result.ok) throw new Error(result.error || "Failed to save tenant album");
      return;
    }

    updateAlbum(album);
    const response = await fetch(`/api/albums/${encodeURIComponent(album.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(album),
    });
    if (!response.ok) throw new Error(`Failed to save album (${response.status})`);
  }, [tenantSession]);

  const autoCullRouteMissingRef = useRef(false);
  const cullInFlightRef = useRef(false);
  const queuedCullAlbumRef = useRef<Album | null>(null);
  const runAutoCullRef = useRef<((albumId: string, albumForRetry?: Album) => Promise<void>) | null>(null);

  const runAutoCull = useCallback(async (albumId: string, albumForRetry?: Album) => {
    if (!albumId) return;
    if (cullInFlightRef.current) {
      if (albumForRetry) queuedCullAlbumRef.current = albumForRetry;
      setQuietCaptureStatus("Review queued", "Waiting for the current Best of pass to finish.", "active");
      return;
    }
    cullInFlightRef.current = true;
    setCulling(true);
    setQuietCaptureStatus("Updating review", "Scoring latest uploads quietly.", "active");
    try {
      const fallbackAlbum = albumForRetry
        || (targetAlbumRef.current?.id === albumId
          ? targetAlbumRef.current
          : albums.find(album => album.id === albumId));
      const applyFallback = async (sourceAlbum: Album) => {
        const fallback = buildMobileCullFallback(sourceAlbum);
        await saveAlbum(fallback.album);
        setTargetAlbum(fallback.album);
        targetAlbumRef.current = fallback.album;
        setAlbums(prev => prev.map(a => a.id === fallback.album.id ? fallback.album : a));
        queueCaptureSummary({ cullCounts: fallback.counts });
      };

      if (autoCullRouteMissingRef.current && fallbackAlbum) {
        await applyFallback(fallbackAlbum);
        return;
      }

      let result = await autoCullAlbum(albumId, tenantSession?.slug);
      if (!result.ok && result.error?.includes("(404)")) {
        const currentAlbum = fallbackAlbum;
        if (currentAlbum) {
          await saveAlbum(currentAlbum);
          result = await autoCullAlbum(albumId, tenantSession?.slug);
          if (!result.ok && result.error?.includes("(404)")) {
            autoCullRouteMissingRef.current = true;
            await applyFallback(currentAlbum);
            return;
          }
        }
      }
      if (result.ok && result.album) {
        setTargetAlbum(result.album);
        targetAlbumRef.current = result.album;
        setAlbums(prev => prev.map(a => a.id === result.album!.id ? result.album! : a));
        queueCaptureSummary({ cullCounts: result.counts || {} });
      } else if (result.error) {
        toast.warning(result.error);
      }
    } catch (err) {
      console.warn("Auto review failed:", err);
      toast.warning(err instanceof Error ? err.message : "Review update failed");
    } finally {
      setCulling(false);
      cullInFlightRef.current = false;
      const queued = queuedCullAlbumRef.current;
      queuedCullAlbumRef.current = null;
      if (queued) {
        window.setTimeout(() => {
          runAutoCullRef.current?.(queued.id, queued);
        }, 250);
      }
    }
  }, [albums, queueCaptureSummary, saveAlbum, setQuietCaptureStatus, tenantSession?.slug]);
  runAutoCullRef.current = runAutoCull;

  /** Clear all local-preview photos and revoke their blob URLs to free device memory. */
  const clearLocalPreviews = useCallback(() => {
    setLocalPreviewPhotos([]);
    localPreviewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    localPreviewUrlsRef.current = [];
  }, []);

  // Revoke all local-preview blob URLs on unmount so the browser can free the memory.
  useEffect(() => {
    return () => {
      localPreviewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  // ── Network Online/Offline monitoring ──────────────────────────────────────
  useEffect(() => {
    const setOnline = () => setNetworkOnline(true);
    const setOffline = () => setNetworkOnline(false);
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
    };
  }, []);

  // ── Load IndexedDB offline capture queue ───────────────────────────────────
  useEffect(() => {
    getOfflineQueue().then(q => setIdbQueue(q)).catch(() => {});
  }, [networkOnline]);

  // ── Offline upload queue flush via usePwa hook ─────────────────────────────
  const uploadOfflineItem = useCallback(async (item: OfflineCaptureItem): Promise<boolean> => {
    if (!item.albumId) return false;
    const file = new File([item.file], item.fileName, { type: item.mimeType });
    try {
      const album = albums.find(a => a.id === item.albumId);
      if (!album) return false;
      const results = await uploadPhotosToServer([file], () => {}, tenantSession?.slug, 1, album.title, album.id);
      const uploaded = results?.[0];
      if (!uploaded?.url) return false;

      const photo: Photo = {
        id: uploaded.id,
        src: uploaded.url,
        thumbnail: uploaded.url + "?size=thumb&wm=0",
        title: uploaded.originalName.replace(/\.[^.]+$/, "").replace(/^_+/, ""),
        width: uploaded.width ?? 800,
        height: uploaded.height ?? 600,
        uploadedAt: new Date().toISOString(),
        ...(uploaded.takenAt ? { takenAt: uploaded.takenAt } : {}),
        originalName: uploaded.originalName,
        fileSize: uploaded.size,
        proofing: true,
      };
      const fresh = albums.find(a => a.id === item.albumId) || album;
      const updated: Album = {
        ...fresh,
        enabled: true,
        photos: [...(fresh.photos || []), photo],
        photoCount: (fresh.photos || []).length + 1,
        coverImage: fresh.coverImage || photo.src,
      };
      await saveAlbum(updated);
      setTargetAlbum(prev => prev?.id === updated.id ? updated : prev);
      if (targetAlbumRef.current?.id === updated.id) targetAlbumRef.current = updated;
      setAlbums(prev => prev.map(a => a.id === updated.id ? updated : a));
      setIdbQueue(prev => prev.filter(q => q.id !== item.id));
      return true;
    } catch {
      return false;
    }
  }, [albums, saveAlbum, tenantSession?.slug]);

  useOfflineUploadQueue(uploadOfflineItem);

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
    if (tenantSession) {
      // Tenant mode — load bookings and albums from the server API
      fetchTenantMobileData(tenantSession.slug).then(data => {
        if (data) {
          setBookings((data.bookings || []).filter((b: Booking) => b.status !== "cancelled"));
          setAlbums(data.albums || []);
        } else {
          toast.error("Could not load your sessions. Check your connection.");
        }
      });
    } else {
      setBookings(getBookings().filter(b => b.status !== "cancelled"));
      setAlbums(getAlbums());
    }
    recheckServer().then(ok => setServerOnline(ok));
  }, [tenantSession]);

  // Reset zoom whenever the lightbox navigates to a different photo
  useEffect(() => { setLightboxZoom(1); }, [lightboxIndex]);

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

  /**
   * Force-reconnect the camera: closes any stale MTP session, re-requests USB
   * device permission (so the OS dialog appears if needed), then refreshes the
   * file list.  Called when the user taps the Refresh button while the camera
   * is shown as "connected" but live capture cannot be toggled on.
   */
  const reconnectCamera = useCallback(async () => {
    if (!isNative) return;
    try {
      const permResult = await CameraUsb.reconnect();
      const granted = permResult?.granted ?? false;
      if (!granted) {
        setCameraConnected(false);
        setCameraFiles([]);
        return;
      }
    } catch (err) {
      console.warn("reconnectCamera failed:", err);
    }
    // Re-run normal check to update state and file list after reconnect
    await checkCamera();
  }, [isNative, checkCamera]);

  useEffect(() => {
    if (!isNative) return;
    checkCamera();
    const interval = setInterval(checkCamera, 5000);
    return () => clearInterval(interval);
  }, [isNative, checkCamera]);

  // Keep targetAlbumRef current for native listeners and queued imports.
  useEffect(() => { targetAlbumRef.current = targetAlbum; }, [targetAlbum]);
  useEffect(() => { setShowRejectsToClient(!!targetAlbum?.showCullRejectsToClient); }, [targetAlbum?.id, targetAlbum?.showCullRejectsToClient]);
  const pendingCullAlbumRef = useRef<Album | null>(null);
  const cullTimerRef = useRef<number | null>(null);
  const scheduleAutoCull = useCallback((album: Album, delayMs = 4200) => {
    pendingCullAlbumRef.current = album;
    if (cullTimerRef.current != null) window.clearTimeout(cullTimerRef.current);
    cullTimerRef.current = window.setTimeout(() => {
      const pending = pendingCullAlbumRef.current;
      pendingCullAlbumRef.current = null;
      cullTimerRef.current = null;
      if (pending) runAutoCull(pending.id, pending);
    }, delayMs);
  }, [runAutoCull]);
  useEffect(() => () => {
    if (cullTimerRef.current != null) window.clearTimeout(cullTimerRef.current);
  }, []);

  // Serial import queue — prevents concurrent imports from burst shooting causing OOM
  const importQueueRef = useRef<number[][]>([]);
  const ftpImportQueueRef = useRef<string[][]>([]);
  const importBusyRef = useRef(false);
  // ref so drainImportQueue never closes over importCameraFiles before it's defined
  const importCameraFilesRef = useRef<((handles: number[]) => Promise<void>) | null>(null);
  const importFtpFilesRef = useRef<((paths: string[]) => Promise<void>) | null>(null);
  // tracks imported filenames — prevents duplicates when "On Camera" count lags behind
  const importedNamesRef = useRef<Set<string>>(new Set());
  const drainImportQueue = useCallback(async () => {
    if (importBusyRef.current || liveCapturePausedRef.current) return;
    while (importQueueRef.current.length > 0) {
      // Stop processing between batches if the user has paused — queued
      // handles remain in importQueueRef so they're picked up on resume.
      if (liveCapturePausedRef.current) break;
      // Collect all currently-queued handles into one batch so shots that
      // arrived while the previous import was running are processed together
      // rather than as separate sequential round-trips.
      const handles = importQueueRef.current.splice(0).flat();
      setLiveQueueSize(0);
      if (!importCameraFilesRef.current) break;
      importBusyRef.current = true;
      try { await importCameraFilesRef.current(handles); }
      catch (e) { console.error("Queue import error:", e); }
      finally { importBusyRef.current = false; }
    }
  }, []);

  const drainFtpImportQueue = useCallback(async () => {
    if (importBusyRef.current || liveCapturePausedRef.current) return;
    while (ftpImportQueueRef.current.length > 0) {
      if (liveCapturePausedRef.current) break;
      const paths = ftpImportQueueRef.current.splice(0).flat();
      setFtpQueueSize(0);
      if (!importFtpFilesRef.current) break;
      importBusyRef.current = true;
      try { await importFtpFilesRef.current(paths); }
      catch (e) { console.error("FTP queue import error:", e); }
      finally { importBusyRef.current = false; }
    }
  }, []);

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
              // Queue the handles — drainImportQueue processes them serially to avoid OOM
              importQueueRef.current.push(newFiles.map((f: CameraFile) => f.handle));
              setLiveQueueSize(importQueueRef.current.reduce((s, a) => s + a.length, 0));
              drainImportQueue();
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
      try { listenerHandle?.remove?.(); } catch { /* cleanup errors are non-critical */ }
    };
  }, [isNative, watching, drainImportQueue]); // drainImportQueue is stable (no deps)

  useEffect(() => {
    if (!isNative) return;
    CameraFtp.getNetworkInfo()
      .then(info => {
        setFtpHotspotAddress(info.hotspotLikelyAddress || "");
        setFtpAddresses(info.addresses?.length ? info.addresses : [info.hotspotLikelyAddress || info.ipAddress || "192.168.43.1"]);
      })
      .catch(() => setFtpAddresses(["192.168.43.1"]));
    CameraFtp.status().then(setFtpStatus).catch(() => {});
  }, [isNative]);

  useEffect(() => {
    if (!isNative || !ftpStatus?.running) return;
    let listenerHandle: any = null;
    let statusHandle: any = null;
    const poll = window.setInterval(() => {
      CameraFtp.status().then(setFtpStatus).catch(() => {});
    }, 2000);
    const setup = async () => {
      listenerHandle = await CameraFtp.addListener("newFiles", async (event) => {
        const files: CameraFtpFile[] = event?.files || [];
        if (!files.length || !targetAlbumRef.current) return;
        const proofFiles = files.filter(file => {
          const name = file.name || filenameFromFtpPath(file.localPath || file.path || "");
          return isProofableFtpName(name, jpegOnly);
        });
        const heldFiles = files.filter(file => !proofFiles.includes(file));
        if (heldFiles.length > 0) {
          const lastName = heldFiles[heldFiles.length - 1]?.name || filenameFromFtpPath(heldFiles[heldFiles.length - 1]?.localPath || heldFiles[heldFiles.length - 1]?.path || "");
          setHeldRawCount(count => count + heldFiles.length);
          setLastHeldRawName(lastName);
          const rawCount = heldFiles.filter(file => isRawFtpName(file.name || filenameFromFtpPath(file.localPath || file.path || ""))).length;
          queueCaptureSummary({ held: heldFiles.length });
          setQuietCaptureStatus(
            "Files held locally",
            rawCount > 0
              ? `${countLabel(rawCount, "RAW file")} held. Use JPEG for live proofing.`
              : `${countLabel(heldFiles.length, "unsupported file")} held on phone.`,
            "warning"
          );
        }
        const paths = proofFiles.map(f => f.localPath || f.path).filter((path): path is string => Boolean(path));
        if (paths.length === 0) return;
        ftpImportQueueRef.current.push(paths);
        setFtpQueueSize(ftpImportQueueRef.current.reduce((sum, batch) => sum + batch.length, 0));
        drainFtpImportQueue();
      });
      statusHandle = await CameraFtp.addListener("statusChanged", (status) => {
        setFtpStatus(status);
        if (status.clients?.length) {
          const candidates = status.clients.map(client => ({
            ipAddress: client.ipAddress,
            interfaceName: "ftp",
            label: client.connected ? "Connected camera" : "Recent camera",
          }));
          setCameraScanCandidates(prev => {
            const merged = new Map<string, CameraFtpCandidate>();
            [...candidates, ...prev].forEach(candidate => merged.set(candidate.ipAddress, candidate));
            return Array.from(merged.values());
          });
        }
      });
    };
    setup().catch(err => {
      console.error("Failed to attach FTP listener:", err);
      setFtpStatus(prev => prev ? { ...prev, running: false } : prev);
    });
    return () => {
      window.clearInterval(poll);
      try { listenerHandle?.remove?.(); } catch {}
      try { statusHandle?.remove?.(); } catch {}
    };
  }, [isNative, ftpStatus?.running, drainFtpImportQueue, jpegOnly, queueCaptureSummary, setQuietCaptureStatus]);

  const getOrCreateAlbum = useCallback((booking: Booking): Album => {
    const existing = albums.find(a => a.bookingId === booking.id);
    if (existing) return existing;
    const settings = getSettings();
    const newAlbum: Album = {
      id: crypto.randomUUID(), slug: `session-${booking.id}`,
      title: `${booking.type} — ${booking.clientName}`, description: `Session on ${booking.date}`,
      coverImage: "", date: booking.date, photoCount: 0,
      freeDownloads: settings.defaultFreeDownloads, pricePerPhoto: settings.defaultPricePerPhoto,
      priceFullAlbum: settings.defaultPriceFullAlbum, isPublic: false, enabled: false, photos: [],
      clientName: booking.clientName, clientEmail: booking.clientEmail, bookingId: booking.id,
    };
    if (tenantSession) {
      saveTenantAlbum(tenantSession.slug, newAlbum).catch(() => toast.error("Failed to save album"));
    } else {
      addAlbum(newAlbum);
      fetch(`/api/albums/${encodeURIComponent(newAlbum.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAlbum),
      }).catch(() => {});
    }
    setAlbums(prev => [...prev, newAlbum]);
    return newAlbum;
  }, [albums, tenantSession]);

  const selectBooking = (booking: Booking) => {
    setSelectedBooking(booking);
    setCaptureTab("capture");
    const existing = albums.find(a => a.bookingId === booking.id);
    const album = getOrCreateAlbum(booking);
    setTargetAlbum(album);
    targetAlbumRef.current = album;
    setUploadedCount(0);
    setImportSpeed(null);
    setQuietCaptureStatus("Session ready", `${booking.clientName} · ${formatDate(booking.date)}`, "idle");
    emailSentRef.current = false;
    sessionUploadedRef.current = false;
    // Seed with "name:0" — album photos lack size data; name match alone blocks re-import from same session
    importedNamesRef.current = new Set(
      (albums.find(a => a.bookingId === booking.id)?.photos ?? []).map(p => p.title ? `${p.title}:0` : "").filter(Boolean)
    );
    if (!existing) { sendClientNotification("album-created"); emailSentRef.current = true; }
    if (isNative) checkCamera();
  };

  useEffect(() => {
    if (selectedBooking || bookings.length === 0) return;
    const bookingId = new URLSearchParams(window.location.search).get("bookingId");
    if (!bookingId) return;
    const booking = bookings.find((bk) => bk.id === bookingId);
    if (booking) selectBooking(booking);
  }, [bookings, selectedBooking, selectBooking]);

  const importCameraFiles = async (handles: number[]) => {
    const album = targetAlbumRef.current;
    if (!album || handles.length === 0) return;
    // Dedup key is "name:size" — name alone can collide across sessions (e.g. DSC_0001.JPG)
    const keyByHandle = new Map(cameraFiles.map(f => [f.handle, `${f.name}:${(f as any).size ?? 0}`]));
    const freshHandles = handles.filter(h => {
      const key = keyByHandle.get(h);
      if (!key) return true; // unknown handle, let through
      const name = key.split(":")[0];
      return !importedNamesRef.current.has(key) && !importedNamesRef.current.has(`${name}:0`);
    });
    if (freshHandles.length === 0) {
      toast.info('All selected photos already imported');
      return;
    }
    if (freshHandles.length < handles.length)
      toast.info(`Skipping ${handles.length - freshHandles.length} already-imported photo(s)`);
    setImporting(true); setImportProgress(0); setImportSpeed(null);
    setQuietCaptureStatus("Receiving from USB", `${countLabel(freshHandles.length, "photo")} in this batch`, "active");
    const isOnline = await recheckServer();
    setServerOnline(isOnline);
    // Process freshHandles in chunks to bound peak memory — only IMPORT_CHUNK_SIZE photos'
    // base64 payloads reside in JS memory at once.  Prevents OOM on burst shots (>~15 photos).
    const IMPORT_CHUNK_SIZE = 10;
    const newPhotos: Photo[] = [];
    let queuedOfflineCount = 0;
    try {
      for (let chunkStart = 0; chunkStart < freshHandles.length; chunkStart += IMPORT_CHUNK_SIZE) {
        const chunkHandles = freshHandles.slice(chunkStart, chunkStart + IMPORT_CHUNK_SIZE);
        const importResult = await CameraUsb.importFiles({ handles: chunkHandles });
        const imported = importResult?.files ?? [];
        if (imported.length === 0) {
          if (chunkStart === 0) toast.error("Camera returned no files");
          continue;
        }
        if (isOnline) {
          // Decode this chunk's base64 payloads to File objects, then upload before the next chunk
          setImportLabel(`Decoding ${imported.length} file${imported.length !== 1 ? "s" : ""}…`);
          const decodedFiles: File[] = [];
          for (let i = 0; i < imported.length; i++) {
            const f = imported[i];
            if (!f.base64) { console.error("[import] No base64 for", f.localPath); setFailedHandles(prev => [...prev, chunkHandles[i]]); continue; }
            try {
              const byteChars = atob(f.base64);
              const byteArr = new Uint8Array(byteChars.length);
              for (let b = 0; b < byteChars.length; b++) byteArr[b] = byteChars.charCodeAt(b);
              const blob = new Blob([byteArr], { type: f.mimeType || "image/jpeg" });
              decodedFiles.push(new File([blob], f.localPath?.split("/").pop() || `photo_${chunkStart + i}.jpg`, { type: f.mimeType || "image/jpeg" }));
            } catch (e) {
              console.error("Decode error:", e);
              setFailedHandles(prev => [...prev, chunkHandles[i]]);
            }
          }
          if (decodedFiles.length > 0) {
            // Sort by filename so camera sequential shots (DSC_0001.JPG…) stay in capture order
            decodedFiles.sort((a, b) => a.name.localeCompare(b.name));
            setImportLabel(`Uploading ${decodedFiles.length} file${decodedFiles.length !== 1 ? "s" : ""}…`);

            // ── Local preview: show photos immediately from blob URLs while upload is in-flight ──
            // The photographer (and client watching the screen) can see each shot right away
            // instead of waiting for the full server round-trip to complete.
            const chunkPreviews: Photo[] = decodedFiles.map(file => {
              const { photo, blobUrl } = createLocalPreviewPhoto(file);
              localPreviewUrlsRef.current.push(blobUrl);
              return photo;
            });
            setLocalPreviewPhotos(prev => [...prev, ...chunkPreviews]);

            try {
              const uploadedAt = new Date().toISOString();
              const chunkResults = await uploadPhotosToServer(decodedFiles, (done, _total, bytesPerSecond) => {
                setImportProgress(Math.round((chunkStart + done) / freshHandles.length * 100));
                if (bytesPerSecond != null) setImportSpeed(bytesPerSecond);
              }, tenantSession?.slug, 3, album?.title || undefined, album?.id);
              for (const { result } of matchUploadResultsToFiles(decodedFiles, chunkResults)) {
                newPhotos.push(photoFromUploadResult(result, uploadedAt));
              }
              // Delete local cached copies now that files are safely on the server.
              // Fire-and-forget: cleanup is best-effort and must not block the upload flow
              // or depend on the component remaining mounted.
              const localPaths = imported.map(f => f.localPath).filter((p): p is string => Boolean(p));
              if (localPaths.length > 0) {
                CameraUsb.deleteLocalFiles({ paths: localPaths }).catch(e =>
                  console.warn("Local file cleanup failed:", e)
                );
              }
            } catch (e) {
              console.error("Upload error:", e);
              // Queue decoded files for retry when connection is restored
              setOfflineQueue(q => [...q, ...decodedFiles]);
              queuedOfflineCount += decodedFiles.length;
            }
          }
        } else {
          // Offline: decode base64 payloads to File objects and queue for upload
          // when the server becomes reachable. Storing file:// Android-local URIs
          // as Photo.src would cause "Not allowed to load local resource" errors
          // when the admin gallery is viewed in a web browser.
          const offlineFiles: File[] = [];
          for (let i = 0; i < imported.length; i++) {
            const f = imported[i];
            if (!f.base64) { setFailedHandles(prev => [...prev, chunkHandles[i]]); continue; }
            try {
              const byteChars = atob(f.base64);
              const byteArr = new Uint8Array(byteChars.length);
              for (let b = 0; b < byteChars.length; b++) byteArr[b] = byteChars.charCodeAt(b);
              const blob = new Blob([byteArr], { type: f.mimeType || "image/jpeg" });
              offlineFiles.push(new File([blob], f.localPath?.split("/").pop() || `photo_${chunkStart + i}.jpg`, { type: f.mimeType || "image/jpeg" }));
            } catch (e) {
              console.error("Offline decode error:", e);
              setFailedHandles(prev => [...prev, chunkHandles[i]]);
            }
          }
          if (offlineFiles.length > 0) {
            setOfflineQueue(q => [...q, ...offlineFiles]);
            queuedOfflineCount += offlineFiles.length;
          }
          setImportProgress(Math.round((chunkStart + chunkHandles.length) / freshHandles.length * 100));
        }
        // Track imported keys per-chunk to prevent re-import within the session
        const importedKeys = imported.map((f: any) => {
          const n = f.localPath?.split('/').pop() || f.name || '';
          return n ? `${n}:${f.size ?? 0}` : '';
        }).filter(Boolean);
        importedKeys.forEach((k: string) => importedNamesRef.current.add(k));
      }
      setImportProgress(100);
      // importSpeed is intentionally kept (not cleared) so the live capture idle panel
      // continues to show the last measured upload speed between shots.
      if (newPhotos.length > 0) {
        const fresh = albums.find(a => a.id === album.id) || album;
        const updated: Album = { ...fresh, enabled: true, photos: [...fresh.photos, ...newPhotos], photoCount: fresh.photos.length + newPhotos.length, coverImage: fresh.coverImage || newPhotos[0]?.src || "" };
        await saveAlbum(updated); setTargetAlbum(updated); targetAlbumRef.current = updated; setAlbums(prev => prev.map(a => a.id === updated.id ? updated : a));
        if (isOnline) scheduleAutoCull(updated);
        // Sync album record to server so admin panel / recent uploads reflects new photos
        if (isOnline) {
          try {
            await fetch(`/api/albums/${updated.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ photoCount: updated.photoCount, coverImage: updated.coverImage, photos: newPhotos.map(p => p.id) }),
            });
          } catch (syncErr) { console.warn("Album sync failed:", syncErr); }
        }
        setUploadedCount(p => p + newPhotos.length);
        sessionUploadedRef.current = true;
        setImportLabel("");
        queueCaptureSummary({ added: newPhotos.length });
      }
      if (queuedOfflineCount > 0) queueCaptureSummary({ queued: queuedOfflineCount });
      setCameraFiles(prev => prev.filter(f => {
        const n = f.name || '';
        const key = `${n}:${(f as any).size ?? 0}`;
        return !importedNamesRef.current.has(key) && !importedNamesRef.current.has(`${n}:0`);
      }));
    } catch (e) { console.error("Import error:", e); toast.error("Import error"); }
    finally {
      setImporting(false);
      // Clear local previews — the album now contains server-backed URLs (or the import failed).
      clearLocalPreviews();
    }
  };

  // Keep ref in sync so drainImportQueue can call it without stale closure
  importCameraFilesRef.current = importCameraFiles;

  const importFtpFiles = async (paths: string[]) => {
    const album = targetAlbumRef.current;
    if (!album || paths.length === 0) return;
    const freshPaths = paths.filter(path => {
      const name = filenameFromFtpPath(path);
      return !importedNamesRef.current.has(`${name}:0`);
    });
    if (freshPaths.length === 0) return;
    const proofPaths = freshPaths.filter(path => isProofableFtpName(filenameFromFtpPath(path), jpegOnly));
    const heldPaths = freshPaths.filter(path => !proofPaths.includes(path));
    if (heldPaths.length > 0) {
      setHeldRawCount(count => count + heldPaths.length);
      setLastHeldRawName(filenameFromFtpPath(heldPaths[heldPaths.length - 1]));
      queueCaptureSummary({ held: heldPaths.length });
      setQuietCaptureStatus("Files held locally", `${countLabel(heldPaths.length, "RAW/unsupported file")} held. Use JPEG for live proofing.`, "warning");
    }
    if (proofPaths.length === 0) return;

    setImporting(true);
    setImportProgress(0);
    setImportSpeed(null);
    setImportLabel(`Receiving ${proofPaths.length} Wi-Fi file${proofPaths.length !== 1 ? "s" : ""}…`);
    setQuietCaptureStatus("Receiving over Wi-Fi", `${countLabel(proofPaths.length, "photo")} in this batch`, "active");

    const isOnline = await recheckServer();
    setServerOnline(isOnline);
    const newPhotos: Photo[] = [];
    let queuedOfflineCount = 0;
    try {
      for (let start = 0; start < proofPaths.length; start += 5) {
        const chunkPaths = proofPaths.slice(start, start + 5);
        const importResult = await CameraFtp.importFiles({ paths: chunkPaths });
        const imported = importResult?.files ?? [];
        const decodedFiles: File[] = [];

        for (const f of imported) {
          if (!f.base64) continue;
          try {
            const byteChars = atob(f.base64);
            const byteArr = new Uint8Array(byteChars.length);
            for (let b = 0; b < byteChars.length; b++) byteArr[b] = byteChars.charCodeAt(b);
            const blob = new Blob([byteArr], { type: f.mimeType || "image/jpeg" });
            decodedFiles.push(new File([blob], f.name || f.localPath?.split(/[\\/]/).pop() || `ftp_${Date.now()}.jpg`, {
              type: f.mimeType || "image/jpeg",
              lastModified: f.dateModified || Date.now(),
            }));
          } catch (err) {
            console.error("FTP decode error:", err);
          }
        }

        if (decodedFiles.length === 0) continue;
        decodedFiles.sort((a, b) => a.name.localeCompare(b.name));

        if (!isOnline) {
          setOfflineQueue(q => [...q, ...decodedFiles]);
          queuedOfflineCount += decodedFiles.length;
          setImportProgress(Math.round((start + chunkPaths.length) / proofPaths.length * 100));
          continue;
        }

        const previews = decodedFiles.map(file => {
          const { photo, blobUrl } = createLocalPreviewPhoto(file);
          localPreviewUrlsRef.current.push(blobUrl);
          return photo;
        });
        setLocalPreviewPhotos(prev => [...prev, ...previews]);
        setImportLabel(`Uploading ${decodedFiles.length} Wi-Fi file${decodedFiles.length !== 1 ? "s" : ""}…`);

        const results = await uploadPhotosToServer(decodedFiles, (done, _total, bytesPerSecond) => {
          setImportProgress(Math.round((start + done) / proofPaths.length * 100));
          if (bytesPerSecond != null) setImportSpeed(bytesPerSecond);
        }, tenantSession?.slug, 3, album.title, album.id);
        const matched = matchUploadResultsToFiles(decodedFiles, results);
        const uploadedFiles = new Set(matched.map(pair => pair.file));
        for (const { file, result } of matched) {
          newPhotos.push(photoFromUploadResult(result, new Date(file.lastModified || Date.now()).toISOString()));
        }
        const failedFiles = decodedFiles.filter(file => !uploadedFiles.has(file));
        if (failedFiles.length > 0) {
          setOfflineQueue(q => [...q, ...failedFiles]);
          queuedOfflineCount += failedFiles.length;
        }

        const localPaths = imported.map(f => f.localPath || f.path).filter((p): p is string => Boolean(p));
        if (localPaths.length > 0) {
          CameraFtp.deleteLocalFiles({ paths: localPaths }).catch(err => console.warn("FTP cleanup failed:", err));
        }
        imported.forEach(f => {
          const name = f.name || f.localPath?.split(/[\\/]/).pop();
          if (name) importedNamesRef.current.add(`${name}:${f.size ?? 0}`);
        });
      }

      if (newPhotos.length > 0) {
        const fresh = albums.find(a => a.id === album.id) || album;
        const updated: Album = {
          ...fresh,
          enabled: true,
          photos: [...fresh.photos, ...newPhotos],
          photoCount: fresh.photos.length + newPhotos.length,
          coverImage: fresh.coverImage || newPhotos[0]?.src || "",
        };
        await saveAlbum(updated);
        setTargetAlbum(updated);
        targetAlbumRef.current = updated;
        setAlbums(prev => prev.map(a => a.id === updated.id ? updated : a));
        scheduleAutoCull(updated);
        setUploadedCount(p => p + newPhotos.length);
        sessionUploadedRef.current = true;
        queueCaptureSummary({ added: newPhotos.length });
      }
      if (queuedOfflineCount > 0) queueCaptureSummary({ queued: queuedOfflineCount });
    } catch (err) {
      console.error("FTP import error:", err);
      toast.error("Wi-Fi import error");
    } finally {
      setImporting(false);
      setImportLabel("");
      setFtpQueueSize(0);
      clearLocalPreviews();
    }
  };

  importFtpFilesRef.current = importFtpFiles;

  const toggleLiveWatch = async () => {
    if (watching) {
      try { await CameraUsb.stopWatching(); } catch (err) { console.warn("stopWatching error:", err); }
      setWatching(false);
      setLiveQueueSize(0);
      importQueueRef.current = [];
      setLiveCapturePaused(false);
      liveCapturePausedRef.current = false;
      toast.info("Live capture stopped");
    } else {
      if (!cameraConnected) { toast.error("No camera connected"); return; }
      if (!targetAlbumRef.current) { toast.error("Select a session first"); return; }
      setImportSpeed(null); // clear any stale speed from a prior session before first shot
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

  const toggleFtpReceiver = async () => {
    if (!isNative) return;
    if (ftpStatus?.running) {
      await CameraFtp.stop();
      setFtpStatus(prev => prev ? { ...prev, running: false, paused: false } : prev);
      setFtpQueueSize(0);
      ftpImportQueueRef.current = [];
      toast.info("Wi-Fi FTP receiver stopped");
      return;
    }
    if (!targetAlbumRef.current) {
      toast.error("Select a session first");
      return;
    }
    try {
      const username = ftpUsername.trim() || "camera";
      const password = ftpPassword.trim() || "camera";
      const parsedPort = Number(ftpPort);
      const port = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? Math.round(parsedPort) : 2121;
      saveFtpSettings({ username, password, port });
      setFtpUsername(username);
      setFtpPassword(password);
      setFtpPort(String(port));
      const status = await CameraFtp.start({ port, username, password });
      setFtpStatus(status);
      const info = await CameraFtp.getNetworkInfo().catch(() => null);
      if (info) {
        setFtpHotspotAddress(info.hotspotLikelyAddress || "");
        setFtpAddresses(info.addresses?.length ? info.addresses : [info.hotspotLikelyAddress || info.ipAddress || "192.168.43.1"]);
      }
      toast.success("Wi-Fi FTP receiver active");
    } catch (err: any) {
      console.error("FTP receiver failed:", err);
      toast.error(`Wi-Fi FTP failed: ${err?.message || "Unknown error"}`);
    }
  };

  const toggleFtpPause = async () => {
    const running = !!ftpStatus?.running;
    if (!running) return;
    const willPause = !ftpStatus?.paused;
    if (willPause) {
      await CameraFtp.pause();
      liveCapturePausedRef.current = true;
      setLiveCapturePaused(true);
      setFtpStatus(prev => prev ? { ...prev, paused: true } : prev);
      toast.info("Wi-Fi capture paused — incoming files held");
    } else {
      await CameraFtp.resume();
      liveCapturePausedRef.current = false;
      setLiveCapturePaused(false);
      setFtpStatus(prev => prev ? { ...prev, paused: false } : prev);
      drainFtpImportQueue();
      toast.info("Wi-Fi capture resumed");
    }
  };

  const scanForCamera = async () => {
    if (!isNative) return;
    setCameraScanBusy(true);
    setCameraScanCandidates([]);
    setSelectedCameraCandidate(null);
    try {
      const result = await CameraFtp.scanNetwork({ timeoutMs: 4500 });
      const candidates = result.candidates || [];
      setCameraScanCandidates(candidates);
      if (result.serverHost) {
        setFtpHotspotAddress(result.serverHost);
        setFtpAddresses(prev => Array.from(new Set([result.serverHost!, ...prev])));
      }
      if (candidates.length === 0) {
        toast.warning("No camera found on this Wi-Fi/hotspot yet");
      } else if (candidates.length === 1) {
        setSelectedCameraCandidate(candidates[0]);
        toast.success(`Found one device: ${candidates[0].ipAddress}`);
      } else {
        toast.success(`Found ${candidates.length} devices on this network`);
      }
    } catch (err: any) {
      console.error("Camera scan failed:", err);
      toast.error(`Camera scan failed: ${err?.message || "Unknown error"}`);
    } finally {
      setCameraScanBusy(false);
    }
  };

  const toggleLiveCapturePause = () => {
    const willPause = !liveCapturePaused;
    liveCapturePausedRef.current = willPause;
    setLiveCapturePaused(willPause);
    if (!willPause) {
      // Resume — drain any queued handles that arrived while paused
      drainImportQueue();
    }
    toast.info(willPause ? "Live capture paused — still shooting, uploads held" : "Live capture resumed");
  };

  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0 || !targetAlbum) return;
    const rawExt = [".nef",".cr2",".cr3",".arw",".orf",".rw2",".dng",".raf"];
    const imageFiles = Array.from(files).filter(f => {
      if (!isSupportedUploadFile(f)) return false;
      if (jpegOnly) return !rawExt.includes(f.name.toLowerCase().slice(f.name.lastIndexOf(".")));
      return true;
    });
    if (!imageFiles.length) { toast.error("No images found"); return; }

    // Sort by capture time — File.lastModified is the EXIF capture time for photos from a camera
    const sortedFiles = [...imageFiles].sort((a, b) => a.lastModified - b.lastModified);

    // Build upload queue with thumbnail previews
    const queueItems: UploadQueueItem[] = sortedFiles.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      preview: URL.createObjectURL(f),
      status: "pending",
    }));
    setUploadQueue(queueItems);

    // ── Local preview: show photos in the album grid immediately while uploading ──
    // Each queueItem already has a blob URL (preview) — create a separate blob URL for
    // the album preview grid so both can be revoked independently when their work is done.
    const filePickPreviews: Photo[] = sortedFiles.map(f => {
      const { photo, blobUrl } = createLocalPreviewPhoto(f);
      localPreviewUrlsRef.current.push(blobUrl);
      return photo;
    });
    setLocalPreviewPhotos(filePickPreviews);

    setUploadPaused(false);
    uploadPausedRef.current = false;
    setUploading(true); setUploadProgress(0); setUploadSpeed(null);
    setQuietCaptureStatus("Uploading from device", `${countLabel(sortedFiles.length, "photo")} selected`, "active");

    const newPhotos: Photo[] = [];
    let queuedOfflineCount = 0;

    try {
      if (serverOnline) {
        // Upload in chunks of 5 — checks pause state between each chunk
        const CHUNK = 5;
        let totalDone = 0;
        for (let i = 0; i < sortedFiles.length; i += CHUNK) {
          // Wait while paused (user can still cancel by navigating away)
          while (uploadPausedRef.current) {
            await new Promise<void>(r => setTimeout(r, 500));
          }
          const chunk = sortedFiles.slice(i, i + CHUNK);
          const chunkIds = queueItems.slice(i, i + CHUNK).map(q => q.id);
          setUploadQueue(prev => prev.map(item =>
            chunkIds.includes(item.id) ? { ...item, status: "uploading" } : item
          ));
          try {
            const chunkResults = await uploadPhotosToServer(chunk, (done, _total, bytesPerSecond) => {
              setUploadProgress(Math.round((totalDone + done) / sortedFiles.length * 100));
              if (bytesPerSecond != null) setUploadSpeed(bytesPerSecond);
            }, tenantSession?.slug, 3, targetAlbum?.title || undefined, targetAlbum?.id);
            const matched = matchUploadResultsToFiles(chunk, chunkResults);
            const succeededFiles = new Set(matched.map(pair => pair.file));
            for (const { file, result } of matched) {
              newPhotos.push(photoFromUploadResult(result, new Date(file.lastModified || Date.now()).toISOString()));
            }
            totalDone += chunk.length;
            const failedFiles = chunk.filter(file => !succeededFiles.has(file));
            setUploadQueue(prev => prev.map(item => {
              if (!chunkIds.includes(item.id)) return item;
              return { ...item, status: succeededFiles.has(item.file) ? "done" : "failed" };
            }));
            if (failedFiles.length > 0) {
              setOfflineQueue(q => [...q, ...failedFiles]);
              queuedOfflineCount += failedFiles.length;
            }
          } catch {
            // Failed chunk — mark as failed and add to offline queue for retry
            setUploadQueue(prev => prev.map(item =>
              chunkIds.includes(item.id) ? { ...item, status: "failed" } : item
            ));
            setOfflineQueue(q => [...q, ...chunk]);
            queuedOfflineCount += chunk.length;
            totalDone += chunk.length;
          }
        }
      } else {
        setOfflineQueue(q => [...q, ...sortedFiles]);
        setUploadQueue(prev => prev.map(item => ({ ...item, status: "failed" })));
        queuedOfflineCount += sortedFiles.length;
        setQuietCaptureStatus("Queued offline", `${countLabel(sortedFiles.length, "file")} will upload when the server is back.`, "warning");
      }
      if (newPhotos.length > 0) {
        const fresh = albums.find(a => a.id === targetAlbum.id) || targetAlbum;
        const updated: Album = { ...fresh, enabled: true, photos: [...fresh.photos, ...newPhotos], photoCount: fresh.photos.length + newPhotos.length, coverImage: fresh.coverImage || newPhotos[0]?.src || "" };
        await saveAlbum(updated); setTargetAlbum(updated); targetAlbumRef.current = updated; setAlbums(prev => prev.map(a => a.id === updated.id ? updated : a));
        scheduleAutoCull(updated);
        setUploadedCount(p => p + newPhotos.length);
        sessionUploadedRef.current = true;
        queueCaptureSummary({ added: newPhotos.length });
      }
      if (queuedOfflineCount > 0) queueCaptureSummary({ queued: queuedOfflineCount });
    } catch { toast.error("Upload error"); }
    finally {
      setUploading(false); setUploadSpeed(null);
      // Revoke upload-queue preview URLs and clear queue after a brief moment so done state is visible.
      // Also clear local-preview album grid entries and revoke their blob URLs at the same time.
      const toRevoke = queueItems.map(q => q.preview);
      setTimeout(() => {
        toRevoke.forEach(url => URL.revokeObjectURL(url));
        setUploadQueue([]);
        // Clear local previews — album now has server-backed URLs (or upload failed/offline)
        clearLocalPreviews();
      }, 2000);
    }
  };

  // Star a photo — persists to album storage
  const toggleStar = (photoId: string) => {
    if (!targetAlbum) return;
    const updated = {
      ...targetAlbum,
      photos: targetAlbum.photos.map(p => p.id === photoId ? { ...p, starred: !(p as any).starred } : p),
    };
    saveAlbum(updated).catch(() => {});
    setTargetAlbum(updated);
    targetAlbumRef.current = updated;
    setAlbums(prev => prev.map(a => a.id === updated.id ? updated : a));
  };

  const setClientRejectVisibility = (visible: boolean) => {
    setShowRejectsToClient(visible);
    if (!targetAlbum) return;
    const updated = { ...targetAlbum, showCullRejectsToClient: visible };
    saveAlbum(updated).catch(() => {});
    setTargetAlbum(updated);
    targetAlbumRef.current = updated;
    setAlbums(prev => prev.map(a => a.id === updated.id ? updated : a));
  };

  // Flush offline queue when server comes back
  const flushOfflineQueue = async () => {
    if (!offlineQueue.length || !targetAlbum) return;
    const isOnline = await recheckServer();
    if (!isOnline) { toast.info("Still offline — queue retained"); return; }
    setServerOnline(true);
    // Sort by capture time before retrying
    const files = [...offlineQueue].sort((a, b) => a.lastModified - b.lastModified);
    setOfflineQueue([]);
    setUploading(true); setUploadProgress(0); setUploadSpeed(null);
    setQuietCaptureStatus("Syncing queue", `${countLabel(files.length, "queued photo")} uploading now`, "active");
    try {
      const results = await uploadPhotosToServer(files, (done, total, bytesPerSecond) => {
        setUploadProgress(Math.round(done / total * 100));
        if (bytesPerSecond != null) setUploadSpeed(bytesPerSecond);
      }, tenantSession?.slug, 3, targetAlbum?.title || undefined, targetAlbum?.id);
      const matched = matchUploadResultsToFiles(files, results);
      const uploadedFiles = new Set(matched.map(pair => pair.file));
      const failedFiles = files.filter(file => !uploadedFiles.has(file));
      const newPhotos: Photo[] = matched.map(({ file, result }) =>
        photoFromUploadResult(result, new Date(file.lastModified || Date.now()).toISOString())
      );
      if (failedFiles.length > 0) {
        setOfflineQueue(q => [...q, ...failedFiles]);
        queueCaptureSummary({ queued: failedFiles.length });
      }
      const fresh = albums.find(a => a.id === targetAlbum.id) || targetAlbum;
      const upd: Album = { ...fresh, photos: [...fresh.photos, ...newPhotos], photoCount: fresh.photos.length + newPhotos.length, coverImage: fresh.coverImage || newPhotos[0]?.src || "" };
      await saveAlbum(upd); setTargetAlbum(upd); targetAlbumRef.current = upd; setAlbums(prev => prev.map(a => a.id === upd.id ? upd : a));
      scheduleAutoCull(upd);
      setUploadedCount(p => p + newPhotos.length);
      sessionUploadedRef.current = true;
      queueCaptureSummary({ added: results.length });
    } catch { toast.error("Failed to flush offline queue"); }
    finally { setUploading(false); setUploadSpeed(null); }
  };

  const handleSendForProofing = async () => {
    if (!targetAlbum || !getSettings().proofingEnabled) return;
    setSendingProofing(true);
    try {
      const clientToken = targetAlbum.clientToken || `ct-${crypto.randomUUID()}`;
      const newRound = {
        roundNumber: (targetAlbum.proofingRounds?.length || 0) + 1,
        sentAt: new Date().toISOString(),
        selectedPhotoIds: [],
      };
      const updatedAlbum: Album = {
        ...targetAlbum,
        enabled: true,
        proofingEnabled: true,
        proofingStage: "proofing",
        proofingRounds: [...(targetAlbum.proofingRounds || []), newRound],
        clientToken,
      };
      await saveAlbum(updatedAlbum);
      setTargetAlbum(updatedAlbum);
      targetAlbumRef.current = updatedAlbum;
      setAlbums(prev => prev.map(a => a.id === updatedAlbum.id ? updatedAlbum : a));
      if (selectedBooking?.clientEmail && serverOnline) {
        const galleryUrl = `${window.location.origin}/gallery/${targetAlbum.slug}?token=${clientToken}`;
        fetch("/api/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: selectedBooking.clientEmail,
            subject: `📸 Your proofing gallery is ready — ${targetAlbum.title}`,
            html: `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;"><h2 style="margin:0 0 16px;font-size:20px;">Your photos are ready to review! ⭐</h2><p style="color:#9ca3af;margin:0 0 12px;">Hi ${selectedBooking.clientName || "there"}, your ${selectedBooking.type || "session"} photos are ready for you to star your favourites.</p><p style="color:#9ca3af;margin:0 0 20px;">Click the link below to open your private gallery.</p><a href="${galleryUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View My Gallery →</a></div>`,
          }),
        }).catch(() => { toast.error("Failed to send proofing email"); });
        toast.success("Proofing invite sent!");
      } else {
        toast.success("Proofing enabled!");
      }
    } finally {
      setSendingProofing(false);
    }
  };

  const filteredCameraFiles = jpegOnly
    ? cameraFiles.filter(f => f.mimeType === "image/jpeg" || f.name?.toLowerCase().match(/\.jpe?g$/))
    : cameraFiles;

  // Combined display photos: local previews (most recent, shown immediately) + server-backed photos.
  // Local previews whose title already matches an uploaded server photo are filtered out to avoid
  // showing a photo twice during the brief window between upload completing and state being replaced.
  const sessionPhotosWithPreviews = useMemo(() => {
    if (!targetAlbum) return localPreviewPhotos;
    const uploaded = [...targetAlbum.photos].reverse();
    const uploadedTitles = new Set(uploaded.map(p => p.title));
    const pendingPreviews = localPreviewPhotos.filter(p => !uploadedTitles.has(p.title));
    return [...pendingPreviews, ...uploaded];
  }, [targetAlbum, localPreviewPhotos]);

  const cullCounts = useMemo(() => {
    const photos = targetAlbum?.photos || [];
    const bestOf = photos.filter(p => p.starred || isBestOfCull(p)).length;
    return {
      all: photos.length,
      review: photos.filter(p => p.cull?.status === "review" || p.cull?.status === "unscored" || !p.cull?.status).length,
      reject: photos.filter(p => p.cull?.status === "reject").length,
      bestOf,
    };
  }, [targetAlbum]);
  const reviewSummary = useMemo(() => {
    if (!targetAlbum?.photos.length) return lastCullSummary;
    return `${cullCounts.bestOf} Best of · ${cullCounts.review} review · ${cullCounts.reject} reject${cullCounts.reject === 1 ? "" : "s"}`;
  }, [cullCounts.bestOf, cullCounts.reject, cullCounts.review, lastCullSummary, targetAlbum?.photos.length]);

  const applyCullFilter = useCallback((photos: Photo[]) => {
    if (cullFilter === "best") return photos.filter(p => p.localPreview || p.starred || isBestOfCull(p));
    if (cullFilter === "review") return photos.filter(p => !p.cull?.status || p.cull?.status === "review" || p.cull?.status === "unscored");
    if (cullFilter === "reject") return photos.filter(p => p.cull?.status === "reject");
    return photos;
  }, [cullFilter]);

  // ── Booking card ────────────────────────────────────────────
  const BookingCard = ({ bk }: { bk: Booking }) => {
    const status = getSessionStatus(bk, albums);
    const album = albums.find(a => a.bookingId === bk.id);
    const photoCount = album?.photos.length ?? 0;
    const isNextUp = status === "next-up" || status === "in-progress";

    return (
      <div
        className={`capture-session-card cursor-pointer transition-all active:scale-[0.99] ${isNextUp ? "capture-session-card-active" : ""}`}
        onClick={() => selectBooking(bk)}
      >
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isNextUp ? "bg-cyan-400/15 text-cyan-200" : "bg-white/[0.06] text-white/55"}`}>
              {isNextUp
                ? <CircleDot className="w-4 h-4 text-cyan-200" />
                : status === "done" ? <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                : <Users className="w-4 h-4 text-white/55" />
              }
            </div>
            <div className="flex-1 min-w-0">
              {/* Name row */}
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="text-sm font-body text-white font-semibold truncate">{bk.clientName}</h3>
                {isNextUp && <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse flex-shrink-0" />}
              </div>
              {/* Time row — full width, never truncated by badge */}
              <p className="text-xs font-body text-white/55">
                {formatDate(bk.date)}{bk.time ? ` · ${formatTime12(bk.time)}` : ""}{bk.duration ? ` · ${formatDuration(bk.duration)}` : ""}
              </p>
              {/* Type + status row */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[10px] font-body text-muted-foreground/60 truncate">{bk.type}</span>
                <span className={`text-[9px] font-body tracking-wider uppercase px-1.5 py-0.5 rounded-full border ${
                  bk.status === "confirmed" ? "border-cyan-300/30 text-cyan-200 bg-cyan-400/10"
                  : bk.status === "completed" ? "border-emerald-400/30 text-emerald-300 bg-emerald-400/10"
                  : "border-white/10 text-white/50 bg-white/[0.05]"
                }`}>
                  {bk.status}
                </span>
                {photoCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-body text-muted-foreground/70">
                    <ImageIcon className="w-2.5 h-2.5" /> {photoCount}
                  </span>
                )}
                {(() => {
                  const totalSessions = bk.clientEmail
                    ? albums.filter(a => a.clientEmail === bk.clientEmail).length
                    : 0;
                  return totalSessions > 1 ? (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-body text-muted-foreground/50">
                      <CalendarDays className="w-2.5 h-2.5" /> {totalSessions} sessions
                    </span>
                  ) : null;
                })()}
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

  const ftpCameraClient = ftpStatus?.clients?.find(client => client.connected) || ftpStatus?.clients?.[0];
  const ftpCameraAuthState = ftpCameraClient?.authState || "";
  const ftpCameraLinked = !!(ftpStatus?.running && ftpCameraClient && (
    ftpCameraClient.connected ||
    (ftpCameraClient.filesReceived || 0) > 0 ||
    ftpCameraAuthState === "logged-in" ||
    ftpCameraAuthState === "transferring"
  ));
  const ftpCameraSeen = !!ftpCameraClient;
  const connectionState = ftpStatus?.running
    ? ftpStatus.paused ? "Paused" : ftpCameraLinked ? "Camera linked" : "Receiving"
    : watching
      ? liveCapturePaused ? "USB Paused" : "USB Live"
      : "Ready";
  const captureBusy = uploading || importing || !!ftpStatus?.running || watching;
  const captureTabs: { id: CaptureTab; label: string; icon: any; count?: number }[] = [
    { id: "capture", label: "Capture", icon: RadioTower, count: ftpQueueSize + liveQueueSize + uploadPendingCount },
    { id: "review", label: "Review", icon: ListFilter, count: cullCounts.review },
    { id: "publish", label: "Publish", icon: UploadCloud, count: offlineQueue.length },
  ];
  const ftpPrimaryHost = ftpHotspotAddress || ftpStatus?.network?.hotspotLikelyAddress || ftpStatus?.host || ftpStatus?.ipAddress || ftpAddresses[0] || "192.168.43.1";
  const showFtpSetupHelp = !ftpCameraLinked || ftpSetupOpen || !!ftpCameraClient?.lastError;

  // ═══════════════════════════════════════════════════════════
  // ── SESSION PICKER ─────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════
  if (!selectedBooking) {
    return (
      <div className="capture-app-shell min-h-screen" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        {/* Sticky header */}
        <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0a0d12]/95 backdrop-blur-xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <div className="p-4 space-y-3">
            {/* Top row — compact so system time doesn't overlap pills */}
            <div className="flex items-center gap-2">
              <button onClick={() => navigate(tenantSession ? `/tenant-admin/${tenantSession.slug}` : "/admin")} className="capture-icon-button flex-shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex-1 min-w-0">
                <span className="block text-[10px] font-body uppercase tracking-[0.18em] text-white/40">Zuploader Capture</span>
                <span className="block text-base font-body font-semibold text-white truncate">
                {tenantSession ? tenantSession.displayName : "Capture"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {isNative && (
                  <span className={`native-status-pill ${cameraConnected ? "native-status-pill-ok" : ""}`}>
                    <Usb className="w-2.5 h-2.5" />
                    {cameraConnected ? (cameraName || "Z6III").split(" ")[0] : "No Cam"}
                  </span>
                )}
                <span className={`native-status-pill ${serverOnline ? "native-status-pill-ok" : "native-status-pill-warn"}`}>
                  {serverOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
                  {serverOnline ? "Online" : networkOnline ? "Server down" : "No network"}
                </span>
                {idbQueue.filter(q => q.status !== "done").length > 0 && (
                  <button
                    onClick={() => setShowIdbQueue(true)}
                    className="inline-flex items-center gap-0.5 text-[10px] font-body px-2 py-0.5 rounded-full border border-amber-500/50 text-amber-400 bg-amber-500/10"
                    title="Offline capture queue"
                  >
                    <Clock className="w-2.5 h-2.5" />
                    {idbQueue.filter(q => q.status !== "done").length} queued
                  </button>
                )}
                {tenantSession && (
                  <button
                    onClick={() => { setMobileTenantSession(null); navigate("/login", { replace: true }); }}
                    className="capture-icon-button"
                    title="Sign out"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search client, type, date…"
                className="pl-9 bg-white/[0.06] border-white/10 text-white placeholder:text-white/35 font-body text-sm h-10 rounded-xl"
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
                      ? "bg-cyan-400/15 text-cyan-200 border-cyan-300/30"
                      : "border-white/10 text-white/55 hover:text-white hover:bg-white/[0.06]"
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
    <div className="capture-app-shell capture-session-shell min-h-screen pb-28" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
      {/* Header */}
      <div className="capture-dashboard-header z-30 px-4 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (sessionUploadedRef.current && notifyClient) sendClientNotification("photos-uploaded", uploadedCount);
            sessionUploadedRef.current = false;
            setSelectedBooking(null); setTargetAlbum(null); setUploadedCount(0);
            setHeldRawCount(0); setLastHeldRawName("");
            if (watching) { setWatching(false); CameraUsb.stopWatching().catch(() => {}); }
          }}
          className="capture-icon-button"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-body font-semibold text-white truncate">{selectedBooking.clientName}</h1>
          <p className="text-xs font-body text-white/50 truncate">
            {selectedBooking.type} · {formatDate(selectedBooking.date)} · {formatTime12(selectedBooking.time)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {isNative && (
            <span className={`native-status-pill ${cameraConnected ? "native-status-pill-ok" : ""}`}>
              <Usb className="w-3 h-3" />
            </span>
          )}
          <span className={`native-status-pill ${serverOnline ? "native-status-pill-ok" : "native-status-pill-warn"}`}>
            {serverOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </span>
          <button
            onClick={() => setShowAlbumEdit(true)}
            className="capture-icon-button"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 capture-hero-panel">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`capture-live-indicator ${captureBusy ? "capture-live-indicator-on" : ""}`}>
              <Activity className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-body uppercase tracking-[0.18em] text-white/40">Live Intake</p>
              <p className="text-base font-body font-semibold text-white truncate">{connectionState}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-body font-semibold text-white leading-none">{targetAlbum?.photoCount || 0}</p>
            <p className="text-[10px] font-body uppercase tracking-[0.16em] text-white/40 mt-1">Album</p>
          </div>
        </div>
        <div className={`capture-status-strip capture-status-${captureStatus.tone}`}>
          <span className="capture-status-dot" />
          <div className="min-w-0">
            <p>{captureStatus.label}</p>
            <small>{captureStatus.detail}</small>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="capture-mini-metric"><span>{uploadedCount}</span><small>Added</small></div>
          <div className="capture-mini-metric"><span>{cullCounts.bestOf}</span><small>Best of</small></div>
          <div className="capture-mini-metric"><span>{cullCounts.reject + heldRawCount}</span><small>Held</small></div>
        </div>
      </div>

      </div>

      <div className="px-4 pt-3">

      {/* Offline queue banner */}
      {offlineQueue.length > 0 && (
        <div className={`${captureTab === "publish" ? "" : "hidden"} glass-panel rounded-xl p-3 mb-4 border border-amber-500/30 bg-amber-500/5 flex items-center gap-3`}>
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-body text-amber-300">{offlineQueue.length} file{offlineQueue.length !== 1 ? "s" : ""} queued offline</p>
          </div>
          <button onClick={flushOfflineQueue} disabled={uploading} className="inline-flex items-center gap-1 text-[10px] font-body tracking-wider uppercase px-2.5 py-1 rounded-full border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50 transition-all">
            <RotateCcw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* Failed imports retry */}
      {failedHandles.length > 0 && (
        <div className={`${captureTab === "capture" ? "" : "hidden"} glass-panel rounded-xl p-3 mb-4 border border-destructive/30 bg-destructive/5 flex items-center gap-3`}>
          <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-body text-destructive/80">{failedHandles.length} import{failedHandles.length !== 1 ? "s" : ""} failed</p>
          </div>
          <button
            onClick={async () => {
              const toRetry = [...failedHandles];
              setFailedHandles([]);
              for (let i = 0; i < toRetry.length; i += 3) await importCameraFiles(toRetry.slice(i, i + 3));
            }}
            disabled={importing}
            className="inline-flex items-center gap-1 text-[10px] font-body tracking-wider uppercase px-2.5 py-1 rounded-full border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-all"
          >
            <RotateCcw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* Stats */}
      <div className={`${captureTab === "capture" ? "" : "hidden"} capture-session-digest mb-4`}>
        {(() => {
          const clientAlbums = selectedBooking?.clientEmail ? albums.filter(a => a.clientEmail === selectedBooking.clientEmail) : [];
          const totalMins = clientAlbums.reduce((s, a) => {
            const bk = bookings.find(b => b.id === a.bookingId);
            return s + (bk?.duration || 0);
          }, 0);
          const tH = Math.floor(totalMins / 60);
          const tM = totalMins % 60;
          const timeLabel = tH > 0 ? (tM > 0 ? `${tH}h ${tM}m` : `${tH}h`) : (totalMins > 0 ? `${totalMins}m` : "—");
          return (
            <div className="grid grid-cols-4 gap-2 text-center">
              <div><p>{targetAlbum?.photoCount || 0}</p><small>Album</small></div>
              <div><p>{uploadedCount}</p><small>Added</small></div>
              <div><p>{clientAlbums.length || 1}</p><small>Sessions</small></div>
              <div><p>{timeLabel}</p><small>Total</small></div>
            </div>
          );
        })()}
      </div>

      {/* Progress / Live capture stats */}
      {(uploading || importing || watching) && (
        <div className={`${captureTab === "capture" ? "" : "hidden"} glass-panel rounded-xl p-4 mb-4`}>
          <div className="flex items-center gap-2 mb-2">
            {importing || uploading ? (
              <RefreshCw className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
            ) : (
              <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                <span className={`w-2 h-2 rounded-full ${liveCapturePaused ? "bg-amber-400" : "bg-primary animate-pulse"}`} />
              </span>
            )}
            <span className="text-sm font-body text-foreground truncate">
              {(() => {
                if (importing) {
                  const base = importLabel || "Importing from camera…";
                  return liveQueueSize > 0 ? `${base} · ${liveQueueSize} waiting` : base;
                }
                if (uploading) {
                  if (uploadPaused) return `Upload paused${uploadPendingCount > 0 ? ` · ${uploadPendingCount} pending` : ""}`;
                  return `Uploading…${uploadPendingCount > 0 ? ` · ${uploadPendingCount} pending` : ""}`;
                }
                if (liveCapturePaused) return `${liveQueueSize > 0 ? `${liveQueueSize} held · ` : ""}Live paused`;
                if (liveQueueSize > 0) return `${liveQueueSize} photo${liveQueueSize !== 1 ? "s" : ""} queued…`;
                return "Live — waiting for next shot";
              })()}
            </span>
            <div className="flex items-center gap-2 ml-auto flex-shrink-0">
              {(importing || watching) && importSpeed != null && importSpeed > 0 && (
                <span className="text-xs font-body text-primary font-medium">{formatSpeed(importSpeed)}</span>
              )}
              {uploading && uploadSpeed != null && uploadSpeed > 0 && (
                <span className="text-xs font-body text-primary font-medium">{formatSpeed(uploadSpeed)}</span>
              )}
              {(importing || uploading) && (
                <span className="text-xs font-body text-muted-foreground">{importing ? importProgress : uploadProgress}%</span>
              )}
              {/* Pause/resume for file picker uploads */}
              {uploading && !importing && (
                <button
                  onClick={() => {
                    const willPause = !uploadPaused;
                    uploadPausedRef.current = willPause;
                    setUploadPaused(willPause);
                  }}
                  className="inline-flex items-center gap-1 text-[10px] font-body tracking-wider uppercase px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  {uploadPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                  {uploadPaused ? "Resume" : "Pause"}
                </button>
              )}
              {!importing && !uploading && (
                <span className="text-xs font-body text-muted-foreground">{uploadedCount} uploaded</span>
              )}
            </div>
          </div>
          {(importing || uploading) && (
            <Progress value={importing ? importProgress : uploadProgress} className="h-1.5" />
          )}
        </div>
      )}

      {/* Upload queue — thumbnail previews for file picker bulk uploads */}
      {uploadQueue.length > 0 && (
        <div className={`${captureTab === "capture" ? "" : "hidden"} glass-panel rounded-xl p-4 mb-4`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">
              Upload Queue · {uploadQueue.filter(q => q.status === "done").length}/{uploadQueue.length}
            </p>
            {uploadQueue.some(q => q.status === "failed") && (
              <span className="text-[10px] font-body text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {uploadQueue.filter(q => q.status === "failed").length} failed
              </span>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {uploadQueue.map(item => (
              <div key={item.id} className="relative flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-secondary">
                <img src={item.preview} alt={item.file.name} className="w-full h-full object-cover" />
                {/* Status overlay */}
                {item.status === "uploading" && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4 text-white animate-spin" />
                  </div>
                )}
                {item.status === "done" && (
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  </div>
                )}
                {item.status === "failed" && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                  </div>
                )}
                {item.status === "pending" && (
                  <div className="absolute inset-0 bg-black/20" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toggles */}
      <div className={`${captureTab === "capture" ? "grid" : "hidden"} grid-cols-2 gap-3 mb-4`}>
        <div className="capture-control-tile">
          <div className="flex items-center gap-2">
            <Mail className={`w-4 h-4 ${notifyClient ? "text-primary" : "text-muted-foreground"}`} />
            <span className="text-xs font-body text-foreground">Notify</span>
          </div>
          <Switch checked={notifyClient} onCheckedChange={setNotifyClient} disabled={!selectedBooking?.clientEmail || !serverOnline} />
        </div>
        <div className="capture-control-tile">
          <div className="flex items-center gap-2">
            <FileImage className={`w-4 h-4 ${jpegOnly ? "text-primary" : "text-muted-foreground"}`} />
            <span className="text-xs font-body text-foreground">JPEG Only</span>
          </div>
          <Switch checked={jpegOnly} onCheckedChange={setJpegOnly} />
        </div>
      </div>

      {/* Capture transport */}
      {isNative && (
        <div className={`${captureTab === "capture" ? "" : "hidden"} capture-card p-4 mb-4 space-y-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Intake mode</p>
              <p className="text-sm font-body text-foreground mt-0.5">Receive, upload, then build Best of and review sets.</p>
            </div>
            <button
              onClick={() => CameraFtp.openHotspotSettings().catch(() => {})}
              className="inline-flex items-center gap-1.5 text-[10px] font-body tracking-wider uppercase px-2.5 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            >
              <Wifi className="w-3 h-3" /> Hotspot
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["ftp", "Wi-Fi FTP", Wifi],
              ["usb", "USB", Usb],
              ["wifi-control", "Pairing", Zap],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setCaptureTransport(id)}
                disabled={id === "wifi-control"}
                className={`capture-transport-option ${
                  captureTransport === id
                    ? "capture-transport-option-active"
                    : ""
                } ${id === "wifi-control" ? "opacity-50" : ""}`}
              >
                <Icon className="w-4 h-4 mb-1" />
                <span className="block text-xs font-body font-medium">{label}</span>
                <span className="block text-[9px] font-body uppercase tracking-wider opacity-70">
                  {id === "ftp" ? "Live" : id === "usb" ? "Cable" : "Next"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Camera panel */}
      {isNative && captureTransport === "usb" && (
        <div className={`${captureTab === "capture" ? "" : "hidden"} glass-panel rounded-xl p-4 mb-4`}>
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
                <button onClick={reconnectCamera} className="inline-flex items-center gap-1.5 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-full border border-border hover:bg-secondary transition-all" title="Force-close and re-open the camera connection, and re-request access permission">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>

              {/* Live capture toggle */}
              <div className="flex items-center justify-between pt-3 border-t border-border/50">
                <div className="flex items-center gap-2">
                  <Zap className={`w-4 h-4 ${watching ? (liveCapturePaused ? "text-amber-400" : "text-primary animate-pulse") : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-body text-foreground">Live Capture</p>
                    <p className="text-xs font-body text-muted-foreground">
                      {watching && liveCapturePaused ? "Paused — shots queued, not uploading" : "Auto-import as you shoot"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {watching && (
                    <button
                      onClick={toggleLiveCapturePause}
                      className={`inline-flex items-center gap-1 text-[10px] font-body tracking-wider uppercase px-2.5 py-1.5 rounded-full border transition-all ${
                        liveCapturePaused
                          ? "border-amber-500/50 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                      }`}
                    >
                      {liveCapturePaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      {liveCapturePaused ? "Resume" : "Pause"}
                    </button>
                  )}
                  <Switch checked={watching} onCheckedChange={toggleLiveWatch} />
                </div>
              </div>

              {/* Queued camera handles — shown while live capture is paused or processing */}
              {watching && liveQueueSize > 0 && (
                <div className="mt-2 pt-2 border-t border-border/30">
                  <p className="text-[10px] font-body text-muted-foreground/70 mb-1">
                    {liveCapturePaused ? "Held in queue:" : "Processing:"} {liveQueueSize} photo{liveQueueSize !== 1 ? "s" : ""}
                  </p>
                  <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                    {importQueueRef.current.flat().slice(0, 20).map((handle, idx) => {
                      const cf = cameraFiles.find(f => f.handle === handle);
                      return cf ? (
                        <span key={`${handle}-${idx}`} className="text-[9px] font-body text-muted-foreground/60 bg-secondary/50 px-1.5 py-0.5 rounded truncate max-w-[80px]">
                          {cf.name}
                        </span>
                      ) : null;
                    })}
                    {liveQueueSize > 20 && (
                      <span className="text-[9px] font-body text-muted-foreground/50">+{liveQueueSize - 20} more</span>
                    )}
                  </div>
                </div>
              )}

              {/* Import all */}
              {filteredCameraFiles.length > 0 && !watching && (
                <Button
                  className="w-full font-body text-xs tracking-wider uppercase gap-2 h-11"
                  onClick={async () => { const all = filteredCameraFiles.map(f => f.handle); for (let i = 0; i < all.length; i += 3) await importCameraFiles(all.slice(i, i + 3)); }}
                  disabled={importing}
                >
                  <Download className="w-4 h-4" />
                  Import All ({filteredCameraFiles.length})
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-body text-foreground">No camera detected</p>
                <p className="text-xs font-body text-muted-foreground">Connect via USB-C · Set USB mode to PTP on camera</p>
              </div>
              <button
                onClick={async () => {
                  setCameraChecking(true);
                  try { await checkCamera(); } finally { setCameraChecking(false); }
                }}
                disabled={cameraChecking}
                className="inline-flex items-center gap-1 text-[10px] font-body tracking-wider uppercase px-2.5 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50 transition-all flex-shrink-0"
              >
                <RefreshCw className={`w-3 h-3 ${cameraChecking ? "animate-spin" : ""}`} />
                {cameraChecking ? "Scanning…" : "Scan"}
              </button>
            </div>
          )}
        </div>
      )}

      {isNative && captureTransport === "ftp" && (
        <div className={`${captureTab === "capture" ? "" : "hidden"} glass-panel rounded-xl p-4 mb-4 space-y-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <Wifi className={`w-5 h-5 mt-0.5 ${ftpStatus?.running ? "text-primary" : "text-muted-foreground/60"}`} />
              <div className="min-w-0">
                <p className="text-sm font-body text-foreground">Wi-Fi FTP Receiver</p>
                <p className="text-xs font-body text-muted-foreground">
                  {ftpStatus?.running
                    ? `${ftpStatus.paused ? "Paused" : "Listening"} on ${ftpPrimaryHost}:${ftpStatus.port}`
                    : "Start this, then set Nikon Connect to FTP Server > Auto Upload ON"}
                </p>
              </div>
            </div>
            <Switch checked={!!ftpStatus?.running} onCheckedChange={toggleFtpReceiver} />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-body">
            <div className="rounded-lg bg-secondary/50 border border-border/50 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Host</p>
              <p className="text-foreground truncate">{ftpPrimaryHost}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 border border-border/50 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Port</p>
              <Input
                value={ftpPort}
                disabled={!!ftpStatus?.running}
                inputMode="numeric"
                onChange={e => {
                  const next = e.target.value.replace(/[^\d]/g, "").slice(0, 5);
                  setFtpPort(next);
                  saveFtpSettings({ username: ftpUsername, password: ftpPassword, port: Number(next) || 2121 });
                }}
                className="h-8 border-white/10 bg-white/[0.04] px-2 text-sm text-foreground"
              />
            </div>
            <div className="rounded-lg bg-secondary/50 border border-border/50 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">User</p>
              <Input
                value={ftpUsername}
                disabled={!!ftpStatus?.running}
                onChange={e => {
                  setFtpUsername(e.target.value);
                  saveFtpSettings({ username: e.target.value, password: ftpPassword, port: Number(ftpPort) || 2121 });
                }}
                autoCapitalize="none"
                autoCorrect="off"
                className="h-8 border-white/10 bg-white/[0.04] px-2 text-sm text-foreground"
              />
            </div>
            <div className="rounded-lg bg-secondary/50 border border-border/50 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Password</p>
              <Input
                value={ftpPassword}
                disabled={!!ftpStatus?.running}
                onChange={e => {
                  setFtpPassword(e.target.value);
                  saveFtpSettings({ username: ftpUsername, password: e.target.value, port: Number(ftpPort) || 2121 });
                }}
                autoCapitalize="none"
                autoCorrect="off"
                className="h-8 border-white/10 bg-white/[0.04] px-2 text-sm text-foreground"
              />
            </div>
          </div>

          {ftpStatus?.running && (
            <p className="text-[10px] font-body text-white/45">
              Stop the receiver before changing FTP username or password. Nikon must match these exactly.
            </p>
          )}

          {ftpCameraClient && (
            <div className={`rounded-lg border p-3 space-y-1.5 ${ftpCameraClient.lastError ? "border-amber-400/25 bg-amber-400/5" : "border-emerald-300/20 bg-emerald-400/5"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-body tracking-wider uppercase text-white/55">
                    {ftpCameraClient.connected ? "Camera connected" : "Last camera seen"}
                  </p>
                  <p className="text-sm font-body text-white">{ftpCameraClient.ipAddress}</p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[10px] font-body uppercase tracking-wider ${ftpCameraClient.authState === "logged-in" || ftpCameraClient.authState === "transferring" ? "border-emerald-300/30 text-emerald-100 bg-emerald-400/10" : ftpCameraClient.lastError ? "border-amber-300/30 text-amber-100 bg-amber-400/10" : "border-white/10 text-white/60 bg-white/[0.04]"}`}>
                  {ftpCameraClient.authState || "connected"}
                </span>
              </div>
              <p className="text-xs font-body text-white/58">
                {ftpCameraClient.lastError
                  ? ftpCameraClient.lastError
                  : ftpCameraClient.filesReceived
                    ? `${ftpCameraClient.filesReceived} file${ftpCameraClient.filesReceived === 1 ? "" : "s"} received${ftpCameraClient.lastTransferName ? ` · ${ftpCameraClient.lastTransferName}` : ""}`
                    : "Server reached. If no files arrive, turn Auto Upload ON and shoot/copy a JPEG."}
              </p>
            </div>
          )}

          {heldRawCount > 0 && (
            <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 space-y-1.5">
              <p className="text-[10px] font-body tracking-wider uppercase text-amber-100/80">RAW held locally</p>
              <p className="text-xs font-body text-white/65">
                {heldRawCount} RAW/unsupported file{heldRawCount === 1 ? "" : "s"} received but not sent to client proofing. Switch Nikon image quality to JPEG or RAW+JPEG with JPEG auto upload for live galleries.
              </p>
              {lastHeldRawName && <p className="text-[10px] font-body text-white/42 truncate">Latest: {lastHeldRawName}</p>}
            </div>
          )}

          {ftpCameraLinked && (
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-body tracking-wider uppercase text-emerald-100/75">Camera linked</p>
                  <p className="text-xs font-body text-white/58 truncate">
                    Setup help is hidden while the camera is connected. Files will appear in the queue as Nikon uploads them.
                  </p>
                </div>
                <button
                  onClick={() => setFtpSetupOpen(v => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-[10px] font-body uppercase tracking-wider text-emerald-100"
                >
                  {ftpSetupOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  Setup
                </button>
              </div>
            </div>
          )}

          {showFtpSetupHelp && (
            <>
              <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/5 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-body tracking-wider uppercase text-cyan-100/80">Find camera on Wi-Fi</p>
                    <p className="text-xs font-body text-white/60 mt-1">
                      The app scans the phone hotspot subnet. If your Nikon appears here, it is on the right network; use this phone server address in the FTP profile.
                    </p>
                  </div>
                  <button
                    onClick={scanForCamera}
                    disabled={cameraScanBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[10px] font-body uppercase tracking-wider text-cyan-100 disabled:opacity-50"
                  >
                    <Search className={`w-3 h-3 ${cameraScanBusy ? "animate-pulse" : ""}`} />
                    {cameraScanBusy ? "Scanning" : "Scan"}
                  </button>
                </div>
                {cameraScanCandidates.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-body uppercase tracking-wider text-white/45">Is this your camera?</p>
                    {cameraScanCandidates.slice(0, 6).map(candidate => {
                      const selected = selectedCameraCandidate?.ipAddress === candidate.ipAddress;
                      return (
                        <button
                          key={`${candidate.ipAddress}-${candidate.macAddress || ""}`}
                          onClick={() => setSelectedCameraCandidate(candidate)}
                          className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-cyan-300/40 bg-cyan-400/12" : "border-white/10 bg-white/[0.04]"}`}
                        >
                          <span className="block text-sm font-body text-white">{candidate.ipAddress}</span>
                          <span className="block text-[10px] font-body text-white/42">
                            {candidate.macAddress || "network device"}{candidate.interfaceName ? ` · ${candidate.interfaceName}` : ""}
                          </span>
                        </button>
                      );
                    })}
                    {selectedCameraCandidate && (
                      <p className="text-xs font-body text-cyan-100/70">
                        Camera selected. On Nikon, keep the FTP server host as {ftpPrimaryHost}; the camera device IP is only used to confirm it joined this hotspot.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {!ftpCameraLinked && ftpAddresses.length > 1 && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 space-y-2">
                  <p className="text-[10px] font-body tracking-wider uppercase text-amber-200/80">Unable to locate server?</p>
                  <p className="text-xs font-body text-white/65">
                    The camera must use the phone IP on the same network. If the camera is joined to this phone hotspot, try the hotspot address first.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {ftpAddresses.slice(0, 5).map((address) => (
                      <span key={address} className={`rounded-full border px-2.5 py-1 text-[11px] font-body ${address === ftpPrimaryHost ? "border-cyan-300/35 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-white/60"}`}>
                        {address}{address === ftpHotspotAddress ? " hotspot" : ""}{address === ftpPrimaryHost ? " use this" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-1.5">
                <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">Nikon Z6III / ZR setup</p>
                <p className="text-xs font-body text-muted-foreground">Network Menu &gt; Connect to FTP Server &gt; Network Settings &gt; Create Profile &gt; Connection Wizard. Choose FTP, enter the host/port/user/password above, set PASV mode ON, then Auto Upload ON.</p>
                <p className="text-[10px] font-body text-muted-foreground/70">If the phone hotspot is active, use the host shown above. If the camera creates Wi-Fi, join it in Android Wi-Fi settings first.</p>
              </div>

              <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/5 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-cyan-200 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-body tracking-wider uppercase text-cyan-100/80">Camera says “Start Wireless Transmitter Utility”?</p>
                    <p className="text-xs font-body text-white/65 mt-1">
                      That is Nikon pairing for Connect to Computer. Back out and use Connect to FTP Server for this app. FTP does not need Wireless Transmitter Utility pairing.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => CameraFtp.openHotspotSettings().catch(() => {})}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-body uppercase tracking-wider text-white/65"
                  >
                    <Wifi className="w-3 h-3" /> Wi-Fi Settings
                  </button>
                  <button
                    onClick={() => setCaptureTransport("wifi-control")}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-body uppercase tracking-wider text-white/65"
                  >
                    <Zap className="w-3 h-3" /> Pairing Info
                  </button>
                </div>
              </div>
            </>
          )}

          {(ftpStatus?.running || ftpQueueSize > 0) && (
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <div>
                <p className="text-xs font-body text-foreground">{ftpQueueSize > 0 ? `${ftpQueueSize} photo${ftpQueueSize !== 1 ? "s" : ""} queued` : "Waiting for camera uploads"}</p>
                <p className="text-[10px] font-body text-muted-foreground">{culling ? "Updating Best of…" : "Uploads update Best of quietly"}</p>
              </div>
              <button
                onClick={toggleFtpPause}
                className={`inline-flex items-center gap-1 text-[10px] font-body tracking-wider uppercase px-2.5 py-1.5 rounded-full border transition-all ${
                  ftpStatus?.paused
                    ? "border-amber-500/50 text-amber-400 bg-amber-500/10"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {ftpStatus?.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                {ftpStatus?.paused ? "Resume" : "Pause"}
              </button>
            </div>
          )}
        </div>
      )}

      {isNative && captureTransport === "wifi-control" && (
        <div className={`${captureTab === "capture" ? "" : "hidden"} glass-panel rounded-xl p-4 mb-4 space-y-4`}>
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-white/45 mt-0.5" />
            <div>
              <p className="text-sm font-body text-foreground">Nikon pairing mode</p>
              <p className="text-xs font-body text-muted-foreground">
                Planned for camera control and Nikon image-transfer pairing. Use Wi-Fi FTP for live client proofing today.
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 space-y-2">
            <p className="text-[10px] font-body tracking-wider uppercase text-muted-foreground">What the camera message means</p>
            <p className="text-xs font-body text-muted-foreground">
              “Start Wireless Transmitter Utility and select camera” appears when the camera is waiting for Nikon’s desktop utility to pair. That is not the FTP receiver path.
            </p>
            <p className="text-xs font-body text-muted-foreground">
              For this APK: Network Menu &gt; Connect to FTP Server &gt; Create Profile &gt; FTP. Then use the app’s FTP host, port 2121, user camera, password camera.
            </p>
          </div>
          <Button
            className="w-full font-body text-xs tracking-wider uppercase gap-2 h-11"
            onClick={() => setCaptureTransport("ftp")}
          >
            <Wifi className="w-4 h-4" />
            Use Wi-Fi FTP Receiver
          </Button>
        </div>
      )}

      {/* Manual pickers */}
      <div className={`${captureTab === "capture" ? "grid" : "hidden"} grid-cols-2 gap-3 mb-4`}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || importing}
          className="capture-action-tile"
        >
          <ImageIcon className="w-5 h-5 text-muted-foreground" />
          <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Pick Photos</span>
          <span className="text-[10px] font-body text-muted-foreground/60">Select multiple</span>
        </button>
        <button
          onClick={() => watchInputRef.current?.click()}
          disabled={uploading || importing}
          className="capture-action-tile"
        >
          <Camera className="w-5 h-5 text-muted-foreground" />
          <span className="text-xs font-body tracking-wider uppercase text-muted-foreground">Take a Photo</span>
          <span className="text-[10px] font-body text-muted-foreground/60">One at a time</span>
        </button>
      </div>

      {targetAlbum && targetAlbum.photos.length > 0 && (
        <div className={`${captureTab === "review" ? "" : "hidden"} capture-review-panel mb-4 space-y-3`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Best of review</p>
              <p className="text-xs font-body text-muted-foreground/70">{reviewSummary}</p>
            </div>
            <button
              onClick={() => runAutoCull(targetAlbum.id, targetAlbum)}
              disabled={culling || !serverOnline}
              className="inline-flex items-center gap-1.5 text-[10px] font-body tracking-wider uppercase px-2.5 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50 transition-all"
            >
              <RefreshCw className={`w-3 h-3 ${culling ? "animate-spin" : ""}`} />
              {culling ? "Reviewing" : "Review again"}
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {([
              ["best", "Best of", cullCounts.bestOf],
              ["review", "Review", cullCounts.review],
              ["reject", "Rejects", cullCounts.reject],
              ["all", "All", cullCounts.all],
            ] as const).map(([id, label, count]) => (
              <button
                key={id}
                onClick={() => setCullFilter(id)}
                className={`capture-review-filter ${
                  cullFilter === id
                    ? "capture-review-filter-active"
                    : ""
                }`}
              >
                <span>{count}</span>
                <small>{label}</small>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between pt-1">
            <p className="text-[10px] font-body text-muted-foreground/70">Rejects stay recoverable and off the client view unless enabled.</p>
            <Switch checked={showRejectsToClient} onCheckedChange={setClientRejectVisibility} />
          </div>
        </div>
      )}

      {/* Recent uploads */}
      {targetAlbum && (targetAlbum.photos.length > 0 || localPreviewPhotos.length > 0) && (() => {
        const allPhotos = applyCullFilter(sessionPhotosWithPreviews);
        const filteredByStars = starFilter ? allPhotos.filter(p => (p as any).starred) : allPhotos;
        const previewPhotos = filteredByStars.slice(0, 12);
        const hasMore = filteredByStars.length > 12;
        const serverPhotoCount = targetAlbum.photos.length;
        const filterLabel = cullFilter === "best" ? "Best of" : cullFilter === "reject" ? "Rejects" : cullFilter === "review" ? "Review" : "All";
        return (
          <div className={`${captureTab === "review" ? "" : "hidden"} glass-panel rounded-xl p-4`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Review Tray</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStarFilter(v => !v)}
                  className={`inline-flex items-center gap-1 text-[10px] font-body tracking-wider uppercase px-2 py-1 rounded-full border transition-colors ${starFilter ? "border-yellow-500/50 text-yellow-400 bg-yellow-500/10" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  <Star className={`w-2.5 h-2.5 ${starFilter ? "fill-yellow-400" : ""}`} /> Starred
                </button>
                <p className="text-xs font-body text-muted-foreground/60">{filteredByStars.length} {filterLabel}</p>
                {hasMore && (
                  <button
                    onClick={() => setViewAllMode(true)}
                    className="text-[10px] font-body tracking-wider uppercase px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >View All</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {previewPhotos.map((photo, idx) => (
                <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-secondary">
                  <button
                    onClick={() => setLightboxIndex(idx)}
                    className="absolute inset-0 w-full h-full active:scale-95 transition-transform"
                  >
                    <img src={getThumbSrc(photo, tenantSession?.slug)} alt={photo.title} className="w-full h-full object-cover" />
                  </button>
                  {/* Uploading indicator for local preview photos */}
                  {photo.localPreview && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
                      <RefreshCw className="w-4 h-4 text-white/80 animate-spin drop-shadow" />
                    </div>
                  )}
                  {photo.proofing && !photo.localPreview && (
                    <span className="absolute top-1 left-1 text-[8px] font-body tracking-wider uppercase px-1 py-0.5 rounded bg-primary/90 text-primary-foreground leading-tight pointer-events-none">P</span>
                  )}
                  {!photo.localPreview && (
                    <button
                      onClick={e => { e.stopPropagation(); toggleStar(photo.id); }}
                      className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-black/40 flex items-center justify-center active:scale-90 transition-all"
                    >
                      <Star className={`w-3 h-3 ${(photo as any).starred ? "text-yellow-400 fill-yellow-400" : "text-white/60"}`} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {hasMore && (
              <button
                onClick={() => setViewAllMode(true)}
                className="w-full mt-3 py-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-foreground border border-border/50 rounded-lg hover:bg-secondary/30 transition-colors"
              >
                View all {serverPhotoCount} photos
              </button>
            )}
          </div>
        );
      })()}

      {captureTab === "review" && targetAlbum && targetAlbum.photos.length === 0 && localPreviewPhotos.length === 0 && (
        <div className="capture-empty-state">
          <FolderOpen className="w-8 h-8 text-white/35" />
          <p className="text-sm font-body font-medium text-white">No photos in review yet</p>
          <p className="text-xs font-body text-white/45">Start the Wi-Fi receiver or import photos to fill Best of and review.</p>
          <button onClick={() => setCaptureTab("capture")} className="capture-primary-action mt-2">
            <RadioTower className="w-4 h-4" />
            Go to Capture
          </button>
        </div>
      )}

      {captureTab === "publish" && targetAlbum && (
        <div className="glass-panel rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-cyan-200 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-body font-semibold text-white">Client visibility</p>
              <p className="text-xs font-body text-white/50">
                Clients see Best of and review photos by default. Rejects stay uploaded and recoverable.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="capture-mini-metric"><span>{cullCounts.bestOf}</span><small>Best of</small></div>
            <div className="capture-mini-metric"><span>{cullCounts.review}</span><small>Review</small></div>
            <div className="capture-mini-metric"><span>{showRejectsToClient ? cullCounts.reject : 0}</span><small>Rejects shown</small></div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div>
              <p className="text-xs font-body text-white">Show rejects to client</p>
              <p className="text-[10px] font-body text-white/40">Use only when the client needs the full capture set.</p>
            </div>
            <Switch checked={showRejectsToClient} onCheckedChange={setClientRejectVisibility} />
          </div>
        </div>
      )}

      {/* View All Gallery */}
      {viewAllMode && targetAlbum && (() => {
        const allPhotos = applyCullFilter(sessionPhotosWithPreviews);
        const displayPhotos = viewAllStarFilter ? allPhotos.filter(p => (p as any).starred) : allPhotos;
        const starredCount = allPhotos.filter(p => (p as any).starred).length;
        const serverPhotoCount = targetAlbum.photos.length;
        return (
          <div className="fixed inset-0 z-40 bg-background flex flex-col">
            <div className="flex items-center gap-3 px-4 border-b border-border/50 bg-background/95 backdrop-blur-sm" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)", paddingBottom: "0.75rem" }}>
              <button
                onClick={() => { setViewAllMode(false); setViewAllStarFilter(false); }}
                className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center active:scale-95 transition-transform"
              >
                <ArrowLeft className="w-4 h-4 text-foreground" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-body text-foreground truncate">{selectedBooking?.clientName || "Session"}</p>
                <p className="text-xs font-body text-muted-foreground">{serverPhotoCount} photos{starredCount > 0 ? ` · ${starredCount} starred` : ""}</p>
              </div>
              {starredCount > 0 && (
                <button
                  onClick={() => setViewAllStarFilter(f => !f)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-body transition-colors ${viewAllStarFilter ? "bg-yellow-500/20 text-yellow-400" : "bg-secondary text-muted-foreground"}`}
                >
                  <Star className={`w-3 h-3 ${viewAllStarFilter ? "fill-yellow-400" : ""}`} />
                  {viewAllStarFilter ? "Starred" : "All"}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {displayPhotos.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/50">
                  <Star className="w-6 h-6 mb-2" />
                  <p className="text-xs font-body">No starred photos yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-0.5">
                  {displayPhotos.map((photo, idx) => (
                    <div key={photo.id} className="relative aspect-square overflow-hidden bg-secondary">
                      <button
                        onClick={() => setLightboxIndex(idx)}
                        className="absolute inset-0 w-full h-full active:scale-[0.98] transition-transform"
                      >
                        <img
                          src={getThumbSrc(photo, tenantSession?.slug)}
                          alt={photo.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </button>
                      {/* Uploading indicator for local preview photos */}
                      {photo.localPreview && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
                          <RefreshCw className="w-4 h-4 text-white/70 animate-spin drop-shadow" />
                        </div>
                      )}
                      {(photo as any).starred && !photo.localPreview && (
                        <span className="absolute top-1 left-1 w-4 h-4 flex items-center justify-center pointer-events-none">
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 drop-shadow" />
                        </span>
                      )}
                      {!photo.localPreview && (
                        <button
                          onClick={e => { e.stopPropagation(); toggleStar(photo.id); }}
                          className={`absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center active:scale-90 transition-all ${(photo as any).starred ? "bg-yellow-500/30" : "bg-black/40"}`}
                        >
                          <Star className={`w-3 h-3 ${(photo as any).starred ? "text-yellow-400 fill-yellow-400" : "text-white/60"}`} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Lightbox with prev/next arrows, touch swipe, pinch & double-tap zoom */}
      {lightboxIndex !== null && targetAlbum && (() => {
        const reviewPhotos = applyCullFilter(sessionPhotosWithPreviews);
        const allPhotos = viewAllMode
          ? (viewAllStarFilter ? reviewPhotos.filter(p => (p as any).starred) : reviewPhotos)
          : (starFilter ? reviewPhotos.filter(p => (p as any).starred) : reviewPhotos);
        const photo = allPhotos[lightboxIndex];
        if (!photo) return null;
        const hasPrev = lightboxIndex > 0;
        const hasNext = lightboxIndex < allPhotos.length - 1;

        const handleSwipe = (deltaX: number) => {
          if (Math.abs(deltaX) < 40) return;
          if (deltaX < 0 && hasNext) setLightboxIndex(i => i! + 1);
          else if (deltaX > 0 && hasPrev) setLightboxIndex(i => i! - 1);
        };

        const getPinchDist = (touches: React.TouchList) => {
          const dx = touches[0].clientX - touches[1].clientX;
          const dy = touches[0].clientY - touches[1].clientY;
          return Math.sqrt(dx * dx + dy * dy);
        };

        return (
          <div
            className="fixed inset-0 z-50 bg-black select-none overflow-hidden"
            onTouchStart={e => {
              if (e.touches.length === 2) {
                pinchStartDist.current = getPinchDist(e.touches);
                pinchStartScale.current = lightboxZoom;
                touchStartX.current = null;
              } else if (e.touches.length === 1) {
                const now = Date.now();
                if (now - lastTapTime.current < LIGHTBOX_DOUBLE_TAP_MS) {
                  setLightboxZoom(s => s > LIGHTBOX_MIN_ZOOM ? LIGHTBOX_MIN_ZOOM : LIGHTBOX_DOUBLE_TAP_ZOOM);
                  lastTapTime.current = 0;
                  touchStartX.current = null;
                } else {
                  lastTapTime.current = now;
                  if (lightboxZoom === 1) touchStartX.current = e.touches[0].clientX;
                  else touchStartX.current = null;
                }
              }
            }}
            onTouchMove={e => {
              if (e.touches.length === 2 && pinchStartDist.current !== null) {
                const scale = (getPinchDist(e.touches) / pinchStartDist.current) * pinchStartScale.current;
                setLightboxZoom(Math.max(LIGHTBOX_MIN_ZOOM, Math.min(LIGHTBOX_MAX_ZOOM, scale)));
              }
            }}
            onTouchEnd={e => {
              if (pinchStartDist.current !== null && e.touches.length < 2) {
                pinchStartDist.current = null;
                return;
              }
              if (touchStartX.current !== null && lightboxZoom === 1) {
                handleSwipe(touchStartX.current - e.changedTouches[0].clientX);
                touchStartX.current = null;
              }
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setLightboxIndex(null)}
              className="absolute right-4 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/80 text-lg hover:bg-white/20 active:scale-95 z-20" style={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}
            >&#x2715;</button>

            {/* Counter */}
            <p className="absolute left-0 right-0 text-center text-xs text-white/40 font-body pointer-events-none z-20" style={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}>
              {lightboxIndex + 1} / {allPhotos.length}
            </p>

            {/* Photo — fills entire viewport; AnimatePresence handles slide transitions */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={photo.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{
                    transform: `scale(${lightboxZoom})`,
                    transformOrigin: "center",
                    transition: lightboxZoom === 1 ? "transform 0.2s ease-out" : "none",
                  }}
                >
                  <CaptureLightboxImage
                    photo={photo}
                    cache={lightboxSrcCache}
                    onCacheUpdate={updateLightboxCache}
                    tenantSlug={tenantSession?.slug}
                  />
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Prev arrow — overlays the image; hidden when zoomed in */}
            {hasPrev && lightboxZoom === 1 && (
              <button
                onClick={() => setLightboxIndex(i => i! - 1)}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center hover:bg-black/70 active:scale-95 transition-all z-20"
              >
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
            )}

            {/* Next arrow — overlays the image; hidden when zoomed in */}
            {hasNext && lightboxZoom === 1 && (
              <button
                onClick={() => setLightboxIndex(i => i! + 1)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center hover:bg-black/70 active:scale-95 transition-all z-20"
              >
                <ChevronRight className="w-5 h-5 text-white" />
              </button>
            )}

            {/* Photo title */}
            <p className="absolute font-body truncate px-4 text-center text-xs text-white/30 z-20" style={{ bottom: "calc(env(safe-area-inset-bottom) + 3.5rem)", left: 0, right: 0 }}>{photo.title}</p>

            {/* Star button — overlay on image, bottom-left corner */}
            <button
              onClick={() => toggleStar(photo.id)}
              className={`absolute flex items-center gap-1.5 px-3 py-2 rounded-full active:scale-95 transition-all z-20 ${(photo as any).starred ? "bg-yellow-500/30 text-yellow-400 border border-yellow-500/50" : "bg-black/50 backdrop-blur-sm text-white/70 border border-white/20"}`}
              style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)", left: "1rem" }}
            >
              <Star className={`w-4 h-4 ${(photo as any).starred ? "text-yellow-400 fill-yellow-400" : "text-white/50"}`} />
              <span className="text-xs font-body">{(photo as any).starred ? "Starred" : "Star"}</span>
            </button>
          </div>
        );
      })()}

      {/* Send for Proofing */}
      {getSettings().proofingEnabled && targetAlbum && targetAlbum.photos.length > 0 && (
        <div className={`${captureTab === "publish" ? "" : "hidden"} mt-4`}>
          {(!targetAlbum.proofingStage || targetAlbum.proofingStage === "not-started") ? (
            <button
              onClick={handleSendForProofing}
              disabled={sendingProofing}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-yellow-500/30 text-yellow-400 bg-yellow-500/5 text-xs font-body tracking-wider uppercase hover:bg-yellow-500/10 transition-colors active:scale-[0.99] disabled:opacity-50"
            >
              <Star className="w-4 h-4" />
              {sendingProofing ? "Sending…" : "Send for Proofing"}
            </button>
          ) : (
            <div className="flex items-center justify-between p-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400/30" />
                <div>
                  <p className="text-xs font-body text-foreground font-medium">Proofing Active</p>
                  <p className="text-[10px] font-body text-muted-foreground/70 mt-0.5">Round {targetAlbum.proofingRounds?.length || 1}</p>
                </div>
              </div>
              {targetAlbum.proofingStage === "selections-submitted" && (
                <button
                  onClick={handleSendForProofing}
                  disabled={sendingProofing}
                  className="text-[10px] font-body tracking-wider uppercase px-2.5 py-1.5 rounded-full border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-50 transition-all"
                >
                  {sendingProofing ? "Sending…" : "New Round"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mark Complete */}
      {selectedBooking && selectedBooking.status !== "completed" && (
        <div className={`${captureTab === "publish" ? "" : "hidden"} mt-4`}>
          <button
            onClick={async () => {
              if (tenantSession) {
                fetch(`/api/tenant/${encodeURIComponent(tenantSession.slug)}/bookings/${encodeURIComponent(selectedBooking.id)}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "completed" }),
                }).catch(() => toast.error("Failed to update booking status"));
              } else {
                updateBooking({ ...selectedBooking, status: "completed" });
              }
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

      </div>

      <div className="capture-bottom-bar">
        {captureTabs.map(tab => {
          const Icon = tab.icon;
          const active = captureTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setCaptureTab(tab.id)} className={`capture-bottom-tab ${active ? "capture-bottom-tab-active" : ""}`}>
              <Icon className="w-5 h-5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFilePick(e.target.files)} />
      <input ref={watchInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { handleFilePick(e.target.files); if (e.target) e.target.value = ""; }} />

      {/* Album Edit Modal */}
      {showAlbumEdit && targetAlbum && (
        <AlbumEditModal
          album={targetAlbum}
          onClose={() => setShowAlbumEdit(false)}
          onSave={(updated) => {
            saveAlbum(updated);
            setTargetAlbum(updated);
            targetAlbumRef.current = updated;
            setAlbums(prev => prev.map(a => a.id === updated.id ? updated : a));
            setShowAlbumEdit(false);
            toast.success("Album updated");
          }}
        />
      )}
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
