import { Input } from "@/components/ui/input";

export default function AlbumSlugField({ value, onChange, taken, privateLink = false }: {
  value: string;
  onChange: (value: string) => void;
  taken: boolean;
  privateLink?: boolean;
}) {
  return <div>
    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Custom URL Slug</label>
    <div className="flex items-center gap-2">
      <span className="text-xs font-body text-muted-foreground">/gallery/</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} className="bg-secondary border-border text-foreground font-body flex-1" />
      {value && <span className={`text-[10px] font-body whitespace-nowrap ${taken ? "text-destructive" : "text-green-500"}`}>
        {taken ? "⚠ Already taken" : "✓ Available"}
      </span>}
    </div>
    {privateLink && <p className="mt-1 text-[10px] font-body text-amber-500">
      Private-link protection is active. Share using “Copy gallery link” so the required access token is included.
    </p>}
  </div>;
}
