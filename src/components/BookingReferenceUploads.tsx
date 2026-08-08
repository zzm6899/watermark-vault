import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteBookingReferenceImage, uploadBookingReferenceImages } from "@/lib/api";
import type { Booking, BookingReferenceImage } from "@/lib/types";

export default function BookingReferenceUploads({ booking, onChange }: { booking: Booking; onChange?: (booking: Booking) => void }) {
  const [images, setImages] = useState<BookingReferenceImage[]>(booking.referenceImages || []);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setImages(booking.referenceImages || []), [booking.referenceImages]);
  if (!booking.modifyToken || booking.status === "cancelled") return null;

  const upload = async (files: FileList | null) => {
    const chosen = Array.from(files || []);
    if (!chosen.length) return;
    if (images.length + chosen.length > 5) { toast.error("You can keep up to five reference images."); return; }
    if (chosen.some(file => file.size > 8 * 1024 * 1024)) { toast.error("Each image must be 8 MB or smaller."); return; }
    setBusy(true);
    const result = await uploadBookingReferenceImages(booking.modifyToken!, chosen);
    setBusy(false);
    if (!result.ok || !result.booking) { toast.error(result.error || "Upload failed"); return; }
    setImages(result.booking.referenceImages || []); onChange?.(result.booking); toast.success("Reference images uploaded");
    if (inputRef.current) inputRef.current.value = "";
  };
  const remove = async (image: BookingReferenceImage) => {
    setBusy(true);
    const result = await deleteBookingReferenceImage(booking.modifyToken!, image.id);
    setBusy(false);
    if (!result.ok || !result.booking) { toast.error(result.error || "Unable to remove image"); return; }
    setImages(result.booking.referenceImages || []); onChange?.(result.booking); toast.success("Reference image removed");
  };

  return <section className="mt-5 rounded-xl border border-border/70 bg-secondary/20 p-4 text-left">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-medium text-foreground">Reference images</h3><p className="mt-1 text-xs text-muted-foreground">Optional inspiration, poses, costumes or location references. JPEG, PNG or WebP; five files maximum.</p></div><span className="shrink-0 text-xs text-muted-foreground">{images.length}/5</span></div>
    {!!images.length && <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{images.map(image => <div key={image.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-background">{image.url ? <img src={image.url} alt={image.originalName} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground">{image.originalName}</div>}<button type="button" disabled={busy} onClick={() => void remove(image)} aria-label={`Remove ${image.originalName}`} className="absolute right-1 top-1 rounded-md bg-black/75 p-1 text-white opacity-90 hover:bg-destructive"><Trash2 className="size-3" /></button></div>)}</div>}
    <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => void upload(event.target.files)} />
    <Button type="button" variant="outline" size="sm" disabled={busy || images.length >= 5} onClick={() => inputRef.current?.click()} className="mt-3 gap-2">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}{busy ? "Uploading…" : images.length ? "Add more references" : "Add reference images"}</Button>
  </section>;
}
