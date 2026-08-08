"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyBookingArchiveState,
  albumAllowsFreeFullUnlock,
  albumAccessWindow,
  bookingAllowsCapabilityMutation,
  bookingCanBeArchived,
  bookingBlocksAvailability,
  collectUploadFileNames,
  galleryPhotoDownloadEntitlement,
  galleryShareLinkAccess,
  generateAvailableSlots,
  isExplicitNativeOrigin,
  normalizeClientPortalEmail,
  planFreePhotoClaims,
  resolveContainedPath,
  resolveUploadOwnerScope,
  safeUploadFilenameFromSrc,
  safeTenantPublicDto,
  safeGalleryAlbumDto,
  safeGalleryPurchaseDto,
  selectClientPortalAlbumGroups,
  signSession,
  validateBookingRequest,
  verifySession,
  uploadsWithoutRemainingReferences,
  uploadPreviewVariant,
  uploadBelongsToScope,
  tenantLicenseState,
  tenantSelfServiceStoreKeyAllowed,
  validateEventTypeIdentityChange,
} = require("../security-core");

const eventType = {
  id: "portrait",
  title: "Portrait",
  active: true,
  price: 200,
  durations: [60],
  bufferMinutes: 30,
  depositEnabled: true,
  depositType: "percentage",
  depositAmount: 25,
  availability: {
    recurring: [{ day: 1, startTime: "09:00", endTime: "12:00" }],
    specificDates: [],
    blockedDates: [],
  },
};

test("signed sessions are purpose-bound, tamper evident, and expire", () => {
  const secret = "test-secret-that-is-long-enough-123";
  const nowMs = Date.UTC(2026, 0, 1);
  const token = signSession({ purpose: "tenant", sub: "studio" }, secret, { nowMs, ttlSeconds: 120 });
  assert.equal(verifySession(token, secret, { nowMs: nowMs + 1000, purpose: "tenant" }).sub, "studio");
  assert.equal(verifySession(token, secret, { nowMs: nowMs + 1000, purpose: "gallery" }), null);
  assert.equal(verifySession(`${token}x`, secret, { nowMs: nowMs + 1000 }), null);
  assert.equal(verifySession(token, secret, { nowMs: nowMs + 121000 }), null);
});

test("public tenant DTO never contains credentials or licence data", () => {
  const dto = safeTenantPublicDto({
    slug: "studio",
    displayName: "Studio",
    email: "private@example.com",
    passwordHash: "secret",
    licenseKey: "WV-SECRET",
    active: true,
  });
  assert.deepEqual(dto, {
    slug: "studio",
    displayName: "Studio",
    bio: undefined,
    timezone: "Australia/Sydney",
    customDomain: undefined,
    active: true,
  });
  assert.equal("passwordHash" in dto, false);
  assert.equal("licenseKey" in dto, false);
  assert.equal("email" in dto, false);
});

