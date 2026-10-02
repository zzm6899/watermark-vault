import { useState, type MouseEvent } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export type EmptyAlbumOutcome = "emptied" | "stale" | "failed";

export default function EmptyAlbumConfirmation({
  albumTitle,
  photoCount,
  disabled = false,
  onConfirm,
}: {
  albumTitle: string;
  photoCount: number;
  disabled?: boolean;
  onConfirm: () => Promise<EmptyAlbumOutcome>;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (submitting || disabled || photoCount <= 0) return;
    setSubmitting(true);
    setError("");
    try {
      const outcome = await onConfirm();
      if (outcome === "emptied" || outcome === "stale") setOpen(false);
      else setError("The album was not emptied. Check the message and retry when ready.");
    } catch {
      setError("The album could not be emptied. Check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={next => { if (!submitting) { setOpen(next); if (next) setError(""); } }}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled || photoCount <= 0} aria-label={`Empty album: ${photoCount} photo${photoCount === 1 ? "" : "s"}`} className="min-h-9 gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:text-muted-foreground">
          <Trash2 className="h-3.5 w-3.5" /> Empty album
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Empty “{albumTitle}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove all {photoCount} photo{photoCount === 1 ? "" : "s"} from this album? The album, client link, pricing, and other settings will stay. Uploaded files are removed only when no other album or photo library uses them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={submitting || disabled || photoCount <= 0} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {submitting ? "Emptying album…" : `Empty ${photoCount} photo${photoCount === 1 ? "" : "s"}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
