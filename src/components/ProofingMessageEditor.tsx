import { proofingSelectionGuidance } from "@/lib/proofing-email";

export default function ProofingMessageEditor({ value = {}, onChange, durations = [20, 40], defaults, event = false }: {
  value?: Record<string, string>; onChange: (value: Record<string, string>) => void;
  durations?: number[]; defaults?: Record<string, string>; event?: boolean;
}) {
  const keys = ["default", ...Array.from(new Set([...durations, ...Object.keys(value).filter(key => key !== "default").map(Number)])).filter(Number.isFinite).sort((a, b) => a - b).map(String)];
  return <section className="space-y-3 rounded-lg border border-border p-4">
    <h3 className="font-display text-lg">Proofing messages by session length</h3>
    <p className="text-xs text-muted-foreground">{event ? "Override the Settings wording for this event. Leave blank to inherit. The default applies to durations without an event override." : "Instructions included in proofing emails. Leave blank to use the built-in wording. Events can override these defaults."} Uses booked duration. Save changes with the form below.</p>
    {keys.map(key => <label key={key} className="block text-xs space-y-1"><span>{key === "default" ? "Default message" : `${key} minutes`}</span>
      <textarea rows={2} maxLength={2000} value={value[key] || ""} placeholder={proofingSelectionGuidance(key === "default" ? undefined : Number(key), defaults)} onChange={e => onChange({ ...value, [key]: e.target.value })} className="w-full rounded border border-border bg-secondary p-2 text-sm text-foreground" />
    </label>)}
  </section>;
}
