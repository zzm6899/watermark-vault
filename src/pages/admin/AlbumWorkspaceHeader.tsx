import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Album } from "@/lib/types";

const sections = [
  ["album-editor-details", "Details"], ["album-editor-access", "Access"], ["album-editor-pricing", "Pricing"],
  ["album-editor-workflow", "Proofing"], ["album-editor-photos", "Photos"], ["album-editor-delivery", "Delivery"],
] as const;

export default function AlbumWorkspaceHeader({ isNew, title, photoCount, clientName, status, saving, onClose, onSave }: {
  isNew: boolean; title: string; photoCount: number; clientName: string; status: Album["status"];
  saving: boolean; onClose: () => void; onSave: () => void;
}) {
  return <div className="sticky top-16 z-30 -mx-2 rounded-xl border border-border/70 bg-background/95 p-3 shadow-xl shadow-black/20 backdrop-blur-xl sm:-mx-3 sm:p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[10px] font-body uppercase tracking-[0.2em] text-primary">{isNew ? "Create gallery" : "Album workspace"}</p>
        <h3 className="font-display text-xl text-foreground truncate">{title || (isNew ? "New Album" : "Untitled album")}</h3>
        <p className="text-[11px] font-body text-muted-foreground">{photoCount} photos · {clientName || "No client linked"} · {status}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        <Button size="sm" onClick={onSave} disabled={saving} className="gap-2">
          <Save className="h-4 w-4" /> {saving ? "Saving…" : isNew ? "Create album" : "Save changes"}
        </Button>
      </div>
    </div>
    <nav aria-label="Album editor sections" className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
      {sections.map(([target, label]) => <button key={target} type="button" onClick={() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" })} className="whitespace-nowrap rounded-full border border-border/70 px-3 py-1 text-[10px] font-body text-muted-foreground hover:border-primary/40 hover:text-primary">{label}</button>)}
    </nav>
  </div>;
}
