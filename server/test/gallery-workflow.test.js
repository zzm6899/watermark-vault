const test = require("node:test");
const assert = require("node:assert/strict");
const { applyAlbumPhotoRemovals, dedupeAlbumPhotos, markAlbumDelivered, mergeAlbumPhotos, proofingSubmission, preserveGalleryServerState, recoverablePurchase, repairDeliveredAlbumWorkflows, stripePurchaseIdentity, updateManualAlbumStatus } = require("../gallery-workflow");

test("a stale empty editor does not erase photos added by another device", () => {
  const phonePhotos = [{ id: "phone-1", src: "/uploads/phone-1.jpg" }, { id: "phone-2", src: "/uploads/phone-2.jpg" }];
  assert.deepEqual(mergeAlbumPhotos(phonePhotos, [], { replacePhotos: true, basePhotoIds: [] }), phonePhotos);
});

test("an editor can remove photos from the snapshot it actually loaded", () => {
  const existing = [{ id: "old-1" }, { id: "old-2" }, { id: "concurrent" }];
  const incoming = [{ id: "old-2", title: "Retitled" }];
  assert.deepEqual(
    mergeAlbumPhotos(existing, incoming, { replacePhotos: true, basePhotoIds: ["old-1", "old-2"] }),
    [{ id: "old-2", title: "Retitled" }, { id: "concurrent" }],
  );
});

test("album saves collapse duplicate photo ids and sources", () => {
  assert.deepEqual(dedupeAlbumPhotos([
    { id: "one", src: "/one.jpg" },
    { id: "one", src: "/duplicate-id.jpg" },
    { id: "two", src: "/one.jpg" },
    { id: "three", src: "/three.jpg" },
  ]), [
    { id: "one", src: "/one.jpg" },
    { id: "three", src: "/three.jpg" },
  ]);
  assert.deepEqual(mergeAlbumPhotos(
    [{ id: "one", src: "/one.jpg" }, { id: "one", src: "/one.jpg" }],
    [{ id: "one", src: "/one.jpg", title: "Updated" }],
  ), [{ id: "one", src: "/one.jpg", title: "Updated" }]);
});

test("one-click delivery completes proofing and releases its temporary purchase lock", () => {
  const deliveredAt = "2026-09-10T03:30:00.000Z";
  const delivered = markAlbumDelivered({
    id: "album",
    proofingEnabled: true,
    proofingStage: "selections-submitted",
    proofingExpiresAt: "2026-09-12T00:00:00.000Z",
    purchasingDisabled: true,
    watermarkDisabled: false,
    status: "editing",
    isPublic: false,
  }, deliveredAt);

  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.proofingStage, "finals-delivered");
  assert.equal(delivered.proofingExpiresAt, undefined);
  assert.equal(delivered.purchasingDisabled, false);
  assert.equal(delivered.watermarkDisabled, true);
  assert.equal(delivered.isPublic, true);
  assert.equal(delivered.deliveredAt, deliveredAt);
});

test("startup repair advances albums delivered by an older build", () => {
  const alreadyFinal = { id: "final", status: "delivered", proofingEnabled: true, proofingStage: "finals-delivered" };
  const stale = { id: "stale", status: "delivered", deliveredAt: "2026-09-02T12:00:00.000Z", proofingEnabled: true, proofingStage: "selections-submitted", purchasingDisabled: true };
  const editing = { id: "editing", status: "editing", proofingEnabled: true, proofingStage: "selections-submitted" };
  const result = repairDeliveredAlbumWorkflows([alreadyFinal, stale, editing]);

  assert.equal(result.repaired, 1);
  assert.equal(result.albums[0], alreadyFinal);
  assert.equal(result.albums[1].proofingStage, "finals-delivered");
  assert.equal(result.albums[1].deliveredAt, stale.deliveredAt);
  assert.equal(result.albums[2], editing);
});

test("manual album status changes preserve photos and client proofing receipts", () => {
  const album = {
    id: "album",
    status: "proofing",
    proofingStage: "selections-submitted",
    proofingRevision: "receipt-1",
    proofingRounds: [{ submissionId: "receipt-1", selectedPhotoIds: ["one"] }],
    photos: [{ id: "one" }],
  };
  const result = updateManualAlbumStatus(album, { status: "editing", proofingStage: "editing" }, "2026-09-10T05:00:00.000Z");
  assert.equal(result.album.status, "editing");
  assert.equal(result.album.proofingStage, "editing");
  assert.equal(result.album.updatedAt, "2026-09-10T05:00:00.000Z");
  assert.equal(result.album.photos, album.photos);
  assert.equal(result.album.proofingRounds, album.proofingRounds);
  assert.equal(updateManualAlbumStatus(album, { status: "unknown" }).status, 400);
});
const { selectClientPortalAlbumGroups, signSession, verifySession } = require("../security-core");

