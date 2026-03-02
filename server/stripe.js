const stripe = require("stripe");
const { notifyPayment } = require("./discord");

let stripeClient = null;

function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient = stripe(key);
  return stripeClient;
}

function getDiscordWebhookUrl(store) {
  try {
    const settings = store.get("wv_settings");
    return settings?.discordWebhookUrl || null;
  } catch { return null; }
}

function registerRoutes(app, store, sendBookingConfirmationEmail, autoSyncBooking) {
  // ── Status ─────────────────────────────────────────
  app.get("/api/stripe/status", (_req, res) => {
    const configured = !!process.env.STRIPE_SECRET_KEY;
    res.json({ configured, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null });
  });

  // ── Create Checkout Session (booking deposit) ──────
  app.post("/api/stripe/checkout/booking", async (req, res) => {
    const s = getStripe();
    if (!s) return res.status(400).json({ error: "Stripe not configured" });
    const { bookingId, clientName, clientEmail, amount, eventTitle, modifyToken, successUrl, cancelUrl } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    const baseUrl = process.env.APP_BASE_URL || req.headers.origin || "";
    const bookingSuccessUrl = successUrl || (modifyToken
      ? `${baseUrl}/booking/modify/${modifyToken}?payment=success`
      : `${baseUrl}/booking?success=1&bookingId=${bookingId}`);
    const bookingCancelUrl = cancelUrl || (modifyToken
      ? `${baseUrl}/booking/modify/${modifyToken}?payment=cancelled`
      : `${baseUrl}/booking?cancelled=1`);
    try {
      const session = await s.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: clientEmail || undefined,
        line_items: [{
          price_data: {
            currency: "aud",
            product_data: {
              name: `${eventTitle || "Booking"}`,
              description: `Booking for ${clientName || "Client"}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: bookingSuccessUrl,
        cancel_url: bookingCancelUrl,
        metadata: { bookingId, modifyToken: modifyToken || "", type: "booking-deposit" },
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("Stripe checkout error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Create Checkout Session (album purchase) ───────
  app.post("/api/stripe/checkout/album", async (req, res) => {
    const s = getStripe();
    if (!s) return res.status(400).json({ error: "Stripe not configured" });
    const { albumId, albumTitle, photoCount, amount, clientEmail, successUrl, cancelUrl } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    try {
      const session = await s.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: clientEmail || undefined,
        line_items: [{
          price_data: {
            currency: "aud",
            product_data: {
              name: albumTitle || "Photo Album",
              description: `${photoCount || 0} photos`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: successUrl || `${req.headers.origin || ""}/gallery?success=1&albumId=${albumId}`,
        cancel_url: cancelUrl || `${req.headers.origin || ""}/gallery?cancelled=1`,
        metadata: { albumId, type: "album-purchase" },
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("Stripe checkout error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Webhook ────────────────────────────────────────
  // NOTE: For webhooks, Stripe sends raw body. Use express.raw() middleware on this route.
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const s = getStripe();
    if (!s) return res.status(400).json({ error: "Stripe not configured" });
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event;
    try {
      if (webhookSecret && sig) {
        event = s.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        // No webhook secret — parse directly (dev mode)
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).json({ error: "Webhook verification failed" });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metadata = session.metadata || {};
      console.log(`✅ Payment completed: ${metadata.type} — ${metadata.bookingId || metadata.albumId}`);
      
      // Update booking/album payment status in db.json
      const fs = require("fs");
      const path = require("path");
      const DB_FILE = path.join(process.env.DATA_DIR || "/data", "db.json");
      try {
        const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
        
        if (metadata.type === "booking-deposit" && metadata.bookingId) {
          const bookings = db.bookings ? JSON.parse(db.bookings) : [];
          const idx = bookings.findIndex(b => b.id === metadata.bookingId);
          if (idx >= 0) {
            const booking = bookings[idx];
            const totalAmt = booking.paymentAmount || 0;
            const depositAmt = booking.depositAmount || 0;
            const amountPaid = session.amount_total ? session.amount_total / 100 : 0;

            // If paying remaining balance (already deposit-paid), mark fully paid
            // If first payment equals total, mark fully paid; otherwise deposit-paid
            if (booking.paymentStatus === "deposit-paid") {
              booking.paymentStatus = "paid";
              console.log(`📝 Booking ${metadata.bookingId} remaining balance paid — Paid in Full`);
            } else if (depositAmt > 0 && amountPaid < totalAmt) {
              booking.paymentStatus = "deposit-paid";
              booking.depositPaidAt = new Date().toISOString();
              console.log(`📝 Booking ${metadata.bookingId} deposit paid`);
            } else {
              booking.paymentStatus = "paid";
              console.log(`📝 Booking ${metadata.bookingId} paid in full`);
            }

            booking.stripeSessionId = session.id;
            db.bookings = JSON.stringify(bookings);
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

            // Auto-sync to Google Calendar
            if (autoSyncBooking) {
              autoSyncBooking(booking).catch(err => console.error("Calendar sync after payment failed:", err.message));
            }

            // Send confirmation email
            if (sendBookingConfirmationEmail && booking.clientEmail) {
              const eventTypes = db["event-types"] ? JSON.parse(db["event-types"]) : [];
              const eventType = eventTypes.find(e => e.id === booking.eventTypeId) || {};
              sendBookingConfirmationEmail({
                to: booking.clientEmail,
                clientName: booking.clientName,
                eventTitle: booking.type || eventType.title || "Session",
                date: booking.date,
                time: booking.time,
                duration: booking.duration,
                location: eventType.location || "",
                price: booking.paymentAmount || 0,
                depositAmount: booking.depositAmount || 0,
                paymentMethod: "stripe",
                modifyToken: booking.modifyToken,
                bookingId: booking.id,
                appBaseUrl: process.env.APP_BASE_URL || "",
                store,
              }).catch(err => console.error("Email after Stripe payment failed:", err.message));
            }
          }
        }
        
        if (metadata.type === "album-purchase" && metadata.albumId) {
          // Mark album as fully unlocked
          const albumKey = `album_${metadata.albumId}`;
          if (db[albumKey]) {
            const album = JSON.parse(db[albumKey]);
            album.allUnlocked = true;
            album.stripePaidAt = new Date().toISOString();
            db[albumKey] = JSON.stringify(album);
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
            console.log(`📝 Album ${metadata.albumId} unlocked`);
          }
        }
      } catch (dbErr) {
        console.error("Failed to update DB after payment:", dbErr);
      }
    }

    res.json({ received: true });
  });
}

// Need express for the raw body parser
const express = require("express");

module.exports = { registerRoutes };
