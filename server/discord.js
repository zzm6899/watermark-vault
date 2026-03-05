/**
 * Discord webhook notifications for Watermark Vault.
 * Rich embeds for all key events.
 */

const AVATAR_URL = "https://cdn.discordapp.com/embed/avatars/0.png";
const APP_URL = process.env.APP_URL || "";

async function sendDiscordEmbed(webhookUrl, payload) {
  if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) return;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Watermark Vault", avatar_url: AVATAR_URL, ...payload }),
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
      footer: { text: `Booking ID: ${booking.id} · Watermark Vault` },
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
      footer: { text: `Booking ID: ${booking.id} · Watermark Vault` },
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
      footer: { text: `Booking ID: ${booking.id} · Watermark Vault` },
      timestamp: new Date().toISOString(),
    }],
    ...(components.length ? { components } : {}),
  });
}

// ── Album Purchase ─────────────────────────────────────────
async function notifyAlbumPurchase(webhookUrl, album, purchaseType, amount, email) {
  if (!webhookUrl) return;
  const adminUrl = APP_URL ? `${APP_URL}/admin/albums` : null;
  const components = adminUrl ? [adminButton("View Albums", adminUrl)] : [];

  await sendDiscordEmbed(webhookUrl, {
    embeds: [{
      title: "💳 Album Purchase",
      color: 0x22c55e,
      fields: [
        { name: "👤 Client", value: album.clientName || "Unknown", inline: true },
        { name: "📁 Album", value: album.title || "—", inline: true },
        { name: "💵 Amount", value: `$${amount}`, inline: true },
        { name: "🛍 Type", value: purchaseType === "full" ? "Full Album" : "Individual Photos", inline: true },
        ...(email ? [{ name: "📧 Email", value: email, inline: true }] : []),
      ],
      footer: { text: `Album ID: ${album.id} · Watermark Vault` },
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
      footer: { text: `Album ID: ${album.id} · Watermark Vault` },
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
      footer: { text: "Watermark Vault · Waitlist" },
      timestamp: new Date().toISOString(),
    }],
  });
}

module.exports = {
  sendDiscordEmbed,
  notifyNewBooking,
  notifyPayment,
  notifyBookingUpdate,
  notifyAlbumPurchase,
  notifyProofingSubmission,
  notifyWaitlistNotified,
};