test("booking validation derives price and deposit from the event type", () => {
  const result = validateBookingRequest({
    eventTypeId: "portrait",
    date: "2026-08-10",
    time: "09:00",
    duration: 60,
  }, {
    eventTypes: [eventType],
    bookings: [],
    timezone: "Australia/Sydney",
    now: new Date("2026-08-01T00:00:00Z"),
    tenantSlug: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.normalized.paymentAmount, 200);
  assert.equal(result.normalized.depositRequired, true);
  assert.equal(result.normalized.depositAmount, 50);
});

test("booking validation rejects invalid dates, past times, and buffered conflicts", () => {
  const context = {
    eventTypes: [eventType],
    timezone: "Australia/Sydney",
    now: new Date("2026-08-01T00:00:00Z"),
    tenantSlug: null,
    bookings: [{ id: "existing", date: "2026-08-10", time: "09:00", duration: 60, eventTypeId: "portrait", status: "confirmed" }],
  };
  assert.equal(validateBookingRequest({ eventTypeId: "portrait", date: "2026-02-30", time: "09:00", duration: 60 }, context).ok, false);
  assert.equal(validateBookingRequest({ eventTypeId: "portrait", date: "2026-08-10", time: "10:00", duration: 60 }, context).ok, false);
  assert.equal(validateBookingRequest({ eventTypeId: "portrait", date: "2026-08-10", time: "10:30", duration: 60 }, context).ok, true);
});

test("availability only returns future, non-conflicting starts", () => {
  const slots = generateAvailableSlots({
    eventType,
    date: "2026-08-10",
    eventTypes: [eventType],
    bookings: [{ id: "existing", date: "2026-08-10", time: "09:00", duration: 60, eventTypeId: "portrait", status: "confirmed" }],
    tenantSlug: null,
    timezone: "Australia/Sydney",
    now: new Date("2026-08-01T00:00:00Z"),
  });
  assert.deepEqual(slots, ["10:30", "10:40", "10:50", "11:00"]);
});

test("start-time intervals stay consistent across different booking durations", () => {
  const mixed = { ...eventType, durations: [20, 40], bufferMinutes: 0, slotIntervalMinutes: 10 };
  const common = { eventType: mixed, date: "2026-08-10", eventTypes: [mixed], bookings: [], tenantSlug: null, timezone: "Australia/Sydney", now: new Date("2026-08-01T00:00:00Z") };
  const twenty = generateAvailableSlots({ ...common, duration: 20 });
  const forty = generateAvailableSlots({ ...common, duration: 40 });
  assert.deepEqual(twenty.slice(0, 4), ["09:00", "09:10", "09:20", "09:30"]);
  assert.deepEqual(forty.slice(0, 4), ["09:00", "09:10", "09:20", "09:30"]);
  assert.equal(twenty.at(-1), "11:40");
  assert.equal(forty.at(-1), "11:20");
});

test("public booking validation enforces the configured start-time grid", () => {
  const gridded = { ...eventType, durations: [20], bufferMinutes: 0, slotIntervalMinutes: 10 };
  const context = { eventTypes: [gridded], bookings: [], tenantSlug: null, timezone: "Australia/Sydney", now: new Date("2026-08-01T00:00:00Z") };
  assert.equal(validateBookingRequest({ eventTypeId: gridded.id, date: "2026-08-10", time: "09:10", duration: 20 }, context).ok, true);
  assert.equal(validateBookingRequest({ eventTypeId: gridded.id, date: "2026-08-10", time: "09:07", duration: 20 }, context).ok, false);
});

test("expired unpaid checkout holds no longer block availability", () => {
  const result = validateBookingRequest({ eventTypeId: "portrait", date: "2026-08-10", time: "09:00", duration: 60 }, {
    eventTypes: [eventType],
    bookings: [{
      id: "abandoned",
      date: "2026-08-10",
      time: "09:00",
      duration: 60,
      eventTypeId: "portrait",
      status: "pending",
      paymentStatus: "unpaid",
      holdExpiresAt: "2026-08-01T00:10:00.000Z",
    }],
    tenantSlug: null,
    timezone: "Australia/Sydney",
    now: new Date("2026-08-01T01:00:00.000Z"),
  });
  assert.equal(result.ok, true);
});

test("all expired unconfirmed payment holds release availability but settled bookings remain", () => {
  const now = Date.parse("2026-08-02T00:00:00Z");
  for (const paymentStatus of [undefined, "unpaid", "pending-confirmation"]) {
    assert.equal(bookingBlocksAvailability({ status: "pending", paymentStatus, holdExpiresAt: "2026-08-01T00:00:00Z" }, now), false);
  }
  assert.equal(bookingBlocksAvailability({ status: "pending", paymentStatus: "paid", holdExpiresAt: "2026-08-01T00:00:00Z" }, now), true);
  assert.equal(bookingBlocksAvailability({ status: "confirmed", paymentStatus: "unpaid", holdExpiresAt: "2026-08-01T00:00:00Z" }, now), true);
});

test("booking archives retain audit history and cannot hide a live slot", () => {
  const now = new Date(2026, 7, 8, 12, 0, 0).getTime();
  const live = { id: "live", date: "2026-08-09", time: "10:00", duration: 60, status: "confirmed", paymentStatus: "paid" };
  const completed = { id: "done", date: "2026-08-07", time: "10:00", duration: 60, status: "completed", paymentStatus: "paid" };
  assert.equal(bookingCanBeArchived(live, now), false);
  assert.equal(bookingCanBeArchived(completed, now), true);
  const timezoneSensitive = { id: "same-day", date: "2026-08-08", time: "11:30", duration: 30, status: "confirmed", paymentStatus: "paid" };
  const boundaryNow = Date.parse("2026-08-08T02:30:00.000Z");
  assert.equal(bookingCanBeArchived(timezoneSensitive, boundaryNow, "Australia/Sydney"), true);
  assert.equal(bookingCanBeArchived(timezoneSensitive, boundaryNow, "America/Los_Angeles"), false);

  const archived = applyBookingArchiveState([live, completed], ["live", "done", "missing"], true, { nowMs: now, actor: "owner" });
  assert.deepEqual(archived.changedIds, ["done"]);
  assert.deepEqual(archived.skipped, [
    { id: "live", reason: "active-booking" },
    { id: "missing", reason: "not-found" },
  ]);
  const retained = archived.bookings.find(booking => booking.id === "done");
  assert.equal(retained.archived, true);
  assert.equal(retained.archiveHistory.at(-1).changedBy, "owner");

  const restored = applyBookingArchiveState(archived.bookings, ["done"], false, { nowMs: now + 1000, actor: "owner" });
  const activeAgain = restored.bookings.find(booking => booking.id === "done");
  assert.equal(activeAgain.archived, false);
  assert.equal(activeAgain.archivedAt, undefined);
  assert.equal(activeAgain.archiveHistory.length, 2);
  // Even a malformed/migrated archived live booking still blocks; presentation
  // state is not an availability authority.
  assert.equal(bookingBlocksAvailability({ ...live, archived: true }, now), true);
  assert.equal(bookingAllowsCapabilityMutation({ ...completed, archived: true }), false);
  assert.equal(bookingAllowsCapabilityMutation(completed), true);
});

test("tenant licences are ownership-bound, active, unrevoked, and unexpired", () => {
  const tenant = { slug: "studio", active: true, licenseKey: "WV-ONE" };
  const valid = { key: "WV-ONE", usedAt: "2026-01-01T00:00:00Z", usedBy: "studio", expiresAt: "2027-01-01T00:00:00Z" };
  assert.equal(tenantLicenseState(tenant, [valid], Date.parse("2026-08-08T00:00:00Z")).active, true);
  assert.equal(tenantLicenseState(tenant, [{ ...valid, usedBy: "other" }], Date.parse("2026-08-08T00:00:00Z")).reason, "license-unclaimed");
  assert.equal(tenantLicenseState(tenant, [{ ...valid, revokedAt: "2026-08-01T00:00:00Z" }], Date.parse("2026-08-08T00:00:00Z")).reason, "license-revoked");
  assert.equal(tenantLicenseState(tenant, [{ ...valid, expiresAt: "2026-08-01T00:00:00Z" }], Date.parse("2026-08-08T00:00:00Z")).reason, "license-expired");
  assert.equal(tenantLicenseState(tenant, [{ ...valid, expiresAt: "not-a-date" }], Date.parse("2026-08-08T00:00:00Z")).reason, "license-invalid");
});

test("tenant generic store cannot read or overwrite credential-bearing settings", () => {
  assert.equal(tenantSelfServiceStoreKeyAllowed("wv_event_types"), true);
  assert.equal(tenantSelfServiceStoreKeyAllowed("wv_tenant_settings"), false);
  assert.equal(tenantSelfServiceStoreKeyAllowed("wv_gcal_tokens"), false);
  assert.equal(tenantSelfServiceStoreKeyAllowed("wv_upload_owners"), false);
});

test("event type lifetime limits count replaced stable ids and reject duplicate or missing ids", () => {
  assert.deepEqual(validateEventTypeIdentityChange([{ id: "old" }], [{ id: "replacement" }]), { ok: true, introducedIds: ["replacement"] });
  assert.equal(validateEventTypeIdentityChange([], [{ id: "same" }, { id: "same" }]).ok, false);
  assert.equal(validateEventTypeIdentityChange([], [{ title: "Missing" }]).ok, false);
});

test("tenant cleanup only selects uploads with no references left elsewhere", () => {
  const candidates = collectUploadFileNames({
    albums: [{ coverImage: "/uploads/tenant-cover.jpg?size=thumb", photos: [{ src: "/uploads/shared.jpg" }] }],
    library: [{ src: "/uploads/tenant-only.jpg" }],
  });
  assert.deepEqual([...candidates].sort(), ["shared.jpg", "tenant-cover.jpg", "tenant-only.jpg"]);
  const removable = uploadsWithoutRemainingReferences(candidates, {
    mainAlbums: [{ photos: [{ src: "/uploads/shared.jpg" }] }],
  });
  assert.deepEqual(removable.sort(), ["tenant-cover.jpg", "tenant-only.jpg"]);
});

test("gallery DTO exposes only the current session and redacts canonical secrets", () => {
  const dto = safeGalleryAlbumDto({
    id: "album-1",
    sentinelAlbumSecret: "must-not-leak",
    accessCode: "1234",
    clientToken: "secret-token",
    clientEmail: "private@example.com",
    downloadHistory: [{ sessionKey: "other" }],
    downloadRequests: [{ sessionKey: "other" }],
    sessionPurchases: {
      current: { fullAlbum: true, stripeSessionId: "cs_secret", purchaserEmail: "buyer@example.com", sentinelPurchaseSecret: "must-not-leak" },
      other: { fullAlbum: true, purchaserEmail: "other@example.com" },
    },
    usedFreeDownloads: { current: 1, other: 9 },
    proofingRounds: [{ roundNumber: 2, adminNote: "Please choose again", clientNote: "private", selectedPhotoIds: ["hidden"] }],
    photos: [
      { id: "visible", src: "/uploads/a.jpg", thumbnailWatermarked: "data:secret", beforeSrc: "/uploads/original.jpg", comments: [{ authorEmail: "private@example.com" }], sentinelPhotoSecret: "must-not-leak" },
      { id: "hidden", hidden: true, src: "/uploads/b.jpg" },
    ],
  }, "current");
  assert.equal(dto.accessCode, undefined);
  assert.equal(dto.clientToken, undefined);
  assert.equal(dto.clientEmail, undefined);
  assert.equal(dto.downloadHistory, undefined);
  assert.equal(dto.sentinelAlbumSecret, undefined);
  assert.deepEqual(Object.keys(dto.sessionPurchases), ["current"]);
  assert.equal(dto.sessionPurchases.current.stripeSessionId, undefined);
  assert.equal(dto.sessionPurchases.current.purchaserEmail, undefined);
  assert.equal(dto.sessionPurchases.current.sentinelPurchaseSecret, undefined);
  assert.deepEqual(dto.usedFreeDownloads, { current: 1 });
  assert.deepEqual(dto.proofingRounds, [{ roundNumber: 2, adminNote: "Please choose again" }]);
  assert.deepEqual(dto.photos.map(photo => photo.id), ["visible"]);
  assert.equal(dto.photos[0].thumbnailWatermarked, undefined);
  assert.equal(dto.photos[0].beforeSrc, undefined);
  assert.equal(dto.photos[0].comments, undefined);
  assert.equal(dto.photos[0].sentinelPhotoSecret, undefined);
  assert.deepEqual(safeGalleryPurchaseDto({ fullAlbum: true, photoIds: ["a"], stripeSessionId: "secret", sentinel: "secret" }), {
    fullAlbum: true,
    photoIds: ["a"],
    paidAt: undefined,
    method: undefined,
  });
});

test("direct original authorization consumes free quota before bytes and remains idempotent", () => {
  const first = planFreePhotoClaims({ requestedPhotoIds: ["photo-a"], alreadyClaimedPhotoIds: [], nonQuotaPhotoIds: [], quota: 1, used: 0 });
  assert.equal(first.ok, true);
  assert.deepEqual(first.claimedPhotoIds, ["photo-a"]);
  assert.equal(first.used, 1);
  const repeat = planFreePhotoClaims({ requestedPhotoIds: ["photo-a"], alreadyClaimedPhotoIds: first.claimedPhotoIds, nonQuotaPhotoIds: [], quota: 1, used: first.used });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.used, 1);
  const bypass = planFreePhotoClaims({ requestedPhotoIds: ["photo-b"], alreadyClaimedPhotoIds: first.claimedPhotoIds, nonQuotaPhotoIds: [], quota: 1, used: first.used });
  assert.equal(bypass.ok, false);
});