function proof() { return { id: "album", proofingEnabled: true, proofingStage: "proofing",
  photos: [{ id: "one" }, { id: "two" }, { id: "hidden", hidden: true }],
  proofingRounds: [{ roundNumber: 1, sentAt: "2026-09-06T00:00:00Z" }] }; }
const request = { selectedPhotoIds: ["one"], clientNote: "Edit this please", submissionId: "proof-1234567890123456", roundNumber: 1, roundSentAt: "2026-09-06T00:00:00Z" };

test("explicit photo removals repair the album photo count, cover, and proofing picks", () => {
  const album = {
    coverImage: "/uploads/removed.jpg",
    photos: [
      { id: "removed", src: "/uploads/removed.jpg" },
      { id: "kept", src: "/uploads/kept.jpg" },
    ],
    proofingRounds: [{ roundNumber: 1, selectedPhotoIds: ["removed", "kept"] }],
  };
  const updated = applyAlbumPhotoRemovals(album, ["removed"]);
  assert.deepEqual(updated.photos.map(photo => photo.id), ["kept"]);
  assert.equal(updated.photoCount, 1);
  assert.equal(updated.coverImage, "/uploads/kept.jpg");
  assert.deepEqual(updated.proofingRounds[0].selectedPhotoIds, ["kept"]);
});

test("proofing saves a receipt and a lost-response retry returns the same submission", () => {
  const first = proofingSubmission(proof(), request);
  assert.equal(first.album.proofingStage, "selections-submitted");
  assert.equal(first.album.photos[0].starred, true);
  const retry = proofingSubmission(first.album, request);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.receipt, first.receipt);
  assert.equal(retry.album.proofingRounds.length, 1);
  assert.equal(proofingSubmission(first.album, { ...request, selectedPhotoIds: ["two"] }).status, 409);
});

test("proofing refuses empty, hidden, or stale-round selections", () => {
  assert.equal(proofingSubmission(proof(), { ...request, selectedPhotoIds: [] }).status, 400);
  assert.equal(proofingSubmission(proof(), { ...request, selectedPhotoIds: ["hidden"] }).status, 400);
  assert.equal(proofingSubmission(proof(), { ...request, roundNumber: 2 }).status, 409);
  assert.equal(proofingSubmission(proof(), { ...request, roundSentAt: "old" }).status, 409);
});

test("a stale admin save cannot erase client picks or purchases", () => {
  const stale = proof();
  const canonical = proofingSubmission(stale, request).album;
  canonical.sessionPurchases = { viewer: { photoIds: ["two"], purchaserEmail: "buyer@example.com" } };
  canonical.usedFreeDownloads = { viewer: 1 };
  const saved = preserveGalleryServerState(canonical, { ...stale, title: "New title", sessionPurchases: {}, usedFreeDownloads: {} });
  assert.equal(saved.title, "New title");
  assert.equal(saved.proofingStage, "selections-submitted");
  assert.equal(saved.photos[0].starred, true);
  assert.deepEqual(saved.proofingRounds, canonical.proofingRounds);
  assert.deepEqual(saved.sessionPurchases, canonical.sessionPurchases);
  assert.deepEqual(saved.usedFreeDownloads, canonical.usedFreeDownloads);
  const reset = preserveGalleryServerState(canonical, { ...canonical, proofingStage: "not-started", proofingRounds: [] });
  assert.equal(reset.proofingStage, "not-started");
});

test("a stale revision cannot change proofing state even when receipt history was copied", () => {
  const submitted = proofingSubmission(proof(), request).album;
  const staleSave = preserveGalleryServerState(submitted, { ...submitted, proofingRevision: "old-reference", proofingStage: "not-started", title: "Updated title" });
  assert.equal(staleSave.title, "Updated title");
  assert.equal(staleSave.proofingStage, "selections-submitted");
  assert.equal(staleSave.proofingRounds.length, 1);
  assert.equal(staleSave.proofingRevision, submitted.proofingRevision);
});

