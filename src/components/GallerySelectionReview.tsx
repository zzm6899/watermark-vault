import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Photo } from "@/lib/types";
import { X } from "lucide-react";

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void; photos: Photo[];
  fullAlbum: boolean; paidIds: Set<string>; freeRemaining: number;
  pricePerPhoto: number; priceFullAlbum: number;
  photoSrc: (photo: Photo) => string; onRemove: (id: string) => void; onContinue: () => void;
};

export default function GallerySelectionReview({ open, onOpenChange, photos, fullAlbum, paidIds, freeRemaining, pricePerPhoto, priceFullAlbum, photoSrc, onRemove, onContinue }: Props) {
  const unpaid = photos.filter(photo => !paidIds.has(photo.id));
  const freeIds = new Set(unpaid.slice(0, freeRemaining).map(photo => photo.id));
  const billable = Math.max(0, unpaid.length - freeRemaining);
  const total = fullAlbum ? priceFullAlbum : Math.round(billable * pricePerPhoto * 100) / 100;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="gallery-dialog max-w-lg">
      <DialogHeader><DialogTitle>Review your photographs</DialogTitle><DialogDescription>Check your file numbers and total before continuing.</DialogDescription></DialogHeader>
      <p className="text-sm">{fullAlbum ? "Complete gallery" : "Your selection"} · {photos.length} photo{photos.length === 1 ? "" : "s"}</p>
      <ul aria-label="Selected photographs" className="max-h-[40dvh] overflow-y-auto divide-y divide-border pr-1">
        {photos.map(photo => {
          const name = photo.originalName || photo.title || photo.id;
          const included = fullAlbum || paidIds.has(photo.id) || freeIds.has(photo.id);
          return <li key={photo.id} className="flex items-center gap-3 py-3">
            <img src={photoSrc(photo)} alt="" loading="lazy" className="size-14 shrink-0 rounded-sm object-cover bg-secondary" />
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{name}</p><p className="text-xs text-muted-foreground">1 photo · {fullAlbum ? "Included in gallery" : paidIds.has(photo.id) ? "Already purchased" : freeIds.has(photo.id) ? "Complimentary" : `$${pricePerPhoto.toFixed(2)}`}</p></div>
            {!fullAlbum && <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Remove ${name}`} onClick={() => onRemove(photo.id)}><X className="size-4" /></Button>}
            {fullAlbum && included && <span className="text-xs text-muted-foreground">Included</span>}
          </li>;
        })}
      </ul>
      {!photos.length && <p className="text-sm text-muted-foreground">Your selection is empty. Return to the gallery to choose photos.</p>}
      <dl className="border-t border-border pt-3 space-y-2 text-sm">
        {!fullAlbum && <><div className="flex justify-between"><dt>Previously purchased</dt><dd>{photos.length - unpaid.length}</dd></div><div className="flex justify-between"><dt>Complimentary photos</dt><dd>{freeIds.size}</dd></div><div className="flex justify-between"><dt>Additional photos</dt><dd>{billable} × ${pricePerPhoto.toFixed(2)}</dd></div></>}
        <div className="flex justify-between font-medium text-base"><dt>Total to pay</dt><dd>${total.toFixed(2)}</dd></div>
      </dl>
      <Button disabled={!photos.length} onClick={onContinue}>{total === 0 ? "Continue to download" : `Continue to payment · $${total.toFixed(2)}`}</Button>
      <Button variant="ghost" onClick={() => onOpenChange(false)}>Back to gallery</Button>
    </DialogContent>
  </Dialog>;
}
