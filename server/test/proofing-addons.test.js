const test = require("node:test");
const assert = require("node:assert/strict");
const { proofingPolicy, proofingAddonRequirements, proofingSubmission, applyAlbumPhotoRemovals, preserveGalleryServerState } = require("../gallery-workflow");
const { safeGalleryAlbumDto } = require("../security-core");

const requirement = { id: "vfx", name: "VFX", quantity: 2, mode: "required" };
const album = (requirements = [requirement]) => ({
  id: "album", proofingEnabled: true, proofingStage: "proofing",
  photos: [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "hidden", hidden: true }],
  proofingRounds: [{ roundNumber: 1, sentAt: "2026-09-18T00:00:00Z" }],
  proofingAddonRequirements: requirements,
});
const request = (addonSelections = { vfx: ["one", "two"] }) => ({
  selectedPhotoIds: ["one", "two"], addonSelections, clientNote: "",
  submissionId: "proof-addon-1234567890", roundNumber: 1, roundSentAt: "2026-09-18T00:00:00Z",
});

test("addon requirements come only from this booking's purchased extras and event rules", () => {
  const event = { extras: [
    { id: "vfx", name: "Current VFX", proofingPhotoSelection: "required", proofingInstructions: "Choose your action shots" },
    { id: "retouch", name: "Retouch", proofingPhotoSelection: "optional" },
    { id: "unbought", name: "Not purchased", proofingPhotoSelection: "required" },
    { id: "off", name: "Disabled", proofingPhotoSelection: "off" },
  ] };
  const booking = { lineItems: [
    { id: "vfx", name: "VFX", quantity: 2 },
    { id: "retouch", name: "Retouch", quantity: 1 },
    { id: "off", name: "Disabled", quantity: 1 },
    { id: "removed", name: "Removed", quantity: 1 },
  ] };
  const requirements = proofingAddonRequirements(booking, event);
  assert.deepEqual(requirements.map(({ id, quantity, mode }) => ({ id, quantity, mode })), [
    { id: "vfx", quantity: 2, mode: "required" }, { id: "retouch", quantity: 1, mode: "optional" },
  ]);
  assert.equal(requirements[0].instructions, "Choose your action shots");
  assert.deepEqual(proofingAddonRequirements({}, event), []);
  assert.deepEqual(proofingAddonRequirements(booking, {}), []);
});

test("required addons need exactly the purchased quantity of unique normal picks", () => {
  const saved = proofingSubmission(album(), request());
  assert.equal(saved.error, undefined);
  assert.deepEqual(saved.receipt.addonSelections, { vfx: ["one", "two"] });
  for (const choices of [{}, { vfx: [] }, { vfx: ["one"] }, { vfx: ["one", "one"] },
    { vfx: ["one", "three"] }, { vfx: ["one", "hidden"] }, { vfx: ["one", "missing"] },
    { vfx: ["one", "two", "three"] }, { vfx: "one" }, null, [], { vfx: [1] }]) {
    assert.equal(proofingSubmission(album(), request(choices)).status, 400, JSON.stringify(choices));
  }
  assert.equal(proofingSubmission(album(), request({ unknown: ["one"] })).status, 409);
});

test("optional addons may be skipped, while legacy proofing remains compatible", () => {
  const optional = album([{ ...requirement, mode: "optional" }]);
  for (const choices of [{}, { vfx: [] }, { vfx: ["one"] }, { vfx: ["one", "two"] }]) {
    assert.equal(proofingSubmission(optional, request(choices)).error, undefined);
  }
  assert.equal(proofingSubmission(optional, request({ vfx: ["one", "two", "three"] })).status, 400);
  const legacy = album();
  delete legacy.proofingAddonRequirements;
  const legacyRequest = request();
  delete legacyRequest.addonSelections;
  assert.equal(proofingSubmission(legacy, legacyRequest).error, undefined);
  assert.equal(proofingSubmission(legacy, request({ vfx: ["one"] })).status, 409);
});

test("addon receipts replay order-independent choices but reject changed choices", () => {
  const optional = album([{ ...requirement, mode: "optional" }]);
  const first = proofingSubmission(optional, request());
  assert.equal(proofingSubmission(first.album, request({ vfx: ["two", "one"] })).replayed, true);
  assert.equal(proofingSubmission(first.album, request({ vfx: ["one"] })).status, 409);
  assert.equal(proofingSubmission(first.album, request({})).status, 409);
});

