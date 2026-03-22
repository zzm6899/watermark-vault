import { useParams, useSearchParams } from "react-router-dom";
import { useState, useCallback, useEffect, useRef } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { motion, AnimatePresence } from "framer-motion";
import { Info, Building2, Copy, Check as CheckIcon, Lock, Download, Grid, List, LayoutGrid, CreditCard, X, ChevronLeft, ChevronRight, Star, Camera, CheckCircle2, Clock, Sparkles, Maximize2, ArrowUpDown, SlidersHorizontal, ZoomIn, ZoomOut, Images, ChevronUp } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WatermarkedImage from "@/components/WatermarkedImage";
import PurchasePanel from "@/components/PurchasePanel";
import { getAlbumBySlug, getSettings, updateAlbum } from "@/lib/storage";
import { useBackfillThumbnails } from "@/hooks/use-backfill-thumbnails";
import { Badge } from "@/components/ui/badge";
import { createAlbumCheckout, createTenantAlbumCheckout, getStripeStatus, getTenantStripeStatus, getTenantSettings, isServerMode, fetchPublicAlbum, tenantPhotoSrc, ftpMoveToStarred } from "@/lib/api";
import { toast } from "sonner";
import { resizeToTargetSize } from "@/lib/image-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { Album, AlbumDownloadRecord, DownloadQuality, DownloadHistoryEntry, Photo } from "@/lib/types";

const TARGET_LIGHTBOX_BYTES = 600 * 1024; // ~600KB
// Scroll wheel zoom sensitivity — smaller = slower zoom per scroll tick
const ZOOM_WHEEL_SENSITIVITY = 0.002;
// Gallery lazy-render batch sizes
const GALLERY_INITIAL_BATCH = 36;
const GALLERY_BATCH_SIZE = 24;

/** Type for Stripe checkout params — defined at file level to avoid re-creation on every render. */
type StripeCheckoutParams = Parameters<typeof createAlbumCheckout>[0];

/** Uses baked watermarked variants for unpaid photos and clean assets for unlocked photos. */
function LightboxImage({ photo, cache, onCacheUpdate, wmDisabled, watermarkVersion }: {
  photo: Photo;
  cache: Record<string, string>;
  onCacheUpdate: (cacheKey: string, url: string) => void;
  wmDisabled?: boolean;
  watermarkVersion?: number;
}) {
  const previewSrc = getPhotoVariantSrc(photo, "thumbnail", !!wmDisabled);
  const fullSrc = getPhotoVariantSrc(photo, "medium", !!wmDisabled);
  const cacheKey = `${photo.id}:${wmDisabled ? "clean" : "wm"}:v${watermarkVersion || 0}:${fullSrc}`;

  const [src, setSrc] = useState(cache[cacheKey] || previewSrc);

  useEffect(() => {
    if (cache[cacheKey]) {
      setSrc(cache[cacheKey]);
      return;
    }

    setSrc(previewSrc);

    if (fullSrc === previewSrc) return;

    const img = new Image();
    img.onload = () => {
      onCacheUpdate(cacheKey, fullSrc);
      setSrc(fullSrc);
    };
    img.onerror = () => setSrc(previewSrc);
    img.src = fullSrc;
  }, [cache, cacheKey, fullSrc, onCacheUpdate, previewSrc]);

  return (
    <img
      src={src}
      alt={photo.title}
      className="max-w-full max-h-full w-full h-full object-contain rounded-lg"
      loading="eager"
      decoding="async"
    />
  );
}
// Session key priority: client token (works across devices) > PIN > generic per-album fallback
function getSessionKey(album: Album, pin: string, token?: string): string {
  // Token is the most portable — same magic link URL works on any device
  if (token && album.clientToken && token === album.clientToken) return `token-${token}`;
  // PIN is device-agnostic if the client knows it
  if (pin) return pin;
  // Last resort — shared per-album (no auth = no per-client isolation possible)
  return `session-${album.id}`;
}

function getFreeUsed(album: Album, sessionKey: string): number {
  return album.usedFreeDownloads?.[sessionKey] || 0;
}

function buildPhotoSrc(src: string, disableWatermark: boolean): string {
  if (!disableWatermark) return src;
  if (!src || src.startsWith("data:")) return src;
  if (/[?&]wm=0(&|$)/.test(src)) return src; // already has wm=0, avoid duplicate
  return `${src}${src.includes("?") ? "&" : "?"}wm=0`;
}

function getPhotoVariantSrc(photo: Photo, variant: "thumbnail" | "medium" | "full", disableWatermark: boolean): string {
  const p = photo as any;

  // Strip any legacy ?wm=0 from the thumbnail URL so server applies watermarks when needed
  const stripWm = (src: string) =>
    src ? src.replace(/[?&]wm=0(?=&|$)/g, "").replace(/[?&]$/, "").replace(/\?&/, "?") : src;

  // Ensure a server-hosted thumbnail URL always includes ?size=thumb for smaller payloads.
  const ensureThumbSize = (src: string) => {
    if (!src || !src.startsWith("/uploads/")) return src;
    if (src.includes("size=thumb") || src.includes("size=medium")) return src; // already has a size param
    return `${src}${src.includes("?") ? "&" : "?"}size=thumb`;
  };

  // Upgrade a server thumbnail URL to medium quality for lightbox use.
  // If the URL already uses ?size=thumb, swap to ?size=medium.
  // If it's a server-hosted image with no size param, add ?size=medium.
  const upgradeToMedium = (src: string) => {
    if (!src || !src.startsWith("/uploads/")) return src;
    if (src.includes("size=thumb")) {
      return src.replace(/([?&])size=thumb(?=&|$)/, "$1size=medium");
    }
    if (!src.includes("size=medium")) {
      // No size param yet — add medium so lightbox loads a reasonable resolution
      return `${src}${src.includes("?") ? "&" : "?"}size=medium`;
    }
    return src;
  };

  if (disableWatermark) {
    const rawBase = variant === "full" ? photo.src : (photo.thumbnail || photo.src);
    const sized = variant === "medium" ? upgradeToMedium(rawBase) : variant === "thumbnail" ? ensureThumbSize(rawBase) : rawBase;
    return buildPhotoSrc(sized, true);
  }

  if (variant === "thumbnail") {
    const src = p.thumbnailWatermarked || photo.thumbnail || photo.src;
    return ensureThumbSize(stripWm(src));
  }
  if (variant === "medium") {
    // Prefer baked watermarked variants; fall back to thumb → upgrade to medium for lightbox
    const src = p.mediumWatermarked || p.thumbnailWatermarked || photo.thumbnail || photo.src;
    return upgradeToMedium(stripWm(src));
  }
  return stripWm(p.fullWatermarked || p.mediumWatermarked || p.thumbnailWatermarked || photo.src);
}

function getGalleryPhotoSrc(photo: Photo, disableWatermark: boolean): string {
  return getPhotoVariantSrc(photo, "thumbnail", disableWatermark);
}

