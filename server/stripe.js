const stripe = require("stripe");
const rateLimit = require("express-rate-limit");
const { notifyInvoice, notifyAlbumPurchase } = require("./discord");
const { sendInvoicePaidEmail } = require("./email");

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
          // Stripe metadata values are capped at 500 chars; leave room for the key name overhead
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
          const raw = db["wv_bookings"];
          const bookings = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
          const idx = bookings.findIndex(b => b.id === metadata.bookingId);
          if (idx >= 0) {
            bookings[idx].paymentStatus = bookings[idx].depositRequired ? "deposit-paid" : "paid";
            bookings[idx].depositPaidAt = new Date().toISOString();
            bookings[idx].stripeSessionId = session.id;
            // Auto-confirm booking now that deposit is paid (unless admin confirmation is separately required)
            if (bookings[idx].status === "pending" && !bookings[idx].requiresConfirmation) {
              bookings[idx].status = "confirmed";
            }
            db["wv_bookings"] = JSON.stringify(bookings);
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
              sessionPurchases[sKey] = { fullAlbum: true, photoIds: [], paidAt: new Date().toISOString(), stripeSessionId: session.id, purchaserEmail: session.customer_email || "" };
              album.stripePaidAt = new Date().toISOString(); // for finance view
              console.log(`📝 Album ${metadata.albumId} full album unlocked for session ${sKey}`);
            } else {
              // Per-photo — add to this session's purchased set
              const newIds = metadata.photoIds ? metadata.photoIds.split(",").filter(Boolean) : [];
              const existing = sessionPurchases[sKey]?.photoIds || [];
              sessionPurchases[sKey] = { fullAlbum: false, photoIds: [...new Set([...existing, ...newIds])], paidAt: new Date().toISOString(), stripeSessionId: session.id, purchaserEmail: session.customer_email || "" };
              console.log(`📝 Album ${metadata.albumId}: ${newIds.length} photo(s) unlocked for session ${sKey}`);
            }
            album.sessionPurchases = sessionPurchases;
            albums[albumIdx] = album;
            db["wv_albums"] = JSON.stringify(albums);
            saveDb(db);

            // Discord notification for album purchase
            try {
              const rawSettings = db["wv_settings"];
              const settings = typeof rawSettings === "string" ? JSON.parse(rawSettings) : (rawSettings || {});
              const discordUrl = settings?.discordWebhookUrl;
              if (discordUrl && settings?.discordNotifyDownloads !== false) {
                const purchaseType = metadata.isFullAlbum === "true" ? "full" : "individual";
                const purchasedPhotoIds = sessionPurchases[sKey]?.photoIds || [];
                notifyAlbumPurchase(discordUrl, album, purchaseType, (session.amount_total || 0) / 100, session.customer_email || "", purchasedPhotoIds).catch(err => console.error("Discord album-purchase notify error:", err.message));
              }
            } catch (discordErr) {
              console.error("Discord settings read error:", discordErr.message);
            }
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
            invoices[idx].emailLog = [
              ...(invoices[idx].emailLog || []),
              { sentAt: new Date().toISOString(), type: "custom", to: invoices[idx].to?.email || "", subject: "Payment Received" },
            ];
            db["wv_invoices"] = JSON.stringify(invoices);
            saveDb(db);
            console.log(`📝 Invoice ${metadata.invoiceId} marked as paid via Stripe`);

            // Discord notification
            try {
              const rawSettings = db["wv_settings"];
              const settings = typeof rawSettings === "string" ? JSON.parse(rawSettings) : (rawSettings || {});
              const discordUrl = settings?.discordWebhookUrl;
              if (discordUrl && settings?.discordNotifyInvoices !== false) {
                notifyInvoice(discordUrl, invoices[idx], "paid").catch(err => console.error("Discord invoice-paid notify error:", err.message));
              }
            } catch (discordErr) {
              console.error("Discord settings read error:", discordErr.message);
            }

            // Email confirmation to client
            try {
              const appBaseUrl = process.env.APP_BASE_URL || "";
              const shareUrl = appBaseUrl && invoices[idx].shareToken ? `${appBaseUrl}/invoice/${invoices[idx].shareToken}` : "";
              sendInvoicePaidEmail(invoices[idx], shareUrl).catch(err => console.error("Invoice paid email error:", err.message));
            } catch (emailErr) {
              console.error("Invoice paid email setup error:", emailErr.message);
            }
          }
        }

        // ── License Plan Purchase ─────────────────────────────
        if (metadata.type === "license-plan" && metadata.planId) {
          try {
            const crypto = require("crypto");
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            // Use crypto.randomInt for unbiased cryptographically secure selection
            const seg = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("");
            const newKey = `WV-${seg()}-${seg()}-${seg()}-${seg()}`;
            const KEYS_FILE = path.join(process.env.DATA_DIR || "/data", "license_keys.json");
            let keys = [];
            try { keys = JSON.parse(fs.readFileSync(KEYS_FILE, "utf-8")); } catch {}
            const durationDays = metadata.durationDays ? parseInt(metadata.durationDays) : undefined;
            const expiresAt = durationDays
              ? new Date(Date.now() + durationDays * 86400 * 1000).toISOString()
              : undefined;
            keys.push({
              key: newKey,
              issuedTo: metadata.buyerEmail || session.customer_email || "Customer",
              createdAt: new Date().toISOString(),
              ...(expiresAt ? { expiresAt } : {}),
              notes: `${metadata.planName || ""} — Stripe`,
            });
            fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));

            // Store purchase record
            const purchasesRaw = db["wv_license_purchases"];
            const purchases = purchasesRaw
              ? (typeof purchasesRaw === "string" ? JSON.parse(purchasesRaw) : (Array.isArray(purchasesRaw) ? purchasesRaw : []))
              : [];
            purchases.push({
              id: `purchase-${Date.now()}`,
              planId: metadata.planId,
              planName: metadata.planName || "",
              buyerEmail: metadata.buyerEmail || session.customer_email || "",
              buyerName: metadata.buyerName || "",
              amount: (session.amount_total || 0) / 100,
              currency: (session.currency || "aud").toUpperCase(),
              method: "stripe",
              status: "active",
              licenseKey: newKey,
              stripeSessionId: session.id,
              createdAt: new Date().toISOString(),
              ...(expiresAt ? { expiresAt } : {}),
            });
            db["wv_license_purchases"] = JSON.stringify(purchases);
            saveDb(db);
            console.log(`🔑 License key ${newKey} generated for ${metadata.buyerEmail} (plan: ${metadata.planName})`);
          } catch (keyErr) {
            console.error("Failed to generate license key after payment:", keyErr);
          }
        }
      } catch (dbErr) {
        console.error("Failed to update DB after payment:", dbErr);
      }
    }

    res.json({ received: true });
  });
}

