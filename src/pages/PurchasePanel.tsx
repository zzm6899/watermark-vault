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

  const allFree = paidCount === 0 && effectiveUnpaid > 0;
  const allAlreadyPaid = alreadyPaidCount > 0 && effectiveUnpaid === 0;

  const breakdownLabel = () => {
    const parts: string[] = [];
    if (alreadyPaidCount > 0) parts.push(`${alreadyPaidCount} already purchased`);
    if (freeRemaining > 0 && effectiveUnpaid > 0) {
      parts.push(`${Math.min(effectiveUnpaid, freeRemaining)} free`);
    }
    if (paidCount > 0) parts.push(`${paidCount} × $${perPhotoPrice} = $${paidTotal}`);
    return parts.length ? parts.join(" · ") : "No charge";
  };

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
          <div className="mx-auto w-full max-w-5xl">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <div className="mt-0.5 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <ShoppingCart className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-body text-foreground font-semibold leading-tight">
                    {selectedCount} photo{selectedCount !== 1 ? "s" : ""} selected
                  </p>
                  <p className="text-xs text-muted-foreground font-body leading-tight break-words">
                    {breakdownLabel()}
                  </p>
                  {paidCount > 0 && fullAlbumCheaper && albumPrice > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mt-1">
                      Full album is cheaper: ${albumPrice}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                {(allFree || allAlreadyPaid) && (
                  <Button
                    onClick={onDownloadFree}
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto gap-1.5 text-xs h-9"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Free</span>
                  </Button>
                )}

                {paidCount > 0 && fullAlbumCheaper && albumPrice > 0 && (
                  <Button
                    onClick={onPurchaseAlbum}
                    size="sm"
                    className="w-full sm:w-auto gap-1.5 text-xs h-9 bg-green-600 hover:bg-green-500 text-white"
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>Pay ${albumPrice} Full Album</span>
                  </Button>
                )}

                {paidCount > 0 && !fullAlbumCheaper && (
                  <Button
                    onClick={onPurchaseSelected}
                    size="sm"
                    className="w-full sm:w-auto gap-1.5 text-xs h-9"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>Pay ${paidTotal}</span>
                  </Button>
                )}

                {bankTransferEnabled && onBankTransfer && paidCount > 0 && (
                  <Button
                    onClick={onBankTransfer}
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto gap-1.5 text-xs h-9"
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Bank Transfer</span>
                  </Button>
                )}

                {albumPrice > 0 && !allAlreadyPaid && !(paidCount > 0 && fullAlbumCheaper) && (
                  <Button
                    onClick={onPurchaseAlbum}
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto gap-1.5 text-xs h-9"
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>${albumPrice} Full Album</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