export default function AlbumDetail() {
  const { albumId } = useParams();
  const [album, setAlbumState] = useState(() => {
    if (!albumId) return undefined;
    const local = getAlbumBySlug(albumId);
    // If the local copy only has stub data (photos stripped by background poll),
    // return undefined so the server fetch below runs and loads the full photos.
    return local?._photosStripped ? undefined : local;
  });
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [tenantDisplayName, setTenantDisplayName] = useState<string | null>(null);
  const [tenantEmail, setTenantEmail] = useState<string | null>(null);
  const [tenantBankTransfer, setTenantBankTransfer] = useState<typeof settings.bankTransfer | null>(null);
  const [albumLoading, setAlbumLoading] = useState(() => {
    if (!albumId) return false;
    const local = getAlbumBySlug(albumId);
    // Show loading state when album is absent or only has stub data (no photos yet).
    return !local || !!local._photosStripped;
  });
  const settings = getSettings();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBankTransfer, setShowBankTransfer] = useState(false);
  const [showBankTransferRequest, setShowBankTransferRequest] = useState(false);
  const [showPaymentChoice, setShowPaymentChoice] = useState(false);
  const [showDownloadOptions, setShowDownloadOptions] = useState(false);
  const [downloadQuality, setDownloadQuality] = useState<DownloadQuality>("original");
  const [preferIndividualDownload, setPreferIndividualDownload] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const urlToken = searchParams.get("token");
  // Token in URL grants access without PIN — verified against album.clientToken
  const tokenMatchesAlbum = !!(urlToken && album?.clientToken && urlToken === album.clientToken);
  const [accessGranted, setAccessGranted] = useState(!album?.accessCode || tokenMatchesAlbum);
  const [pinInput, setPinInput] = useState("");
  const [usedPin, setUsedPin] = useState(tokenMatchesAlbum ? "__token__" : "");
  const [registeredEmail, setRegisteredEmail] = useState<string>(() => {
    // Restore email from localStorage if previously registered for this album
    try { return localStorage.getItem(`wv_email_${albumId}`) || ""; } catch { return ""; }
  });
  const [emailInput, setEmailInput] = useState("");
  const [showEmailCapture, setShowEmailCapture] = useState(false);
  const [clientNote, setClientNote] = useState("");
  const [lightboxPhotoId, setLightboxPhotoId] = useState<string | null>(null);
  const displayedPhotosRef = useRef<Photo[]>([]);
  const touchStartX = useRef<number | null>(null);
  // Callback ref for the gallery load-more sentinel. Using a callback ref instead
  // of useRef + useEffect means the IntersectionObserver is automatically
  // re-attached whenever the sentinel mounts or re-mounts (e.g. after a
  // filter/sort change resets galleryVisibleCount and the sentinel div returns
  // to the DOM). With a plain ref + [] effect the observer would keep watching
  // a detached DOM node after the sentinel disappeared and reappeared.
  const sentinelObserverRef = useRef<IntersectionObserver | null>(null);
  const gallerySentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (sentinelObserverRef.current) {
      sentinelObserverRef.current.disconnect();
      sentinelObserverRef.current = null;
    }
    if (node) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            setGalleryVisibleCount(c => c + GALLERY_BATCH_SIZE);
          }
        },
        { rootMargin: "400px" }
      );
      observer.observe(node);
      sentinelObserverRef.current = observer;
    }
  }, []);
  const [galleryVisibleCount, setGalleryVisibleCount] = useState(GALLERY_INITIAL_BATCH);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState<"default" | "asc" | "desc">("desc");
  // Local display size — defaults to admin-set album size (or "medium" fallback)
  const [localDisplaySize, setLocalDisplaySize] = useState<string>(
    () => (albumId ? getAlbumBySlug(albumId) : undefined)?.displaySize ?? "medium"
  );
  const [lightboxSrcCache, setLightboxSrcCache] = useState<Record<string, string>>({});
  const [lbZoom, setLbZoom] = useState(1);
  const [lbPan, setLbPan] = useState({ x: 0, y: 0 });
  const lbPanStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  // Stable callback for LightboxImage to update the preload cache without
  // re-triggering its useEffect on every parent render.
  const handleLightboxCacheUpdate = useCallback((cacheKey: string, url: string) => {
    setLightboxSrcCache(prev => ({ ...prev, [cacheKey]: url }));
  }, []);
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [processingStripe, setProcessingStripe] = useState(false);
  const [stripeSuccess, setStripeSuccess] = useState(() => searchParams.get("success") === "1");
  const [pollingCount, setPollingCount] = useState(0);
  const [showEmailReg, setShowEmailReg] = useState(false);
  const [emailSkippedThisSession, setEmailSkippedThisSession] = useState(false);
  const [purchaserEmail, setPurchaserEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  // When user explicitly requests to purchase the full album (via button)
  const [requestedFullAlbum, setRequestedFullAlbum] = useState(false);
  // When user explicitly requests bank transfer flow
  const [requestedBankTransfer, setRequestedBankTransfer] = useState(false);
  // Pending Stripe checkout params — set when email is required before we can launch checkout
  
  const [pendingStripeParams, setPendingStripeParams] = useState<StripeCheckoutParams | null>(null);

  // Proofing state
  const [proofingClientNote, setProofingClientNote] = useState("");
  const [proofingSubmitting, setProofingSubmitting] = useState(false);
  const [proofingSubmitted, setProofingSubmitted] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Check Stripe availability from server — uses tenant Stripe (with fallback) when a tenant album
  useEffect(() => {
    if (tenantSlug) {
      getTenantStripeStatus(tenantSlug).then(s => setStripeAvailable(s.configured));
    } else {
      getStripeStatus().then(s => setStripeAvailable(s.configured));
    }
  }, [tenantSlug]);

  usePageTitle(
    albumLoading
      ? "Gallery — Loading…"
      : album
        ? tenantDisplayName
          ? `${album.title} — ${tenantDisplayName}`
          : `${album.title} — Gallery`
        : "Gallery"
  );

  // Fetch the album from the server.
  // In server mode we always fetch even if a local copy exists so that any
  // photo changes made on the admin side (added, deleted) are immediately
  // visible to clients using the gallery/proofing link on other devices.
  // The local copy (if present) keeps showing while the fetch is in flight.
  useEffect(() => {
    if (!albumId) return;
    // Always attempt to fetch from the server — isServerMode() returns false when
    // serverAvailable is still null (undetermined), which causes the fetch to be
    // skipped on the very first page load and results in "Album Not Found" for
    // albums that are not in localStorage (e.g. tenant albums, first visit from
    // a different device).  fetchPublicAlbum handles network errors gracefully by
    // returning null, so it is safe to call even when the server may be offline.
    // Only show the loading spinner when we have no data at all yet.
    if (!album) setAlbumLoading(true);
    fetchPublicAlbum(albumId).then(async result => {
      if (result?.album) {
        const tSlug = result.tenantSlug;
        setTenantSlug(tSlug);
        let loadedAlbum = result.album;
        if (tSlug) {
          // Add ?tenant=slug to all photo URLs so the server applies the right watermark
          const withTenant = (src: string) => tenantPhotoSrc(src, tSlug);
          loadedAlbum = {
            ...result.album,
            photos: (result.album.photos || []).map((p: any) => ({
              ...p,
              src: withTenant(p.src),
              thumbnail: p.thumbnail ? withTenant(p.thumbnail) : p.thumbnail,
              thumbnailWatermarked: p.thumbnailWatermarked ? withTenant(p.thumbnailWatermarked) : p.thumbnailWatermarked,
              mediumWatermarked: p.mediumWatermarked ? withTenant(p.mediumWatermarked) : p.mediumWatermarked,
            })),
            coverImage: result.album.coverImage ? withTenant(result.album.coverImage) : result.album.coverImage,
          };
          // Fetch tenant display info and settings for header + bank transfer
          try {
            const [publicInfo, tenantSettings] = await Promise.all([
              fetch(`/api/tenant/${encodeURIComponent(tSlug)}/public`).then(r => r.ok ? r.json() : null),
              getTenantSettings(tSlug),
            ]);
            if (publicInfo?.tenant?.displayName) {
              setTenantDisplayName(publicInfo.tenant.displayName);
            }
            if (publicInfo?.tenant?.email) {
              setTenantEmail(publicInfo.tenant.email);
            }
            if (tenantSettings) {
              setTenantBankTransfer({
                enabled: !!tenantSettings.bankTransferEnabled,
                accountName: tenantSettings.bankAccountName || "",
                bsb: tenantSettings.bankBsb || "",
                accountNumber: tenantSettings.bankAccountNumber || "",
                payId: tenantSettings.bankPayId || "",
                payIdType: tenantSettings.bankPayIdType || "email",
                instructions: tenantSettings.bankInstructions || "",
              });
            }
          } catch {
            // Tenant info fetch failure is non-critical
          }
        }
        setAlbumState(loadedAlbum);
        // Reset access grant based on the server-loaded album's access code and URL token
        const tokenGrantsAccess = !!(urlToken && loadedAlbum.clientToken && urlToken === loadedAlbum.clientToken);
        setAccessGranted(!loadedAlbum.accessCode || tokenGrantsAccess);
      }
      setAlbumLoading(false);
    });
  }, [albumId]); // eslint-disable-line react-hooks/exhaustive-deps

  const watermarkPosition = settings.watermarkPosition;
  // Use tenant bank settings for tenant galleries, fall back to superuser settings
  const bankTransfer = tenantBankTransfer ?? settings.bankTransfer;

  const refreshAlbum = useCallback(() => {
    if (albumId) {
      const fresh = getAlbumBySlug(albumId);
      // Only update state from localStorage for main (non-tenant) albums.
      // Tenant albums are not stored in the main wv_albums key, so fresh will be
      // undefined — don't overwrite the in-memory album with undefined.
      if (fresh !== undefined) setAlbumState(fresh);
    }
  }, [albumId]);

  // Poll until Stripe webhook updates album (runs on stripeSuccess/pollingCount changes).
  // We must fetch fresh data from the server because the webhook writes sessionPurchases
  // directly to db.json — it never goes through the client's localStorage.
  useEffect(() => {
    if (!stripeSuccess) return;
    if (pollingCount >= 15) {
      toast.info("Payment received — refresh the page if photos don't unlock shortly.");
      setStripeSuccess(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        if (tenantSlug) {
          // For tenant albums, fetch the tenant-specific album store so the
          // webhook-written sessionPurchases are picked up by the stop-polling check.
          const res = await fetch(`/api/store/t_${encodeURIComponent(tenantSlug)}_wv_albums`);
          if (res.ok) {
            const { value } = await res.json();
            if (value != null) {
              const albums: Album[] = typeof value === "string" ? JSON.parse(value) : value;
              const serverAlbum = albums.find((a) => (album?.id !== undefined && a.id === album.id) || a.slug === albumId);
              if (serverAlbum) {
                // Merge purchase state from server into current React state (keeps
                // already-transformed tenant photo URLs intact). If prev is falsy
                // the album isn't loaded yet, so leave it as-is.
                setAlbumState(prev => prev ? {
                  ...prev,
                  allUnlocked: serverAlbum.allUnlocked,
                  paidPhotoIds: serverAlbum.paidPhotoIds,
                  sessionPurchases: serverAlbum.sessionPurchases,
                } : prev);
              }
            }
          }
        } else {
          const res = await fetch("/api/store/wv_albums");
          if (res.ok) {
            const { value } = await res.json();
            if (value != null) {
              localStorage.setItem("wv_albums", typeof value === "string" ? value : JSON.stringify(value));
            }
          }
          refreshAlbum();
        }
      } catch (err) {
        console.error("Failed to fetch album data from server:", err);
      }
      setPollingCount(n => n + 1);
    }, 2000);
    return () => clearTimeout(timer);
  }, [stripeSuccess, pollingCount, refreshAlbum, tenantSlug, album?.id, albumId]);

  // Stop polling once paid data lands
  useEffect(() => {
    if (!stripeSuccess) return;
    const hasPurchase = album && (
      album.allUnlocked ||
      album.paidPhotoIds?.length > 0 ||
      Object.keys(album.sessionPurchases || {}).length > 0
    );
    if (hasPurchase) {
      toast.success("Payment confirmed! Your photos are now unlocked.");
      setStripeSuccess(false);
      setPollingCount(0);
      if (!emailSkippedThisSession) setShowEmailReg(true);
    }
  }, [album, stripeSuccess, emailSkippedThisSession]);

  // Backfill missing thumbnails in background
  useBackfillThumbnails(album?.photos || [], useCallback((photoId, thumb) => {
    setAlbumState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, photos: prev.photos.map(p => p.id === photoId ? { ...p, thumbnail: thumb } : p) };
      updateAlbum(updated);
      return updated;
    });
  }, []));

  // Reset visible count when the photo list changes (filter / sort)
  useEffect(() => {
    setGalleryVisibleCount(GALLERY_INITIAL_BATCH);
  }, [showStarredOnly, sortOrder]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxPhotoId === null) return;
    const handler = (e: KeyboardEvent) => {
      const lbPhotos = displayedPhotosRef.current;
      const currentIdx = lbPhotos.findIndex((p: any) => p.id === lightboxPhotoId);
      if (e.key === "Escape") { setLightboxPhotoId(null); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }
      if (e.key === "ArrowLeft" && currentIdx > 0) { setLightboxPhotoId(lbPhotos[currentIdx - 1].id); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }
      if (e.key === "ArrowRight" && currentIdx >= 0 && currentIdx < lbPhotos.length - 1) { setLightboxPhotoId(lbPhotos[currentIdx + 1].id); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }
      if ((e.key === "+" || e.key === "=") && !e.ctrlKey) setLbZoom(z => Math.min(4, +(z + 0.5).toFixed(1)));
      if (e.key === "-" && !e.ctrlKey) setLbZoom(z => { const next = Math.max(1, +(z - 0.5).toFixed(1)); if (next === 1) setLbPan({ x: 0, y: 0 }); return next; });
      if (e.key === "0") { setLbZoom(1); setLbPan({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxPhotoId]);

  // Preload adjacent lightbox images when the lightbox photo changes.
  // We store album.watermarkDisabled in a ref so the effect stays stable
  // and doesn't need to re-run whenever unrelated album state changes.
  const albumWatermarkDisabledRef = useRef<boolean>(false);
  albumWatermarkDisabledRef.current = !!album?.watermarkDisabled;

  useEffect(() => {
    if (!lightboxPhotoId) return;
    const photos = displayedPhotosRef.current;
    const idx = photos.findIndex(p => p.id === lightboxPhotoId);
    if (idx < 0) return;
    // Preload up to one photo in each direction at medium resolution.
    const toPreload = [
      idx + 1 < photos.length ? photos[idx + 1] : null,
      idx - 1 >= 0 ? photos[idx - 1] : null,
    ].filter((p): p is Photo => p !== null);
    for (const photo of toPreload) {
      const src = getPhotoVariantSrc(photo, "medium", albumWatermarkDisabledRef.current);
      const img = new Image();
      img.src = src;
    }
  }, [lightboxPhotoId]);

  // Show scroll-to-top button after scrolling down
  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  /** Save the buyer's email, then resume any pending Stripe checkout.
   *  Defined here (before any conditional returns) to satisfy the Rules of Hooks. */
  const handleSaveEmail = useCallback(async () => {
    if (!purchaserEmail.includes("@")) { toast.error("Please enter a valid email"); return; }
    setSavingEmail(true);
    try {
      const emailKey = `email-${purchaserEmail.toLowerCase().trim()}`;
      await fetch("/api/album/register-purchaser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ albumId: album?.id, sessionKey: emailKey, email: purchaserEmail }),
      });
      try { localStorage.setItem(`wv_email_${albumId}`, purchaserEmail); } catch { /* localStorage may be unavailable */ }
      setRegisteredEmail(purchaserEmail);
      toast.success("Email saved — your purchases are now linked to " + purchaserEmail);
      setShowEmailReg(false);
      setPurchaserEmail("");
      // If the user was mid-Stripe-checkout, resume it now with the email session key
      if (pendingStripeParams) {
        const params = { ...pendingStripeParams, sessionKey: emailKey };
        setPendingStripeParams(null);
        setProcessingStripe(true);
        const result = tenantSlug
          ? await createTenantAlbumCheckout(tenantSlug, params)
          : await createAlbumCheckout(params);
        setProcessingStripe(false);
        if (result.url) window.location.href = result.url;
        else toast.error(result.error || "Failed to create checkout session");
      }
    } catch { toast.error("Failed to save email"); }
    setSavingEmail(false);
  }, [purchaserEmail, album?.id, albumId, pendingStripeParams, tenantSlug]);

  if (!album || (album.enabled === false && !tokenMatchesAlbum)) {
    if (albumLoading) {
      return (
        <div className="min-h-screen bg-background">
          <Header tenantSlug={null} tenantName={null} />
          <section className="pt-28 pb-32">
            <div className="container mx-auto px-4">
              {/* Skeleton title */}
              <div className="mb-12">
                <div className="h-10 w-64 bg-secondary/60 rounded-lg animate-pulse mb-3" />
                <div className="h-4 w-48 bg-secondary/40 rounded animate-pulse" />
              </div>
              {/* Skeleton photo grid */}
              <div className="masonry-grid">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="mb-4 rounded-lg bg-secondary/50 animate-pulse"
                    style={{ height: `${160 + (i % 3) * 60}px`, breakInside: "avoid" }}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="font-display text-2xl text-foreground mb-2">Album Not Found</p>
          <p className="text-muted-foreground font-body text-sm">This gallery may be private or the link is incorrect.</p>
        </div>
      </div>
    );
  }

  // Gallery-level expiry check — block all access after expiresAt
  if (album.expiresAt && new Date(album.expiresAt + "T23:59:59") < new Date()) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="glass-panel rounded-xl p-8 max-w-sm w-full text-center">
          <Lock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-2">Gallery Expired</h2>
          <p className="text-sm font-body text-muted-foreground">
            This gallery was available until{" "}
            <span className="text-foreground font-medium">
              {new Date(album.expiresAt + "T23:59:59").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
            </span>
            {" "}and is no longer accessible.
          </p>
          <p className="text-xs font-body text-muted-foreground/60 mt-3">Please contact your photographer if you believe this is an error.</p>
        </div>
      </div>
    );
  }

  if (!accessGranted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="glass-panel rounded-xl p-8 max-w-sm w-full text-center">
          <Lock className="w-8 h-8 text-primary mx-auto mb-4" />
          <h2 className="font-display text-xl text-foreground mb-2">Private Gallery</h2>
          <p className="text-sm font-body text-muted-foreground mb-4">Enter the PIN to access this gallery.</p>
          <Input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} placeholder="Enter PIN" className="bg-secondary border-border text-foreground font-body mb-3" onKeyDown={(e) => { if (e.key === "Enter") { if (pinInput === album.accessCode) { setAccessGranted(true); setUsedPin(pinInput); } else toast.error("Incorrect PIN"); } }} />
          <Button onClick={() => { if (pinInput === album.accessCode) { setAccessGranted(true); setUsedPin(pinInput); } else toast.error("Incorrect PIN"); }} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase">
            Unlock Gallery
          </Button>
        </div>
      </div>
    );
  }

  // Session key: email > token > PIN > generic fallback
  const effectiveSessionKey = registeredEmail
    ? `email-${registeredEmail.toLowerCase().trim()}`
    : null;
  const sessionKey = effectiveSessionKey || getSessionKey(album, usedPin, urlToken ?? undefined);
  const freeUsed = getFreeUsed(album, sessionKey);
  const freeRemaining = Math.max(0, album.freeDownloads - freeUsed);
  const isFullyUnlocked = album.allUnlocked === true; // admin-set only (proofing delivery, manual unlock)
  const isExpired = !!(album.downloadExpiresAt && new Date(album.downloadExpiresAt + "T23:59:59") < new Date());
  // Per-session purchase record for this viewer
  const sessionPurchase = album.sessionPurchases?.[sessionKey];
  const sessionFullAlbum = sessionPurchase?.fullAlbum === true;
  const sessionPaidIds = new Set<string>(sessionPurchase?.photoIds || []);
  // Legacy global paidPhotoIds (kept for backwards compat with old purchases)
  const globalPaidSet = new Set<string>(album.paidPhotoIds || []);
  // Approved/completed bank transfer requests also unlock their photos
  const bankPaidIds = new Set<string>(
    (album.downloadRequests || [])
      .filter((r: any) => r.status === "approved" || r.status === "completed")
      .flatMap((r: any) => r.photoIds || [])
  );
  const paidPhotoIdSet = new Set<string>([...sessionPaidIds, ...globalPaidSet, ...bankPaidIds]);

  // Proofing derived values (computed before canDownload so we can use proofingStage)
  const proofingStage = album.proofingStage || "not-started";
  const isProofingWindowExpired = !!(album.proofingExpiresAt && new Date() > new Date(album.proofingExpiresAt));
  // effectiveProofingEnabled: true when the admin has enabled proofing globally, the album
  // itself has proofing enabled (server-persisted), or the client has a valid token. This
  // allows clients who open a proofing link to see the proofing status banners even though
  // their local settings default to proofingEnabled=false.
  const effectiveProofingEnabled = settings.proofingEnabled || !!album.proofingEnabled || tokenMatchesAlbum;
  // isProofing: the album must have proofing explicitly enabled by the admin (album.proofingEnabled)
  // and be in the active "proofing" stage. Having a valid client token does NOT enable
  // interactive proofing on its own — it only grants gallery access.
  const isProofing = proofingStage === "proofing" && !!album.proofingEnabled && !isProofingWindowExpired;
  // lockDownloadsDuringProofing: block all downloads while any proofing stage is active (except
  // not-started and finals-delivered). Unlocks automatically once finals are delivered or proofing is reset.
  const isDownloadLockedForProofing = !!(album.lockDownloadsDuringProofing &&
    album.proofingEnabled &&
    proofingStage !== "not-started" &&
    proofingStage !== "finals-delivered");

  const canDownload = (isFullyUnlocked || sessionFullAlbum) && !isExpired && !album.purchasingDisabled && !isDownloadLockedForProofing;
  const isPhotoPaid = (id: string) => canDownload || paidPhotoIdSet.has(id);
  const latestRound = album.proofingRounds?.[album.proofingRounds.length - 1];
  const adminNote = latestRound?.adminNote;
  // Visible photos: hide photos marked hidden (non-selected after round approval)
  const visiblePhotos = album.photos.filter((p: any) => !p.hidden);
  const hasStarred = visiblePhotos.some((p: any) => p.starred);
  const _dpBase = showStarredOnly ? visiblePhotos.filter((p: any) => p.starred) : visiblePhotos;
  const displayedPhotos = sortOrder === "default" ? _dpBase : [..._dpBase].sort((a: any, b: any) => {
    const _dA = new Date((a as any).takenAt || (a as any).uploadedAt || 0).getTime();
    const _dB = new Date((b as any).takenAt || (b as any).uploadedAt || 0).getTime();
    const _tCmp = a.title.localeCompare(b.title, undefined, { numeric: true });
    const _timeCmp = _dA !== _dB ? _dA - _dB : _tCmp;
    return sortOrder === "asc" ? _timeCmp : -_timeCmp;
  });

  // Keep ref in sync with the current displayed photos without a useEffect (direct assignment
  // is safe here and avoids a conditional-hook violation: this code is reached only when
  // album is defined and the early-return guards above have not fired).
  displayedPhotosRef.current = displayedPhotos as Photo[];
  // Lightbox photo lookup — must be after displayedPhotos
  const lbPhoto = lightboxPhotoId ? displayedPhotos.find((p: any) => p.id === lightboxPhotoId) ?? null : null;
  const lbIdx = lbPhoto ? displayedPhotos.findIndex((p: any) => p.id === lightboxPhotoId) : -1;
  // During proofing, starred photos = client's current picks
  const starredIds = new Set<string>(album.photos.filter((p: any) => p.starred).map(p => p.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  /**
   * A photo download is watermark-free EXCEPT when the admin has set "All Downloads Unlocked"
   * with watermarks still ON and the client has not actually paid for the photo.
   * In that case the photographer wants branded (watermarked) copies for freely distributed photos.
   *
   * Every other case — free-tier quota, individual Stripe/bank payment, full-album purchase,
   * watermarks explicitly disabled — serves the clean original.
   */
  const isCleanDownload = (photoId: string): boolean => {
    // Admin branded giveaway: allUnlocked=true but watermarks still enabled and no real payment
    if (isFullyUnlocked && !album.watermarkDisabled && !paidPhotoIdSet.has(photoId) && !sessionFullAlbum) {
      return false;
    }
    return true; // free-tier, paid, watermarkDisabled, sessionFullAlbum — all get clean originals
  };

  /** Returns the URL to use when downloading a photo.
   *  Clean photos → authenticated /api/photo/original endpoint (no watermark).
   *  Watermarked photos → plain /uploads/ URL so the server applies the watermark. */
  const getDownloadSrc = (photo: { src: string; id: string }) => {
    if (isServerMode() && photo.src?.startsWith("/uploads/")) {
      // Strip query params (e.g. ?tenant=slug) to get the bare filename
      const filename = photo.src.split("?")[0].split("/").pop() || "";
      if (isCleanDownload(photo.id)) {
        return `/api/photo/${encodeURIComponent(filename)}/original?sessionKey=${encodeURIComponent(sessionKey)}&albumId=${encodeURIComponent(album.id)}`;
      }
      // Watermarked — the plain upload URL causes the server to apply the watermark
      return photo.src;
    }
    // localStorage / data-URL mode — no server watermarking, serve as-is
    return photo.src;
  };

  const downloadPhoto = async (photo: { src: string; id: string; title: string }, quality: DownloadQuality) => {
    const downloadSrc = getDownloadSrc(photo);
    if (quality === "original") {
      const link = document.createElement("a");
      link.href = downloadSrc;
      link.download = `${photo.title}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const targetBytes = quality === "2mb" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
      try {
        const blob = await resizeToTargetSize(downloadSrc, targetBytes);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${photo.title}_${quality}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch {
        // Fallback to direct download
        const link = document.createElement("a");
        link.href = downloadSrc;
        link.download = `${photo.title}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  };

  /** Downloads multiple photos as a single zip via the server zip endpoint. */
  const downloadZip = async (photos: Photo[]) => {
    const serverPhotos = photos.filter(p => p.src.startsWith("/uploads/"));
    const localPhotos = photos.filter(p => !p.src.startsWith("/uploads/"));

    // Download local (data-URL) photos individually as fallback
    for (const p of localPhotos) {
      await downloadPhoto(p, downloadQuality);
    }

    if (serverPhotos.length === 0) return;

    // Pass per-file clean/watermarked flag so the server renders each correctly
    const files = serverPhotos.map(p => ({
      // Strip query params (e.g. ?tenant=slug) to get the bare filename
      filename: p.src.split("?")[0].split("/").pop() || "",
      clean: isCleanDownload(p.id),
    }));
    try {
      const res = await fetch("/api/download/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, sessionKey, albumId: album.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Server error");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${album.title || "photos"}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(`Zip download failed: ${err.message || "unknown error"}`);
      // Fallback: download individually
      for (const p of serverPhotos) {
        await downloadPhoto(p, downloadQuality);
      }
    }
  };

  const handleDownloadFree = () => {
    setShowDownloadOptions(true);
  };

  // ── Proofing handlers ─────────────────────────────────────
  const toggleStar = (photoId: string) => {
    if (!album) return;
    const photo = album.photos.find((p: any) => p.id === photoId);
    const nowStarred = photo ? !photo.starred : false;
    const updated = {
      ...album,
      photos: album.photos.map((p: any) => p.id === photoId ? { ...p, starred: nowStarred } : p),
    };
    setAlbumState(updated);
    updateAlbum(updated);
    if (isServerMode() && photo) {
      ftpMoveToStarred({
        photoSrc: photo.src,
        albumTitle: album.title,
        albumSlug: album.slug,
        ...(tenantSlug ? { tenantSlug } : {}),
        originalName: (photo as any).originalName,
        starred: nowStarred,
      }).catch(() => {});
    }
  };

  const handleSubmitSelections = async () => {
    if (!album) return;
    const picked = album.photos.filter((p: any) => p.starred).map(p => p.id);
    if (picked.length === 0) {
      toast.error("Please star at least one photo before submitting.");
      return;
    }
    setProofingSubmitting(true);
    try {
      const res = await fetch("/api/proofing/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ albumId: album.id, selectedPhotoIds: picked, clientNote: proofingClientNote }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Server error");
      }
      // Update local UI state only — don't call updateAlbum here or it will
      // overwrite the server's picks data (selectedPhotoIds in rounds) with our
      // stale local version that doesn't have them yet
      const updated = { ...album, proofingStage: "selections-submitted" as const };
      setAlbumState(updated);
      setProofingSubmitted(true);
      toast.success(`${picked.length} photo${picked.length !== 1 ? "s" : ""} submitted — the photographer will be in touch!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit. Please try again.");
    } finally {
      setProofingSubmitting(false);
    }
  };

  const executeDownloadFree = async () => {
    const selected = album.photos.filter(p => selectedIds.has(p.id));
    // Photos paid individually via Stripe always downloadable
    const alreadyPaid = selected.filter(p => paidPhotoIdSet.has(p.id));
    const notPaid = selected.filter(p => !paidPhotoIdSet.has(p.id));
    const canDownloadFree = Math.min(notPaid.length, freeRemaining);
    const canDownload = alreadyPaid.length + canDownloadFree;
    if (canDownload === 0) {
      toast.error("No free downloads remaining for this session");
      return;
    }
    setDownloading(true);
    const toDownload = [...alreadyPaid, ...notPaid.slice(0, canDownloadFree)];
    if (isServerMode() && toDownload.length > 1 && !preferIndividualDownload) {
      await downloadZip(toDownload as Photo[]);
    } else {
      for (const p of toDownload) {
        await downloadPhoto(p, downloadQuality);
      }
    }

    const updated = { ...album };
    updated.usedFreeDownloads = { ...(updated.usedFreeDownloads || {}), [sessionKey]: freeUsed + canDownloadFree };
    // Track download history
    const historyEntry: DownloadHistoryEntry = {
      photoIds: toDownload.map(p => p.id),
      downloadedAt: new Date().toISOString(),
      quality: downloadQuality,
      sessionKey,
      email: registeredEmail || undefined,
      photoCount: toDownload.length,
    };
    updated.downloadHistory = [...(updated.downloadHistory || []), historyEntry];
    updateAlbum(updated);
    setAlbumState(updated);
    refreshAlbum();
    setSelectedIds(new Set());
    setShowDownloadOptions(false);
    setDownloading(false);
    toast.success(`Downloaded ${canDownload} photo${canDownload !== 1 ? "s" : ""}`);
  };

  const handleDownloadAll = async () => {
    if (!canDownload) return;
    setShowDownloadOptions(true);
  };

  const executeDownloadAll = async () => {
    setDownloading(true);
    const photos = selectedIds.size > 0
      ? album.photos.filter(p => selectedIds.has(p.id))
      : album.photos;
    if (isServerMode() && photos.length > 1 && !preferIndividualDownload) {
      await downloadZip(photos as Photo[]);
    } else {
      for (const p of photos) {
        await downloadPhoto(p, downloadQuality);
      }
    }
    // Track download history
    const updated = { ...album };
    const historyEntry: DownloadHistoryEntry = {
      photoIds: photos.map(p => p.id),
      downloadedAt: new Date().toISOString(),
      quality: downloadQuality,
      sessionKey,
    };
    updated.downloadHistory = [...(updated.downloadHistory || []), historyEntry];
    updateAlbum(updated);
    setAlbumState(updated);
    refreshAlbum();
    setSelectedIds(new Set());
    setShowDownloadOptions(false);
    setDownloading(false);
    toast.success(`Downloaded ${photos.length} photo${photos.length !== 1 ? "s" : ""}`);
  };

  const handlePurchaseSelected = () => {
    setEmailSkippedThisSession(false); // reset on new payment attempt
    setRequestedFullAlbum(false);
    setShowPaymentChoice(true);
    // Prompt email registration before paying if not already registered
    if (!registeredEmail && !emailSkippedThisSession) setTimeout(() => setShowEmailReg(true), 300);
  };

  const handlePurchaseAlbum = () => {
    // If full album is free (or already unlocked), just unlock and download
    if (!album.priceFullAlbum || album.priceFullAlbum === 0) {
      const updated = { ...album, allUnlocked: true };
      updateAlbum(updated);
      setAlbumState(updated);
      toast.success("Album unlocked! You can now download all photos.");
      return;
    }
    setRequestedFullAlbum(true);
    setShowPaymentChoice(true);
    // Prompt email registration before paying if not already registered
    if (!registeredEmail && !emailSkippedThisSession) setTimeout(() => setShowEmailReg(true), 300);
  };

  const handleBankTransferRequest = (explicit = false) => {
    setEmailSkippedThisSession(false); // reset skip on new payment attempt
    const selected = album.photos.filter(p => selectedIds.has(p.id));
    const unpaidSelected = selected.filter(p => !paidPhotoIdSet.has(p.id));
    const paidCount = Math.max(0, unpaidSelected.length - freeRemaining);
    // If nothing actually needs paying and the user didn't explicitly request bank transfer/full-album, just download
    if (paidCount === 0 && !explicit && !requestedFullAlbum && !requestedBankTransfer) {
      handleDownloadFree();
      return;
    }
    // Reset explicit intent marker once we open the request
    setRequestedBankTransfer(false);
    setRequestedFullAlbum(false);
    setShowBankTransferRequest(true);
  };

  const handleBankTransferClick = () => {
    setRequestedBankTransfer(true);
    setEmailSkippedThisSession(false);
    // Prompt email registration before bank transfer if needed
    if (!registeredEmail && !emailSkippedThisSession) setTimeout(() => setShowEmailReg(true), 300);
    setShowPaymentChoice(true);
  };

  /**
   * Launch Stripe checkout.  If the buyer hasn't provided their email yet,
   * save the params and show the email capture dialog (no Skip allowed) so
   * we can log the purchase to their account before redirecting.
   */
  const launchStripe = async (params: StripeCheckoutParams) => {
    if (!registeredEmail) {
      // Store params so we can resume after email is captured
      setPendingStripeParams(params);
      setShowEmailReg(true);
      return;
    }
    setProcessingStripe(true);
    const result = tenantSlug
      ? await createTenantAlbumCheckout(tenantSlug, { ...params, sessionKey })
      : await createAlbumCheckout({ ...params, sessionKey });
    setProcessingStripe(false);
    if (result.url) window.location.href = result.url;
    else toast.error(result.error || "Failed to create checkout session");
  };

  const submitBankTransferRequest = () => {
    const selected = album.photos.filter(p => selectedIds.has(p.id) && !paidPhotoIdSet.has(p.id));
    const record: AlbumDownloadRecord = {
      photoIds: selected.map(p => p.id),
      method: "bank-transfer",
      status: "pending",
      requestedAt: new Date().toISOString(),
      clientNote: clientNote.trim() || undefined,
    };
    const updated = { ...album };
    updated.downloadRequests = [...(updated.downloadRequests || []), record];
    updateAlbum(updated);
    setAlbumState(updated);
    refreshAlbum();
    setShowBankTransferRequest(false);
    setShowBankTransfer(true);
    setClientNote("");
    setSelectedIds(new Set());
    toast.success("Bank transfer request submitted! Pay using the details shown, then the photographer will unlock your photos.");
  };

  const gridClass = localDisplaySize === "small" ? "masonry-grid-sm" : localDisplaySize === "large" ? "masonry-grid-lg" : localDisplaySize === "list" ? "masonry-grid-list" : "masonry-grid";

  const unpaidSelected = album.photos.filter(p => selectedIds.has(p.id) && !paidPhotoIdSet.has(p.id));
  const paidCount = Math.max(0, unpaidSelected.length - freeRemaining);
  const pricePerPhoto = Number(album.pricePerPhoto) || 0;
  const priceFullAlbum = Number(album.priceFullAlbum) || 0;
  const paidTotal = paidCount * pricePerPhoto;
  // Compute here where all values are known — full album is cheaper when individual cost >= album price
  const fullAlbumCheaper = priceFullAlbum > 0 && paidCount > 0 && paidTotal >= priceFullAlbum;

  // Preview checkout amount used in the payment dialog to decide which CTAs to show
  const previewIsFullAlbum = requestedFullAlbum || fullAlbumCheaper || selectedIds.size === 0 || selectedIds.size === album.photos.length;
  const previewPaidCount = Math.max(0, unpaidSelected.length - freeRemaining);
  const previewCheckoutAmount = previewIsFullAlbum ? priceFullAlbum : (previewPaidCount * pricePerPhoto);


  const _expiryDaysLeft = album?.downloadExpiresAt
    ? Math.ceil((new Date(album.downloadExpiresAt + "T23:59:59").getTime() - Date.now()) / 86400000)
    : null;
  const _expiryBanner = (canDownload && album?.downloadExpiresAt && _expiryDaysLeft !== null && _expiryDaysLeft <= 14) ? (
    <div className="glass-panel rounded-xl p-4 border border-yellow-500/20 bg-yellow-500/5 flex items-center gap-3">
      <Clock className="w-4 h-4 text-yellow-400 shrink-0" />
      <p className="text-xs font-body text-muted-foreground">
        <span className="text-yellow-400 font-medium">Download expires in {_expiryDaysLeft} day{_expiryDaysLeft !== 1 ? "s" : ""}</span>
        {" "}— {new Date(album.downloadExpiresAt + "T23:59:59").toLocaleDateString("en-AU", { day: "numeric", month: "long" })}
      </p>
    </div>
  ) : null;

  const _galleryExpiryDaysLeft = album?.expiresAt
    ? Math.ceil((new Date(album.expiresAt + "T23:59:59").getTime() - Date.now()) / 86400000)
    : null;
  const _galleryExpiryBanner = (album?.expiresAt && _galleryExpiryDaysLeft !== null && _galleryExpiryDaysLeft <= 14) ? (
    <div className="glass-panel rounded-xl p-4 border border-orange-500/20 bg-orange-500/5 flex items-center gap-3">
      <Clock className="w-4 h-4 text-orange-400 shrink-0" />
      <p className="text-xs font-body text-muted-foreground">
        <span className="text-orange-400 font-medium">Gallery access expires in {_galleryExpiryDaysLeft} day{_galleryExpiryDaysLeft !== 1 ? "s" : ""}</span>
        {" "}— {new Date(album.expiresAt + "T23:59:59").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
      </p>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-background">
      <Header tenantSlug={tenantSlug} tenantName={tenantDisplayName} />

      <section className="pt-28 pb-32">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="font-display text-4xl md:text-5xl text-foreground">{album.title}</h1>
                  {visiblePhotos.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-body shrink-0">
                      <Images className="w-3 h-3" />
                      {visiblePhotos.length}
                    </span>
                  )}
                </div>
                {album.description && <p className="text-sm font-body text-muted-foreground">{album.description}</p>}
              </div>

              {/* ── Proofing Stage Banner ───────────────────────────── */}

              {/* Expired window banner (shown instead of the star UI) */}
              {effectiveProofingEnabled && album.proofingEnabled && proofingStage === "proofing" && isProofingWindowExpired && (
                <div className="glass-panel rounded-xl p-5 border border-destructive/30 bg-destructive/5">
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-display text-foreground mb-1">Proofing window has closed</p>
                      <p className="text-xs font-body text-muted-foreground">
                        The deadline to submit your photo picks has passed.
                        Please contact your photographer if you need more time.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Active proofing banner (only when window is open) */}
              {effectiveProofingEnabled && album.proofingEnabled && proofingStage === "proofing" && !isProofingWindowExpired && (
                <div className="glass-panel rounded-xl p-5 border border-yellow-500/30 bg-yellow-500/5">
                  <div className="flex items-start gap-3">
                    <Star className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0 fill-yellow-400/30" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-display text-foreground">Select your favourite photos</p>
                        {album.proofingRounds && album.proofingRounds.length > 0 && (
                          <span className="text-[10px] font-body px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">
                            Round {album.proofingRounds.length}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-body text-muted-foreground">
                        {adminNote || "Tap ★ on the photos you love — star as many as you like, then submit your picks below."}
                      </p>
                      {album.proofingExpiresAt && (() => {
                        const expiresAt = new Date(album.proofingExpiresAt!);
                        const msLeft = expiresAt.getTime() - Date.now();
                        // Guard: window expired (parent condition should catch this, but be safe)
                        if (msLeft <= 0) return null;
                        const hoursLeft = Math.floor(msLeft / 3600000);
                        const minsLeft = Math.floor((msLeft % 3600000) / 60000);
                        const timeLabel = hoursLeft > 0
                          ? `${hoursLeft}h ${minsLeft}m`
                          : `${Math.max(1, minsLeft)}m`;
                        const isUrgent = msLeft < 3 * 3600000; // < 3 hours
                        return (
                          <p className={`text-xs font-body mt-1.5 flex items-center gap-1 ${isUrgent ? "text-orange-400" : "text-yellow-400/70"}`}>
                            <Clock className="w-3 h-3 shrink-0" />
                            {isUrgent ? `⚠ Only ${timeLabel} left to submit` : `Closes in ${timeLabel}`}
                          </p>
                        );
                      })()}
                      <p className="text-xs font-body text-yellow-400/80 mt-1">
                        {starredIds.size === 0 ? "No photos starred yet" : `${starredIds.size} photo${starredIds.size !== 1 ? "s" : ""} starred`}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {effectiveProofingEnabled && album.proofingEnabled && proofingStage === "selections-submitted" && (
                <div className="glass-panel rounded-xl p-5 border border-primary/30 bg-primary/5">
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-display text-foreground mb-1">Picks received — editing in progress</p>
                      <p className="text-xs font-body text-muted-foreground">Your selections are with the photographer. Finals will be delivered here once editing is complete.</p>
                    </div>
                  </div>
                </div>
              )}
              {effectiveProofingEnabled && album.proofingEnabled && proofingStage === "editing" && (
                <div className="glass-panel rounded-xl p-5 border border-primary/30 bg-primary/5">
                  <div className="flex items-start gap-3">
                    <Camera className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-display text-foreground mb-1">Editing underway</p>
                      <p className="text-xs font-body text-muted-foreground">Your photographer is editing your selected photos. You'll receive an email when finals are ready.</p>
                    </div>
                  </div>
                </div>
              )}
              {effectiveProofingEnabled && album.proofingEnabled && proofingStage === "finals-delivered" && (
                <div className="glass-panel rounded-xl p-5 border border-green-500/30 bg-green-500/5">
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-display text-foreground mb-1">Your final photos are ready!</p>
                      <p className="text-xs font-body text-muted-foreground">Select photos below to download your edited finals.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Downloads locked during proofing */}
              {isDownloadLockedForProofing && (
                <div className="glass-panel rounded-xl p-5 border border-yellow-500/30 bg-yellow-500/5">
                  <div className="flex items-start gap-3">
                    <Lock className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-display text-foreground mb-1">Downloads locked during proofing</p>
                      <p className="text-xs font-body text-muted-foreground">Downloads are unavailable while your photos are being reviewed and edited. They'll be unlocked once your finals are delivered.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Download Expiry Banner ─────────────────────────── */}
              {isExpired && (
                <div className="glass-panel rounded-xl p-5 border border-destructive/30 bg-destructive/5">
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-display text-foreground">Download access has expired</p>
                      <p className="text-xs font-body text-muted-foreground mt-1">
                        This gallery's download period ended on {new Date(album.downloadExpiresAt! + "T23:59:59").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}. Contact your photographer to request an extension.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {_galleryExpiryBanner}
              {_expiryBanner}

              <div className="glass-panel rounded-lg p-4 space-y-4">
                {canDownload ? (
                  <div className="text-center sm:text-left">
                    <p className="text-lg font-display text-green-400">✓ Unlocked</p>
                    <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">All Photos</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-3 sm:gap-4 items-start">
                      <div className="text-center min-w-0">
                        <p className="text-lg font-display text-primary">{freeRemaining}</p>
                        <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground leading-tight">Free Left</p>
                      </div>
                      <div className="text-center min-w-0">
                        <p className="text-lg font-display text-foreground">${album.pricePerPhoto}</p>
                        <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground leading-tight">Per Photo</p>
                      </div>
                      <div className="text-center min-w-0">
                        <p className="text-lg font-display text-foreground">${album.priceFullAlbum}</p>
                        <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground leading-tight">Full Album</p>
                      </div>
                      {registeredEmail ? (
                        <div className="text-center group/email min-w-0">
                          <div className="cursor-pointer" onClick={() => setShowEmailReg(true)} title="Change email">
                            <p className="text-[10px] sm:text-[11px] font-body text-green-400 truncate">{registeredEmail}</p>
                            <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground group-hover/email:text-foreground transition-colors leading-tight">Linked ✓</p>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); try { localStorage.removeItem(`wv_email_${albumId}`); } catch { /* localStorage may be unavailable */ } setRegisteredEmail(""); }}
                            className="text-[9px] font-body text-muted-foreground/30 hover:text-red-400 transition-colors mt-0.5 block w-full leading-none"
                            title="Unlink email"
                          >unlink</button>
                        </div>
                      ) : (
                        <button onClick={() => setShowEmailReg(true)} className="text-center hover:opacity-80 transition-opacity min-w-0">
                          <p className="text-lg font-display text-muted-foreground">@</p>
                          <p className="text-[10px] font-body uppercase tracking-wider text-primary leading-tight">Add Email</p>
                        </button>
                      )}
                    </div>

                    {!album.purchasingDisabled && (
                      <div className="pt-1">
                        {previewCheckoutAmount === 0 ? (
                          <Button
                            onClick={() => { setShowPaymentChoice(false); handleDownloadFree(); }}
                            className="w-full sm:w-auto gap-3 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-sm h-12"
                          >
                            <Download className="w-5 h-5" />
                            Download Free
                          </Button>
                        ) : (
                          stripeAvailable ? (
                            <Button
                              onClick={() => {
                                setShowPaymentChoice(false);
                                const isFullAlbumPurchase =
                                  requestedFullAlbum ||
                                  fullAlbumCheaper ||
                                  selectedIds.size === 0 ||
                                  selectedIds.size === album.photos.length;
                                const checkoutAmount = isFullAlbumPurchase ? album.priceFullAlbum : paidTotal;
                                if (!isFullAlbumPurchase && checkoutAmount === 0) {
                                  handleDownloadFree();
                                  return;
                                }
                                launchStripe({
                                  albumId: album.id,
                                  albumTitle: album.title,
                                  photoCount: isFullAlbumPurchase ? album.photos.length : unpaidSelected.length,
                                  amount: checkoutAmount,
                                  clientEmail: album.clientEmail,
                                  photoIds: isFullAlbumPurchase ? [] : unpaidSelected.map(p => p.id),
                                  isFullAlbum: isFullAlbumPurchase,
                                  sessionKey,
                                });
                              }}
                              disabled={processingStripe}
                              className="w-full sm:w-auto gap-3 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-sm h-12"
                            >
                              <CreditCard className="w-5 h-5" />
                              {processingStripe ? "Redirecting to Stripe..." : "Pay with Card (Stripe)"}
                            </Button>
                          ) : null
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>

            {canDownload && (
              <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-green-500/5 border border-green-500/10">
                <Download className="w-4 h-4 text-green-400 flex-shrink-0" />
                <p className="text-xs font-body text-muted-foreground">
                  All photos are unlocked! Click any photo to select, then download.
                </p>
                <Button size="sm" variant="outline" onClick={handleDownloadAll} className="ml-auto gap-2 border-green-500/30 text-green-400 hover:bg-green-500/10 font-body text-xs">
                  <Download className="w-3.5 h-3.5" /> Download All
                </Button>
              </div>
            )}

          {/* ── Filter / Sort toolbar ──────────────────────────────── */}
          {visiblePhotos.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {/* Starred filter — only shown when at least one photo is starred */}
              {hasStarred && (
                <button
                  onClick={() => setShowStarredOnly(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-body border transition-all ${
                    showStarredOnly
                      ? "bg-yellow-400/15 border-yellow-400/40 text-yellow-400"
                      : "bg-secondary/50 border-border/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Star className={`w-3 h-3 ${showStarredOnly ? "fill-yellow-400" : ""}`} />
                  {showStarredOnly ? `Starred (${displayedPhotos.length})` : `Show Starred (${visiblePhotos.filter((p: any) => p.starred).length})`}
                </button>
              )}
              {/* Sort by time */}
              <button
                onClick={() => setSortOrder(s => s === "desc" ? "asc" : s === "asc" ? "default" : "desc")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-body border transition-all ${
                  sortOrder !== "default"
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-secondary/50 border-border/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                <ArrowUpDown className="w-3 h-3" />
                {sortOrder === "desc" ? "Newest first" : sortOrder === "asc" ? "Oldest first" : "Manual order"}
              </button>
              {/* Active filter summary — only show "Clear" when not on the default (newest-first) sort */}
              {(showStarredOnly || sortOrder !== "desc") && (
                <button
                  onClick={() => { setShowStarredOnly(false); setSortOrder("desc"); }}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-body text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
              {/* Display size controls — push to right on larger screens */}
              <div className="flex items-center gap-1 ml-auto">
                {([
                  { size: "small", icon: <LayoutGrid className="w-3.5 h-3.5" />, label: "Small" },
                  { size: "medium", icon: <Grid className="w-3.5 h-3.5" />, label: "Medium" },
                  { size: "large", icon: <List className="w-3.5 h-3.5 rotate-90" />, label: "Large" },
                  { size: "list", icon: <List className="w-3.5 h-3.5" />, label: "List" },
                ] as const).map(({ size, icon, label }) => (
                  <button
                    key={size}
                    onClick={() => setLocalDisplaySize(size)}
                    title={label}
                    className={`p-1.5 rounded-lg border transition-all ${
                      localDisplaySize === size
                        ? "border-primary/50 text-primary bg-primary/10"
                        : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          )}

          {album.photos.length === 0 ? (
            <div className="glass-panel rounded-xl p-12 text-center">
              <p className="text-sm font-body text-muted-foreground">No photos uploaded yet.</p>
            </div>
          ) : displayedPhotos.length === 0 ? (
            <div className="glass-panel rounded-xl p-12 text-center">
              <p className="text-sm font-body text-muted-foreground">No starred photos yet.</p>
            </div>
          ) : (
            <>
            <div className={gridClass}>
              {displayedPhotos.slice(0, galleryVisibleCount).map((photo, i) => (
                <div key={photo.id} className="relative group mb-3 sm:mb-4 overflow-hidden rounded-lg transition-transform duration-200 hover:scale-[1.01] hover:shadow-xl hover:shadow-black/40">
                  <WatermarkedImage
                src={getGalleryPhotoSrc(photo,
                  // Branded giveaway: allUnlocked but watermarks still active and no real payment → keep watermark in gallery (matches download behaviour)
                  (isFullyUnlocked && !album.watermarkDisabled && !paidPhotoIdSet.has(photo.id) && !sessionFullAlbum)
                    ? false
                    : !!(album.watermarkDisabled || isPhotoPaid(photo.id))
                )}
                  title={photo.title}
                  selected={isProofing ? starredIds.has(photo.id) : selectedIds.has(photo.id)}
                  onSelect={() => isProofing ? toggleStar(photo.id) : toggleSelect(photo.id)}
                  locked={!isProofing && !isPhotoPaid(photo.id) && freeRemaining <= 0 && !selectedIds.has(photo.id)}
                  index={i}
                  showWatermark={false}
                  renderWatermarkOverlay={false}
                  watermarkPosition={watermarkPosition}
                  watermarkText={settings.watermarkText}
                  watermarkImage={settings.watermarkImage}
                  watermarkOpacity={settings.watermarkOpacity}
                  watermarkSize={settings.watermarkSize ?? 40}
                />
                  {/* Expand button — always visible on touch devices, hover-only on pointer devices */}
                  <button
                    onClick={e => { e.stopPropagation(); setLightboxPhotoId(photo.id); }}
                    className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center [@media(hover:none)]:opacity-100 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                  {isProofing && (
                    <button
                      onClick={() => toggleStar(photo.id)}
                      className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-lg ${
                        starredIds.has(photo.id)
                          ? "bg-yellow-400 text-yellow-900 scale-110"
                          : "bg-black/60 backdrop-blur-sm text-white/70 [@media(hover:none)]:opacity-100 opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <Star className={`w-4 h-4 ${starredIds.has(photo.id) ? "fill-yellow-900" : ""}`} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {/* Sentinel for batch loading more photos */}
            {galleryVisibleCount < displayedPhotos.length && (
              <div ref={gallerySentinelRef} className="flex justify-center py-8">
                <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            )}
            </>
          )}
        </div>
      </section>

      {/* Scroll-to-top button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="fixed bottom-24 right-4 z-40 w-10 h-10 rounded-full bg-secondary/90 backdrop-blur-sm border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 flex items-center justify-center shadow-lg transition-colors"
            title="Back to top"
          >
            <ChevronUp className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Stripe payment confirming banner */}
      {stripeSuccess && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 glass-panel rounded-full px-5 py-2.5 border border-primary/30 flex items-center gap-2 shadow-lg">
          <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span className="text-xs font-body text-primary">Confirming payment…</span>
        </div>
      )}

      {/* Proofing submit bar */}
      {isProofing && !proofingSubmitted && (
        <motion.div
          initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-yellow-500/20 p-4"
        >
          <div className="max-w-2xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-display text-foreground">
                  {starredIds.size === 0 ? "Star photos to select them" : `${starredIds.size} photo${starredIds.size !== 1 ? "s" : ""} selected`}
                </p>
                <p className="text-xs font-body text-muted-foreground">Tap ★ on any photo to add/remove from your picks</p>
              </div>
              <button
                onClick={handleSubmitSelections}
                disabled={proofingSubmitting || starredIds.size === 0}
                className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-yellow-950 font-body text-xs tracking-wider uppercase px-5 py-2.5 rounded-full transition-colors font-semibold"
              >
                <CheckCircle2 className="w-4 h-4" />
                {proofingSubmitting ? "Submitting…" : "Submit Picks"}
              </button>
            </div>
            <textarea
              value={proofingClientNote}
              onChange={e => setProofingClientNote(e.target.value)}
              placeholder="Add a note for the photographer (optional)…"
              rows={1}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-body text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-yellow-500/50"
            />
          </div>
        </motion.div>
      )}

      {/* Show PurchasePanel unless every selected photo is already paid, or we're in proofing mode, or purchasing disabled, or downloads locked */}
      {!canDownload && !isProofing && !album.purchasingDisabled && !isDownloadLockedForProofing && !(selectedIds.size > 0 && Array.from(selectedIds).every(id => isPhotoPaid(id))) && (
        <PurchasePanel
          selectedCount={selectedIds.size}
          unpaidCount={unpaidSelected.length}
          alreadyPaidCount={selectedIds.size - unpaidSelected.length}
          freeRemaining={freeRemaining}
          pricePerPhoto={pricePerPhoto}
          priceFullAlbum={priceFullAlbum}
          fullAlbumCheaper={fullAlbumCheaper}
          totalPhotos={album.photos.length}
          onDownloadFree={handleDownloadFree}
          onPurchaseSelected={handlePurchaseSelected}
          onPurchaseAlbum={handlePurchaseAlbum}
          onBankTransfer={handleBankTransferClick}
          bankTransferEnabled={bankTransfer.enabled}
        />
      )}

      {/* Download bar when all selected photos are individually paid */}
      {!canDownload && !isDownloadLockedForProofing && selectedIds.size > 0 && Array.from(selectedIds).every(id => isPhotoPaid(id)) && (
        <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-border/50 p-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}>
          <div className="container mx-auto flex items-center justify-between">
            <p className="text-sm font-body text-foreground">
              <span className="font-semibold">{selectedIds.size}</span> paid photo{selectedIds.size !== 1 ? 's' : ''} selected
            </p>
            <Button onClick={() => setShowDownloadOptions(true)} size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              <Download className="w-4 h-4" /> Download
            </Button>
          </div>
        </motion.div>
      )}

      {canDownload && selectedIds.size > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-border/50 p-4"
        >
          <div className="container mx-auto flex items-center justify-between">
            <p className="text-sm font-body text-foreground">
              <span className="font-semibold">{selectedIds.size}</span> photo{selectedIds.size !== 1 ? "s" : ""} selected
            </p>
            <Button onClick={() => setShowDownloadOptions(true)} size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              <Download className="w-4 h-4" /> Download Selected
            </Button>
          </div>
        </motion.div>
      )}

      {/* Download Quality Options */}
      <Dialog open={showDownloadOptions} onOpenChange={setShowDownloadOptions}>
        <DialogContent className="glass-panel border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" />
              Download Options
            </DialogTitle>
            <DialogDescription className="sr-only">Choose the quality and format for your photo downloads.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {(() => {
              const downloadCount = canDownload
                ? (selectedIds.size > 0 ? selectedIds.size : album.photos.length)
                : (() => {
                    const sel = album.photos.filter(p => selectedIds.has(p.id));
                    const paid = sel.filter(p => paidPhotoIdSet.has(p.id));
                    const free = Math.min(sel.filter(p => !paidPhotoIdSet.has(p.id)).length, freeRemaining);
                    return paid.length + free;
                  })();
              const canUseZip = isServerMode() && downloadCount > 1;
              const useZip = canUseZip && !preferIndividualDownload;
              return (
                <>
                  {/* ZIP vs Individual toggle — only shown in server mode with multiple photos */}
                  {canUseZip && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPreferIndividualDownload(false)}
                        className={`flex-1 flex items-center gap-2 p-3 rounded-lg border text-sm font-body transition-colors ${!preferIndividualDownload ? "bg-primary/10 border-primary/40 text-foreground" : "bg-secondary border-border text-muted-foreground hover:bg-secondary/80"}`}
                      >
                        <Download className="w-4 h-4 flex-shrink-0" />
                        <div className="text-left">
                          <p>Download as ZIP</p>
                          <p className="text-[10px] text-muted-foreground">{downloadCount} photos · single file</p>
                        </div>
                      </button>
                      <button
                        onClick={() => setPreferIndividualDownload(true)}
                        className={`flex-1 flex items-center gap-2 p-3 rounded-lg border text-sm font-body transition-colors ${preferIndividualDownload ? "bg-primary/10 border-primary/40 text-foreground" : "bg-secondary border-border text-muted-foreground hover:bg-secondary/80"}`}
                      >
                        <Download className="w-4 h-4 flex-shrink-0" />
                        <div className="text-left">
                          <p>Individual Files</p>
                          <p className="text-[10px] text-muted-foreground">{downloadCount} separate downloads</p>
                        </div>
                      </button>
                    </div>
                  )}
                  {/* Quality selector — shown when downloading individually OR non-server mode */}
                  {(!canUseZip || preferIndividualDownload) && (
                    <RadioGroup value={downloadQuality} onValueChange={(v) => setDownloadQuality(v as DownloadQuality)}>
                      <div className="flex items-center space-x-3 p-3 rounded-lg bg-secondary hover:bg-secondary/80 cursor-pointer">
                        <RadioGroupItem value="2mb" id="q-2mb" />
                        <Label htmlFor="q-2mb" className="font-body text-sm cursor-pointer flex-1">
                          <span className="text-foreground">Web Quality</span>
                          <span className="text-xs text-muted-foreground block">~2 MB per photo · Fast download</span>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 p-3 rounded-lg bg-secondary hover:bg-secondary/80 cursor-pointer">
                        <RadioGroupItem value="5mb" id="q-5mb" />
                        <Label htmlFor="q-5mb" className="font-body text-sm cursor-pointer flex-1">
                          <span className="text-foreground">High Quality</span>
                          <span className="text-xs text-muted-foreground block">~5 MB per photo · Print ready</span>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 p-3 rounded-lg bg-secondary hover:bg-secondary/80 cursor-pointer">
                        <RadioGroupItem value="original" id="q-original" />
                        <Label htmlFor="q-original" className="font-body text-sm cursor-pointer flex-1">
                          <span className="text-foreground">Original</span>
                          <span className="text-xs text-muted-foreground block">Full resolution · Largest file size</span>
                        </Label>
                      </div>
                    </RadioGroup>
                  )}
                  <Button
                    onClick={canDownload ? executeDownloadAll : executeDownloadFree}
                    disabled={downloading}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {downloading
                      ? (useZip ? "Preparing ZIP…" : "Downloading…")
                      : (useZip ? `Download ZIP (${downloadCount})` : `Download (${downloadCount})`)}
                  </Button>
                </>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Method Choice */}
      <Dialog open={showPaymentChoice} onOpenChange={(v) => { setShowPaymentChoice(v); if (!v) { setRequestedFullAlbum(false); setRequestedBankTransfer(false); } }}>
        <DialogContent className="glass-panel border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground">Choose Payment Method</DialogTitle>
            <DialogDescription className="sr-only">Select how you would like to pay for your selected photos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-sm font-body text-muted-foreground">
              {selectedIds.size} photo{selectedIds.size !== 1 ? "s" : ""} selected
              {paidCount > 0 && (
                  <>
                    {" · "}
                    <span className="text-primary font-medium">
                      ${fullAlbumCheaper ? priceFullAlbum : paidTotal}
                    </span>
                    {fullAlbumCheaper && (
                      <span className="text-muted-foreground"> (full album)</span>
                    )}
                  </>
                )}
            </p>

            {stripeAvailable && (
              <Button
                onClick={() => {
                  setShowPaymentChoice(false);
                  const isFullAlbumPurchase =
                    requestedFullAlbum ||
                    fullAlbumCheaper ||
                    selectedIds.size === 0 ||
                    selectedIds.size === album.photos.length;
                  const photosBeingPaid = isFullAlbumPurchase
                    ? [] // server handles full album
                    : album.photos.filter(p => selectedIds.has(p.id) && !paidPhotoIdSet.has(p.id) && !( unpaidSelected.indexOf(p) < freeRemaining ));
                  // Recalculate amount using only truly unpaid photos
                  const checkoutAmount = isFullAlbumPurchase ? album.priceFullAlbum : paidTotal;
                  // If nothing actually needs paying, just download
                  if (!isFullAlbumPurchase && checkoutAmount === 0) {
                    handleDownloadFree();
                    return;
                  }
                  launchStripe({
                    albumId: album.id,
                    albumTitle: album.title,
                    photoCount: isFullAlbumPurchase ? album.photos.length : unpaidSelected.length,
                    amount: checkoutAmount,
                    clientEmail: album.clientEmail,
                    photoIds: isFullAlbumPurchase ? [] : photosBeingPaid.map(p => p.id),
                    isFullAlbum: isFullAlbumPurchase,
                    sessionKey,
                  });
                }}
                disabled={processingStripe}
                className="w-full gap-3 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-sm h-12"
              >
                <CreditCard className="w-5 h-5" />
                {processingStripe ? "Redirecting to Stripe..." : "Pay with Card (Stripe)"}
              </Button>
            )}

            {bankTransfer.enabled && (
              <Button
                onClick={() => {
                  setShowPaymentChoice(false);
                  // If user hasn't registered email, show email capture first and remember intent
                  if (!registeredEmail && !emailSkippedThisSession) {
                    setRequestedBankTransfer(true);
                    setShowEmailReg(true);
                  } else {
                    handleBankTransferRequest(true);
                  }
                }}
                variant="outline"
                className="w-full gap-3 border-border text-foreground hover:bg-secondary font-body text-sm h-12"
              >
                <Building2 className="w-5 h-5" />
                Bank Transfer / PayID
              </Button>
            )}

            {!stripeAvailable && !bankTransfer.enabled && (
              <div className="p-4 rounded-lg bg-secondary text-center">
                <p className="text-sm font-body text-muted-foreground">No payment methods configured. Contact the photographer.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Bank Transfer Details Dialog */}
      <Dialog open={showBankTransfer} onOpenChange={setShowBankTransfer}>
        <DialogContent className="glass-panel border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              Bank Transfer Details
            </DialogTitle>
            <DialogDescription className="sr-only">Bank transfer payment details for your photo purchase.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {bankTransfer.accountName && (
              <DetailRow label="Account Name" value={bankTransfer.accountName} onCopy={() => copyToClipboard(bankTransfer.accountName, "name")} copied={copiedField === "name"} />
            )}
            {bankTransfer.bsb && (
              <DetailRow label="BSB" value={bankTransfer.bsb} onCopy={() => copyToClipboard(bankTransfer.bsb, "bsb")} copied={copiedField === "bsb"} />
            )}
            {bankTransfer.accountNumber && (
              <DetailRow label="Account Number" value={bankTransfer.accountNumber} onCopy={() => copyToClipboard(bankTransfer.accountNumber, "acc")} copied={copiedField === "acc"} />
            )}
            {bankTransfer.payId && (
              <DetailRow label={`PayID (${bankTransfer.payIdType})`} value={bankTransfer.payId} onCopy={() => copyToClipboard(bankTransfer.payId, "payid")} copied={copiedField === "payid"} />
            )}
            {bankTransfer.instructions && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                <p className="text-xs font-body text-muted-foreground">{bankTransfer.instructions}</p>
              </div>
            )}
            <p className="text-xs font-body text-muted-foreground text-center">Once payment is confirmed, the photographer will unlock your photos.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bank Transfer Request Dialog */}
      <Dialog open={showBankTransferRequest} onOpenChange={setShowBankTransferRequest}>
        <DialogContent className="glass-panel border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              Request Photos via Bank Transfer
            </DialogTitle>
            <DialogDescription className="sr-only">Submit a bank transfer request to unlock your selected photos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm font-body text-muted-foreground">
              You've selected <span className="text-primary font-medium">{selectedIds.size}</span> photo{selectedIds.size !== 1 ? "s" : ""}.
              {paidCount > 0
                ? <> (<span className="text-primary font-medium">{Math.min(unpaidSelected.length, freeRemaining)} free</span>, <span className="text-primary font-medium">{paidCount} paid</span>)</>
                : freeRemaining > 0 ? <> (all free)</> : null}
            </p>
            <div className="p-3 rounded-lg bg-secondary">
              <p className="text-xs font-body text-muted-foreground">Estimated total</p>
              {fullAlbumCheaper ? (
                <div>
                  <p className="text-lg font-display text-green-400">${priceFullAlbum} <span className="text-xs font-body text-muted-foreground line-through">${paidTotal}</span></p>
                  <p className="text-xs font-body text-green-400/80 mt-0.5">Full album price applied — better deal!</p>
                </div>
              ) : (
                <p className="text-lg font-display text-foreground">${paidTotal}</p>
              )}
            </div>
            <div>
              <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Note (optional)</label>
              <Textarea value={clientNote} onChange={(e) => setClientNote(e.target.value)} placeholder="Your name or reference..." className="bg-secondary border-border text-foreground font-body min-h-[60px]" />
            </div>
            <Button onClick={submitBankTransferRequest} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2">
              <Building2 className="w-4 h-4" /> Submit Request & View Bank Details
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Post-payment email registration */}
      <Dialog open={showEmailReg} onOpenChange={(open) => { setShowEmailReg(open); if (!open && !registeredEmail) { setPendingStripeParams(null); } }}>
        <DialogContent className="glass-panel border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground">
              {pendingStripeParams ? "Email required for payment" : "Save your access"}
            </DialogTitle>
            <DialogDescription className="sr-only">Add your email to link purchases to your account so you can access photos from any device.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm font-body text-muted-foreground">
              {pendingStripeParams
                ? "Enter your email so your purchase is logged and you can re-access your photos from any device."
                : "Add your email to link this purchase to your account — so you can re-access your photos from any device using the same gallery link."}
            </p>
            <input
              type="email"
              placeholder="your@email.com"
              value={purchaserEmail}
              onChange={e => setPurchaserEmail(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSaveEmail(); }}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <div className="flex gap-2">
              <Button
                onClick={handleSaveEmail}
                disabled={savingEmail}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-sm"
              >
                {savingEmail ? "Saving…" : pendingStripeParams ? "Save & Pay" : "Save Email"}
              </Button>
              {/* Don't offer Skip when Stripe payment is waiting — email is required */}
              {!pendingStripeParams && (
                <Button variant="outline" onClick={() => { setShowEmailReg(false); setEmailSkippedThisSession(true); }} className="font-body text-sm border-border">
                  Skip
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fullscreen Lightbox */}
      <AnimatePresence>
        {lbPhoto ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
            onClick={() => { if (lbZoom === 1) setLightboxPhotoId(null); }}
            onWheel={(e) => {
              e.preventDefault();
              setLbZoom(z => {
                const next = Math.min(4, Math.max(1, +(z - e.deltaY * ZOOM_WHEEL_SENSITIVITY).toFixed(2)));
                if (next === 1) setLbPan({ x: 0, y: 0 });
                return next;
              });
            }}
            onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (touchStartX.current === null) return;
              const dx = e.changedTouches[0].clientX - touchStartX.current;
              touchStartX.current = null;
              if (lbZoom > 1) return; // don't swipe-navigate when zoomed
              if (Math.abs(dx) < 50) return; // too short — treat as a tap, let onClick close
              e.preventDefault(); // block the synthetic click so lightbox stays open
              const photos = displayedPhotosRef.current;
              const idx = photos.findIndex(p => p.id === lightboxPhotoId);
              if (dx < 0 && idx < photos.length - 1) { setLightboxPhotoId(photos[idx + 1].id); setLbZoom(1); setLbPan({ x: 0, y: 0 }); } // swipe left → next
              if (dx > 0 && idx > 0) { setLightboxPhotoId(photos[idx - 1].id); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }                  // swipe right → prev
            }}
          >
            {/* Close button */}
            <button className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/25 transition-colors"
              onClick={() => { setLightboxPhotoId(null); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }}>
              <X className="w-5 h-5" />
            </button>

            {/* Zoom controls */}
            <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-10 flex items-center gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); setLbZoom(z => { const next = Math.max(1, +(z - 0.5).toFixed(1)); if (next === 1) setLbPan({ x: 0, y: 0 }); return next; }); }}
                disabled={lbZoom <= 1}
                className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/25 transition-colors disabled:opacity-30 disabled:cursor-default"
                title="Zoom out (−)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              {lbZoom !== 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }}
                  className="h-9 px-3 rounded-full bg-white/15 backdrop-blur-sm text-white text-xs font-body hover:bg-white/25 transition-colors"
                  title="Reset zoom (0)"
                >
                  {Math.round(lbZoom * 100)}%
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setLbZoom(z => Math.min(4, +(z + 0.5).toFixed(1))); }}
                disabled={lbZoom >= 4}
                className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/25 transition-colors disabled:opacity-30 disabled:cursor-default"
                title="Zoom in (+)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Nav arrows — hidden when zoomed */}
            {lbZoom === 1 && lbIdx > 0 && (
              <button className="absolute left-2 sm:left-4 z-10 w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/25 transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxPhotoId(displayedPhotos[lbIdx - 1].id); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }}>
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {lbZoom === 1 && lbIdx < displayedPhotos.length - 1 && (
              <button className="absolute right-2 sm:right-4 z-10 w-11 h-11 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/25 transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxPhotoId(displayedPhotos[lbIdx + 1].id); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }}>
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            {/* Photo */}
            <div
              className="relative w-full max-w-[96vw] sm:max-w-[90vw] h-[78vh] sm:h-[84vh] flex items-center justify-center overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={() => { if (lbZoom === 1) { setLbZoom(2); } else { setLbZoom(1); setLbPan({ x: 0, y: 0 }); } }}
              onMouseDown={(e) => {
                if (lbZoom > 1) {
                  e.preventDefault();
                  lbPanStart.current = { mx: e.clientX, my: e.clientY, px: lbPan.x, py: lbPan.y };
                }
              }}
              onMouseMove={(e) => {
                if (lbPanStart.current) {
                  setLbPan({ x: lbPanStart.current.px + e.clientX - lbPanStart.current.mx, y: lbPanStart.current.py + e.clientY - lbPanStart.current.my });
                }
              }}
              onMouseUp={() => { lbPanStart.current = null; }}
              onMouseLeave={() => { lbPanStart.current = null; }}
              style={{ cursor: lbZoom > 1 ? (lbPanStart.current ? "grabbing" : "grab") : "default" }}
            >
              <div
                style={{ transform: `scale(${lbZoom}) translate(${lbPan.x / lbZoom}px, ${lbPan.y / lbZoom}px)`, transition: lbPanStart.current ? "none" : "transform 0.15s ease", transformOrigin: "center center", width: "100%", height: "100%" }}
                className="flex items-center justify-center"
              >
                <LightboxImage
                  photo={lbPhoto}
                  cache={lightboxSrcCache}
                  onCacheUpdate={handleLightboxCacheUpdate}
                  wmDisabled={!!(album.watermarkDisabled || isPhotoPaid(lbPhoto.id))}
                  watermarkVersion={(settings as any).watermarkVersion || (lbPhoto as any).watermarkVersion || 0}
                />
              </div>

              {/* Bottom bar with select/star/title */}
              <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-t from-black/80 to-transparent rounded-b-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2" style={{ pointerEvents: lbZoom > 1 ? "none" : undefined }}>
                <p className="text-sm font-body text-white/90 pr-12 sm:pr-0">{lbPhoto.title}</p>
                <div className="flex gap-2">
                  {isProofing && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleStar(lbPhoto.id)}
                      className={`gap-1.5 font-body text-xs border-white/20 ${(lbPhoto as any).starred ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40 hover:bg-yellow-500/30" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                    >
                      <Star className={`w-3.5 h-3.5 ${(lbPhoto as any).starred ? "fill-yellow-400 text-yellow-400" : ""}`} />
                      {(lbPhoto as any).starred ? "Starred" : "Star"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={selectedIds.has(lbPhoto.id) ? "default" : "outline"}
                    onClick={() => toggleSelect(lbPhoto.id)}
                    className="gap-1.5 font-body text-xs"
                  >
                    {selectedIds.has(lbPhoto.id) ? (
                      <><CheckIcon className="w-3.5 h-3.5" /> Selected</>
                    ) : (
                      <><Download className="w-3.5 h-3.5" /> Select</>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Counter */}
            <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2">
              <p className="text-xs font-body text-white/50 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full">
                {lbIdx + 1} / {displayedPhotos.length}
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Footer tenantName={tenantDisplayName ?? undefined} tenantEmail={tenantEmail ?? undefined} />
    </div>
  );
}

function DetailRow({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
      <div>
        <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm font-body text-foreground font-medium">{value}</p>
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={onCopy}>
        {copied ? <CheckIcon className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}
