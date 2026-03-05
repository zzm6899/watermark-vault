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

  const freeUsed = Math.min(selectedCount, freeRemaining);
  const breakdownParts: string[] = [];
  if (freeUsed > 0) breakdownParts.push(`${freeUsed} free`);
  if (paidCount > 0) breakdownParts.push(`${paidCount} × $${perPhotoPrice} = $${paidTotal}`);
  const breakdown = breakdownParts.length ? breakdownParts.join(" · ") : "No charge";

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-border/50 px-3 pt-2.5 pb-2.5"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.625rem)" }}
        >
          <div className="flex flex-col gap-2">

            {/* Info row */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <ShoppingCart className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground font-body leading-tight">
                  {selectedCount} photo{selectedCount !== 1 ? "s" : ""} selected
                </p>
                <p className="text-xs text-muted-foreground font-body leading-tight">
                  {breakdown}
                </p>
              </div>
            </div>

            {/* Buttons row — equal width, always side by side */}
            <div className="flex gap-2">

              {freeRemaining > 0 && selectedCount <= freeRemaining && (
                <Button onClick={onDownloadFree} variant="outline" size="sm"
                  className="flex-1 h-9 text-xs border-primary/30 text-primary hover:bg-primary/10">
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Download Free
                </Button>
              )}

              {paidCount > 0 && !fullAlbumCheaper && (
                <Button onClick={onPurchaseSelected} size="sm"
                  className="flex-1 h-9 text-xs bg-primary text-primary-foreground hover:bg-primary/90">
                  <ShoppingCart className="w-3.5 h-3.5 mr-1" />
                  Pay ${paidTotal}
                </Button>
              )}

              {paidCount > 0 && fullAlbumCheaper && albumPrice > 0 && (
                <Button onClick={onPurchaseAlbum} size="sm"
                  className="flex-1 h-9 text-xs bg-green-600 hover:bg-green-500 text-white">
                  <Package className="w-3.5 h-3.5 mr-1" />
                  ${albumPrice} Album
                </Button>
              )}

              {bankTransferEnabled && onBankTransfer && paidCount > 0 && (
                <Button onClick={onBankTransfer} variant="outline" size="sm"
                  className="flex-1 h-9 text-xs">
                  <Building2 className="w-3.5 h-3.5 mr-1" />
                  Bank
                </Button>
              )}

              {albumPrice > 0 && !fullAlbumCheaper && (
                <Button onClick={onPurchaseAlbum} variant="outline" size="sm"
                  className="flex-1 h-9 text-xs">
                  <Package className="w-3.5 h-3.5 mr-1" />
                  ${priceFullAlbum} Album
                </Button>
              )}

            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