test("public addon choices hide unavailable photos and removals clean stored choices", () => {
  const source = album();
  source.photos.push({ id: "rejected", cull: { status: "reject" } });
  source.proofingRounds[0] = { ...source.proofingRounds[0], submittedAt: "2026-09-18T01:00:00Z",
    selectedPhotoIds: ["one", "two", "hidden", "rejected", "missing"],
    addonSelections: { vfx: ["one", "hidden", "rejected", "missing"] } };
  const safe = safeGalleryAlbumDto(source, "viewer");
  assert.deepEqual(safe.proofingRounds[0].addonSelections, { vfx: ["one"] });
  assert.deepEqual(safe.proofingAddonRequirements, [requirement]);
  const removed = applyAlbumPhotoRemovals(source, ["one", "hidden"]);
  assert.deepEqual(removed.proofingRounds[0].addonSelections, { vfx: ["rejected", "missing"] });
  assert.equal(removed.proofingRounds[0].selectedPhotoIds.includes("one"), false);
});

test("gallery addon rules resolve bookings and events within the album tenant", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../index.js"), "utf8");
  const helper = source.slice(source.indexOf("function galleryProofingAddonRequirements("), source.indexOf("function publicAlbumDto("));
  const derive = vm.runInNewContext(`${helper}; galleryProofingAddonRequirements`, {
    DB_KEYS: { BOOKINGS: "wv_bookings" }, dbGet: (db, key, fallback) => db[key] || fallback,
    require: () => ({ proofingAddonRequirements, proofingPolicy }),
  });
  const booked = { id: "booking", albumId: "linked-gallery", eventTypeId: "event", lineItems: [{ id: "vfx", name: "VFX", quantity: 1 }] };
  const db = {
    wv_bookings: [{ ...booked, tenantSlug: "other" }, booked, { ...booked, tenantSlug: "tenant" }],
    wv_event_types: [{ id: "event", extras: [{ id: "vfx", proofingPhotoSelection: "optional" }] }],
    t_tenant_wv_event_types: [{ id: "event", extras: [{ id: "vfx", proofingPhotoSelection: "required" }] }],
  };
  assert.equal(derive(db, { bookingId: "booking" }, null)[0].mode, "optional");
  assert.equal(derive(db, { id: "linked-gallery" }, null)[0].mode, "optional");
  assert.equal(derive(db, { id: "linked-gallery", bookingId: "different" }, null).length, 0);
  assert.equal(derive(db, { bookingId: "booking" }, "tenant")[0].mode, "required");
  assert.equal(derive(db, { bookingId: "booking" }, "missing").length, 0);
  const resolvePolicy = vm.runInNewContext(`${helper}; galleryProofingPolicy`, {
    DB_KEYS: { BOOKINGS: "wv_bookings" }, dbGet: (db, key, fallback) => db[key] || fallback,
    require: () => ({ proofingPolicy }),
  });
  db.wv_event_types[0].proofingPhotoSelection = "off";
  db.t_tenant_wv_event_types[0].proofingPhotoSelection = "optional";
  assert.equal(resolvePolicy(db, { bookingId: "booking" }, null).proofingPhotoSelection, "off");
  assert.equal(resolvePolicy(db, { bookingId: "booking" }, "tenant").proofingPhotoSelection, "optional");
  assert.equal(resolvePolicy(db, { bookingId: "booking" }, "missing").proofingPhotoSelection, "required");
  db.t_other_wv_event_types = [{ id: "event", proofingPhotoSelection: "required", proofingInstructions: "Other tenant only" }];
  db.t_tenant_wv_event_types[0].proofingInstructions = "This tenant only";
  assert.equal(resolvePolicy(db, { bookingId: "booking" }, "other").proofingInstructions, "Other tenant only");
  assert.equal(resolvePolicy(db, { bookingId: "booking" }, "tenant").proofingInstructions, "This tenant only");
  const overridden = { ...album([]), bookingId: "booking", proofingPhotoSelection: "off", proofingInstructions: "Album override" };
  const reset = preserveGalleryServerState(overridden, { id: overridden.id, proofingPhotoSelection: null, proofingInstructions: null });
  assert.equal(reset.proofingPhotoSelection, null);
  assert.equal(reset.proofingInstructions, null);
  assert.equal(resolvePolicy(db, reset, "tenant").proofingPhotoSelection, "optional");
  assert.equal(resolvePolicy(db, reset, "tenant").proofingInstructions, "This tenant only");
  assert.deepEqual(reset.photos, overridden.photos);


});

