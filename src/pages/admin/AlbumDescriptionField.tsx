import { Textarea } from "@/components/ui/textarea";

export default function AlbumDescriptionField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div>
    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Description</label>
    <Textarea value={value} onChange={(event) => onChange(event.target.value)} className="bg-secondary border-border text-foreground font-body min-h-[50px]" />
  </div>;
}
