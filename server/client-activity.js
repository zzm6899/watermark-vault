"use strict";

const list = value => Array.isArray(value) ? value : [];
const clean = value => typeof value === "string" ? value.trim().toLowerCase() : "";
const money = (value, currency = "AUD") => {
  if (value == null || !Number.isFinite(Number(value))) return "Amount not recorded";
  try { return new Intl.NumberFormat("en-AU", { style: "currency", currency: String(currency).toUpperCase() }).format(Number(value)); }
  catch { return `${Number(value).toFixed(2)} ${currency}`; }
};
function contactMatches(contact, name, email) {
  const a = clean(contact.email), b = clean(email);
  if (a && b) return a === b;
  return !!clean(contact.name) && clean(contact.name) === clean(name);
}
const date = value => value && Number.isFinite(Date.parse(value)) ? value : null;

/** Read-only chronology from persisted records; never reconstruct historical prices from current settings. */
function buildClientActivity({ contact, bookings = [], invoices = [], albums = [], orders = {} }) {
  const items = [];
  const add = (id, at, type, title, detail, extra = {}) => items.push({ id, at: date(at), type, title, detail, ...extra });
  const matchedBookings = list(bookings).filter(booking => !booking.tenantSlug && contactMatches(contact, booking.clientName, booking.clientEmail));
  const bookingIds = new Set(matchedBookings.map(booking => booking.id));
  const albumIds = new Set([...list(contact.albumIds), ...matchedBookings.map(booking => booking.albumId).filter(Boolean)]);
  for (const booking of matchedBookings) {
    const context = booking.type || "Booking";
    const extraLines = list(booking.lineItems).map(item => ({ name: item.name || "Extra", description: item.description || "", quantity: item.quantity, amount: money(item.total) }));
    add(`booking:${booking.id}`, booking.createdAt, "booking", `${context} · ${booking.status || "pending"}`, `${booking.date || "Date not recorded"}${booking.time ? ` at ${booking.time}` : ""} · ${money(booking.paymentAmount)} · ${String(booking.paymentStatus || "unpaid").replaceAll("-", " ")}`, { bookingId: booking.id, extras: extraLines });
    list(booking.statusHistory).forEach((entry, index) => add(`booking-status:${booking.id}:${index}`, entry.changedAt, "booking", `${context} · ${entry.status}`, entry.note || "Booking status updated", { bookingId: booking.id }));
    if (booking.depositPaidAt) add(`deposit:${booking.id}`, booking.depositPaidAt, "payment", "Booking deposit received", `${context} · ${money(booking.depositAmount)} · ${booking.depositMethod || "Method not recorded"}`, { bookingId: booking.id });
    if (["paid", "cash"].includes(booking.paymentStatus)) {
      const balance = booking.depositPaidAt && Number.isFinite(Number(booking.depositAmount)) && Number.isFinite(Number(booking.paymentAmount)) ? Math.max(0, Number(booking.paymentAmount) - Number(booking.depositAmount)) : booking.paymentAmount;
      add(`booking-paid:${booking.id}`, booking.balancePaidAt || booking.paidAt, "payment", booking.depositPaidAt ? "Booking balance received" : "Booking payment received", `${context} · ${money(balance)} · ${booking.paymentMethod || booking.paymentStatus}`, { bookingId: booking.id });
    } else if (booking.bankTransferPendingAt) add(`booking-transfer:${booking.id}`, booking.bankTransferPendingAt, "request", "Booking bank transfer awaiting confirmation", `${context} · ${money(booking.depositRequired ? booking.depositAmount : booking.paymentAmount)}`, { bookingId: booking.id });
    list(booking.emailLog).forEach((entry, index) => add(`email:${booking.id}:${index}`, entry.sentAt || entry.at || entry.createdAt, "email", entry.subject || entry.type || "Booking email", `${context}${entry.to ? ` · ${entry.to}` : ""}`, { bookingId: booking.id }));
  }
  for (const invoice of list(invoices).filter(invoice => !invoice.tenantSlug && (bookingIds.has(invoice.bookingId) || contactMatches(contact, invoice.to?.name, invoice.to?.email)))) {
    const subtotal = list(invoice.items).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
    const total = (subtotal - Number(invoice.discount || 0)) * (1 + Number(invoice.tax || 0) / 100);
    add(`invoice:${invoice.id}`, invoice.paidAt || invoice.sentAt || invoice.createdAt, "invoice", `${invoice.number || "Invoice"} · ${invoice.status}`, `${money(total, invoice.currency)} · due ${invoice.dueDate || "not set"}`, { invoiceId: invoice.id });
  }
  const seenPayments = new Set();
  for (const album of list(albums).filter(album => !album.tenantSlug)) {
    const linked = albumIds.has(album.id) || bookingIds.has(album.bookingId) || contactMatches(contact, album.clientName, album.clientEmail);
    const identityFor = record => record.email || record.purchaserEmail || record.clientEmail || album.sessionPurchases?.[record.sessionKey]?.purchaserEmail;
    const matchesRecord = record => {
      const email = identityFor(record);
      return email ? !!clean(contact.email) && clean(email) === clean(contact.email) : linked;
    };
    const requests = list(album.downloadRequests).filter(matchesRecord);
    const downloads = list(album.downloadHistory).filter(matchesRecord);
    const albumOrders = Object.values(orders || {}).filter(order => !order.tenantSlug && order.albumId === album.id && order.status === "fulfilled" && matchesRecord(order));
    const purchases = Object.entries(album.sessionPurchases || {}).filter(([sessionKey, purchase]) => matchesRecord({ ...purchase, sessionKey }));
    if (!linked && !requests.length && !downloads.length && !albumOrders.length && !purchases.length) continue;
    const names = new Map(list(album.photos).map(photo => [photo.id, photo.originalName || photo.title || photo.id]));
    const files = ids => [...new Set(list(ids))].map(id => names.get(id) || `Unavailable photo (${id})`);
    const meta = record => ({ albumId: album.id, albumTitle: album.title || "Gallery", files: files(record.photoIds), ...(!identityFor(record) ? { identityNote: "Visitor email not recorded; shown because this gallery is linked to the client." } : {}) });
    if (linked) add(`album:${album.id}`, album.deliveredAt || album.date, "album", `${album.title || "Gallery"} · ${album.status || "created"}`, `${album.photoCount ?? list(album.photos).length} photos`, { albumId: album.id, albumTitle: album.title });
    requests.forEach((request, index) => {
      const id = request.id || `${index}`;
      const subject = request.fullAlbum ? "Complete gallery" : Array.isArray(request.billablePhotoIds) ? `${request.billablePhotoIds.length} paid + ${list(request.complimentaryPhotoIds).length} complimentary photos` : `${list(request.photoIds).length} photos`;
      add(`request:${album.id}:${id}`, request.requestedAt, "request", `${album.title} · Photo request`, `${subject} · ${money(request.amount)} · ${request.status}${request.clientNote ? ` · ${request.clientNote}` : ""}`, meta(request));
      if (["approved", "completed"].includes(request.status)) add(`approved:${album.id}:${id}`, request.approvedAt, "payment", request.method === "bank-transfer" ? "Bank transfer confirmed" : "Photo request approved", `${album.title} · ${subject} · ${money(request.amount)}`, meta(request));
    });
    for (const order of albumOrders) {
      const id = order.fulfilledStripeSessionId || order.id;
      if (seenPayments.has(id)) continue;
      seenPayments.add(id);
      add(`gallery-payment:${order.id}`, order.fulfilledAt, "payment", `${album.title} · Card payment received`, `${order.isFullAlbum ? "Complete gallery" : `${list(order.photoIds).length} photos`} · ${money(Number.isSafeInteger(order.expectedAmountCents) ? order.expectedAmountCents / 100 : undefined, order.currency || "AUD")}`, meta(order));
    }
    for (const [, purchase] of purchases) {
      if (!(purchase.fullAlbum || list(purchase.photoIds).length) || !purchase.paidAt) continue;
      const ids = list(purchase.stripeSessionIds).length ? purchase.stripeSessionIds : [purchase.stripeSessionId].filter(Boolean);
      if (ids.length && ids.every(id => seenPayments.has(id))) continue;
      const dedupe = ids.length ? ids.slice().sort().join(":") : `${album.id}:${purchase.paidAt}:${purchase.fullAlbum}:${list(purchase.photoIds).slice().sort().join(",")}`;
      if (seenPayments.has(dedupe)) continue;
      seenPayments.add(dedupe);
      // This entitlement is not a payment ledger: never invent an amount or repeat known payments.
      add(`legacy-purchase:${album.id}:${items.length}`, purchase.paidAt, "payment", `${album.title} · Purchased photo access`, `${purchase.fullAlbum ? "Complete gallery" : `${list(purchase.photoIds).length} photos`} · Historical payment amount not recorded`, meta(purchase));
    }
    downloads.forEach((entry, index) => add(`download:${album.id}:${index}`, entry.downloadedAt, "download", `${album.title} · Photos downloaded`, `${entry.photoCount ?? list(entry.photoIds).length} photos · ${entry.quality || "original"}${entry.skippedCount ? ` · ${entry.skippedCount} skipped` : ""}`, meta(entry)));
  }
  return items.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || a.id.localeCompare(b.id));
}

module.exports = { buildClientActivity, contactMatches };