/**
 * Create a Stripe client from per-tenant settings, falling back to the
 * superuser's environment-variable keys when the tenant has none configured.
 * Returns { client, publishableKey, currency, usingFallback }.
 * @param {object} tenantSettings - TenantSettings object
 */
function getTenantStripe(tenantSettings) {
  const key = tenantSettings?.stripeSecretKey;
  if (!key) return null;
  return stripe(key);
}

/**
 * Resolve the effective Stripe client + metadata for a tenant.
 * Falls back to the superuser's Stripe keys when the tenant hasn't
 * configured their own.
 */
function resolveTenantStripe(tenantSettings) {
  const tenantKey = tenantSettings?.stripeSecretKey;
  if (tenantKey && tenantSettings?.stripeEnabled !== false) {
    return {
      client: stripe(tenantKey),
      publishableKey: tenantSettings.stripePublishableKey || null,
      currency: (tenantSettings.stripeCurrency || "aud").toLowerCase(),
      usingFallback: false,
    };
  }
  // Fall back to superuser Stripe
  const fallbackKey = process.env.STRIPE_SECRET_KEY;
  if (fallbackKey) {
    return {
      client: stripe(fallbackKey),
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      currency: "aud",
      usingFallback: true,
    };
  }
  return null;
}

/**
 * Register per-tenant Stripe routes.
 * Tenants can take deposits/payments using their own Stripe keys.
 */
