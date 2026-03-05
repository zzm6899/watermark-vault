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

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-border/50 p-4"
        >
          <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-body text-foreground">
                  <span className="font-semibold">{selectedCount}</span> photo{selectedCount !== 1 ? "s" : ""} selected
                </p>
                <p className="text-xs text-muted-foreground font-body">
                  {freeRemaining > 0
                    ? `${Math.min(selectedCount, freeRemaining)} free · ${paidCount > 0 ? `${paidCount} × $${pricePerPhoto} = $${paidTotal}` : "No charge"}`
                    : `${selectedCount} × $${pricePerPhoto} = $${paidTotal}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {freeRemaining > 0 && selectedCount <= freeRemaining && (
                <Button onClick={onDownloadFree} variant="outline" size="sm" className="gap-2 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary">
                  <Download className="w-4 h-4" />
                  Download Free
                </Button>
              )}

              {paidCount > 0 && !fullAlbumCheaper && (
                <>
                  <Button onClick={onPurchaseSelected} size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                    <ShoppingCart className="w-4 h-4" />
                    Pay ${paidTotal}
                  </Button>
                </>
              )}

              {paidCount > 0 && fullAlbumCheaper && albumPrice > 0 && (
                <Button
                  onClick={onPurchaseAlbum}
                  size="sm"
                  className="gap-2 bg-green-600 hover:bg-green-500 text-white"
                >
                  <Package className="w-4 h-4" />
                  Pay ${albumPrice} (Full Album)
                </Button>
              )}

              {bankTransferEnabled && onBankTransfer && paidCount > 0 && (
                <Button onClick={onBankTransfer} variant="outline" size="sm" className="gap-2 border-border text-foreground hover:bg-secondary">
                  <Building2 className="w-4 h-4" />
                  Bank Transfer
                </Button>
              )}

              {albumPrice > 0 && !fullAlbumCheaper && (
                <Button onClick={onPurchaseAlbum} variant="outline" size="sm" className="gap-2 border-border text-foreground hover:bg-secondary">
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
