import { Edit, ExternalLink, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Album } from "@/lib/types";

export function AlbumListRow({ album, cover, onEdit, onView, onReview, selected, onSelect }: {
  album: Album; cover?: string; onEdit: () => void; onView: () => void; onReview: () => void; selected?: boolean; onSelect?: () => void;
}) {
  const pending = (album.downloadRequests || []).filter(request => request.status === "pending");
  return <article className={`glass-panel rounded-xl p-3 flex flex-wrap sm:flex-nowrap items-center gap-3 ${selected ? "ring-2 ring-primary" : ""}`}>
    {onSelect && <input type="checkbox" aria-label={`Select ${album.title} for merge`} checked={selected} onChange={onSelect} className="size-4" />}
    <div className="size-14 shrink-0 rounded-lg overflow-hidden bg-secondary flex items-center justify-center">{cover ? <img src={cover} alt="" loading="lazy" className="size-full object-cover" /> : <Images className="size-5 text-muted-foreground" />}</div>
    <div className="min-w-0 flex-1 basis-40"><button onClick={onEdit} className="text-left font-medium text-sm hover:text-primary break-words">{album.title}</button><p className="text-xs text-muted-foreground">{album.clientName || "No linked client"} · {album._photosStripped ? album.photoCount || 0 : album.photos.length} photos · {album.date}</p></div>
    <div className="min-w-0 sm:w-44"><p className="text-xs capitalize text-muted-foreground">{album.enabled === false ? "Hidden · " : ""}{(album.proofingEnabled ? album.proofingStage : album.status)?.replaceAll("-", " ") || "Editing"}</p>{pending.length > 0 && <button onClick={onReview} className="text-xs text-amber-500 hover:underline">{pending.length} download request{pending.length === 1 ? "" : "s"} · Review</button>}</div>
    <div className="flex gap-2"><Button size="sm" onClick={onEdit}>Edit album</Button><Button size="sm" variant="outline" onClick={onView}>View gallery</Button></div>
  </article>;
}

export function AlbumCardCover({ src, title, enabled, onError, layout = "comfortable" }: { src?: string; title: string; enabled: boolean; onError: () => void; layout?: "compact" | "comfortable" | "list" }) {
  return <div className={`relative bg-secondary overflow-hidden ${layout === "list" ? "h-28 sm:h-36 sm:w-40 shrink-0" : layout === "compact" ? "h-24" : "aspect-[16/9]"}`}>
    {src && !src.startsWith("file://") ? (
      <img src={src} alt={title} className="w-full h-full object-cover transition-transform duration-700 hover:scale-105" loading="lazy" onError={onError} />
    ) : (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground/50">
        <Images className="h-7 w-7" />
        <span className="text-[10px] font-body uppercase tracking-wider">No cover selected</span>
      </div>
    )}
    <span className={`absolute left-3 top-3 rounded-full border px-2 py-1 text-[10px] font-body backdrop-blur-md ${enabled ? "border-emerald-400/30 bg-emerald-950/80 text-emerald-200" : "border-white/15 bg-black/65 text-white/70"}`}>
      {enabled ? "Live gallery" : "Hidden"}
    </span>
  </div>;
}

export function AlbumCardPrimaryActions({ onEdit, onView }: { onEdit: () => void; onView: () => void }) {
  return <div className="grid grid-cols-2 gap-2 pt-3 mt-2 border-t border-white/10">
    <Button size="sm" onClick={onEdit} className="gap-2 font-body text-xs"><Edit className="w-3.5 h-3.5" /> Edit album</Button>
    <Button size="sm" variant="outline" onClick={onView} className="gap-2 font-body text-xs"><ExternalLink className="w-3.5 h-3.5" /> View gallery</Button>
  </div>;
}