function registerTenantStripeRoutes(app, { readDb, writeDb, readTenants, readLicenseKeys, getLicKeyLimits, readEventSlotRequests, writeEventSlotRequests }) {
  const tenantCheckoutLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });

  // Status — check if a tenant has Stripe configured (or falls back to superuser)
  app.get("/api/tenant/:slug/stripe/status", tenantCheckoutLimiter, (req, res) => {
    const { slug } = req.params;
    const tenants = readTenants();
    if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
    const db = readDb();
    const raw = db[`t_${slug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const resolved = resolveTenantStripe(ts);
    res.json({
      configured: !!resolved,
      publishableKey: resolved?.publishableKey || null,
      usingFallback: resolved?.usingFallback || false,
    });
  });

  // Checkout — booking deposit using tenant Stripe keys (falls back to superuser)
  app.post("/api/tenant/:slug/stripe/checkout/booking", tenantCheckoutLimiter, async (req, res) => {
    const { slug } = req.params;
    const tenants = readTenants();
    if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
    const db = readDb();
    const raw = db[`t_${slug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const resolved = resolveTenantStripe(ts);
    if (!resolved) return res.status(400).json({ error: "Stripe not configured for this tenant" });
    const { bookingId, clientName, clientEmail, amount, eventTitle, successUrl, cancelUrl } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    try {
      const session = await resolved.client.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: clientEmail || undefined,
        line_items: [{
          price_data: {
            currency: resolved.currency,
            product_data: {
              name: `Deposit — ${eventTitle || "Booking"}`,
              description: `Booking for ${clientName || "Client"}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: successUrl || `${req.headers.origin || ""}/book/${slug}?success=1&bookingId=${bookingId}`,
        cancel_url: cancelUrl || `${req.headers.origin || ""}/book/${slug}?cancelled=1`,
        metadata: { bookingId, tenantSlug: slug, type: "tenant-booking-deposit" },
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("Tenant Stripe checkout error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Checkout — album purchase using tenant Stripe keys (falls back to superuser)
  app.post("/api/tenant/:slug/stripe/checkout/album", tenantCheckoutLimiter, async (req, res) => {
    const { slug } = req.params;
    const tenants = readTenants();
    if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
    const db = readDb();
    const raw = db[`t_${slug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const resolved = resolveTenantStripe(ts);
    if (!resolved) return res.status(400).json({ error: "Stripe not configured for this tenant" });
    const { albumId, albumTitle, photoCount, amount, clientEmail, successUrl, cancelUrl, photoIds, isFullAlbum, sessionKey } = req.body;
    const hasSpecificPhotos = Array.isArray(photoIds) && photoIds.length > 0;
    const productName = isFullAlbum ? (albumTitle || "Full Photo Album") : hasSpecificPhotos ? `${photoCount || photoIds.length} Photo(s) — ${albumTitle || "Gallery"}` : (albumTitle || "Photo Album");
    if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    try {
      const session = await resolved.client.checkout.sessions.create({
        payment_method_types: ["card"],
        customer_email: clientEmail || undefined,
        line_items: [{
          price_data: {
            currency: resolved.currency,
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
          tenantSlug: slug,
          type: "tenant-album-purchase",
          isFullAlbum: isFullAlbum ? "true" : "false",
          // Stripe metadata values are capped at 500 chars; leave room for the key name overhead
          photoIds: hasSpecificPhotos ? photoIds.join(",").slice(0, 490) : "",
          sessionKey: sessionKey || "",
        },
      });
      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("Tenant album Stripe checkout error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Checkout — extra event slot purchase using tenant Stripe keys (falls back to superuser)
  app.post("/api/tenant/:slug/stripe/checkout/event-slot", tenantCheckoutLimiter, async (req, res) => {
    const { slug } = req.params;
    const tenants = readTenants();
    const tenant = tenants.find(t => t.slug === slug);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    // Determine effective extra event price: tenant-level override takes priority
    let extraEventPrice = null;
    if (tenant.extraEventSlotRequestEnabled === true) {
      extraEventPrice = typeof tenant.extraEventPrice === "number" ? tenant.extraEventPrice : null;
    }
    if (extraEventPrice == null && tenant.licenseKey) {
      const allKeys = readLicenseKeys();
      const licKey = allKeys.find(k => k.key === tenant.licenseKey);
      if (licKey) {
        const limits = getLicKeyLimits(licKey);
        extraEventPrice = limits.extraEventPrice;
      }
    }
    if (extraEventPrice == null) return res.status(400).json({ error: "Extra event slots are not available for this tenant" });
    const db = readDb();
    const raw = db[`t_${slug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const resolved = resolveTenantStripe(ts);
    if (!resolved) return res.status(400).json({ error: "Stripe not configured for this tenant" });
    // Find the pending stripe request for this tenant
    const requests = readEventSlotRequests();
    const pendingRequest = requests.find(r => r.tenantSlug === slug && r.paymentMethod === "stripe" && r.status === "pending");
    if (!pendingRequest) return res.status(404).json({ error: "No pending Stripe event slot request found. Submit a request first." });
    try {
      const session = await resolved.client.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: resolved.currency,
            product_data: { name: "Extra Event Type Slot" },
            unit_amount: Math.round(extraEventPrice * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: req.body.successUrl || `${req.headers.origin || ""}/tenant-admin?event_slot_success=1`,
        cancel_url: req.body.cancelUrl || `${req.headers.origin || ""}/tenant-admin?event_slot_cancelled=1`,
        metadata: { tenantSlug: slug, requestId: pendingRequest.id, type: "tenant-event-slot" },
      });
      // Attach session ID to the request
      const idx = requests.findIndex(r => r.id === pendingRequest.id);
      requests[idx] = { ...requests[idx], stripeSessionId: session.id };
      writeEventSlotRequests(requests);
      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("Event slot Stripe checkout error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook — per-tenant Stripe webhook handler
  app.post("/api/tenant/:slug/stripe/webhook", tenantCheckoutLimiter, express.raw({ type: "application/json" }), async (req, res) => {
    const { slug } = req.params;
    const tenants = readTenants();
    if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
    const db = readDb();
    const raw = db[`t_${slug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const resolved = resolveTenantStripe(ts);
    if (!resolved) return res.status(400).json({ error: "Stripe not configured for this tenant" });
    const sig = req.headers["stripe-signature"];
    // Use tenant webhook secret; fall back to superuser secret when using fallback Stripe
    const webhookSecret = ts.stripeWebhookSecret || (resolved.usingFallback ? process.env.STRIPE_WEBHOOK_SECRET : null);
    let event;
    try {
      if (webhookSecret && sig) {
        event = resolved.client.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      console.error("Tenant webhook signature verification failed:", err.message);
      return res.status(400).json({ error: "Webhook verification failed" });
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metadata = session.metadata || {};
      try {
        const fs = require("fs");
        const path = require("path");
        const DB_FILE = path.join(process.env.DATA_DIR || "/data", "db.json");
        const dbData = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));

        if (metadata.type === "tenant-booking-deposit" && metadata.bookingId) {
          const bookingsRaw = dbData["wv_bookings"];
          const bookings = bookingsRaw ? (typeof bookingsRaw === "string" ? JSON.parse(bookingsRaw) : bookingsRaw) : [];
          const idx = bookings.findIndex(b => b.id === metadata.bookingId);
          if (idx >= 0) {
            bookings[idx].paymentStatus = "deposit-paid";
            bookings[idx].depositPaidAt = new Date().toISOString();
            bookings[idx].stripeSessionId = session.id;
            // Auto-confirm booking now that deposit is paid (unless admin confirmation is separately required)
            if (bookings[idx].status === "pending" && !bookings[idx].requiresConfirmation) {
              bookings[idx].status = "confirmed";
            }
            dbData["wv_bookings"] = JSON.stringify(bookings);
            fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));
            console.log(`📝 Tenant booking ${metadata.bookingId} deposit marked as paid`);
          }
        }

        if (metadata.type === "tenant-album-purchase" && metadata.albumId) {
          const albumsKey = `t_${slug}_wv_albums`;
          const albumsRaw = dbData[albumsKey];
          const albums = albumsRaw ? (typeof albumsRaw === "string" ? JSON.parse(albumsRaw) : albumsRaw) : [];
          const albumIdx = albums.findIndex(a => a.id === metadata.albumId);
          if (albumIdx >= 0) {
            const album = albums[albumIdx];
            const sKey = metadata.sessionKey || `stripe-${session.id}`;
            const sessionPurchases = album.sessionPurchases || {};
            if (metadata.isFullAlbum === "true" || !metadata.photoIds) {
              sessionPurchases[sKey] = { fullAlbum: true, photoIds: [], paidAt: new Date().toISOString(), stripeSessionId: session.id, purchaserEmail: session.customer_email || "" };
              album.stripePaidAt = new Date().toISOString();
            } else {
              const newIds = metadata.photoIds ? metadata.photoIds.split(",").filter(Boolean) : [];
              const existing = sessionPurchases[sKey]?.photoIds || [];
              sessionPurchases[sKey] = { fullAlbum: false, photoIds: [...new Set([...existing, ...newIds])], paidAt: new Date().toISOString(), stripeSessionId: session.id, purchaserEmail: session.customer_email || "" };
            }
            album.sessionPurchases = sessionPurchases;
            albums[albumIdx] = album;
            dbData[albumsKey] = JSON.stringify(albums);
            fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));
            console.log(`📝 Tenant album ${metadata.albumId} purchase processed for session ${metadata.sessionKey || session.id}`);

            // Discord notification for tenant album purchase
            try {
              const tenantSettingsRaw = dbData[`t_${slug}_wv_tenant_settings`];
              const tenantSettings = tenantSettingsRaw ? (typeof tenantSettingsRaw === "string" ? JSON.parse(tenantSettingsRaw) : tenantSettingsRaw) : {};
              const globalSettingsRaw = dbData["wv_settings"];
              const globalSettings = typeof globalSettingsRaw === "string" ? JSON.parse(globalSettingsRaw) : (globalSettingsRaw || {});
              const activeSettings = tenantSettings?.discordWebhookUrl ? tenantSettings : globalSettings;
              const discordUrl = activeSettings?.discordWebhookUrl;
              if (discordUrl && activeSettings?.discordNotifyDownloads !== false) {
                const purchaseType = metadata.isFullAlbum === "true" ? "full" : "individual";
                notifyAlbumPurchase(discordUrl, album, purchaseType, (session.amount_total || 0) / 100, session.customer_email || "").catch(err => console.error("Discord tenant album-purchase notify error:", err.message));
              }
            } catch (discordErr) {
              console.error("Discord tenant settings read error:", discordErr.message);
            }
          } else {
            console.warn(`Tenant album ${metadata.albumId} not found in ${albumsKey}`);
          }
        }
        if (metadata.type === "tenant-event-slot" && metadata.requestId) {
          try {
            const requests = readEventSlotRequests();
            const idx = requests.findIndex(r => r.id === metadata.requestId);
            if (idx >= 0 && requests[idx].status === "pending") {
              requests[idx] = { ...requests[idx], status: "paid", paidAt: new Date().toISOString(), stripeSessionId: session.id };
              writeEventSlotRequests(requests);
              console.log(`📝 Event slot request ${metadata.requestId} marked as paid — awaiting super admin confirmation`);
            }
          } catch (slotErr) {
            console.error("Failed to update event slot request after payment:", slotErr);
          }
        }
      } catch (dbErr) {
        console.error("Failed to update DB after tenant payment:", dbErr);
      }
    }
    res.json({ received: true });
  });
}

// Need express for the raw body parser
const express = require("express");

module.exports = { registerRoutes, getTenantStripe, registerTenantStripeRoutes };
