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

                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground font-body">
                    {breakdownLabel()}
                  </p>

                  {paidCount > 0 && fullAlbumCheaper && albumPrice > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
                      Best deal: Full album ${albumPrice}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">

              {(allFree || allAlreadyPaid) && (
                <Button onClick={onDownloadFree} variant="outline" size="sm" className="gap-2">
                  <Download className="w-4 h-4" />
                  Download
                </Button>
              )}

              {paidCount > 0 && fullAlbumCheaper && (
                <Button
                  onClick={onPurchaseAlbum}
                  size="sm"
                  className="gap-2 bg-green-600 hover:bg-green-500 text-white"
                >
                  <Package className="w-4 h-4" />
                  Pay ${albumPrice} (Full Album)
                </Button>
              )}

              {paidCount > 0 && !fullAlbumCheaper && (
                <Button
                  onClick={onPurchaseSelected}
                  size="sm"
                  className="gap-2"
                >
                  <ShoppingCart className="w-4 h-4" />
                  Pay ${paidTotal}
                </Button>
              )}

              {bankTransferEnabled && onBankTransfer && paidCount > 0 && (
                <Button
                  onClick={onBankTransfer}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  <Building2 className="w-4 h-4" />
                  Bank Transfer
                </Button>
              )}

              {/* Always offer Full Album purchase as an option unless everything is already paid */}
              {albumPrice > 0 && !allAlreadyPaid && !(paidCount > 0 && fullAlbumCheaper) && (
                <Button
                  onClick={onPurchaseAlbum}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  <Package className="w-4 h-4" />
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