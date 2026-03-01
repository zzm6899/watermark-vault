import { useParams } from "react-router-dom";
import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Info, Building2, Copy, Check as CheckIcon, Lock, Download, Grid, List, LayoutGrid } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WatermarkedImage from "@/components/WatermarkedImage";
import PurchasePanel from "@/components/PurchasePanel";
import { getAlbumBySlug, getSettings, updateAlbum } from "@/lib/storage";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Album, AlbumDownloadRecord } from "@/lib/types";

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
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [accessGranted, setAccessGranted] = useState(!album?.accessCode);
  const [pinInput, setPinInput] = useState("");
  const [usedPin, setUsedPin] = useState("");
  const [clientNote, setClientNote] = useState("");

  const watermarkPosition = settings.watermarkPosition;
  const bankTransfer = settings.bankTransfer;

  const refreshAlbum = useCallback(() => {
    if (albumId) {
      const fresh = getAlbumBySlug(albumId);
      setAlbumState(fresh);
    }
  }, [albumId]);

  if (!album) {
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

  const downloadPhoto = (photo: { src: string; title: string }) => {
    const link = document.createElement("a");
    link.href = photo.src;
    link.download = `${photo.title}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadFree = () => {
    const selected = album.photos.filter(p => selectedIds.has(p.id));
    const canDownload = Math.min(selected.length, freeRemaining);
    if (canDownload === 0) {
      toast.error("No free downloads remaining for this session");
      return;
    }
    const toDownload = selected.slice(0, canDownload);
    toDownload.forEach(p => downloadPhoto(p));

    // Track usage
    const updated = { ...album };
    updated.usedFreeDownloads = { ...(updated.usedFreeDownloads || {}), [sessionKey]: freeUsed + canDownload };
    updateAlbum(updated);
    refreshAlbum();
    setSelectedIds(new Set());
    toast.success(`Downloaded ${canDownload} photo${canDownload !== 1 ? "s" : ""} (watermark removed)`);
  };

  const handleDownloadAll = () => {
    if (!isFullyUnlocked) return;
    album.photos.forEach(p => downloadPhoto(p));
    toast.success(`Downloading all ${album.photos.length} photos`);
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

  // Display size from album or default
  const displaySize = album.displaySize || "medium";
  const gridClass = displaySize === "small" ? "masonry-grid-sm" : displaySize === "large" ? "masonry-grid-lg" : displaySize === "list" ? "masonry-grid-list" : "masonry-grid";

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
                  src={photo.src}
                  title={photo.title}
                  selected={selectedIds.has(photo.id)}
                  onSelect={() => toggleSelect(photo.id)}
                  locked={!isFullyUnlocked && freeRemaining <= 0 && !selectedIds.has(photo.id)}
                  index={i}
                  watermarkPosition={isFullyUnlocked ? undefined : watermarkPosition}
                  watermarkText={isFullyUnlocked ? undefined : settings.watermarkText}
                  watermarkImage={isFullyUnlocked ? undefined : settings.watermarkImage}
                  watermarkOpacity={settings.watermarkOpacity}
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
          onPurchaseSelected={() => toast.info("Payment portal would open here — connect Stripe to enable")}
          onPurchaseAlbum={() => toast.info("Full album purchase — connect Stripe to enable")}
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
            <Button onClick={() => {
              album.photos.filter(p => selectedIds.has(p.id)).forEach(p => downloadPhoto(p));
              setSelectedIds(new Set());
              toast.success(`Downloaded ${selectedIds.size} photos`);
            }} size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              <Download className="w-4 h-4" /> Download Selected
            </Button>
          </div>
        </motion.div>
      )}

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
