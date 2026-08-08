import { Edit, ExternalLink, Images } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AlbumCardCover({ src, title, enabled, onError }: { src?: string; title: string; enabled: boolean; onError: () => void }) {
  return <div className="relative aspect-[16/9] bg-secondary overflow-hidden">
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
