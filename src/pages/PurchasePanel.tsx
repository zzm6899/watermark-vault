import { ShoppingCart, Download, Package, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface PurchasePanelProps {
  selectedCount: number;
  unpaidCount?: number;
  alreadyPaidCount?: number;
  freeRemaining: number;
  pricePerPhoto: number;
  priceFullAlbum: number;
  fullAlbumCheaper?: boolean; // computed by parent where all data is known
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
  fullAlbumCheaper = false,
  totalPhotos,
  onDownloadFree,
  onPurchaseSelected,
  onPurchaseAlbum,
  onBankTransfer,
  bankTransferEnabled = false,
}: PurchasePanelProps) {
  const effectiveUnpaid = unpaidCount ?? selectedCount;
  const paidCount = Math.max(0, effectiveUnpaid - freeRemaining);
  const perPhotoPrice = Number(pricePerPhoto) || 0;
  const albumPrice = Number(priceFullAlbum) || 0;
  const paidTotal = paidCount * perPhotoPrice;

  const allFree = paidCount === 0 && effectiveUnpaid > 0;
  const allAlreadyPaid = alreadyPaidCount > 0 && effectiveUnpaid === 0;

  const breakdownLabel = () => {
    const parts: string[] = [];
    if (alreadyPaidCount > 0) parts.push(`${alreadyPaidCount} already purchased`);
    if (freeRemaining > 0 && effectiveUnpaid > 0) parts.push(`${Math.min(effectiveUnpaid, freeRemaining)} free`);
    if (paidCount > 0) {
      if (fullAlbumCheaper) {
        parts.push(`${paidCount} × $${perPhotoPrice} = $${paidTotal} — full album is cheaper!`);
      } else {
        parts.push(`${paidCount} × $${perPhotoPrice} = $${paidTotal}`);
      }
    }
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
          className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-border/50 p-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
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
                <p className="text-xs text-muted-foreground font-body">{breakdownLabel()}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {(allFree || allAlreadyPaid) && (
                <Button onClick={onDownloadFree} variant="outline" size="sm" className="gap-2 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary">
                  <Download className="w-4 h-4" />
                  Download{allAlreadyPaid ? " Purchased" : " Free"}
                </Button>
              )}

              {/* Only show Pay / Bank Transfer when full album is NOT the better deal */}
              {paidCount > 0 && !fullAlbumCheaper && (
                <>
                  <Button onClick={onPurchaseSelected} size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                    <ShoppingCart className="w-4 h-4" />
                    Pay ${paidTotal}
                  </Button>
                  {bankTransferEnabled && onBankTransfer && (
                    <Button onClick={onBankTransfer} variant="outline" size="sm" className="gap-2 border-border text-foreground hover:bg-secondary">
                      <Building2 className="w-4 h-4" />
                      Bank Transfer
                    </Button>
                  )}
                </>
              )}

              {/* Full album button — highlighted green when it's the better deal */}
              {albumPrice > 0 ? (
                <Button
                  onClick={onPurchaseAlbum}
                  variant={fullAlbumCheaper ? "default" : "outline"}
                  size="sm"
                  className={fullAlbumCheaper
                    ? "gap-2 bg-green-600 hover:bg-green-500 text-white border-0 font-semibold"
                    : "gap-2 border-border text-foreground hover:bg-secondary"}
                >
                  <Package className="w-4 h-4" />
                  {fullAlbumCheaper
                    ? `Full Album $${albumPrice} — Best deal!`
                    : `Full Album $${albumPrice}`}
                </Button>
              ) : (
                <Button onClick={onPurchaseAlbum} variant="outline" size="sm" className="gap-2 border-green-500/30 text-green-400 hover:bg-green-500/10">
                  <Package className="w-4 h-4" />
                  Unlock Full Album (Free)
                </Button>
              )}

              {/* Bank Transfer also available when full album is the better deal */}
              {fullAlbumCheaper && bankTransferEnabled && onBankTransfer && (
                <Button onClick={onBankTransfer} variant="outline" size="sm" className="gap-2 border-border text-foreground hover:bg-secondary">
                  <Building2 className="w-4 h-4" />
                  Bank Transfer
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
