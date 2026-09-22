/**
 * Discord webhook notifications for PhotoFlow.
 * Rich embeds for all key events.
 */

const AVATAR_URL = "https://cdn.discordapp.com/embed/avatars/0.png";
const APP_URL = process.env.APP_URL || "";

async function sendDiscordEmbed(webhookUrl, payload) {
  if (!webhookUrl || !/^https:\/\/(ptb\.|canary\.)?discord\.com\/api\/webhooks\//.test(webhookUrl)) return;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "PhotoFlow", avatar_url: AVATAR_URL, ...payload }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Discord webhook failed:", res.status, text);
    }
  } catch (err) {
    console.error("Discord webhook error:", err.message);
  }
}

// ── Helpers ────────────────────────────────────────────────
const paymentLabel = (status) => ({
  paid: "✅ Paid in Full",
  "deposit-paid": "💰 Deposit Paid",
  cash: "💵 Cash",
  "pending-confirmation": "🏦 Bank Transfer Pending",
  unpaid: "⏳ Unpaid",
}[status] || status || "—");

const statusEmoji = (s) => ({ confirmed: "✅", cancelled: "❌", completed: "🎉", pending: "⏳", rescheduled: "📅" }[s] || "📋");
const statusColor = (s) => ({ confirmed: 0x22c55e, cancelled: 0xef4444, completed: 0xf59e0b, pending: 0x6b7280, rescheduled: 0x3b82f6 }[s] || 0x7c3aed);

function bookingBaseFields(booking) {
  let slot = booking.time || "—";
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time) && Number.isInteger(booking.duration) && booking.duration > 0) {
    const [hour, minute] = booking.time.split(":").map(Number);
    const end = hour * 60 + minute + booking.duration;
    slot += ` – ${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}${end >= 1440 ? ` (+${Math.floor(end / 1440)} day)` : ""}`;
  }
  const fields = [
    { name: "👤 Client", value: booking.clientName || "Unknown", inline: true },
    { name: "📅 Session Date", value: booking.date || "—", inline: true },
    { name: "⏰ Booking Slot", value: slot, inline: true },
    { name: "📷 Type", value: booking.type || "—", inline: true },
    { name: "⏱ Duration", value: booking.duration ? `${booking.duration} min` : "—", inline: true },
    { name: "📊 Status", value: booking.status ? `${statusEmoji(booking.status)} ${booking.status}` : "pending", inline: true },
  ];
  if (Number.isFinite(booking.sessionPrice)) fields.push({ name: "📷 Session Price", value: `$${booking.sessionPrice.toFixed(2)}`, inline: true });
  const extras = Array.isArray(booking.lineItems) ? booking.lineItems.filter(item => item && item.quantity > 0) : [];
  fields.push({ name: "🛍 Additional Add-ons", value: extras.length ? extras.map(item => `${item.quantity} × ${item.name} — $${Number(item.unitPrice).toFixed(2)} each / $${Number(item.total).toFixed(2)} total`).join("\n") : "None", inline: false });
  if (Number.isFinite(booking.paymentAmount)) fields.push({ name: "💵 Booking Total", value: `$${booking.paymentAmount.toFixed(2)}`, inline: true });
  if (booking.depositRequired && Number.isFinite(booking.depositAmount)) fields.push({ name: "🏦 Deposit", value: `$${booking.depositAmount.toFixed(2)}`, inline: true });
  fields.push({ name: "💳 Payment", value: paymentLabel(booking.paymentStatus), inline: true });
  if (booking.paymentReference) fields.push({ name: "🔖 Payment Reference", value: booking.paymentReference, inline: true });
  if (booking.phone) fields.push({ name: "📞 Phone", value: booking.phone, inline: true });
  if (booking.clientEmail) fields.push({ name: "📧 Email", value: booking.clientEmail, inline: true });
  if (booking.instagramHandle) fields.push({ name: "📸 Instagram", value: `@${booking.instagramHandle.replace("@", "")}`, inline: true });
  if (booking.location) fields.push({ name: "📍 Location", value: booking.location, inline: true });
  if (booking.notes) fields.push({ name: "📝 Notes", value: booking.notes.slice(0, 300), inline: false });
  // Keep even large add-on orders within Discord's field and embed limits.
  return fields.map(field => {
    const value = String(field.value);
    const limit = field.name === "🛍 Additional Add-ons" ? 1024 : 250;
    return { ...field, value: value.length > limit ? `${value.slice(0, limit - 1)}…` : value || "—" };
  });
}

function adminButton(label, url) {
  if (!url) return null;
  return {
    type: 1,
    components: [{
      type: 2, style: 5, label, url,
    }],
  };
}

