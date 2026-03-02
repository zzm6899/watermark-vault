import { useParams } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info, Building2, Copy, Check as CheckIcon, Lock, Download, Grid, List, LayoutGrid, CreditCard, X, ChevronLeft, ChevronRight } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WatermarkedImage from "@/components/WatermarkedImage";
import PurchasePanel from "@/components/PurchasePanel";
import { getAlbumBySlug, getSettings, updateAlbum } from "@/lib/storage";
import { createAlbumCheckout, getStripeStatus } from "@/lib/api";
import { toast } from "sonner";
import { resizeToTargetSize } from "@/lib/image-utils";
import {
  Dialog,
  DialogContent,
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
function LightboxImage({ photo, cache, onCacheUpdate }: {
  photo: Photo;
  cache: Record<string, string>;
  onCacheUpdate: (id: string, url: string) => void;
}) {
  const [src, setSrc] = useState(cache[photo.id] || photo.src);

  useEffect(() => {
    if (cache[photo.id]) { setSrc(cache[photo.id]); return; }
    let cancelled = false;
    resizeToTargetSize(photo.src, TARGET_LIGHTBOX_BYTES)
      .then(blob => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        onCacheUpdate(photo.id, url);
        setSrc(url);
      })
      .catch(() => { /* keep original src */ });
    return () => { cancelled = true; };
  }, [photo.id, photo.src]);

  return (
    <img
      src={src}
      alt={photo.title}
      className="max-w-full max-h-[85vh] object-contain rounded-lg"
    />
  );
}
function getSessionKey(album: Album, pin: string): string {
  return pin || `session-${album.id}`;
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
  const [accessGranted, setAccessGranted] = useState(!album?.accessCode);
  const [pinInput, setPinInput] = useState("");
  const [usedPin, setUsedPin] = useState("");
  const [clientNote, setClientNote] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxSrcCache, setLightboxSrcCache] = useState<Record<string, string>>({});
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [processingStripe, setProcessingStripe] = useState(false);

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

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowLeft" && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
      if (e.key === "ArrowRight" && album && lightboxIndex < album.photos.length - 1) setLightboxIndex(lightboxIndex + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, album]);

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

  const sessionKey = getSessionKey(album, usedPin);
  const freeUsed = getFreeUsed(album, sessionKey);
  const freeRemaining = Math.max(0, album.freeDownloads - freeUsed);
  const isFullyUnlocked = album.allUnlocked === true;

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

  const executeDownloadFree = async () => {
    const selected = album.photos.filter(p => selectedIds.has(p.id));
    const canDownload = Math.min(selected.length, freeRemaining);
    if (canDownload === 0) {
      toast.error("No free downloads remaining for this session");
      return;
    }
    setDownloading(true);
    const toDownload = selected.slice(0, canDownload);
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
    if (!isFullyUnlocked) return;
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
    setShowPaymentChoice(true);
  };

  const handlePurchaseAlbum = () => {
    // Always go to payment portal for full album
    setShowPaymentChoice(true);
  };

  const handleBankTransferRequest = () => {
    const selected = album.photos.filter(p => selectedIds.has(p.id));
    const paidCount = Math.max(0, selected.length - freeRemaining);
    if (paidCount === 0) {
      handleDownloadFree();
      return;
    }
    setShowBankTransferRequest(true);
  };

  const submitBankTransferRequest = () => {
    const selected = album.photos.filter(p => selectedIds.has(p.id));
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

  const paidCount = Math.max(0, selectedIds.size - freeRemaining);
  const paidTotal = paidCount * album.pricePerPhoto;

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

              <div className="glass-panel rounded-lg p-4 flex items-center gap-6">
                {isFullyUnlocked ? (
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
                  </>
                )}
              </div>
            </div>

            {!isFullyUnlocked && (
              <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10">
                <Info className="w-4 h-4 text-primary flex-shrink-0" />
                <p className="text-xs font-body text-muted-foreground">
                  Click photos to select. You have <span className="text-primary font-medium">{freeRemaining} free download{freeRemaining !== 1 ? "s" : ""}</span> remaining. Additional photos can be purchased individually or as a full album.
                </p>
              </div>
            )}

            {isFullyUnlocked && (
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
          </motion.div>

          {album.photos.length === 0 ? (
            <div className="glass-panel rounded-xl p-12 text-center">
              <p className="text-sm font-body text-muted-foreground">No photos uploaded yet.</p>
            </div>
          ) : (
            <div className={gridClass}>
              {album.photos.map((photo, i) => (
                <WatermarkedImage
                  key={photo.id}
                src={photo.thumbnail || photo.src}
                  title={photo.title}
                  selected={selectedIds.has(photo.id)}
                  onSelect={() => setLightboxIndex(i)}
                  locked={!isFullyUnlocked && freeRemaining <= 0 && !selectedIds.has(photo.id)}
                  index={i}
                  showWatermark={!isFullyUnlocked}
                  watermarkPosition={watermarkPosition}
                  watermarkText={settings.watermarkText}
                  watermarkImage={settings.watermarkImage}
                  watermarkOpacity={settings.watermarkOpacity}
                  watermarkSize={settings.watermarkSize ?? 40}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {!isFullyUnlocked && (
        <PurchasePanel
          selectedCount={selectedIds.size}
          freeRemaining={freeRemaining}
          pricePerPhoto={album.pricePerPhoto}
          priceFullAlbum={album.priceFullAlbum}
          totalPhotos={album.photos.length}
          onDownloadFree={handleDownloadFree}
          onPurchaseSelected={handlePurchaseSelected}
          onPurchaseAlbum={handlePurchaseAlbum}
          onBankTransfer={handleBankTransferRequest}
          bankTransferEnabled={bankTransfer.enabled}
        />
      )}

      {isFullyUnlocked && selectedIds.size > 0 && (
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
              onClick={isFullyUnlocked && selectedIds.size === 0 ? executeDownloadAll : isFullyUnlocked ? executeDownloadAll : executeDownloadFree}
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
      <Dialog open={showPaymentChoice} onOpenChange={setShowPaymentChoice}>
        <DialogContent className="glass-panel border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground">Choose Payment Method</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-sm font-body text-muted-foreground">
              {selectedIds.size} photo{selectedIds.size !== 1 ? "s" : ""} selected
              {paidCount > 0 && <> · <span className="text-primary font-medium">${paidTotal}</span></>}
            </p>

            {stripeAvailable && (
              <Button
                onClick={async () => {
                  setShowPaymentChoice(false);
                  setProcessingStripe(true);
                  const result = await createAlbumCheckout({
                    albumId: album.id,
                    albumTitle: album.title,
                    photoCount: selectedIds.size > 0 ? selectedIds.size : album.photos.length,
                    amount: selectedIds.size > 0 ? paidTotal : album.priceFullAlbum,
                    clientEmail: album.clientEmail,
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
                  handleBankTransferRequest();
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
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm font-body text-muted-foreground">
              You've selected <span className="text-primary font-medium">{selectedIds.size}</span> photo{selectedIds.size !== 1 ? "s" : ""}. 
              {freeRemaining > 0 && <> ({Math.min(selectedIds.size, freeRemaining)} free, {Math.max(0, selectedIds.size - freeRemaining)} paid)</>}
            </p>
            <div className="p-3 rounded-lg bg-secondary">
              <p className="text-xs font-body text-muted-foreground">Estimated total</p>
              <p className="text-lg font-display text-foreground">${Math.max(0, selectedIds.size - freeRemaining) * album.pricePerPhoto}</p>
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

      {/* Fullscreen Lightbox */}
      <AnimatePresence>
        {lightboxIndex !== null && album.photos[lightboxIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setLightboxIndex(null)}
          >
            {/* Close button */}
            <button className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-card transition-colors"
              onClick={() => setLightboxIndex(null)}>
              <X className="w-5 h-5" />
            </button>

            {/* Nav arrows */}
            {lightboxIndex > 0 && (
              <button className="absolute left-4 z-10 w-10 h-10 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-card transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}>
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {lightboxIndex < album.photos.length - 1 && (
              <button className="absolute right-4 z-10 w-10 h-10 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center text-foreground hover:bg-card transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}>
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            {/* Photo */}
            <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
              <LightboxImage
                photo={album.photos[lightboxIndex]}
                cache={lightboxSrcCache}
                onCacheUpdate={(id, url) => setLightboxSrcCache(prev => ({ ...prev, [id]: url }))}
              />
              {/* Watermark overlay in lightbox — uses same settings as grid */}
              {!isFullyUnlocked && (() => {
                const op = settings.watermarkOpacity / 100;
                const size = settings.watermarkSize ?? 40;
                const pos = settings.watermarkPosition || "center";
                const isTiled = pos === "tiled";
                const isCenter = pos === "center";
                const posStyle: React.CSSProperties = isCenter || isTiled ? {} : {
                  position: "absolute",
                  top: pos.startsWith("top") ? "16px" : "auto",
                  bottom: pos.startsWith("bottom") ? "16px" : "auto",
                  left: pos.endsWith("left") ? "16px" : "auto",
                  right: pos.endsWith("right") ? "16px" : "auto",
                };
                if (isTiled) return (
                  <div className="absolute inset-0 pointer-events-none select-none overflow-hidden rounded-lg">
                    <div className="absolute inset-0 flex flex-wrap items-start justify-start gap-x-16 gap-y-12 rotate-[-30deg] scale-150 origin-center" style={{ opacity: op }}>
                      {Array.from({ length: 20 }).map((_, i) => settings.watermarkImage
                        ? <img key={i} src={settings.watermarkImage} alt="" style={{ height: `${Math.max(20, size * 0.4)}px`, width: "auto" }} />
                        : <p key={i} className="font-display text-foreground tracking-widest whitespace-nowrap" style={{ fontSize: `${Math.max(10, size * 0.3)}px` }}>{settings.watermarkText}</p>
                      )}
                    </div>
                  </div>
                );
                return (
                  <div className="absolute inset-0 pointer-events-none select-none" style={isCenter ? { display: "flex", alignItems: "center", justifyContent: "center" } : { position: "absolute" }}>
                    <div style={{ ...posStyle, transform: isCenter ? "rotate(-30deg)" : undefined }}>
                      {settings.watermarkImage
                        ? <img src={settings.watermarkImage} alt="" style={{ width: `${size}%`, maxWidth: "100%", height: "auto", opacity: op }} />
                        : <p className="font-display text-foreground tracking-widest whitespace-nowrap"
                            style={{ opacity: op, fontSize: `${(size / 40).toFixed(2)}em` }}>
                            {settings.watermarkText}
                          </p>
                      }
                    </div>
                  </div>
                );
              })()}

              {/* Bottom bar with select/title */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background/80 to-transparent rounded-b-lg flex items-center justify-between">
                <p className="text-sm font-body text-foreground">{album.photos[lightboxIndex].title}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={selectedIds.has(album.photos[lightboxIndex].id) ? "default" : "outline"}
                    onClick={() => toggleSelect(album.photos[lightboxIndex].id)}
                    className="gap-1.5 font-body text-xs"
                  >
                    {selectedIds.has(album.photos[lightboxIndex].id) ? (
                      <><CheckIcon className="w-3.5 h-3.5" /> Selected</>
                    ) : (
                      <><Download className="w-3.5 h-3.5" /> Select</>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Counter */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <p className="text-xs font-body text-muted-foreground bg-card/80 backdrop-blur-sm px-3 py-1.5 rounded-full">
                {lightboxIndex + 1} / {album.photos.length}
              </p>
            </div>
          </motion.div>
        )}
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
