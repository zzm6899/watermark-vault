import type { ConventionDetails as Details } from "@/lib/types";

export function ConventionDetailsFields({ value, onChange, booking = false }: { value: Details; onChange: (value: Details) => void; booking?: boolean }) {
  const field = "block w-full rounded border border-border bg-background p-2 text-sm";
  return <fieldset className="space-y-3 border border-border rounded p-3"><legend className="px-1 text-sm">Meeting point & delivery</legend>
    <label className="block text-xs">Meeting point<input className={field} maxLength={300} value={value.meetingPoint || ""} onChange={e => onChange({ ...value, meetingPoint: e.target.value })} /></label>
    <label className="block text-xs">Map link (https://…)<input className={field} type="url" maxLength={2000} value={value.mapUrl || ""} onChange={e => onChange({ ...value, mapUrl: e.target.value })} /></label>
    <label className="block text-xs">Arrival instructions<textarea className={field} maxLength={2000} value={value.arrivalInstructions || ""} onChange={e => onChange({ ...value, arrivalInstructions: e.target.value })} /></label>
    {booking ? <label className="block text-xs">Agreed delivery date<input className={field} type="date" value={value.deliveryDate || ""} onChange={e => onChange({ ...value, deliveryDate: e.target.value || undefined })} /></label> : <label className="block text-xs">Delivery target: days after the session<input className={field} type="number" min={0} max={365} step={1} value={value.deliveryDays ?? ""} onChange={e => onChange({ ...value, deliveryDays: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>}
    {!booking && <p className="text-xs text-muted-foreground">Copied to each new booking so later event edits do not change agreed instructions or delivery dates.</p>}
  </fieldset>;
}
export default function ConventionDetails({ value }: { value?: Details }) {
  if (!value || ![value.meetingPoint, value.mapUrl, value.arrivalInstructions, value.deliveryDate].some(Boolean)) return null;
  const safeMap = /^https?:\/\//i.test(value.mapUrl || "") ? value.mapUrl : undefined;
  return <section className="rounded border border-border p-3 space-y-2 text-sm" aria-label="Meeting point and delivery">
    {value.meetingPoint && <p><strong>Meeting point:</strong> {value.meetingPoint}</p>}
    {safeMap && <a className="underline" href={safeMap} target="_blank" rel="noreferrer">Open meeting-point map</a>}
    {value.arrivalInstructions && <p className="whitespace-pre-wrap">{value.arrivalInstructions}</p>}
    {value.deliveryDate && <p><strong>Agreed delivery target:</strong> {value.deliveryDate}</p>}
  </section>;
}