test("multi-file ZIP authorization reserves the whole free batch atomically", () => {
  const denied = planFreePhotoClaims({ requestedPhotoIds: ["a", "b", "c"], alreadyClaimedPhotoIds: [], nonQuotaPhotoIds: [], quota: 2, used: 0 });
  assert.equal(denied.ok, false);
  assert.deepEqual(denied.claimedPhotoIds, []);
  const allowed = planFreePhotoClaims({ requestedPhotoIds: ["a", "b"], alreadyClaimedPhotoIds: [], nonQuotaPhotoIds: [], quota: 2, used: 0 });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.claimedPhotoIds, ["a", "b"]);
  assert.equal(allowed.remaining, 0);
});

test("gallery download entitlement honors admin grants and rejects hidden or expired photos", () => {
  const photo = { id: "a" };
  assert.deepEqual(galleryPhotoDownloadEntitlement({ album: { allUnlocked: true }, photo, sessionKey: "s" }), {
    accessible: true, clean: true, reason: "album-unlock", photoId: "a",
  });
  assert.equal(galleryPhotoDownloadEntitlement({ album: { paidPhotoIds: ["a"] }, photo, sessionKey: "s" }).clean, true);
  assert.equal(galleryPhotoDownloadEntitlement({ album: { allUnlocked: true }, photo: { id: "a", hidden: true }, sessionKey: "s" }).accessible, false);
  assert.equal(galleryPhotoDownloadEntitlement({ album: { allUnlocked: true, enabled: false }, photo, sessionKey: "s" }).reason, "gallery-disabled");
  assert.equal(galleryPhotoDownloadEntitlement({ album: { allUnlocked: true, showCullRejectsToClient: false }, photo: { id: "a", cull: { status: "reject" } }, sessionKey: "s" }).accessible, false);
  assert.equal(galleryPhotoDownloadEntitlement({ album: { allUnlocked: true, downloadExpiresAt: "2026-08-07T00:00:00Z" }, photo, sessionKey: "s", nowMs: Date.parse("2026-08-08T00:00:00Z") }).accessible, false);
});