// ── New Booking ────────────────────────────────────────────
async function notifyNewBooking(webhookUrl, booking) {
  if (!webhookUrl) return;
  const components = [];
  const adminUrl = APP_URL ? `${APP_URL}/admin/bookings` : null;
  if (adminUrl) components.push(adminButton("View in Admin", adminUrl));

  await sendDiscordEmbed(webhookUrl, {
    embeds: [{
      title: "📸 New Booking",
      color: 0x7c3aed,
      fields: bookingBaseFields(booking),
      footer: { text: `Booking ID: ${booking.id} · PhotoFlow` },
      timestamp: new Date().toISOString(),
    }],
    ...(components.length ? { components } : {}),
  });
}

// ── Payment Received ───────────────────────────────────────
async function notifyPayment(webhookUrl, booking, paymentStatus) {
  if (!webhookUrl) return;
  const color = paymentStatus === "paid" ? 0x22c55e : paymentStatus === "deposit-paid" ? 0x14b8a6 : 0x3b82f6;
  await sendDiscordEmbed(webhookUrl, {
    embeds: [{
      title: `💰 ${paymentLabel(paymentStatus)}`,
      color,
      fields: bookingBaseFields({ ...booking, paymentStatus }),
      footer: { text: `Booking ID: ${booking.id} · PhotoFlow` },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ── Booking Status Change ──────────────────────────────────
async function notifyBookingUpdate(webhookUrl, booking, oldStatus, newStatus) {
  if (!webhookUrl || oldStatus === newStatus) return;
  const fields = [
    ...bookingBaseFields({ ...booking, status: newStatus }),
    { name: "🔄 Status Change", value: `${statusEmoji(oldStatus)} ${oldStatus} → ${statusEmoji(newStatus)} ${newStatus}`, inline: false },
  ];

  const components = [];
  const adminUrl = APP_URL ? `${APP_URL}/admin/bookings` : null;
  if (adminUrl) components.push(adminButton("View in Admin", adminUrl));

  await sendDiscordEmbed(webhookUrl, {
    embeds: [{
      title: `${statusEmoji(newStatus)} Booking ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
      color: statusColor(newStatus),
      fields,
      footer: { text: `Booking ID: ${booking.id} · PhotoFlow` },
      timestamp: new Date().toISOString(),
    }],
    ...(components.length ? { components } : {}),
  });
}

// ── Album Purchase ─────────────────────────────────────────
async function notifyAlbumPurchase(webhookUrl, album, purchaseType, amount, email, photoIds) {
  if (!webhookUrl) return;
  const adminUrl = APP_URL ? `${APP_URL}/admin/albums` : null;
  const components = adminUrl ? [adminButton("View Albums", adminUrl)] : [];
  const purchasedCount = Array.isArray(photoIds) ? photoIds.length : 0;

  await sendDiscordEmbed(webhookUrl, {
    embeds: [{
      title: "💳 Album Purchase",
      color: 0x22c55e,
      fields: [
        { name: "👤 Client", value: album.clientName || "Unknown", inline: true },
        { name: "📁 Album", value: album.title || "—", inline: true },
        { name: "💵 Amount", value: `$${amount}`, inline: true },
        { name: "🛍 Type", value: purchaseType === "full" ? "Full Album" : "Individual Photos", inline: true },
        ...(purchasedCount > 0 ? [{ name: "🖼 Photos", value: `${purchasedCount} photo${purchasedCount !== 1 ? "s" : ""}`, inline: true }] : []),
        ...(email ? [{ name: "📧 Email", value: email, inline: true }] : []),
      ],
      footer: { text: `Album ID: ${album.id} · PhotoFlow` },
      timestamp: new Date().toISOString(),
    }],
    ...(components.length ? { components } : {}),
  });
}

// ── Proofing Picks Submitted ───────────────────────────────
async function notifyProofingSubmission(webhookUrl, album, photoCount, clientNote) {
  if (!webhookUrl) return;
  const adminUrl = APP_URL ? `${APP_URL}/admin/albums` : null;
  const components = adminUrl ? [adminButton("Review in Admin", adminUrl)] : [];

  const fields = [
    { name: "👤 Client", value: album.clientName || "Unknown", inline: true },
    { name: "📁 Album", value: album.title || "—", inline: true },
    { name: "📷 Photos Selected", value: `${photoCount}`, inline: true },
  ];
  if (clientNote) fields.push({ name: "📝 Client Note", value: clientNote.slice(0, 300), inline: false });

  await sendDiscordEmbed(webhookUrl, {
    embeds: [{
      title: "🌟 Proofing Picks Submitted",
      color: 0xf59e0b,
      fields,
      footer: { text: `Album ID: ${album.id} · PhotoFlow` },
      timestamp: new Date().toISOString(),
    }],
    ...(components.length ? { components } : {}),
  });
}

// ── New Enquiry ────────────────────────────────────────────
async function notifyNewEnquiry(webhookUrl, enquiry) {
  if (!webhookUrl) return;
  const adminUrl = APP_URL ? `${APP_URL}/admin` : null;
  const components = adminUrl ? [adminButton("View in Admin", adminUrl)] : [];

  const fields = [
    { name: "👤 Name", value: enquiry.name || "Unknown", inline: true },
    { name: "📧 Email", value: enquiry.email || "—", inline: true },
  ];
  if (enquiry.phone) fields.push({ name: "📞 Phone", value: enquiry.phone, inline: true });
  if (enquiry.eventTypeTitle) fields.push({ name: "📷 Event Type", value: enquiry.eventTypeTitle, inline: true });
  if (enquiry.preferredDate) fields.push({ name: "📅 Preferred Date", value: enquiry.preferredDate, inline: true });
  if (enquiry.preferredStartTime || enquiry.preferredEndTime) {
    const timeVal = [enquiry.preferredStartTime, enquiry.preferredEndTime].filter(Boolean).join(" – ");
    fields.push({ name: "⏰ Preferred Time", value: timeVal, inline: true });
  }
  if (enquiry.message) fields.push({ name: "📝 Message", value: enquiry.message.slice(0, 300), inline: false });

  await sendDiscordEmbed(webhookUrl, {
    embeds: [{
      title: "💬 New Enquiry",
      color: 0x6366f1,
      fields,
      footer: { text: `Enquiry ID: ${enquiry.id} · PhotoFlow` },
      timestamp: new Date().toISOString(),
    }],
    ...(components.length ? { components } : {}),
  });
}

// ── Waitlist Notified ──────────────────────────────────────
async function notifyWaitlistNotified(webhookUrl, cancelledBooking, notifiedNames) {
  if (!webhookUrl || !notifiedNames.length) return;
  await sendDiscordEmbed(webhookUrl, {
    embeds: [{
      title: "📋 Waitlist Notified",
      color: 0x3b82f6,
      description: `Cancellation of **${cancelledBooking.clientName}**'s session opened a slot.`,
      fields: [
        { name: "📅 Date", value: cancelledBooking.date || "—", inline: true },
        { name: "📷 Type", value: cancelledBooking.type || "—", inline: true },
        { name: "📬 Notified", value: notifiedNames.join(", "), inline: false },
      ],
      footer: { text: "PhotoFlow · Waitlist" },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ── Invoice Events ─────────────────────────────────────────
async function notifyInvoice(webhookUrl, invoice, eventType) {
  if (!webhookUrl) return;
  const total = (invoice.items || []).reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const disc = invoice.discount || 0;
  const taxRate = invoice.tax || 0;
  const taxAmt = (total - disc) * (taxRate / 100);
  const grandTotal = total - disc + taxAmt;

  const titles = {
    created: "🧾 Invoice Created",
    sent: "📤 Invoice Sent",
    paid: "✅ Invoice Paid",
    overdue: "⚠️ Invoice Overdue",
    cancelled: "❌ Invoice Cancelled",
    reminder: "🔔 Payment Reminder Sent",
  };
  const colors = {
    created: 0x6b7280,
    sent: 0x3b82f6,
    paid: 0x22c55e,
    overdue: 0xef4444,
    cancelled: 0x6b7280,
    reminder: 0xf59e0b,
  };

  const adminUrl = APP_URL ? `${APP_URL}/admin/invoices` : null;
  const shareUrl = APP_URL && invoice.shareToken ? `${APP_URL}/invoice/${invoice.shareToken}` : null;
  const components = [];
  if (adminUrl) components.push(adminButton("View in Admin", adminUrl));

  const fields = [
    { name: "🧾 Invoice", value: invoice.number || invoice.id, inline: true },
    { name: "👤 Client", value: invoice.to?.name || "Unknown", inline: true },
    { name: "💵 Total", value: `$${grandTotal.toFixed(2)}`, inline: true },
  ];
  if (invoice.to?.email) fields.push({ name: "📧 Email", value: invoice.to.email, inline: true });
  if (invoice.dueDate) fields.push({ name: "📅 Due", value: invoice.dueDate, inline: true });
  if (shareUrl) fields.push({ name: "🔗 Share Link", value: shareUrl, inline: false });

  await sendDiscordEmbed(webhookUrl, {
    embeds: [{
      title: titles[eventType] || `🧾 Invoice ${eventType}`,
      color: colors[eventType] || 0x7c3aed,
      fields,
      footer: { text: `Invoice ${invoice.number || invoice.id} · PhotoFlow` },
      timestamp: new Date().toISOString(),
    }],
    ...(components.length ? { components } : {}),
  });
}

module.exports = {
  sendDiscordEmbed,
  notifyNewBooking,
  notifyNewEnquiry,
  notifyPayment,
  notifyBookingUpdate,
  notifyAlbumPurchase,
  notifyProofingSubmission,
  notifyWaitlistNotified,
  notifyInvoice,
};
