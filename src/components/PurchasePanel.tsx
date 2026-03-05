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
          className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-border/50 px-4 pt-3 pb-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
        >
          <div className="container mx-auto flex flex-col gap-2.5">

            {/* Top row: icon + text info */}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <ShoppingCart className="w-4 h-4 text-primary" />
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

            {/* Bottom row: action buttons — full width, side by side */}
            <div className="flex items-center gap-2">

              {freeRemaining > 0 && selectedCount <= freeRemaining && (
                <Button onClick={onDownloadFree} variant="outline" size="sm"
                  className="flex-1 gap-2 h-9 border-primary/30 text-primary hover:bg-primary/10">
                  <Download className="w-4 h-4" />
                  Download Free
                </Button>
              )}

              {paidCount > 0 && !fullAlbumCheaper && (
                <Button onClick={onPurchaseSelected} size="sm"
                  className="flex-1 gap-2 h-9 bg-primary text-primary-foreground hover:bg-primary/90">
                  <ShoppingCart className="w-4 h-4" />
                  Pay ${paidTotal}
                </Button>
              )}

              {paidCount > 0 && fullAlbumCheaper && albumPrice > 0 && (
                <Button onClick={onPurchaseAlbum} size="sm"
                  className="flex-1 gap-2 h-9 bg-green-600 hover:bg-green-500 text-white">
                  <Package className="w-4 h-4" />
                  ${albumPrice} Full Album
                </Button>
              )}

              {bankTransferEnabled && onBankTransfer && paidCount > 0 && (
                <Button onClick={onBankTransfer} variant="outline" size="sm"
                  className="flex-1 gap-2 h-9">
                  <Building2 className="w-4 h-4" />
                  Bank Transfer
                </Button>
              )}

              {albumPrice > 0 && !fullAlbumCheaper && (
                <Button onClick={onPurchaseAlbum} variant="outline" size="sm"
                  className="flex-1 gap-2 h-9">
                  <Package className="w-4 h-4" />
                  Full Album ${priceFullAlbum}
                </Button>
              )}

            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
