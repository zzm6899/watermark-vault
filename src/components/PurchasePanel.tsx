import { ShoppingCart, Download, Package, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface PurchasePanelProps {
  selectedCount: number;
  freeRemaining: number;
  pricePerPhoto: number;
  priceFullAlbum: number;
  totalPhotos: number;
  onDownloadFree: () => void;
  onPurchaseSelected: () => void;
  onPurchaseAlbum: () => void;
  onBankTransfer?: () => void;
  bankTransferEnabled?: boolean;
}

export default function PurchasePanel({
  selectedCount,
  freeRemaining,
  pricePerPhoto,
  priceFullAlbum,
  totalPhotos,
  onDownloadFree,
  onPurchaseSelected,
  onPurchaseAlbum,
  onBankTransfer,
  bankTransferEnabled = false,
}: PurchasePanelProps) {
  const perPhotoPrice = Number(pricePerPhoto) || 0;
  const albumPrice = Number(priceFullAlbum) || 0;
  const paidCount = Math.max(0, selectedCount - freeRemaining);
  const paidTotal = paidCount * perPhotoPrice;
  const fullAlbumCheaper = albumPrice > 0 && paidCount > 0 && paidTotal >= albumPrice;

  // Compact breakdown: "5 free" or "3 × $0.2" or "5 free · 3 × $0.2"
  const breakdown = (() => {
    const parts: string[] = [];
    const freeUsed = Math.min(selectedCount, freeRemaining);
    if (freeUsed > 0) parts.push(`${freeUsed} free`);
    if (paidCount > 0) parts.push(`${paidCount} × $${perPhotoPrice}`);
    return parts.length ? parts.join(" · ") : "No charge";
  })();

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-border/50 px-3 py-2"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
        >
          <div className="flex items-center justify-between gap-2">

            {/* Left: icon + count + breakdown — fixed narrow width so buttons always fit */}
            <div className="flex items-center gap-2 w-[120px] shrink-0">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <ShoppingCart className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground font-body leading-tight truncate">
                  {selectedCount} photo{selectedCount !== 1 ? "s" : ""}
                </p>
                <p className="text-[10px] text-muted-foreground font-body leading-tight truncate">
                  {breakdown}
                </p>
              </div>
            </div>

            {/* Right: buttons — take remaining space, never wrap */}
            <div className="flex items-center gap-1.5 flex-1 justify-end">

              {freeRemaining > 0 && selectedCount <= freeRemaining && (
                <Button onClick={onDownloadFree} variant="outline" size="sm"
                  className="gap-1 text-xs px-2.5 h-8 border-primary/30 text-primary hover:bg-primary/10 shrink-0">
                  <Download className="w-3.5 h-3.5" />
                  Free
                </Button>
              )}

              {paidCount > 0 && !fullAlbumCheaper && (
                <Button onClick={onPurchaseSelected} size="sm"
                  className="gap-1 text-xs px-2.5 h-8 bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Pay ${paidTotal}
                </Button>
              )}

              {paidCount > 0 && fullAlbumCheaper && albumPrice > 0 && (
                <Button onClick={onPurchaseAlbum} size="sm"
                  className="gap-1 text-xs px-2.5 h-8 bg-green-600 hover:bg-green-500 text-white shrink-0">
                  <Package className="w-3.5 h-3.5" />
                  ${albumPrice} Album
                </Button>
              )}

              {bankTransferEnabled && onBankTransfer && paidCount > 0 && (
                <Button onClick={onBankTransfer} variant="outline" size="sm"
                  className="gap-1 text-xs px-2.5 h-8 shrink-0">
                  <Building2 className="w-3.5 h-3.5" />
                  Bank
                </Button>
              )}

              {albumPrice > 0 && !fullAlbumCheaper && (
                <Button onClick={onPurchaseAlbum} variant="outline" size="sm"
                  className="gap-1 text-xs px-2.5 h-8 shrink-0">
                  <Package className="w-3.5 h-3.5" />
                  ${priceFullAlbum}
                </Button>
              )}

            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
