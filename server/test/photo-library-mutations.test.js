const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSqliteStore } = require("../sqlite-store");
const { applyPhotoMutations } = require("../photo-library-mutations");

function fixture() {
  const photo = (id, src, title) => ({ id, src, thumbnail: `${src}?size=thumb`, title, uploadedAt: "2026-01-01T00:00:00.000Z" });
  return {
    wv_albums: JSON.stringify([
      { id: "a", slug: "alpha", title: "Alpha", photoCount: 2, coverImage: "/uploads/shared.jpg", photos: [photo("duplicate", "/uploads/shared.jpg", "From Alpha"), photo("duplicate", "/uploads/shared-2.jpg", "Repeated ID")] },
      { id: "b", slug: "beta", title: "Beta", photoCount: 1, coverImage: "/uploads/beta.jpg", photos: [photo("duplicate", "/uploads/beta.jpg", "From Beta")] },
    ]),
    wv_photo_library: JSON.stringify([photo("duplicate", "/uploads/library.jpg", "Library copy"), photo("orphan", "/uploads/orphan.jpg", "Orphan")]),
    t_cosplay_wv_photo_library: JSON.stringify([photo("tenant-ref", "/uploads/shared.jpg", "Tenant reference")]),
  };
}

function withStore(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-photo-mutation-"));
  const store = createSqliteStore({ dataDir });
  try { run(store); }
  finally { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
}

test("indexed records resolve repeated IDs using the displayed album/library context", () => withStore(store => {
  store.write(fixture());
  assert.equal(store.getPhotoRecords({ items: [{ id: "duplicate" }] })[0].title, "From Alpha");
  assert.equal(store.getPhotoRecords({ items: [{ id: "duplicate", sourceAlbumId: "b" }] })[0].title, "From Beta");
  assert.equal(store.getPhotoRecords({ items: [{ id: "duplicate", sourceType: "library" }] })[0].title, "Library copy");
  assert.equal(store.getPhotoRecords({ items: [{ id: "missing" }] })[0], null);
}));
test("targeted star, patch, append, and removal update only intended memberships and revision", () => withStore(store => {
  const initial = fixture();
  store.write(initial);
  const revision = store.queryPhotoPage({ limit: 1 }).revision;
  const db = store.read();
  const result = applyPhotoMutations(db, [
    { type: "star", photoId: "duplicate", sourceType: "album", albumId: "b", starred: true },
    { type: "patch-everywhere", photoId: "duplicate", patch: { title: "Retouched title", src: "/uploads/new-final.jpg", beforeSrc: "/uploads/original.jpg" } },
    { type: "append-library", photo: { id: "new", src: "/uploads/new.jpg", title: "New" } },
    { type: "remove", photoId: "orphan", sourceType: "library" },
  ]);
  assert.ok(result.changed >= 6);
  assert.ok(result.deletedFileCandidates.includes("/uploads/shared-2.jpg"));
  assert.ok(!result.deletedFileCandidates.includes("/uploads/shared.jpg"), "tenant reference prevents file deletion");
  store.write(db);
  assert.throws(() => store.queryPhotoPage({ limit: 1, expectedRevision: revision }), error => error.code === "PHOTO_INDEX_STALE");
  const refreshed = store.queryPhotoPage({ q: "retouched title", limit: 10 });
  assert.equal(refreshed.total, 1);
  assert.equal(refreshed.photos[0].sourceAlbumId, "a");
  assert.equal(store.getPhotoRecords({ items: [{ id: "duplicate", sourceAlbumId: "b" }] })[0].starred, true);
  assert.equal(store.queryPhotoPage({ source: "unassigned", limit: 10 }).total, 1);
  assert.equal(store.read().t_cosplay_wv_photo_library, initial.t_cosplay_wv_photo_library);
}));

test("last main membership removal reports a file candidate but a tenant reference protects it", () => withStore(store => {
  const input = fixture();
  store.write(input);
  const db = store.read();
  const result = applyPhotoMutations(db, [
    { type: "remove", photoId: "duplicate", sourceType: "album", albumId: "a" },
    { type: "remove", photoId: "duplicate", sourceType: "album", albumId: "b" },
    { type: "remove", photoId: "duplicate", sourceType: "library" },
  ]);
  assert.ok(!result.deletedFileCandidates.includes("/uploads/shared.jpg"));
  assert.ok(result.deletedFileCandidates.includes("/uploads/beta.jpg"));
  store.write(db);
  assert.equal(store.queryPhotoPage({ limit: 10 }).total, 1);
  assert.equal(store.queryPhotoPage({ source: "unassigned", limit: 10 }).total, 1);
}));
