"use strict";
function buildGalleryPayments({ albums = [], orders = {} }) {
  const rows = [], seen = new Set();
  const albumMap = new Map(albums.filter(a => !a.tenantSlug).map(a => [a.id, a]));
  for (const order of Object.values(orders)) {
    if (order.tenantSlug || order.status !== "fulfilled" || !order.fulfilledStripeSessionId || seen.has(order.fulfilledStripeSessionId)) continue;
    seen.add(order.fulfilledStripeSessionId);
    const album = albumMap.get(order.albumId);
    const email = order.clientEmail || order.purchaserEmail || album?.sessionPurchases?.[order.sessionKey]?.purchaserEmail;
    const known = Number.isSafeInteger(order.expectedAmountCents) && order.expectedAmountCents >= 0 && String(order.currency || "aud").toLowerCase() === "aud";
    rows.push({ id: `order-${order.id || order.fulfilledStripeSessionId}`, albumId: order.albumId, albumTitle: album?.title || "Deleted album", clientName: album?.clientName || email || "Unknown", purchaserEmail: email,
      date: order.fulfilledAt || "", photoIds: order.isFullAlbum ? undefined : order.photoIds || [], method: "stripe", status: "completed", amount: known ? order.expectedAmountCents / 100 : 0, amountUnknown: !known,
      description: order.isFullAlbum ? "Full album - Stripe" : `${order.photoIds?.length || 0} photos - Stripe` });
  }
  for (const album of albumMap.values()) {
    for (const [key, purchase] of Object.entries(album.sessionPurchases || {})) {
      if (!(purchase.fullAlbum || purchase.photoIds?.length)) continue;
      const ids = purchase.stripeSessionIds?.length ? purchase.stripeSessionIds : [purchase.stripeSessionId].filter(Boolean);
      if (ids.length && ids.every(id => seen.has(id))) continue;
      const identity = ids.length ? ids.slice().sort().join(":") : `${album.id}:${purchase.paidAt}:${purchase.fullAlbum}:${(purchase.photoIds || []).slice().sort().join(",")}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.push({ id: `legacy-${album.id}-${key}`, albumId: album.id, albumTitle: album.title, clientName: album.clientName || purchase.purchaserEmail || "Unknown", purchaserEmail: purchase.purchaserEmail,
        date: purchase.paidAt || "", photoIds: purchase.fullAlbum ? undefined : purchase.photoIds || [], method: "stripe", status: "completed", amount: 0, amountUnknown: true, description: "Purchased photo access - historical amount not recorded" });
    }
    if (album.stripePaidAt && !Object.keys(album.sessionPurchases || {}).length && !rows.some(row => row.albumId === album.id)) rows.push({ id: `legacy-${album.id}`, albumId: album.id, albumTitle: album.title, clientName: album.clientName || "Unknown", date: album.stripePaidAt, method: "stripe", status: "completed", amount: 0, amountUnknown: true, description: "Full album - historical amount not recorded" });
  }
  return rows;
}
module.exports = { buildGalleryPayments };