test("explicit delegation satisfies normal and required addon choices and is retry-safe", () => {
  const payload = { ...request({}), selectedPhotoIds: [], photographerChooses: true, addonPhotographerChoices: ['vfx'] };
  const saved = proofingSubmission(album(), payload);
  assert.equal(saved.album.proofingStage, 'selections-submitted');
  assert.equal(saved.receipt.photographerChooses, true);
  assert.deepEqual(saved.receipt.addonPhotographerChoices, ['vfx']);
  assert.deepEqual(saved.receipt.selectedPhotoIds, []);
  assert.equal(proofingSubmission(saved.album, payload).replayed, true);
  assert.equal(proofingSubmission(saved.album, { ...payload, photographerChooses: false }).status, 409);
  assert.equal(proofingSubmission(saved.album, { ...payload, addonPhotographerChoices: [] }).status, 409);
  assert.equal(proofingSubmission(album(), { ...payload, addonSelections: { vfx: ['one'] } }).status, 400);
  assert.equal(proofingSubmission(album(), { ...payload, addonPhotographerChoices: ['unknown'] }).status, 409);
  assert.equal(proofingSubmission(album(), { ...payload, photographerChooses: 'yes' }).status, 400);
  const independent = proofingSubmission(album(), { ...request({}), addonPhotographerChoices: ['vfx'] });
  assert.equal(independent.receipt.photographerChooses, false);
  const preferredAddon = proofingSubmission(album(), { ...payload, addonPhotographerChoices: [], addonSelections: { vfx: ['one', 'two'] } });
  assert.deepEqual(preferredAddon.receipt.addonSelections.vfx, ['one', 'two']);
  assert.equal(proofingSubmission(album(), { ...payload, addonPhotographerChoices: [], addonSelections: { vfx: ['one', 'hidden'] } }).status, 400);
});


test("whole-album policy inherits event settings, supports overrides, and enforces selection boundaries", () => {
  const { proofingPolicy, validProofingPolicy } = require("../gallery-workflow");
  assert.equal(proofingPolicy({}).proofingPhotoSelection, "required");
  const event = { proofingPhotoSelection: "optional", proofingInstructions: "Pick favourites" };
  assert.deepEqual(proofingPolicy({}, event), event);
  assert.deepEqual(proofingPolicy({ proofingPhotoSelection: null, proofingInstructions: null }, event), event);
  assert.deepEqual(proofingPolicy({ proofingPhotoSelection: "off", proofingInstructions: "" }, event), { proofingPhotoSelection: "off", proofingInstructions: "" });
  assert.equal(validProofingPolicy({ proofingPhotoSelection: "bad" }), false);
  assert.equal(validProofingPolicy({ proofingInstructions: "x".repeat(301) }), false);
  const empty = { ...request({}), selectedPhotoIds: [] };
  assert.equal(proofingSubmission(album([]), empty).status, 400);
  for (const mode of ["off", "optional"]) {
    const source = { ...album([]), proofingPhotoSelection: mode, proofingInstructions: "Instructions" };
    assert.equal(proofingSubmission(source, empty).error, undefined);
    assert.equal(proofingSubmission(source, { ...empty, photographerChooses: true }).error, undefined);
    assert.equal(safeGalleryAlbumDto(source, "viewer").proofingPhotoSelection, mode);
    assert.equal(safeGalleryAlbumDto(source, "viewer").proofingInstructions, "Instructions");
    const withAddons = { ...album(), proofingPhotoSelection: mode };
    assert.equal(proofingSubmission(withAddons, { ...empty, addonSelections: { vfx: ["one", "two"] } }).error, undefined);
    assert.equal(proofingSubmission(withAddons, { ...empty, addonSelections: { vfx: ["one", "hidden"] } }).status, 400);
  }
  assert.equal(proofingSubmission({ ...album([]), proofingPhotoSelection: "off" }, request({})).status, 400);
  assert.equal(proofingSubmission(album([]), { ...empty, photographerChooses: true }).error, undefined);
});
