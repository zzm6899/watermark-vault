import type { EventType, BookingLineItem } from "./types";

export function sessionPrice(event: EventType, duration: number): number {
  return Math.round((event.durationPrices?.[duration] ?? event.prices?.[duration] ?? event.price ?? 0) * 100) / 100;
}

export function bookingQuote(event: EventType, duration: number, quantities: Record<string, number> = {}) {
  const lineItems: BookingLineItem[] = (event.extras || []).flatMap(extra => {
    const quantity = Math.max(0, Math.min(extra.maxQuantity, Math.floor(quantities[extra.id] || 0)));
    const cents = Math.round(extra.price * 100);
    return quantity ? [{ id: extra.id, name: extra.name, quantity, unitPrice: cents / 100, total: cents * quantity / 100 }] : [];
  });
  const base = sessionPrice(event, duration);
  const total = Math.round((base + lineItems.reduce((sum, item) => sum + item.total, 0)) * 100) / 100;
  const configured = Math.max(0, event.depositAmount || 0);
  const deposit = !event.depositEnabled ? 0 : event.depositType === "percentage"
    ? Math.round(total * Math.min(100, configured)) / 100
    : Math.min(total, configured);
  return { sessionPrice: base, lineItems, total, deposit };
}