test("free full-album unlock requires an explicit finite zero price and enabled purchasing", () => {
  assert.equal(albumAllowsFreeFullUnlock({ priceFullAlbum: 0 }), true);
  assert.equal(albumAllowsFreeFullUnlock({}), false);
  assert.equal(albumAllowsFreeFullUnlock({ priceFullAlbum: null }), false);
  assert.equal(albumAllowsFreeFullUnlock({ priceFullAlbum: "0" }), false);
  assert.equal(albumAllowsFreeFullUnlock({ priceFullAlbum: 0, purchasingDisabled: true }), false);
});

test("date-only gallery expiry lasts through the stated local day", () => {
  assert.equal(albumAccessWindow({ expiresAt: "2026-08-08" }, Date.parse("2026-08-08T13:59:59.000Z"), "Australia/Sydney").galleryExpired, false);
  assert.equal(albumAccessWindow({ expiresAt: "2026-08-08" }, Date.parse("2026-08-08T14:00:00.000Z"), "Australia/Sydney").galleryExpired, true);
  const boundary = Date.parse("2026-08-08T12:30:00.000Z");
  assert.equal(albumAccessWindow({ expiresAt: "2026-08-08" }, boundary, "Pacific/Auckland").galleryExpired, true);
  assert.equal(albumAccessWindow({ expiresAt: "2026-08-08" }, boundary, "Australia/Sydney").galleryExpired, false);
  assert.equal(safeGalleryAlbumDto({ id: "a", expiresAt: "2026-08-08", photos: [] }, "session", "Pacific/Auckland").expiresAt, "2026-08-08T11:59:59.999Z");
});

