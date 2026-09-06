"use strict";

// Prices are always read from event configuration, never from the request.
function priceBookingExtras(definitions = [], selections = []) {
  if (!Array.isArray(definitions) || definitions.length > 50 || !Array.isArray(selections) || selections.length > 50) {
    throw new Error("Invalid booking extras");
  }
  const catalog = new Map();
  for (const extra of definitions) {
    if (!extra || typeof extra.id !== "string" || !extra.id || catalog.has(extra.id)
      || typeof extra.name !== "string" || !extra.name.trim() || extra.name.length > 160
      || (extra.description !== undefined && (typeof extra.description !== "string" || extra.description.length > 300))
      || typeof extra.price !== "number" || !Number.isFinite(extra.price) || extra.price < 0 || extra.price > 100000
      || !Number.isInteger(extra.maxQuantity) || extra.maxQuantity < 1 || extra.maxQuantity > 1000) {
      throw new Error("Booking extras configuration is invalid. Please contact the photographer.");
    }
    catalog.set(extra.id, extra);
  }
  const seen = new Set();
  const lineItems = [];
  let totalCents = 0;
  for (const selection of selections) {
    const extra = catalog.get(selection?.id);
    if (!extra || seen.has(extra.id) || !Number.isInteger(selection.quantity) || selection.quantity < 0 || selection.quantity > extra.maxQuantity) {
      throw new Error("Choose a valid quantity for each booking extra");
    }
    seen.add(extra.id);
    if (!selection.quantity) continue;
    const cents = Math.round(extra.price * 100);
    const lineCents = cents * selection.quantity;
    totalCents += lineCents;
    lineItems.push({ id: extra.id, name: extra.name.trim(), ...(extra.description?.trim() ? { description: extra.description.trim() } : {}), quantity: selection.quantity, unitPrice: cents / 100, total: lineCents / 100 });
  }
  if (totalCents > 99999999) throw new Error("Booking total is too large");
  return { lineItems, total: totalCents / 100 };
}

module.exports = { priceBookingExtras };
