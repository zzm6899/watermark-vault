const stripe = require("stripe");

let stripeClient = null;

function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient = stripe(key);
  return stripeClient;
}

function registerRoutes(app) {
  // ── Status ─────────────────────────────────────────
  app.get("/api/stripe/status", (_req, res) => {
    const configured = !!process.env.STRIPE_SECRET_KEY;
    res.json({ configured, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null });
  });

  // ── Create Checkout Session (booking deposit) ──────
  app.post("/api/stripe/checkout/booking", async (req, res) => {
    const s = getStripe();
    if (!s) return res.status(400).json({ error: "Stripe not configured" });
    const { bookingId, clientName, clientEmail, amount, eventTitle, successUrl, cancelUrl } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    try {
      const session = await s.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: clientEmail || undefined,
        line_items: [{
          price_data: {
            currency: "aud",
            product_data: {
              name: `Deposit — ${eventTitle || "Booking"}`,
              description: `Booking for ${clientName || "Client"}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: successUrl || `${req.headers.origin || ""}/booking?success=1&bookingId=${bookingId}`,
        cancel_url: cancelUrl || `${req.headers.origin || ""}/booking?cancelled=1`,
        metadata: { bookingId, type: "booking-deposit" },
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
    const { albumId, albumTitle, photoCount, amount, clientEmail, successUrl, cancelUrl, photoIds, isFullAlbum } = req.body;
    const hasSpecificPhotos = Array.isArray(photoIds) && photoIds.length > 0;
    const productName = isFullAlbum ? (albumTitle || "Full Photo Album") : hasSpecificPhotos ? `${photoCount || photoIds.length} Photo(s) — ${albumTitle || "Gallery"}` : (albumTitle || "Photo Album");
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    try {
      const session = await s.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: clientEmail || undefined,
        line_items: [{
          price_data: {
            currency: "aud",
            product_data: {
              name: productName,
              description: `${photoCount || 0} photos`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: successUrl || `${req.headers.origin || ""}/gallery/${albumId}?success=1`,
        cancel_url: cancelUrl || `${req.headers.origin || ""}/gallery/${albumId}?cancelled=1`,
        metadata: {
          albumId,
          type: "album-purchase",
          isFullAlbum: isFullAlbum ? "true" : "false",
          photoIds: hasSpecificPhotos ? photoIds.join(",").slice(0, 490) : "",
        },
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
            bookings[idx].paymentStatus = "paid";
            bookings[idx].depositPaidAt = new Date().toISOString();
            bookings[idx].stripeSessionId = session.id;
            db.bookings = JSON.stringify(bookings);
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
            console.log(`📝 Booking ${metadata.bookingId} marked as paid`);
          }
        }
        
        if (metadata.type === "album-purchase" && metadata.albumId) {
          const albumKey = `album_${metadata.albumId}`;
          if (db[albumKey]) {
            const album = JSON.parse(db[albumKey]);
            album.stripePaidAt = new Date().toISOString();

            if (metadata.isFullAlbum === "true" || !metadata.photoIds) {
              // Full album purchase
              album.allUnlocked = true;
              console.log(`📝 Album ${metadata.albumId} fully unlocked`);
            } else {
              // Per-photo purchase — merge new IDs into paidPhotoIds
              const newIds = metadata.photoIds ? metadata.photoIds.split(",").filter(Boolean) : [];
              const existing = album.paidPhotoIds || [];
              album.paidPhotoIds = [...new Set([...existing, ...newIds])];
              console.log(`📝 Album ${metadata.albumId}: ${newIds.length} photo(s) unlocked`);
            }

            db[albumKey] = JSON.stringify(album);
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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
