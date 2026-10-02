const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { createSqliteStore } = require("../sqlite-store");

function makePhoto(index, prefix = "P") {
  const id = `${prefix}${String(index).padStart(4, "0")}`;
  return {
    id,
    title: `Photo ${String(index).padStart(4, "0")}`,
    src: `/uploads/${id}.jpg`,
    thumbnail: `/uploads/${id}.jpg?size=thumb`,
    uploadedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    fileSize: index % 3 === 0 ? 2_000_000 : index % 3 === 1 ? 6_000_000 : 16_000_000,
    starred: index % 3 === 0,
  };
}

function createFixture() {
  const albums = [
    { id: "alpha", title: "Alpha", clientName: "Client Alpha", photos: Array.from({ length: 500 }, (_, index) => makePhoto(index)) },
    { id: "beta", title: "Beta", clientName: "Client Beta", photos: Array.from({ length: 500 }, (_, index) => makePhoto(index + 500)) },
  ];
  const library = [...albums.flatMap(album => album.photos), ...Array.from({ length: 10 }, (_, index) => makePhoto(index, "L"))];
  return { wv_albums: JSON.stringify(albums), wv_photo_library: JSON.stringify(library), wv_settings: { timezone: "Australia/Sydney" } };
}

function withStore(name, run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `photoflow-${name}-`));
  const store = createSqliteStore({ dataDir });
  try { return run(store, dataDir); }
  finally {
    try { store.close(); } catch {}
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test("indexed pages preserve source order, dedupe all-view IDs, filters, and bounded payload size", () => withStore("photo-index-pages", (store) => {
  store.write(createFixture());
  const first = store.queryPhotoPage({ limit: 60 });
  const second = store.queryPhotoPage({ offset: 60, limit: 60, expectedRevision: first.revision });
  assert.equal(first.photos.length, 60);
  assert.equal(first.total, 1010);
  assert.equal(first.photos[0].id, "P0000");
  assert.equal(first.photos[0].source, "Alpha");
  assert.equal(first.hasMore, true);
  assert.equal(second.photos[0].id, "P0060");
  assert.equal(second.revision, first.revision);

  assert.equal(store.queryPhotoPage({ source: "library", limit: 60 }).total, 1010);
  assert.equal(store.queryPhotoPage({ source: "unassigned", limit: 60 }).total, 10);
  assert.equal(store.queryPhotoPage({ source: "album", albumId: "beta", limit: 60 }).total, 500);
  assert.equal(store.queryPhotoPage({ q: "client beta", limit: 60 }).total, 500);
  assert.equal(store.queryPhotoPage({ starred: true, limit: 60 }).total, 338);
  assert.equal(store.queryPhotoPage({ size: "small", limit: 60 }).total, 338);
  assert.equal(store.queryPhotoPage({ dateFrom: "2026-01-03", dateTo: "2026-01-03", limit: 60 }).total, 37);
  const named = store.queryPhotoPage({ sort: "name-desc", limit: 5 });
  assert.deepEqual(named.photos.map(photo => photo.title), ["Photo 0999", "Photo 0998", "Photo 0997", "Photo 0996", "Photo 0995"]);

  const completeLibraryPayloadBytes = Buffer.byteLength(store.read().wv_photo_library);
  const pagePayloadBytes = Buffer.byteLength(JSON.stringify(first));
  assert.ok(pagePayloadBytes < completeLibraryPayloadBytes, `${pagePayloadBytes} should be smaller than ${completeLibraryPayloadBytes}`);
  assert.equal(store.photoIndexStats("main").album, 1000);
  assert.equal(store.photoIndexStats("main").library, 1010);
}));

test("page reads parse only returned index rows and never parse the complete legacy photo arrays", () => withStore("photo-index-bounded-parse", store => {
  store.write(createFixture());
  const source = store.read();
  const fullAlbumJson = source.wv_albums;
  const fullLibraryJson = source.wv_photo_library;
  const originalParse = JSON.parse;
  let fullSourceParses = 0;
  let parsedPhotoRows = 0;
  JSON.parse = function countedParse(value, ...args) {
    if (value === fullAlbumJson || value === fullLibraryJson) fullSourceParses += 1;
    if (typeof value === "string" && value.startsWith("{") && value.includes("/uploads/")) parsedPhotoRows += 1;
    return Reflect.apply(originalParse, JSON, [value, ...args]);
  };
  let page;
  try { page = store.queryPhotoPage({ limit: 60 }); }
  finally { JSON.parse = originalParse; }
  assert.equal(page.photos.length, 60);
  assert.equal(fullSourceParses, 0);
  assert.equal(parsedPhotoRows, 60);
}));

test("the sidecar omits server-irrelevant baked watermark blobs without changing legacy photo rows", () => withStore("photo-index-baked-fields", store => {
  const baked = `data:image/jpeg;base64,${"x".repeat(256_000)}`;
  const photo = { id: "baked", src: "/uploads/baked.jpg", title: "Baked", thumbnailWatermarked: baked, mediumWatermarked: baked, fullWatermarked: baked };
  const albums = JSON.stringify([{ id: "album", title: "Album", photos: [photo] }]);
  const library = JSON.stringify([photo]);
  store.write({ wv_albums: albums, wv_photo_library: library });

  const page = store.queryPhotoPage({ limit: 10 });
  const selected = store.getPhotoRecords({ items: [{ id: "baked", sourceAlbumId: "album" }] })[0];
  assert.equal(page.photos[0].thumbnailWatermarked, undefined);
  assert.equal(selected.mediumWatermarked, undefined);
  assert.equal(selected.fullWatermarked, undefined);
  assert.equal(store.read().wv_albums, albums);
  assert.equal(store.read().wv_photo_library, library);
}));

test("migration omits unsupported persisted records so page totals match the API sanitizer", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-photo-index-invalid-records-"));
  const legacyFile = path.join(dataDir, "db.json");
  const source = JSON.stringify([
    { id: "supported", src: "/uploads/good.jpg", title: "Good" },
    { id: "unsupported", src: "/uploads/readme.txt", title: "Not a photo" },
    { id: "system", src: "/uploads/._thumb.jpg", title: "System file" },
    { id: "missing-src", title: "No source" },
  ]);
  fs.writeFileSync(legacyFile, JSON.stringify({ wv_albums: "[]", wv_photo_library: source }));
  const store = createSqliteStore({ dataDir, legacyFile });
  const page = store.queryPhotoPage({ limit: 10 });
  assert.equal(page.total, 1);
  assert.deepEqual(page.photos.map(item => item.id), ["supported"]);
  assert.equal(store.photoIndexMigration.skipped, 3);
  assert.equal(store.read().wv_photo_library, source, "index cleanup must not rewrite the authoritative JSON source");
  store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("photo index migration is versioned, idempotent across restart, and leaves legacy source intact", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-photo-index-restart-"));
  const legacyFile = path.join(dataDir, "db.json");
  const source = createFixture();
  fs.writeFileSync(legacyFile, JSON.stringify(source));
  const first = createSqliteStore({ dataDir, legacyFile });
  const initial = first.queryPhotoPage({ limit: 60 });
  assert.equal(first.photoIndexVersion, "2");
  assert.equal(initial.total, 1010);
  assert.equal(JSON.parse(fs.readFileSync(legacyFile, "utf8")).wv_photo_library, source.wv_photo_library);
  first.close();

  fs.writeFileSync(legacyFile, JSON.stringify({ stale: true }));
  const reopened = createSqliteStore({ dataDir, legacyFile });
  assert.equal(reopened.queryPhotoPage({ limit: 60 }).total, 1010);
  assert.deepEqual(reopened.read(), source);
  reopened.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("repeated IDs, album renames, membership deletion, and orphan counts stay index-consistent", () => withStore("photo-index-membership-lifecycle", store => {
  store.write({
    wv_albums: JSON.stringify([
      { id: "first", title: "Alpha Session", photos: [{ id: "repeat", title: "Alpha record", src: "/uploads/alpha.jpg" }] },
      { id: "second", title: "Beta Session", photos: [{ id: "repeat", title: "Beta record", src: "/uploads/beta.jpg" }] },
    ]),
    wv_photo_library: JSON.stringify([
      { id: "repeat", title: "Library duplicate", src: "/uploads/library-copy.jpg" },
      { id: "loose", title: "Loose photo", src: "/uploads/loose.jpg" },
    ]),
  });
  assert.equal(store.queryPhotoPage({ limit: 10 }).total, 2);
  assert.equal(store.queryPhotoPage({ q: "Alpha Session", limit: 10 }).photos[0].sourceAlbumId, "first");

  let db = store.read();
  const renamed = JSON.parse(db.wv_albums);
  renamed[0].title = "Renamed Session";
  db.wv_albums = JSON.stringify(renamed);
  store.write(db);
  assert.equal(store.queryPhotoPage({ q: "Alpha Session", limit: 10 }).total, 0);
  assert.equal(store.queryPhotoPage({ q: "Renamed Session", limit: 10 }).photos[0].source, "Renamed Session");

  db = store.read();
  const withoutFirst = JSON.parse(db.wv_albums);
  withoutFirst.shift();
  db.wv_albums = JSON.stringify(withoutFirst);
  store.write(db);
  assert.equal(store.queryPhotoPage({ q: "Beta record", limit: 10 }).photos[0].sourceAlbumId, "second");

  db = store.read();
  db.wv_albums = "[]";
  store.write(db);
  assert.equal(store.queryPhotoPage({ limit: 10 }).total, 2);
  assert.equal(store.queryPhotoPage({ source: "unassigned", limit: 10 }).total, 2);
  assert.equal(store.getPhotoRecords({ items: [{ id: "repeat" }] })[0].source, "Library");

  db = store.read();
  db.wv_photo_library = JSON.stringify([{ id: "loose", title: "Loose photo", src: "/uploads/loose.jpg" }]);
  store.write(db);
  assert.equal(store.queryPhotoPage({ limit: 10 }).total, 1);
  assert.equal(store.getPhotoRecords({ items: [{ id: "repeat" }] })[0], null);
}));

test("a malformed photo source rolls back both the legacy row and its index update", () => withStore("photo-index-rollback", store => {
  const source = createFixture();
  store.write(source);
  const beforeRevision = store.queryPhotoPage({ limit: 1 }).revision;
  assert.throws(() => store.write({ ...source, wv_albums: "{broken" }), SyntaxError);
  assert.deepEqual(store.read(), source);
  assert.equal(store.queryPhotoPage({ limit: 1 }).revision, beforeRevision);
  assert.equal(store.queryPhotoPage({ limit: 60 }).total, 1010);
}));

test("tenant photo rows remain isolated from the main index", () => withStore("photo-index-tenant", store => {
  const tenantAlbum = [{ id: "tenant-album", title: "Tenant", photos: [makePhoto(1, "T")] }];
  store.write({ wv_albums: "[]", wv_photo_library: "[]", t_cosplay_wv_albums: JSON.stringify(tenantAlbum), t_cosplay_wv_photo_library: "[]" });
  assert.equal(store.queryPhotoPage({ limit: 10 }).total, 0);
  assert.equal(store.queryPhotoPage({ scope: "tenant:cosplay", limit: 10 }).total, 1);
  assert.equal(store.queryPhotoPage({ scope: "tenant:cosplay", limit: 10 }).photos[0].id, "T0001");
}));

test("concurrent SQLite reader sees consistent pages while separate writers commit partial photo keys", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-photo-index-concurrent-"));
  const store = createSqliteStore({ dataDir, legacyFile: null });
  store.write(createFixture());
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { createSqliteStore } = require(workerData.modulePath);
    const store = createSqliteStore({ dataDir: workerData.dataDir, legacyFile: null });
    const db = store.read();
    const photos = JSON.parse(db.wv_photo_library);
    photos.push({ id: 'concurrent-photo', title: 'Concurrent', src: '/uploads/concurrent.jpg' });
    db.wv_photo_library = JSON.stringify(photos);
    store.writePhotoData(db, ['wv_photo_library']);
    store.close();
    parentPort.postMessage('committed');
  `, { eval: true, workerData: { dataDir, modulePath: path.join(__dirname, "..", "sqlite-store.js") } });
  const workerDone = new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", code => { if (code !== 0) reject(new Error(`photo index writer exited ${code}`)); });
  });
  const reader = async () => {
    const page = store.queryPhotoPage({ limit: 60 });
    assert.equal(page.photos.length, Math.min(page.limit, page.total));
    return page;
  };
  const mainDb = store.read();
  const mainAlbums = JSON.parse(mainDb.wv_albums);
  mainAlbums[0].title = "Concurrent Album Update";
  mainDb.wv_albums = JSON.stringify(mainAlbums);
  store.writePhotoData(mainDb, ["wv_albums"]);
  const pages = await Promise.all([reader(), reader(), workerDone, reader()]);
  assert.equal(pages[2], "committed");
  assert.equal(store.queryPhotoPage({ limit: 60 }).total, 1011);
  assert.equal(store.queryPhotoPage({ q: "Concurrent Album Update", limit: 60 }).total, 500);
  assert.equal(store.queryPhotoPage({ q: "Concurrent", limit: 60 }).total, 501);
  await worker.terminate();
  store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
