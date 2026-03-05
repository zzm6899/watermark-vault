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

  const breakdownLabel =
    freeRemaining > 0
      ? `${Math.min(selectedCount, freeRemaining)} free${paidCount > 0 ? ` · ${paidCount} × $${perPhotoPrice} = $${paidTotal}` : " · No charge"}`
      : `${selectedCount} × $${perPhotoPrice} = $${paidTotal}`;

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-border/50 px-3 py-2.5"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.625rem)" }}
        >
          {/* Always single row — info left, buttons right */}
          <div className="container mx-auto flex items-center justify-between gap-3">

            {/* Left: icon + text */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <ShoppingCart className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-body text-foreground font-semibold truncate">
                  {selectedCount} photo{selectedCount !== 1 ? "s" : ""} selected
                </p>
                <p className="text-[11px] text-muted-foreground font-body truncate">
                  {breakdownLabel}
                </p>
              </div>
            </div>

            {/* Right: buttons — never wrap */}
            <div className="flex items-center gap-1.5 shrink-0">

              {freeRemaining > 0 && selectedCount <= freeRemaining && (
                <Button onClick={onDownloadFree} variant="outline" size="sm" className="gap-1 text-xs px-3 h-8 border-primary/30 text-primary hover:bg-primary/10">
                  <Download className="w-3.5 h-3.5" />
                  Free
                </Button>
              )}

              {paidCount > 0 && !fullAlbumCheaper && (
                <Button onClick={onPurchaseSelected} size="sm" className="gap-1 text-xs px-3 h-8 bg-primary text-primary-foreground hover:bg-primary/90">
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Pay ${paidTotal}
                </Button>
              )}

              {paidCount > 0 && fullAlbumCheaper && albumPrice > 0 && (
                <Button onClick={onPurchaseAlbum} size="sm" className="gap-1 text-xs px-3 h-8 bg-green-600 hover:bg-green-500 text-white">
                  <Package className="w-3.5 h-3.5" />
                  ${albumPrice} Album
                </Button>
              )}

              {bankTransferEnabled && onBankTransfer && paidCount > 0 && (
                <Button onClick={onBankTransfer} variant="outline" size="sm" className="gap-1 text-xs px-3 h-8">
                  <Building2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Bank Transfer</span>
                  <span className="sm:hidden">Bank</span>
                </Button>
              )}

              {albumPrice > 0 && !fullAlbumCheaper && (
                <Button onClick={onPurchaseAlbum} variant="outline" size="sm" className="gap-1 text-xs px-3 h-8">
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
