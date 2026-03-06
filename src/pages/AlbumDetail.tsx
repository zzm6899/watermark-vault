import { useParams, useSearchParams } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info, Building2, Copy, Check as CheckIcon, Lock, Download, Grid, List, LayoutGrid, CreditCard, X, ChevronLeft, ChevronRight, Star, Camera, CheckCircle2, Clock, Sparkles, Maximize2, ArrowUpDown, SlidersHorizontal } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WatermarkedImage from "@/components/WatermarkedImage";
import PurchasePanel from "@/components/PurchasePanel";
import { getAlbumBySlug, getSettings, updateAlbum } from "@/lib/storage";
import { useBackfillThumbnails } from "@/hooks/use-backfill-thumbnails";
import { Badge } from "@/components/ui/badge";
import { createAlbumCheckout, getStripeStatus } from "@/lib/api";
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

/** Renders a medium-quality lightbox image, caching the resized blob URL. */
function LightboxImage({ photo, cache, onCacheUpdate, wmDisabled }: {
  photo: Photo;
  cache: Record<string, string>;
  onCacheUpdate: (id: string, url: string) => void;
  wmDisabled?: boolean;
}) {
  const photoSrc = (() => {
    const baseSrc = photo.src;
    if (!wmDisabled) return baseSrc;
    if (baseSrc.startsWith("data:")) return baseSrc;
    return `${baseSrc}${baseSrc.includes("?") ? "&" : "?"}wm=0`;
  })();

  // Show cached version immediately, or fall back to original src (no blank flash)
  const [src, setSrc] = useState(cache[photo.id] || photoSrc);

  useEffect(() => {
    // If already cached, use it immediately
    if (cache[photo.id]) {
      setSrc(cache[photo.id]);
      return;
    }

    // Show original immediately so navigation feels instant
    setSrc(photoSrc);

    // Then upgrade to resized version in background
    let cancelled = false;
    resizeToTargetSize(photoSrc, TARGET_LIGHTBOX_BYTES)
      .then(blob => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        onCacheUpdate(photo.id, url);
        setSrc(url);
      })
      .catch(() => {
        /* keep original src */
      });

    return () => {
      cancelled = true;
    };
  }, [photo.id, photoSrc, cache, onCacheUpdate]);

  return (
    <img
      src={src}
      alt={photo.title}
      className="w-auto max-w-[94vw] max-h-[72vh] sm:max-h-[85vh] object-contain rounded-lg"
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

export default function AlbumDetail() {
  const { albumId } = useParams();
  const [album, setAlbumState] = useState(() => albumId ? getAlbumBySlug(albumId) : undefined);
  const settings = getSettings();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBankTransfer, setShowBankTransfer] = useState(false);
  const [showBankTransferRequest, setShowBankTransferRequest] = useState(false);
  const [showPaymentChoice, setShowPaymentChoice] = useState(false);
  const [showDownloadOptions, setShowDownloadOptions] = useState(false);
  const [downloadQuality, setDownloadQuality] = useState<DownloadQuality>("original");
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
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState<"default" | "asc" | "desc">("default");
  const [lightboxSrcCache, setLightboxSrcCache] = useState<Record<string, string>>({});
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

  // Proofing state
  const [proofingClientNote, setProofingClientNote] = useState("");
  const [proofingSubmitting, setProofingSubmitting] = useState(false);
  const [proofingSubmitted, setProofingSubmitted] = useState(false);

  // Check Stripe availability from server (Docker env var)
  useEffect(() => {
    getStripeStatus().then(s => setStripeAvailable(s.configured));
  }, []);

  const watermarkPosition = settings.watermarkPosition;
  const bankTransfer = settings.bankTransfer;

  const refreshAlbum = useCallback(() => {
    if (albumId) {
      const fresh = getAlbumBySlug(albumId);
      setAlbumState(fresh);
    }
  }, [albumId]);

  // Poll until Stripe webhook updates album (runs on stripeSuccess/pollingCount changes)
  useEffect(() => {
    if (!stripeSuccess) return;
    if (pollingCount >= 15) {
      toast.info("Payment received — refresh the page if photos don't unlock shortly.");
      setStripeSuccess(false);
      return;
    }
    const timer = setTimeout(() => {
      refreshAlbum();
      setPollingCount(n => n + 1);
    }, 2000);
    return () => clearTimeout(timer);
  }, [stripeSuccess, pollingCount, refreshAlbum]);

  // Stop polling once paid data lands
  useEffect(() => {
    if (!stripeSuccess) return;
    const hasPurchase = album && (
      album.allUnlocked ||
      (album as any).paidPhotoIds?.length > 0 ||
      Object.keys((album as any).sessionPurchases || {}).length > 0
    );
    if (hasPurchase) {
      toast.success("Payment confirmed! Your photos are now unlocked.");
      setStripeSuccess(false);
      setPollingCount(0);
      if (!emailSkippedThisSession) setShowEmailReg(true);
    }
  }, [album, stripeSuccess]);

  // Backfill missing thumbnails in background
  useBackfillThumbnails(album?.photos || [], useCallback((photoId, thumb) => {
    setAlbumState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, photos: prev.photos.map(p => p.id === photoId ? { ...p, thumbnail: thumb } : p) };
      updateAlbum(updated);
      return updated;
    });
  }, []));

  if (!album || album.enabled === false) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="font-display text-2xl text-foreground mb-2">Album Not Found</p>
          <p className="text-muted-foreground font-body text-sm">This gallery may be private or the link is incorrect.</p>
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
  const isExpired = !!(album.downloadExpiresAt && new Date(album.downloadExpiresAt) < new Date());
  // Per-session purchase record for this viewer
  const sessionPurchase = (album as any).sessionPurchases?.[sessionKey];
  const sessionFullAlbum = sessionPurchase?.fullAlbum === true;
  const sessionPaidIds = new Set<string>(sessionPurchase?.photoIds || []);
  // Legacy global paidPhotoIds (kept for backwards compat with old purchases)
  const globalPaidSet = new Set<string>((album as any).paidPhotoIds || []);
  // Approved/completed bank transfer requests also unlock their photos
  const bankPaidIds = new Set<string>(
    ((album as any).downloadRequests || [])
      .filter((r: any) => r.status === "approved" || r.status === "completed")
      .flatMap((r: any) => r.photoIds || [])
  );
  const paidPhotoIdSet = new Set<string>([...sessionPaidIds, ...globalPaidSet, ...bankPaidIds]);
  const canDownload = (isFullyUnlocked || sessionFullAlbum) && !isExpired && !(album as any).purchasingDisabled;
  const isPhotoPaid = (id: string) => canDownload || paidPhotoIdSet.has(id);

  // Proofing derived values
  const proofingStage = album.proofingStage || "not-started";
  const isProofing = proofingStage === "proofing" && !!settings.proofingEnabled && (!!(album as any).proofingEnabled || tokenMatchesAlbum);
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
  // Lightbox photo lookup — must be after displayedPhotos
  const lbPhoto = lightboxPhotoId ? displayedPhotos.find((p: any) => p.id === lightboxPhotoId) ?? null : null;
  const lbIdx = lbPhoto ? displayedPhotos.findIndex((p: any) => p.id === lightboxPhotoId) : -1;

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxPhotoId === null) return;
    const handler = (e: KeyboardEvent) => {
      const lbPhotos = displayedPhotos;
      const currentIdx = lbPhotos.findIndex((p: any) => p.id === lightboxPhotoId);
      if (e.key === "Escape") setLightboxPhotoId(null);
      if (e.key === "ArrowLeft" && currentIdx > 0) setLightboxPhotoId(lbPhotos[currentIdx - 1].id);
      if (e.key === "ArrowRight" && currentIdx < lbPhotos.length - 1) setLightboxPhotoId(lbPhotos[currentIdx + 1].id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxPhotoId, displayedPhotos]);
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

  const downloadPhoto = async (photo: { src: string; title: string }, quality: DownloadQuality) => {
    if (quality === "original") {
      const link = document.createElement("a");
      link.href = photo.src;
      link.download = `${photo.title}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const targetBytes = quality === "2mb" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
      try {
        const blob = await resizeToTargetSize(photo.src, targetBytes);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${photo.title}_${quality}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch {
        // Fallback to original
        const link = document.createElement("a");
        link.href = photo.src;
        link.download = `${photo.title}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  };

  const handleDownloadFree = () => {
    setShowDownloadOptions(true);
  };

  // ── Proofing handlers ─────────────────────────────────────
  const toggleStar = (photoId: string) => {
    if (!album) return;
    const updated = {
      ...album,
      photos: album.photos.map((p: any) => p.id === photoId ? { ...p, starred: !p.starred } : p),
    };
    setAlbumState(updated);
    updateAlbum(updated);
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
      if (!res.ok) throw new Error("Server error");
      // Update local UI state only — don't call updateAlbum here or it will
      // overwrite the server's picks data (selectedPhotoIds in rounds) with our
      // stale local version that doesn't have them yet
      const updated = { ...album, proofingStage: "selections-submitted" as const };
      setAlbumState(updated);
      setProofingSubmitted(true);
      toast.success(`${picked.length} photo${picked.length !== 1 ? "s" : ""} submitted — the photographer will be in touch!`);
    } catch {
      toast.error("Failed to submit. Please try again.");
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
    for (const p of toDownload) {
      await downloadPhoto(p, downloadQuality);
    }

    const updated = { ...album };
    updated.usedFreeDownloads = { ...(updated.usedFreeDownloads || {}), [sessionKey]: freeUsed + canDownload };
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
    for (const p of photos) {
      await downloadPhoto(p, downloadQuality);
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
    refreshAlbum();
    setSelectedIds(new Set());
    setShowDownloadOptions(false);
    setDownloading(false);
    toast.success(`Downloaded ${photos.length} photos`);
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
    refreshAlbum();
    setShowBankTransferRequest(false);
    setShowBankTransfer(true);
    setClientNote("");
    setSelectedIds(new Set());
    toast.success("Bank transfer request submitted! Pay using the details shown, then the photographer will unlock your photos.");
  };

  const displaySize = album.displaySize || "medium";
  const gridClass = displaySize === "small" ? "masonry-grid-sm" : displaySize === "large" ? "masonry-grid-lg" : displaySize === "list" ? "masonry-grid-list" : "masonry-grid";

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


  // Pre-computed JSX to avoid IIFEs inside render (causes TDZ crash when minified)
  const _wmOp = settings.watermarkOpacity / 100;
  const _wmSize = settings.watermarkSize ?? 40;
  const _wmPos = settings.watermarkPosition || "center";
  const _wmTiled = _wmPos === "tiled";
  const _wmCenter = _wmPos === "center";
  const _wmPosStyle: React.CSSProperties = _wmCenter || _wmTiled ? {} : {
    position: "absolute",
    top: _wmPos.startsWith("top") ? "16px" : "auto",
    bottom: _wmPos.startsWith("bottom") ? "16px" : "auto",
    left: _wmPos.endsWith("left") ? "16px" : "auto",
    right: _wmPos.endsWith("right") ? "16px" : "auto",
  };
  const _lbWatermark = _wmTiled ? (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden rounded-lg">
      <div className="absolute inset-0 flex flex-wrap items-start justify-start gap-x-16 gap-y-12 rotate-[-30deg] scale-150 origin-center" style={{ opacity: _wmOp }}>
        {Array.from({ length: 20 }).map((_, wi) => settings.watermarkImage
          ? <img key={wi} src={settings.watermarkImage} alt="" style={{ height: `${Math.max(20, _wmSize * 0.4)}px`, width: "auto" }} />
          : <p key={wi} className="font-display text-foreground tracking-widest whitespace-nowrap" style={{ fontSize: `${Math.max(10, _wmSize * 0.3)}px` }}>{settings.watermarkText}</p>
        )}
      </div>
    </div>
  ) : (
    <div className="absolute inset-0 pointer-events-none select-none" style={_wmCenter ? { display: "flex", alignItems: "center", justifyContent: "center" } : { position: "absolute" }}>
      <div style={{ ..._wmPosStyle, transform: _wmCenter ? "rotate(-30deg)" : undefined }}>
        {settings.watermarkImage
          ? <img src={settings.watermarkImage} alt="" style={{ width: `${_wmSize}%`, maxWidth: "100%", height: "auto", opacity: _wmOp }} />
          : <p className="font-display text-foreground tracking-widest whitespace-nowrap"
              style={{ opacity: _wmOp, fontSize: `${(_wmSize / 40).toFixed(2)}em` }}>
              {settings.watermarkText}
            </p>
        }
      </div>
    </div>
  );
  const _expiryDaysLeft = album?.downloadExpiresAt
    ? Math.ceil((new Date(album.downloadExpiresAt + "T12:00:00").getTime() - Date.now()) / 86400000)
    : null;
  const _expiryBanner = (canDownload && album?.downloadExpiresAt && _expiryDaysLeft !== null && _expiryDaysLeft <= 14) ? (
    <div className="glass-panel rounded-xl p-4 border border-yellow-500/20 bg-yellow-500/5 flex items-center gap-3">
      <Clock className="w-4 h-4 text-yellow-400 shrink-0" />
      <p className="text-xs font-body text-muted-foreground">
        <span className="text-yellow-400 font-medium">Download expires in {_expiryDaysLeft} day{_expiryDaysLeft !== 1 ? "s" : ""}</span>
        {" "}— {new Date(album.downloadExpiresAt + "T12:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long" })}
      </p>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <section className="pt-28 pb-32">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-4xl md:text-5xl text-foreground mb-2">{album.title}</h1>
                <p className="text-sm font-body text-muted-foreground">{album.description}</p>
              </div>

              {/* ── Proofing Stage Banner ───────────────────────────── */}
              {settings.proofingEnabled && (album as any).proofingEnabled && proofingStage === "proofing" && (
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
                      <p className="text-xs font-body text-yellow-400/80 mt-2">
                        {starredIds.size === 0 ? "No photos starred yet" : `${starredIds.size} photo${starredIds.size !== 1 ? "s" : ""} starred`}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {settings.proofingEnabled && (album as any).proofingEnabled && proofingStage === "selections-submitted" && (
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
              {settings.proofingEnabled && (album as any).proofingEnabled && proofingStage === "editing" && (
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
              {settings.proofingEnabled && (album as any).proofingEnabled && proofingStage === "finals-delivered" && (
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

              {/* ── Download Expiry Banner ─────────────────────────── */}
              {isExpired && (
                <div className="glass-panel rounded-xl p-5 border border-destructive/30 bg-destructive/5">
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-display text-foreground">Download access has expired</p>
                      <p className="text-xs font-body text-muted-foreground mt-1">
                        This gallery's download period ended on {new Date(album.downloadExpiresAt! + "T12:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}. Contact your photographer to request an extension.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {_expiryBanner}

              <div className="glass-panel rounded-lg p-4 flex items-center gap-6">
                {canDownload ? (
                  <div className="text-center">
                    <p className="text-lg font-display text-green-400">✓ Unlocked</p>
                    <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">All Photos</p>
                  </div>
                ) : (
                  <>
                    <div className="text-center">
                      <p className="text-lg font-display text-primary">{freeRemaining}</p>
                      <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Free Left</p>
                    </div>
                    <div className="w-px h-8 bg-border" />
                    <div className="text-center">
                      <p className="text-lg font-display text-foreground">${album.pricePerPhoto}</p>
                      <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Per Photo</p>
                    </div>
                    <div className="w-px h-8 bg-border" />
                    <div className="text-center">
                      <p className="text-lg font-display text-foreground">${album.priceFullAlbum}</p>
                      <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Full Album</p>
                    </div>
                    <div className="w-px h-8 bg-border" />
                    {/* Email link button */}
                    {registeredEmail ? (
                      <div className="text-center group/email">
                        <div className="cursor-pointer" onClick={() => setShowEmailReg(true)} title="Change email">
                          <p className="text-[11px] font-body text-green-400 truncate max-w-[100px]">{registeredEmail}</p>
                          <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground group-hover/email:text-foreground transition-colors">Linked ✓</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); try { localStorage.removeItem(`wv_email_${albumId}`); } catch {} setRegisteredEmail(""); }}
                          className="text-[9px] font-body text-muted-foreground/30 hover:text-red-400 transition-colors mt-0.5 block w-full leading-none"
                          title="Unlink email"
                        >unlink</button>
                      </div>
                    ) : (
                      <button onClick={() => setShowEmailReg(true)} className="text-center hover:opacity-80 transition-opacity">
                        <p className="text-lg font-display text-muted-foreground">@</p>
                        <p className="text-[10px] font-body uppercase tracking-wider text-primary">Add Email</p>
                      </button>
                    )}
                    {!(album as any).purchasingDisabled && (
                    <>
                    <div className="w-px h-8 bg-border" />
                    {/* Payment CTA(s): hidden when purchasing disabled */}
                    {previewCheckoutAmount === 0 ? (
                      <Button
                        onClick={() => { setShowPaymentChoice(false); handleDownloadFree(); }}
                        className="w-full gap-3 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-sm h-12"
                      >
                        <Download className="w-5 h-5" />
                        Download Free
                      </Button>
                    ) : (
                      stripeAvailable ? (
                        <Button
                          onClick={async () => {
                            setShowPaymentChoice(false);
                            setProcessingStripe(true);
                            const isFullAlbumPurchase =
                              requestedFullAlbum ||
                              fullAlbumCheaper ||
                              selectedIds.size === 0 ||
                              selectedIds.size === album.photos.length;
                            const photosBeingPaid = isFullAlbumPurchase
                              ? []
                              : album.photos.filter(p => selectedIds.has(p.id) && !paidPhotoIdSet.has(p.id) && !( unpaidSelected.indexOf(p) < freeRemaining ));
                            const checkoutAmount = isFullAlbumPurchase ? album.priceFullAlbum : paidTotal;
                            if (!isFullAlbumPurchase && checkoutAmount === 0) {
                              setProcessingStripe(false);
                              handleDownloadFree();
                              return;
                            }
                            const result = await createAlbumCheckout({
                              albumId: album.id,
                              albumTitle: album.title,
                              photoCount: isFullAlbumPurchase ? album.photos.length : unpaidSelected.length,
                              amount: checkoutAmount,
                              clientEmail: album.clientEmail,
                              photoIds: isFullAlbumPurchase ? [] : unpaidSelected.map(p => p.id),
                              isFullAlbum: isFullAlbumPurchase,
                              sessionKey,
                            });
                            setProcessingStripe(false);
                            if (result.url) window.location.href = result.url;
                            else toast.error(result.error || "Failed to create checkout session");
                          }}
                          disabled={processingStripe}
                          className="w-full gap-3 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-sm h-12"
                        >
                          <CreditCard className="w-5 h-5" />
                          {processingStripe ? "Redirecting to Stripe..." : "Pay with Card (Stripe)"}
                        </Button>
                      ) : null
                    )}
                    </>
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
                onClick={() => setSortOrder(s => s === "default" ? "asc" : s === "asc" ? "desc" : "default")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-body border transition-all ${
                  sortOrder !== "default"
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-secondary/50 border-border/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                <ArrowUpDown className="w-3 h-3" />
                {sortOrder === "default" ? "Sort by time" : sortOrder === "asc" ? "Oldest first" : "Newest first"}
              </button>
              {/* Active filter summary */}
              {(showStarredOnly || sortOrder !== "default") && (
                <button
                  onClick={() => { setShowStarredOnly(false); setSortOrder("default"); }}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-body text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
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
            <div className={gridClass}>
              {displayedPhotos.map((photo, i) => (
                <div key={photo.id} className="relative group">
                  <WatermarkedImage
                src={photo.thumbnail || photo.src}
                  title={photo.title}
                  selected={isProofing ? starredIds.has(photo.id) : selectedIds.has(photo.id)}
                  onSelect={() => isProofing ? toggleStar(photo.id) : toggleSelect(photo.id)}
                  locked={!isProofing && !isPhotoPaid(photo.id) && freeRemaining <= 0 && !selectedIds.has(photo.id)}
                  index={i}
                  showWatermark={!(album as any).watermarkDisabled && !isPhotoPaid(photo.id)}
                  watermarkPosition={watermarkPosition}
                  watermarkText={settings.watermarkText}
                  watermarkImage={settings.watermarkImage}
                  watermarkOpacity={settings.watermarkOpacity}
                  watermarkSize={settings.watermarkSize ?? 40}
                />
                  {/* Expand button */}
                  {!isProofing && (
                    <button
                      onClick={e => { e.stopPropagation(); setLightboxPhotoId(photo.id); }}
                      className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                  )}
                                    {isProofing && (
                    <button
                      onClick={() => toggleStar(photo.id)}
                      className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-lg ${
                        starredIds.has(photo.id)
                          ? "bg-yellow-400 text-yellow-900 scale-110"
                          : "bg-black/50 text-white/70 opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <Star className={`w-4 h-4 ${starredIds.has(photo.id) ? "fill-yellow-900" : ""}`} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

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

      {/* Show PurchasePanel unless every selected photo is already paid, or we're in proofing mode, or purchasing disabled */}
      {!canDownload && !isProofing && !(album as any).purchasingDisabled && !(selectedIds.size > 0 && Array.from(selectedIds).every(id => isPhotoPaid(id))) && (
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
      {!canDownload && selectedIds.size > 0 && Array.from(selectedIds).every(id => isPhotoPaid(id)) && (
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
              Download Quality
            </DialogTitle>
            <DialogDescription className="sr-only">Choose the quality for your photo downloads.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
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
            <Button
              onClick={canDownload ? executeDownloadAll : executeDownloadFree}
              disabled={downloading}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-body text-xs tracking-wider uppercase gap-2"
            >
              <Download className="w-4 h-4" />
              {downloading ? "Downloading..." : "Download"}
            </Button>
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
                onClick={async () => {
                  setShowPaymentChoice(false);
                  setProcessingStripe(true);
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
                    setProcessingStripe(false);
                    handleDownloadFree();
                    return;
                  }
                  const result = await createAlbumCheckout({
                    albumId: album.id,
                    albumTitle: album.title,
                    photoCount: isFullAlbumPurchase ? album.photos.length : unpaidSelected.length,
                    amount: checkoutAmount,
                    clientEmail: album.clientEmail,
                    photoIds: isFullAlbumPurchase ? [] : unpaidSelected.map(p => p.id),
                    isFullAlbum: isFullAlbumPurchase,
                    sessionKey,
                  });
                  setProcessingStripe(false);
                  if (result.url) {
                    window.location.href = result.url;
                  } else {
                    toast.error(result.error || "Failed to create checkout session");
                  }
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
      <Dialog open={showEmailReg} onOpenChange={setShowEmailReg}>
        <DialogContent className="glass-panel border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground">Save your access</DialogTitle>
            <DialogDescription className="sr-only">Add your email to link purchases to your account so you can access photos from any device.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm font-body text-muted-foreground">
              Add your email to link this purchase to your account — so you can re-access your photos from any device using the same gallery link.
            </p>
            <input
              type="email"
              placeholder="your@email.com"
              value={purchaserEmail}
              onChange={e => setPurchaserEmail(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  if (!purchaserEmail.includes("@")) { toast.error("Please enter a valid email"); return; }
                  setSavingEmail(true);
                  try {
                    const emailKey = `email-${purchaserEmail.toLowerCase().trim()}`;
                    await fetch("/api/album/register-purchaser", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ albumId: album.id, sessionKey: emailKey, email: purchaserEmail }),
                    });
                    try { localStorage.setItem(`wv_email_${albumId}`, purchaserEmail); } catch {}
                    setRegisteredEmail(purchaserEmail);
                    toast.success("Email saved — your purchases are now linked to " + purchaserEmail);
                    setShowEmailReg(false);
                    setPurchaserEmail("");
                  } catch { toast.error("Failed to save email"); }
                  setSavingEmail(false);
                }}
                disabled={savingEmail}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-body text-sm"
              >
                {savingEmail ? "Saving…" : "Save Email"}
              </Button>
              <Button variant="outline" onClick={() => { setShowEmailReg(false); setEmailSkippedThisSession(true); }} className="font-body text-sm border-border">
                Skip
              </Button>
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
            className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
            onClick={() => setLightboxPhotoId(null)}
          >
            {/* Close button */}
            <button className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 w-11 h-11 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-card transition-colors"
              onClick={() => setLightboxPhotoId(null)}>
              <X className="w-5 h-5" />
            </button>

            {/* Nav arrows */}
            {lbIdx > 0 && (
              <button className="absolute left-2 sm:left-4 z-10 w-11 h-11 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-card transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxPhotoId(displayedPhotos[lbIdx - 1].id); }}>
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {lbIdx < displayedPhotos.length - 1 && (
              <button className="absolute right-2 sm:right-4 z-10 w-11 h-11 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-card transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxPhotoId(displayedPhotos[lbIdx + 1].id); }}>
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            {/* Photo */}
            <div className="relative w-full max-w-[96vw] sm:max-w-[90vw] max-h-[92vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <LightboxImage
                photo={lbPhoto}
                cache={lightboxSrcCache}
                onCacheUpdate={(id, url) => setLightboxSrcCache(prev => ({ ...prev, [id]: url }))}
                wmDisabled={(album as any).watermarkDisabled}
              />
              {/* Watermark overlay in lightbox */}
              {!(album as any).watermarkDisabled && !isPhotoPaid(lbPhoto.id) && _lbWatermark}

              {/* Bottom bar with select/title */}
              <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-t from-background/85 to-transparent rounded-b-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <p className="text-sm font-body text-foreground pr-12 sm:pr-0">{lbPhoto.title}</p>
                <div className="flex gap-2">
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
              <p className="text-xs font-body text-muted-foreground bg-card/80 backdrop-blur-sm px-3 py-1.5 rounded-full">
                {lbIdx + 1} / {displayedPhotos.length}
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Footer />
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
