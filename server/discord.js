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
  const fields = [
    { name: "👤 Client", value: booking.clientName || "Unknown", inline: true },
    { name: "📅 Session Date", value: booking.date || "—", inline: true },
    { name: "⏰ Time", value: booking.time || "—", inline: true },
    { name: "📷 Type", value: booking.type || "—", inline: true },
    { name: "⏱ Duration", value: booking.duration ? `${booking.duration} min` : "—", inline: true },
    { name: "📊 Status", value: booking.status ? `${statusEmoji(booking.status)} ${booking.status}` : "pending", inline: true },
  ];
  if (booking.paymentAmount) fields.push({ name: "💵 Price", value: `$${booking.paymentAmount}`, inline: true });
  if (booking.depositRequired && booking.depositAmount) fields.push({ name: "🏦 Deposit", value: `$${booking.depositAmount}`, inline: true });
  fields.push({ name: "💳 Payment", value: paymentLabel(booking.paymentStatus), inline: true });
  if (booking.clientEmail) fields.push({ name: "📧 Email", value: booking.clientEmail, inline: true });
  if (booking.instagramHandle) fields.push({ name: "📸 Instagram", value: `@${booking.instagramHandle.replace("@", "")}`, inline: true });
  if (booking.location) fields.push({ name: "📍 Location", value: booking.location, inline: true });
  if (booking.notes) fields.push({ name: "📝 Notes", value: booking.notes.slice(0, 300), inline: false });
  return fields;
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
      fields: [
        { name: "👤 Client", value: booking.clientName || "Unknown", inline: true },
        { name: "📅 Session", value: booking.date || "—", inline: true },
        { name: "💵 Amount", value: booking.paymentAmount ? `$${booking.paymentAmount}` : "—", inline: true },
        { name: "📷 Type", value: booking.type || "—", inline: true },
        { name: "📧 Email", value: booking.clientEmail || "—", inline: true },
      ],
      footer: { text: `Booking ID: ${booking.id} · PhotoFlow` },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ── Booking Status Change ──────────────────────────────────
async function notifyBookingUpdate(webhookUrl, booking, oldStatus, newStatus) {
  if (!webhookUrl || oldStatus === newStatus) return;
  const fields = [
    { name: "👤 Client", value: booking.clientName || "Unknown", inline: true },
    { name: "📅 Session", value: `${booking.date || "—"} at ${booking.time || "—"}`, inline: true },
    { name: "📷 Type", value: booking.type || "—", inline: true },
    { name: "🔄 Status Change", value: `${statusEmoji(oldStatus)} ${oldStatus} → ${statusEmoji(newStatus)} ${newStatus}`, inline: false },
  ];
  if (booking.paymentAmount) fields.push({ name: "💵 Price", value: `$${booking.paymentAmount}`, inline: true });
  fields.push({ name: "💳 Payment", value: paymentLabel(booking.paymentStatus), inline: true });

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