test("notification retries are scoped to their admin and preserve saved proofing rounds", () => {
  const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
  const start = source.indexOf("function retryProofingNotification(req, res)");
  const end = source.indexOf('app.post("/api/admin/proofing-notifications', start);
  const round = { submissionId: "receipt", selectedPhotoIds: ["one"] };
  let db = { wv_proofing_notifications: { receipt: { id: "receipt", albumId: "a", tenantSlug: "studio", status: "failed", attempts: 5 } }, t_studio_wv_albums: [{ id: "a", proofingRounds: [round] }] };
  let durable = false;
  const context = { readDb: () => structuredClone(db), dbGet: (data, key, fallback) => typeof data[key] === "string" ? JSON.parse(data[key]) : data[key] || fallback,
    writeDb: (value, options) => { db = value; durable = options.durable; }, proofingDeliveryRunning: false, deliverProofingNotifications: async () => {}, Date, console };
  vm.createContext(context); vm.runInContext(source.slice(start, end) + "\nthis.retry = retryProofingNotification;", context);
  const call = slug => {
    const result = { status: 200 }; const res = { status: status => { result.status = status; return res; }, json: body => { result.body = body; return res; } };
    context.retry({ params: { slug, receiptId: "receipt" } }, res); return result;
  };
  assert.equal(call(undefined).status, 404);
  assert.equal(call("different").status, 404);
  assert.equal(call("studio").status, 202);
  assert.equal(durable, true);
  assert.equal(JSON.parse(db.wv_proofing_notifications).receipt.status, "pending");
  assert.deepEqual(JSON.parse(db.t_studio_wv_albums)[0].proofingRounds, [round]);
});

test("purchase recovery unions the buyer's paid photos and isolates other email addresses", () => {
  const album = { sessionPurchases: {
    a: { purchaserEmail: "BUYER@example.com", purchaserEmailVerified: true, photoIds: ["one"] },
    b: { purchaserEmail: "buyer@example.com", purchaserEmailVerified: true, photoIds: ["two", "one"] },
    other: { purchaserEmail: "other@example.com", purchaserEmailVerified: true, fullAlbum: true },
    typed: { purchaserEmail: "buyer@example.com", fullAlbum: true },
    share: { purchaserEmail: "buyer@example.com", purchaserEmailVerified: true, fullAlbum: true, source: "share-link" },
  } };
  assert.deepEqual(recoverablePurchase(album, " buyer@example.com "), { fullAlbum: false, photoIds: ["one", "two"] });
  assert.equal(recoverablePurchase(album, "stranger@example.com"), null);
  album.sessionPurchases.b.fullAlbum = true;
  assert.equal(recoverablePurchase(album, "buyer@example.com").fullAlbum, true);
});

test("purchaser-only galleries appear in email recovery and remain tenant-scoped", () => {
  const album = { id: "paid", enabled: true, sessionPurchases: { viewer: { purchaserEmail: "buyer@example.com", purchaserEmailVerified: true, photoIds: ["one"] } } };
  const groups = selectClientPortalAlbumGroups({ email: "buyer@example.com", mainAlbums: [album], tenantAlbums: { active: [album], inactive: [album] }, activeTenantSlugs: ["active"] });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].albums[0].purchaseRecovery, true);
  assert.equal(groups[1].tenantSlug, "active");
});

test("verified Stripe fulfilment saves email from customer details or the saved checkout", () => {
  assert.equal(stripePurchaseIdentity({ customer_details: { email: "Buyer@Example.com" } }, {}).purchaserEmail, "buyer@example.com");
  assert.equal(stripePurchaseIdentity({}, { clientEmail: "buyer@example.com" }).purchaserEmailVerified, true);
  assert.equal(stripePurchaseIdentity({}, {}).purchaserEmailVerified, false);
  assert.equal(stripePurchaseIdentity({ customer_email: "other@example.com" }, {}, { purchaserEmail: "original@example.com", purchaserEmailVerified: true, photoIds: ["one"] }).purchaserEmail, "original@example.com");
});

test("recovery credentials are purpose-bound and signature protected", () => {
  const secret = "test-only-secret-at-least-32-characters-long";
  const token = signSession({ purpose: "gallery-recovery", albumId: "paid", tenantSlug: "studio", email: "buyer@example.com" }, secret, { ttlSeconds: 1800 });
  assert.equal(verifySession(token, secret, { purpose: "gallery-recovery" }).tenantSlug, "studio");
  assert.equal(verifySession(token, secret, { purpose: "gallery" }), null);
  assert.equal(verifySession(token + "tampered", secret, { purpose: "gallery-recovery" }), null);
});

const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { albumAccessWindow, safeGalleryAlbumDto } = require("../security-core");

