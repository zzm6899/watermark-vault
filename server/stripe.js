const stripe = require("stripe");
const rateLimit = require("express-rate-limit");

let stripeClient = null;

function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient = stripe(key);
  return stripeClient;
}

function registerRoutes(app, { writeDb } = {}) {
  const checkoutLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many checkout requests — please wait" } });
  // ── Status ─────────────────────────────────────────
  app.get("/api/stripe/status", (_req, res) => {
    const configured = !!process.env.STRIPE_SECRET_KEY;
    res.json({ configured, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null });
  });

  // ── Create Checkout Session (booking deposit) ──────
  app.post("/api/stripe/checkout/booking", checkoutLimiter, async (req, res) => {
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

  app.post("/api/stripe/checkout/album", checkoutLimiter, async (req, res) => {
    const s = getStripe();
    if (!s) return res.status(400).json({ error: "Stripe not configured" });
    const { albumId, albumTitle, photoCount, amount, clientEmail, successUrl, cancelUrl, photoIds, isFullAlbum, sessionKey } = req.body;
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
          sessionKey: sessionKey || "",
        },
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("Stripe checkout error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Create Checkout Session (invoice) ─────────────
  app.post("/api/stripe/checkout/invoice", checkoutLimiter, async (req, res) => {
    const s = getStripe();
    if (!s) return res.status(400).json({ error: "Stripe not configured" });
    const { invoiceId, invoiceNumber, clientName, clientEmail, amount, description, successUrl, cancelUrl } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    try {
      const session = await s.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: clientEmail || undefined,
        line_items: [{
          price_data: {
            currency: "aud",
            product_data: {
              name: invoiceNumber ? `Invoice ${invoiceNumber}` : "Invoice Payment",
              description: description || `Payment for ${clientName || "Client"}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: successUrl || `${req.headers.origin || ""}/invoice/${req.body.shareToken}?paid=1`,
        cancel_url: cancelUrl || `${req.headers.origin || ""}/invoice/${req.body.shareToken}`,
        metadata: { invoiceId, invoiceNumber: invoiceNumber || "", type: "invoice-payment" },
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("Stripe invoice checkout error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Webhook ────────────────────────────────────────
  // Generous rate limit for Stripe webhooks — protects file-system writes while allowing
  // burst retries from Stripe (which retries up to 3× in quick succession on failure).
  const webhookLimiter = rateLimit({ windowMs: 10_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });
  app.post("/api/stripe/webhook", webhookLimiter, express.raw({ type: "application/json" }), async (req, res) => {
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
      // Use the shared writeDb helper when available so that the in-memory DB cache is
      // invalidated immediately, ensuring subsequent reads reflect the updated payment status.
      const saveDb = writeDb || ((data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)));
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
            saveDb(db);
            console.log(`📝 Booking ${metadata.bookingId} marked as paid`);
          }
        }
        
        if (metadata.type === "album-purchase" && metadata.albumId) {
          // Read albums from wv_albums array (current format)
          const raw = db["wv_albums"];
          const albums = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
          const albumIdx = albums.findIndex(a => a.id === metadata.albumId);
          if (albumIdx >= 0) {
            const album = albums[albumIdx];
            // Record the purchase per-session so other visitors aren't affected
            const sKey = metadata.sessionKey || `stripe-${session.id}`;
            const sessionPurchases = album.sessionPurchases || {};
            if (metadata.isFullAlbum === "true" || !metadata.photoIds) {
              // Full album — unlock for this session only
              sessionPurchases[sKey] = { fullAlbum: true, photoIds: [], paidAt: new Date().toISOString(), stripeSessionId: session.id };
              album.stripePaidAt = new Date().toISOString(); // for finance view
              console.log(`📝 Album ${metadata.albumId} full album unlocked for session ${sKey}`);
            } else {
              // Per-photo — add to this session's purchased set
              const newIds = metadata.photoIds ? metadata.photoIds.split(",").filter(Boolean) : [];
              const existing = sessionPurchases[sKey]?.photoIds || [];
              sessionPurchases[sKey] = { fullAlbum: false, photoIds: [...new Set([...existing, ...newIds])], paidAt: new Date().toISOString(), stripeSessionId: session.id };
              console.log(`📝 Album ${metadata.albumId}: ${newIds.length} photo(s) unlocked for session ${sKey}`);
            }
            album.sessionPurchases = sessionPurchases;
            albums[albumIdx] = album;
            db["wv_albums"] = JSON.stringify(albums);
            saveDb(db);
          } else {
            console.warn(`Album ${metadata.albumId} not found in wv_albums`);
          }
        }

        if (metadata.type === "invoice-payment" && metadata.invoiceId) {
          const raw = db["wv_invoices"];
          const invoices = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
          const idx = invoices.findIndex(inv => inv.id === metadata.invoiceId);
          if (idx >= 0) {
            invoices[idx].status = "paid";
            invoices[idx].paidAt = new Date().toISOString();
            invoices[idx].stripeSessionId = session.id;
            db["wv_invoices"] = JSON.stringify(invoices);
            saveDb(db);
            console.log(`📝 Invoice ${metadata.invoiceId} marked as paid via Stripe`);
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
