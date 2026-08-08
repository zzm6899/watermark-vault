export default function SlotIntervalField({ value, onChange, tenant = false }: { value: number; onChange: (value: number) => void; tenant?: boolean }) {
  return <div>
    <label className="text-xs font-body tracking-wider uppercase text-muted-foreground mb-1.5 block">Start Times Every</label>
    <select value={value} onChange={event => onChange(Number(event.target.value))} className="w-full bg-secondary border border-border text-foreground font-body text-sm rounded-md px-3 py-2.5">
      {[5, 10, 15, 20, 30, 60].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
    </select>
    <p className="text-[10px] font-body text-muted-foreground mt-1">{tenant ? "Keeps start-time choices consistent across different session lengths" : "Controls available start choices independently of session length"}</p>
  </div>;
}