test("the recovery route restores only the signed buyer's album and rejects wrong scope", () => {
  const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
  const start = source.indexOf('app.post("/api/public-album/:albumSlug/recover"');
  const end = source.indexOf('app.post("/api/public-album/:albumSlug/access"', start);
  let handler;
  let cookieCount = 0;
  const secret = "recovery-test-secret-at-least-32-characters";
  const db = { wv_albums: [{ id: "a", slug: "friendly", enabled: true, photos: [{ id: "one" }, { id: "two" }], sessionPurchases: {
    first: { purchaserEmail: "buyer@example.com", purchaserEmailVerified: true, photoIds: ["one"] },
    stranger: { purchaserEmail: "stranger@example.com", purchaserEmailVerified: true, fullAlbum: true },
  } }] };
  vm.runInNewContext(source.slice(start, end), {
    app: { post: (_path, _limiter, fn) => { handler = fn; } }, galleryAccessLimiter: () => {},
    verifySession, signSession, SESSION_SECRET: secret, licensedTenantBySlug: () => false, readDb: () => db,
    dbGet: (db, key, fallback) => typeof db[key] === "string" ? JSON.parse(db[key]) : db[key] || fallback,
    albumAccessWindow, galleryTimezone: () => "Australia/Sydney", recoverablePurchase,
    normalizeEmail: require("../gallery-workflow").normalizeEmail, crypto, writeDb: () => {}, GALLERY_SESSION_TTL_SECONDS: 86400,
    galleryCookieName: id => `gallery-${id}`, setHttpOnlyCookie: () => { cookieCount++; },
    publicAlbumDto: (album, session) => safeGalleryAlbumDto(album, session.sessionKey), Date,
  });
  const call = (token, slug = "friendly") => {
    let body; let status = 200;
    const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { body = value; return this; } };
    handler({ body: { recoveryToken: token }, params: { albumSlug: slug } }, res);
    return { status, body };
  };
  const token = signSession({ purpose: "gallery-recovery", albumId: "a", tenantSlug: null, email: "buyer@example.com" }, secret, { ttlSeconds: 1800 });
  assert.equal(call("typed-email-is-not-a-token").status, 401);
  assert.equal(call(token, "another-gallery").status, 404);
  const restored = call(token);
  assert.equal(restored.status, 200);
  const purchase = restored.body.album.sessionPurchases[restored.body.sessionKey];
  assert.equal(purchase.fullAlbum, false);
  assert.deepEqual([...purchase.photoIds], ["one"]);
  assert.equal(restored.body.recoveredEmail, "buyer@example.com");
  assert.equal(call(token).body.sessionKey, restored.body.sessionKey);
  assert.equal(cookieCount, 2);
  const inactiveTenant = signSession({ purpose: "gallery-recovery", albumId: "a", tenantSlug: "inactive", email: "buyer@example.com" }, secret, { ttlSeconds: 1800 });
  assert.equal(call(inactiveTenant).status, 404);
});

test("notification failure preserves picks, retries, and never overwrites newer album data", async () => {
  const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
  const start = source.indexOf("let proofingDeliveryRunning = false;");
  const end = source.indexOf("setInterval(() => { void deliverProofingNotifications()", start);
  let db = { wv_proofing_notifications: { receipt: { id: "receipt", albumId: "a", tenantSlug: null, title: "Gallery", count: 1, submittedAt: "2026-09-06T00:00:00Z", status: "pending", attempts: 0, nextAttemptAt: 0 } },
    wv_albums: [{ id: "a", title: "Original title", proofingStage: "selections-submitted", proofingRounds: [{ submissionId: "receipt", selectedPhotoIds: ["one"] }] }],
    wv_profile: { email: "photographer@example.com" } };
  let shouldFail = true;
  const context = { readDb: () => structuredClone(db), writeDb: next => { db = next; },
    dbGet: (db, key, fallback) => typeof db[key] === "string" ? JSON.parse(db[key]) : db[key] || fallback,
    DB_KEYS: { PROFILE: "wv_profile" }, normalizeEmail: require("../gallery-workflow").normalizeEmail,
    getTransporter: () => ({ sendMail: async () => {
      const albums = typeof db.wv_albums === "string" ? JSON.parse(db.wv_albums) : db.wv_albums;
      albums[0].title = "Changed while email was sending";
      db.wv_albums = JSON.stringify(albums);
      if (shouldFail) throw new Error("Simulated SMTP outage");
      return { accepted: ["photographer@example.com"] };
    } }), getFromAddress: () => "sender@example.com", buildAdminAlertEmail: () => ({ subject: "Test" }), process: { env: {} }, Date };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + "\nthis.deliver = deliverProofingNotifications;", context);
  await context.deliver();
  let outbox = JSON.parse(db.wv_proofing_notifications);
  assert.equal(outbox.receipt.status, "pending");
  assert.equal(outbox.receipt.attempts, 1);
  assert.equal(JSON.parse(db.wv_albums)[0].title, "Changed while email was sending");
  assert.equal(JSON.parse(db.wv_albums)[0].proofingStage, "selections-submitted");
  outbox.receipt.nextAttemptAt = 0;
  db.wv_proofing_notifications = JSON.stringify(outbox);
  shouldFail = false;
  await context.deliver();
  assert.equal(JSON.parse(db.wv_proofing_notifications).receipt.status, "sent");
  assert.equal(JSON.parse(db.wv_albums)[0].proofingNotifications.receipt.status, "sent");
});
