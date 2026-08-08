import { Input } from "@/components/ui/input";

export default function AlbumTitleField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div>
    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Title *</label>
    <Input value={value} onChange={(event) => onChange(event.target.value)} className="bg-secondary border-border text-foreground font-body" />
  </div>;
}