test("native cookie mode and upload watermark scope require explicit canonical ownership", () => {
  assert.equal(isExplicitNativeOrigin("capacitor://localhost/", ["capacitor://localhost"]), true);
  assert.equal(isExplicitNativeOrigin("https://evil.example", ["capacitor://localhost"]), false);
  assert.deepEqual(resolveUploadOwnerScope({ tenantSlug: "studio" }, ["t_other_wv_albums"]), { ok: true, tenantSlug: "studio" });
  assert.deepEqual(resolveUploadOwnerScope(null, ["t_studio_wv_albums"]), { ok: true, tenantSlug: "studio" });
  assert.deepEqual(resolveUploadOwnerScope(null, ["t_studio_wv_albums", "t_other_wv_albums"]), { ok: false, tenantSlug: null });
});

test("client portal matching is email-normalized, expiry-aware, tenant-active, scoped, and deduplicated", () => {
  assert.equal(normalizeClientPortalEmail(" Client@Example.COM "), "client@example.com");
  assert.equal(normalizeClientPortalEmail("not-an-email"), "");
  const groups = selectClientPortalAlbumGroups({
    email: "CLIENT@example.com",
    nowMs: Date.parse("2026-08-08T00:00:00.000Z"),
    activeTenantSlugs: ["active"],
    timezones: { "": "Australia/Sydney", active: "Australia/Sydney", inactive: "Australia/Sydney" },
    bookings: [
      { id: "main-booking", clientEmail: "client@example.com" },
      { id: "tenant-booking", tenantSlug: "active", clientEmail: "client@example.com" },
      { id: "collision", clientEmail: "client@example.com" },
    ],
    mainAlbums: [
      { id: "main", slug: "main", title: "Main", bookingId: "main-booking", enabled: true },
      { id: "expired", clientEmail: "client@example.com", expiresAt: "2026-08-01", enabled: true },
      { id: "disabled", clientEmail: "client@example.com", enabled: false },
      { id: "main", slug: "main", clientEmail: "client@example.com", enabled: true },
    ],
    tenantAlbums: {
      active: [
        { id: "tenant", slug: "tenant", title: "Tenant", bookingId: "tenant-booking", enabled: true },
        { id: "wrong-scope", bookingId: "collision", enabled: true },
      ],
      inactive: [{ id: "inactive", clientEmail: "client@example.com", enabled: true }],
    },
  });
  assert.deepEqual(groups, [
    { tenantSlug: null, albums: [{ id: "main", slug: "main", title: "Main", clientToken: undefined }] },
    { tenantSlug: "active", albums: [{ id: "tenant", slug: "tenant", title: "Tenant", clientToken: undefined }] },
  ]);
});

