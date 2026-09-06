import type { EventType, BookingLineItem } from "@/lib/types";
import { Input } from "@/components/ui/input";

export function BookingExtras({ event, quantities, onChange }: { event: EventType; quantities: Record<string, number>; onChange: (value: Record<string, number>) => void }) {
  if (!event.extras?.length) return null;
  return <fieldset className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
    <legend className="px-2 font-medium">Make it yours · optional extras</legend>
    <p className="text-sm text-muted-foreground">Choose how many you’d like. Leave at 0 to skip.</p>
    {event.extras.map(extra => <div key={extra.id} className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 basis-40 flex-1 space-y-1 break-words">
        <label htmlFor={`extra-${extra.id}`} className="block text-sm font-medium">{extra.name}</label>
        {extra.description?.trim() && <p id={`extra-description-${extra.id}`} className="text-sm leading-relaxed text-muted-foreground">{extra.description}</p>}
        <p id={`extra-price-${extra.id}`} className="text-sm text-muted-foreground">${extra.price.toFixed(2)} each · up to {extra.maxQuantity}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" aria-label={`Remove one ${extra.name}`} disabled={!quantities[extra.id]} onClick={() => onChange({ ...quantities, [extra.id]: Math.max(0, (quantities[extra.id] || 0) - 1) })} className="size-12 rounded-lg border border-border disabled:opacity-30">−</button>
        <Input id={`extra-${extra.id}`} aria-describedby={`${extra.description?.trim() ? `extra-description-${extra.id} ` : ""}extra-price-${extra.id}`} type="number" inputMode="numeric" min={0} max={extra.maxQuantity} step={1} value={quantities[extra.id] || 0}
          onFocus={e => e.target.select()} onChange={e => { const quantity = Math.max(0, Math.min(extra.maxQuantity, Math.floor(Number(e.target.value) || 0))); e.target.value = String(quantity); onChange({ ...quantities, [extra.id]: quantity }); }} className="w-16 shrink-0 text-center" />
        <button type="button" aria-label={`Add one ${extra.name}`} disabled={(quantities[extra.id] || 0) >= extra.maxQuantity} onClick={() => onChange({ ...quantities, [extra.id]: Math.min(extra.maxQuantity, (quantities[extra.id] || 0) + 1) })} className="size-12 rounded-lg border border-border disabled:opacity-30">+</button>
      </div>
    </div>)}
  </fieldset>;
}

export function BookingPriceBreakdown({ base, items, total }: { base?: number; items?: BookingLineItem[]; total: number }) {
  if (!items?.length) return null;
  return <div className="rounded-xl border border-border p-4 space-y-2 text-sm" aria-label="Booking price breakdown">
    {base !== undefined && <div className="flex justify-between gap-3"><span>Session</span><span>${base.toFixed(2)}</span></div>}
    {items.map(item => <div key={item.id} className="flex justify-between gap-3 text-muted-foreground"><span>{item.name} × {item.quantity} <span className="text-xs">(${item.unitPrice.toFixed(2)} each)</span></span><span className="shrink-0">${item.total.toFixed(2)}</span></div>)}
    <div className="flex justify-between border-t border-border pt-2 font-semibold"><span>Total</span><span>${total.toFixed(2)}</span></div>
  </div>;
}
