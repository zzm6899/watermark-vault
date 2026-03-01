import { useParams } from "react-router-dom";
import { useState } from "react";
import { motion } from "framer-motion";
import { Info, Building2, Copy, Check as CheckIcon } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WatermarkedImage from "@/components/WatermarkedImage";
import PurchasePanel from "@/components/PurchasePanel";
import { sampleAlbums, defaultBankTransfer } from "@/lib/mock-data";
import type { WatermarkPosition } from "@/lib/mock-data";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function AlbumDetail() {
  const { albumId } = useParams();
  const album = sampleAlbums.find((a) => a.id === albumId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBankTransfer, setShowBankTransfer] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // These would come from admin settings in production
  const watermarkPosition: WatermarkPosition = "center";
  const bankTransfer = defaultBankTransfer;

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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const freeRemaining = Math.max(0, album.freeDownloads - selectedIds.size);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

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
                <div className="text-center">
                  <p className="text-lg font-display text-primary">{album.freeDownloads}</p>
                  <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Free</p>
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
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10">
              <Info className="w-4 h-4 text-primary flex-shrink-0" />
              <p className="text-xs font-body text-muted-foreground">
                Click photos to select. You get <span className="text-primary font-medium">{album.freeDownloads} free downloads</span>. Additional photos can be purchased individually or as a full album.
              </p>
            </div>
          </motion.div>

          <div className="masonry-grid">
            {album.photos.map((photo, i) => (
              <WatermarkedImage
                key={photo.id}
                src={photo.src}
                title={photo.title}
                selected={selectedIds.has(photo.id)}
                onSelect={() => toggleSelect(photo.id)}
                locked={selectedIds.size >= album.freeDownloads && !selectedIds.has(photo.id)}
                index={i}
                watermarkPosition={watermarkPosition}
              />
            ))}
          </div>
        </div>
      </section>

      <PurchasePanel
        selectedCount={selectedIds.size}
        freeRemaining={album.freeDownloads}
        pricePerPhoto={album.pricePerPhoto}
        priceFullAlbum={album.priceFullAlbum}
        totalPhotos={album.photos.length}
        onDownloadFree={() => toast.success("Downloading free photos (watermark removed)!")}
        onPurchaseSelected={() => toast.info("Payment portal would open here — connect Stripe to enable")}
        onPurchaseAlbum={() => toast.info("Full album purchase — connect Stripe to enable")}
        onBankTransfer={() => setShowBankTransfer(true)}
        bankTransferEnabled={bankTransfer.enabled}
      />

      {/* Bank Transfer Dialog */}
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
