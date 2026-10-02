import { Edit, ExternalLink, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AlbumWorkflowSummary } from "@/lib/album-workflow";
import type { Album } from "@/lib/types";
import AlbumWorkflowProgress from "@/pages/admin/AlbumWorkflowProgress";

export function AlbumListRow({ album, cover, workflow, onContinue, onEdit, onView, onReview, selected, onSelect }: {
  album: Album; cover?: string; workflow: AlbumWorkflowSummary; onContinue: () => void; onEdit: () => void; onView: () => void; onReview: () => void; selected?: boolean; onSelect?: () => void;
}) {
  const pending = (album.downloadRequests || []).filter(request => request.status === "pending");
  return <article className={`studio-album-row flex flex-wrap sm:flex-nowrap items-center gap-3 py-3 ${selected ? "ring-1 ring-primary" : ""}`}>
    {onSelect && <input type="checkbox" aria-label={`Select ${album.title}`} checked={selected} onChange={onSelect} className="size-4" />}
    <div className="size-14 shrink-0 overflow-hidden bg-secondary flex items-center justify-center">{cover ? <img src={cover} alt="" loading="lazy" className="size-full object-cover" /> : <Images className="size-5 text-muted-foreground" />}</div>
    <div className="min-w-0 flex-1 basis-40"><button type="button" onClick={onEdit} className="text-left font-medium text-sm hover:text-primary break-words">{album.title}</button><p className="text-xs text-muted-foreground">{album.clientName || "No linked client"} · {album._photosStripped ? album.photoCount || 0 : album.photos.length} photos · {album.date}</p><div className="mt-2 max-w-xl"><AlbumWorkflowProgress summary={workflow} compact /></div>{pending.length > 0 && <button type="button" onClick={onReview} className="mt-1 text-xs text-primary hover:underline">{pending.length} download request{pending.length === 1 ? "" : "s"} · Review</button>}</div>
    <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:shrink-0"><Button size="sm" variant="outline" onClick={onContinue} className="h-9 whitespace-normal border-border px-3 text-xs leading-tight hover:border-primary/50 hover:text-primary">{workflow.nextAction}</Button><Button size="sm" variant="ghost" onClick={onView} className="px-2 text-xs text-muted-foreground hover:text-foreground">{workflow.delivered ? "View gallery" : "Preview gallery"}</Button></div>
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
    <span className="absolute left-2 top-2 bg-black/65 px-2 py-1 text-[9px] font-body uppercase tracking-wider text-white/80">
      {enabled ? "Live gallery" : "Hidden"}
    </span>
  </div>;
}

export function AlbumCardPrimaryActions({ workflow, onContinue, onEdit, onView }: { workflow: AlbumWorkflowSummary; onContinue: () => void; onEdit: () => void; onView: () => void }) {
  return <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t border-border/70">
    <Button size="sm" variant="outline" onClick={onContinue} className="h-8 gap-1.5 whitespace-normal border-border px-3 font-body text-xs leading-tight hover:border-primary/50 hover:text-primary"><Edit className="h-3.5 w-3.5 shrink-0" /><span>{workflow.nextAction}</span></Button>
    <Button size="sm" variant="ghost" onClick={workflow.delivered ? onView : onEdit} className="h-8 gap-1 px-2 font-body text-xs text-muted-foreground hover:text-foreground"><ExternalLink className="w-3.5 h-3.5" /> {workflow.delivered ? "View gallery" : "Edit album"}</Button>
  </div>;
}
