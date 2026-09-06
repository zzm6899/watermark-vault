"use strict";

const cents = value => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value) * 100)) : 0;

// Event-date reporting: money attributed to the shoot, not the transfer date.
function buildEventRevenue({ bookings = [], albums = [], orders = {}, eventTypes = [], from = "", to = "", groupBy = "event", eventId = "" }) {
  const groups = new Map();
  const bookingMap = new Map(bookings.filter(b => !b.tenantSlug).map(b => [b.id, b]));
  const eventMap = new Map(eventTypes.map(e => [e.id, e.title]));
  const groupFor = (booking, album) => {
    const id = booking?.eventTypeId || (booking?.type ? `legacy:${booking.type}` : "unassigned");
    const date = booking?.date || album?.date || "";
    if ((eventId && id !== eventId) || (from && (!date || date < from)) || (to && (!date || date > to))) return null;
    const key = `${id}${groupBy === "date" ? `:${date}` : ""}`;
    if (!groups.has(key)) groups.set(key, { key, eventId: id, event: eventMap.get(id) || booking?.type || "Unassigned galleries", date: groupBy === "date" ? date : "", bookings: 0, booked: 0, bookingCollected: 0, outstanding: 0, extras: 0, galleryCollected: 0, pendingTransfers: 0, unpricedRequests: 0, unpricedPurchases: 0 });
    return groups.get(key);
  };
  for (const booking of bookingMap.values()) {
    if (booking.status === "cancelled") continue;
    const row = groupFor(booking);
    if (!row) continue;
    const total = cents(booking.paymentAmount);
    const paid = ["paid", "cash"].includes(booking.paymentStatus) ? total : booking.paymentStatus === "deposit-paid" ? Math.min(total, cents(booking.depositAmount)) : 0;
    row.bookings++; row.booked += total; row.bookingCollected += paid; row.outstanding += total - paid;
    row.extras += (booking.lineItems || []).reduce((sum, item) => sum + cents(item.total), 0);
  }
  const fulfilled = Object.values(orders).filter(order => order.status === "fulfilled" && order.fulfilledStripeSessionId);
  const ordersByAlbum = new Map();
  for (const order of fulfilled) {
    if (!ordersByAlbum.has(order.albumId)) ordersByAlbum.set(order.albumId, []);
    ordersByAlbum.get(order.albumId).push(order);
  }
  const seen = new Set();
  for (const album of albums) {
    const row = groupFor(bookingMap.get(album.bookingId), album);
    if (!row) continue;
    const albumOrders = ordersByAlbum.get(album.id) || [];
    const knownSessionIds = new Set(albumOrders.map(order => order.fulfilledStripeSessionId));
    for (const order of albumOrders) {
      if (seen.has(order.fulfilledStripeSessionId)) continue;
      seen.add(order.fulfilledStripeSessionId);
      if (String(order.currency || "aud").toLowerCase() !== "aud" || !Number.isSafeInteger(order.expectedAmountCents) || order.expectedAmountCents < 0) { row.unpricedPurchases++; continue; }
      row.galleryCollected += order.expectedAmountCents;
    }
    // Recovery sessions can duplicate an entitlement. They are not new payments.
    const legacyIds = new Set();
    for (const purchase of Object.values(album.sessionPurchases || {})) {
      if (!(purchase.fullAlbum || purchase.photoIds?.length)) continue;
      const ids = purchase.stripeSessionIds?.length ? purchase.stripeSessionIds : [purchase.stripeSessionId || "legacy"];
      for (const id of ids) if (!knownSessionIds.has(id)) legacyIds.add(id);
    }
    if (album.stripePaidAt && !albumOrders.length && !legacyIds.size) legacyIds.add("legacy");
    row.unpricedPurchases += legacyIds.size;
    for (const request of album.downloadRequests || []) {
      if (request.method !== "bank-transfer") continue;
      if (!["pending", "approved", "completed"].includes(request.status)) continue;
      if (typeof request.amount !== "number" || !Number.isFinite(request.amount) || request.amount < 0) { row.unpricedRequests++; continue; }
      if (request.status === "pending") row.pendingTransfers += cents(request.amount);
      else row.galleryCollected += cents(request.amount);
    }
  }
  const rows = [...groups.values()].filter(row => row.bookings || row.galleryCollected || row.pendingTransfers || row.unpricedRequests || row.unpricedPurchases).map(row => {
    for (const field of ["booked", "bookingCollected", "outstanding", "extras", "galleryCollected", "pendingTransfers"]) row[field] /= 100;
    return { ...row, collected: Math.round((row.bookingCollected + row.galleryCollected) * 100) / 100 };
  }).sort((a, b) => b.collected - a.collected || a.event.localeCompare(b.event) || a.date.localeCompare(b.date));
  return { rows, basis: "event-date", currency: "AUD", generatedAt: new Date().toISOString() };
}

module.exports = { buildEventRevenue };