test("upload preview variants cannot traverse cache paths or collide with protected full renders", () => {
  assert.deepEqual(uploadPreviewVariant("../../full", false), { sizeLabel: "medium", targetWidth: 1400 });
  assert.deepEqual(uploadPreviewVariant(undefined, false), { sizeLabel: "medium", targetWidth: 1400 });
  assert.deepEqual(uploadPreviewVariant("thumb", false), { sizeLabel: "thumb", targetWidth: 700 });
  assert.deepEqual(uploadPreviewVariant(undefined, true), { sizeLabel: "full", targetWidth: null });
  const root = process.platform === "win32" ? "C:\\cache" : "/cache";
  assert.equal(resolveContainedPath(root, "../secret.jpg"), null);
  assert.match(resolveContainedPath(root, "photo_medium_wm.jpg"), /photo_medium_wm\.jpg$/);
  assert.equal(safeUploadFilenameFromSrc("/uploads/photo.jpg?size=thumb"), "photo.jpg");
  assert.equal(safeUploadFilenameFromSrc("..\\db.json"), "");
  assert.equal(safeUploadFilenameFromSrc("/uploads/%2e%2e%2fsecret.jpg"), "");
  assert.equal(safeUploadFilenameFromSrc("/uploads/not-an-image.txt"), "");
});

test("upload ownership cannot be rebound across album tenants", () => {
  assert.equal(uploadBelongsToScope({ tenantSlug: "studio-a" }, ["t_studio-b_wv_albums"], "studio-b"), false);
  assert.equal(uploadBelongsToScope({ tenantSlug: "studio-a" }, ["t_studio-a_wv_albums"], "studio-a"), true);
  assert.equal(uploadBelongsToScope({ admin: true }, ["wv_albums"], null), true);
  assert.equal(uploadBelongsToScope(null, ["t_studio-a_wv_albums", "t_studio-b_wv_albums"], "studio-a"), false);
});

test("gallery share sessions are revocable and cannot retain download access", () => {
  const album = { enabled: true, shareLinks: [{ id: "active", allowDownload: true }, { id: "view", allowDownload: false }, { id: "expired", allowDownload: true, expiresAt: "2026-08-01" }] };
  const now = Date.parse("2026-08-08T00:00:00Z");
  assert.deepEqual(galleryShareLinkAccess(album, "active", now), { active: true, allowDownload: true });
  assert.deepEqual(galleryShareLinkAccess(album, "view", now), { active: true, allowDownload: false });
  assert.deepEqual(galleryShareLinkAccess(album, "expired", now), { active: false, allowDownload: false });
  assert.deepEqual(galleryShareLinkAccess(album, "deleted", now), { active: false, allowDownload: false });
});
