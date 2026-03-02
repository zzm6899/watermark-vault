/**
 * Discord webhook notifications for Watermark Vault.
 * Sends rich embeds to a Discord channel on key events.
 */

/**
 * Send a notification to Discord.
 * @param {string} webhookUrl  - Discord webhook URL from settings
 * @param {Object} embed       - Discord embed object
 */
async function sendDiscordEmbed(webhookUrl, embed) {
  if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) return;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Watermark Vault",
        avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png",
        embeds: [embed],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Discord webhook failed:", res.status, text);
    }
  } catch (err) {
    console.error("Discord webhook error:", err.message);
  }
}

/**
 * Notify when a new booking is created.
 */
async function notifyNewBooking(webhookUrl, booking) {
  if (!webhookUrl) return;
  const fields = [
    { name: "Client", value: booking.clientName || "Unknown", inline: true },
    { name: "Date", value: booking.date || "—", inline: true },
    { name: "Time", value: booking.time || "—", inline: true },
    { name: "Type", value: booking.type || "—", inline: true },
    { name: "Duration", value: booking.duration ? `${booking.duration}min` : "—", inline: true },
    { name: "Status", value: booking.status || "pending", inline: true },
  ];
  if (booking.clientEmail) fields.push({ name: "Email", value: booking.clientEmail, inline: true });
  if (booking.instagramHandle) fields.push({ name: "Instagram", value: `@${booking.instagramHandle.replace("@", "")}`, inline: true });
  if (booking.paymentAmount) fields.push({ name: "Amount", value: `$${booking.paymentAmount}`, inline: true });
  if (booking.notes) fields.push({ name: "Notes", value: booking.notes.slice(0, 200), inline: false });

  await sendDiscordEmbed(webhookUrl, {
    title: "📸 New Booking",
    color: 0x7c3aed, // purple
    fields,
    footer: { text: `Booking ID: ${booking.id}` },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Notify when a payment is received.
 */
async function notifyPayment(webhookUrl, booking, paymentStatus) {
  if (!webhookUrl) return;
  const statusLabels = {
    "paid": "✅ Paid in Full",
    "deposit-paid": "💰 Deposit Paid",
    "cash": "💵 Cash Payment",
    "pending-confirmation": "🏦 Bank Transfer Pending",
  };
  const label = statusLabels[paymentStatus] || paymentStatus;
  const color = paymentStatus === "paid" ? 0x22c55e : paymentStatus === "deposit-paid" ? 0x14b8a6 : 0x3b82f6;

  await sendDiscordEmbed(webhookUrl, {
    title: `${label}`,
    color,
    fields: [
      { name: "Client", value: booking.clientName || "Unknown", inline: true },
      { name: "Date", value: booking.date || "—", inline: true },
      { name: "Amount", value: booking.paymentAmount ? `$${booking.paymentAmount}` : "—", inline: true },
      { name: "Type", value: booking.type || "—", inline: true },
    ],
    footer: { text: `Booking ID: ${booking.id}` },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Notify when a booking status changes (confirmed, cancelled, etc.)
 */
async function notifyBookingUpdate(webhookUrl, booking, oldStatus, newStatus) {
  if (!webhookUrl || oldStatus === newStatus) return;
  const statusEmoji = {
    confirmed: "✅",
    cancelled: "❌",
    completed: "🎉",
    pending: "⏳",
  };
  const color = newStatus === "confirmed" ? 0x22c55e : newStatus === "cancelled" ? 0xef4444 : newStatus === "completed" ? 0xf59e0b : 0x6b7280;

  await sendDiscordEmbed(webhookUrl, {
    title: `${statusEmoji[newStatus] || "📋"} Booking ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
    color,
    fields: [
      { name: "Client", value: booking.clientName || "Unknown", inline: true },
      { name: "Date", value: booking.date || "—", inline: true },
      { name: "Type", value: booking.type || "—", inline: true },
      { name: "Status", value: `${oldStatus} → ${newStatus}`, inline: false },
    ],
    footer: { text: `Booking ID: ${booking.id}` },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { notifyNewBooking, notifyPayment, notifyBookingUpdate, sendDiscordEmbed };
