import { ShoppingCart, Download, Package, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";

interface PurchasePanelProps {
  selectedCount: number;
  unpaidCount?: number;
  alreadyPaidCount?: number;
  freeRemaining: number;
  pricePerPhoto: number;
  priceFullAlbum: number;
  fullAlbumCheaper?: boolean;
  totalPhotos: number;
  onDownloadFree: () => void;
  onPurchaseSelected: () => void;
  onPurchaseAlbum: () => void;
  onBankTransfer?: () => void;
  bankTransferEnabled?: boolean;
}

export default function PurchasePanel({
  selectedCount,
  unpaidCount,
  alreadyPaidCount = 0,
  freeRemaining,
  pricePerPhoto,
  priceFullAlbum,
  fullAlbumCheaper: fullAlbumCheaperProp,
  totalPhotos,
  onDownloadFree,
  onPurchaseSelected,
  onPurchaseAlbum,
  onBankTransfer,
  bankTransferEnabled = false,
}: PurchasePanelProps) {

  const effectiveUnpaid = unpaidCount ?? selectedCount;

  const perPhotoPrice = Number(pricePerPhoto) || 0;
  const albumPrice = Number(priceFullAlbum) || 0;

  const paidCount = Math.max(0, effectiveUnpaid - freeRemaining);
  const paidTotal = paidCount * perPhotoPrice;

  const fullAlbumCheaper =
    fullAlbumCheaperProp === true ||
    (albumPrice > 0 && paidCount > 0 && paidTotal >= albumPrice);

  if (!import.meta.env.PROD) {
    console.log("[PurchasePanel]", {
      selectedCount,
      effectiveUnpaid,
      freeRemaining,
      paidCount,
      paidTotal,
      albumPrice,
      fullAlbumCheaper
    });
  }

  const allFree = paidCount === 0 && effectiveUnpaid > 0;
  const allAlreadyPaid = alreadyPaidCount > 0 && effectiveUnpaid === 0;

  const breakdownLabel = () => {
    const parts: string[] = [];
    if (alreadyPaidCount > 0) parts.push(`${alreadyPaidCount} already purchased`);
    if (freeRemaining > 0 && effectiveUnpaid > 0)
      parts.push(`${Math.min(effectiveUnpaid, freeRemaining)} free`);
    if (paidCount > 0)
      parts.push(`${paidCount} × $${perPhotoPrice} = $${paidTotal}`);
    if (parts.length === 0) return "No charge";
    return parts.join(" · ");
  };

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-border/50 px-4 pt-2.5 pb-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
        >
          <div className="container mx-auto">
            {/* Top row: icon + label + breakdown */}
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-primary shrink-0" />
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-sm font-semibold font-body text-foreground">
                  {selectedCount} photo{selectedCount !== 1 ? "s" : ""}
                </span>
                <span className="text-xs text-muted-foreground font-body truncate">{breakdownLabel()}</span>
              </div>
              {paidCount > 0 && fullAlbumCheaper && albumPrice > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 ml-auto">
                  Best deal
                </Badge>
              )}
            </div>

            {/* Bottom row: action buttons — horizontal scroll, never wrap */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">

              {(allFree || allAlreadyPaid) && (
                <Button onClick={onDownloadFree} size="sm"
                  className="gap-1.5 shrink-0 h-9 px-3 active:scale-95 bg-primary text-primary-foreground hover:bg-primary/90">
                  <Download className="w-3.5 h-3.5" />
                  Download{allAlreadyPaid ? " Purchased" : " Free"}
                </Button>
              )}

              {paidCount > 0 && fullAlbumCheaper ? (
                <Button onClick={onPurchaseAlbum} size="sm"
                  className="gap-1.5 shrink-0 h-9 px-3 active:scale-95 bg-green-600 hover:bg-green-500 text-white">
                  <Package className="w-3.5 h-3.5" />
                  Pay ${albumPrice} · Full Album
                </Button>
              ) : paidCount > 0 ? (
                <Button onClick={onPurchaseSelected} size="sm"
                  className="gap-1.5 shrink-0 h-9 px-3 active:scale-95">
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Pay ${paidTotal}
                </Button>
              ) : null}

              {bankTransferEnabled && onBankTransfer && paidCount > 0 && (
                <Button onClick={onBankTransfer} variant="outline" size="sm"
                  className="gap-1.5 shrink-0 h-9 px-3 active:scale-95">
                  <Building2 className="w-3.5 h-3.5" />
                  Bank Transfer
                </Button>
              )}

              {albumPrice > 0 && !allAlreadyPaid && !(paidCount > 0 && fullAlbumCheaper) && (
                <Button onClick={onPurchaseAlbum} variant="outline" size="sm"
                  className="gap-1.5 shrink-0 h-9 px-3 active:scale-95">
                  <Package className="w-3.5 h-3.5" />
                  Full Album ${albumPrice}
                </Button>
              )}

            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}