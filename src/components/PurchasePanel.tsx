import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface PurchasePanelProps {
  selectedCount: number;
  unpaidCount?: number;
  alreadyPaidCount?: number;
  freeRemaining: number;
  pricePerPhoto: number;
  priceFullAlbum: number;
  onDownloadFree: () => void;
  onPurchaseSelected: () => void;
  onPurchaseAlbum: () => void;
  onClearSelection: () => void;
}

export default function PurchasePanel({
  selectedCount, unpaidCount, alreadyPaidCount = 0, freeRemaining,
  pricePerPhoto, priceFullAlbum, onDownloadFree, onPurchaseSelected,
  onPurchaseAlbum, onClearSelection,
}: PurchasePanelProps) {
  const effectiveUnpaidCount = unpaidCount ?? selectedCount;
  const freeUsed = Math.min(effectiveUnpaidCount, freeRemaining);
  const paidCount = Math.max(0, effectiveUnpaidCount - freeRemaining);
  const paidTotal = paidCount * pricePerPhoto;
  const fullAlbumCheaper = priceFullAlbum > 0 && paidCount > 0 && paidTotal >= priceFullAlbum;
  const breakdown = [
    alreadyPaidCount > 0 && `${alreadyPaidCount} purchased`,
    freeUsed > 0 && `${freeUsed} complimentary`,
    paidCount > 0 && `${paidCount} × $${pricePerPhoto.toFixed(2)}`,
  ].filter(Boolean).join(" · ");

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
          className="gallery-selection-bar fixed bottom-0 left-0 right-0 z-40 border-t border-border px-4 py-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-base font-medium">{selectedCount} photo{selectedCount !== 1 ? "s" : ""} selected</p>
              <p className="text-sm text-muted-foreground">{fullAlbumCheaper ? `The full gallery costs no more than your $${paidTotal.toFixed(2)} selection.` : breakdown || "Ready to download"}</p>
            </div>
            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <Button onClick={onClearSelection} variant="ghost" className="text-muted-foreground">Clear selection</Button>
              {paidCount === 0 ? (
                <Button onClick={onDownloadFree} className="gap-2"><Download className="size-4" />Download Free</Button>
              ) : fullAlbumCheaper ? (
                <Button onClick={onPurchaseAlbum}>Full gallery · ${priceFullAlbum.toFixed(2)}</Button>
              ) : (
                <Button onClick={onPurchaseSelected}>Pay ${paidTotal.toFixed(2)}</Button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
