const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createSqliteStore } = require("../sqlite-store");

test("SQLite storage imports db.json once and retains the migration source", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-sqlite-"));
  const legacyFile = path.join(dataDir, "db.json");
  fs.writeFileSync(legacyFile, JSON.stringify({ wv_bookings: "[]", wv_settings: { timezone: "Australia/Sydney" } }));
  const store = createSqliteStore({ dataDir, legacyFile });
  assert.equal(store.migratedLegacy, true);
  assert.deepEqual(store.read(), { wv_bookings: "[]", wv_settings: { timezone: "Australia/Sydney" } });
  assert.equal(fs.existsSync(legacyFile), true);
  store.close();

  fs.writeFileSync(legacyFile, JSON.stringify({ overwritten: true }));
  const reopened = createSqliteStore({ dataDir, legacyFile });
  assert.equal(reopened.migratedLegacy, false);
  assert.deepEqual(reopened.read(), { wv_bookings: "[]", wv_settings: { timezone: "Australia/Sydney" } });
  assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile, "utf8")), { wv_bookings: "[]", wv_settings: { timezone: "Australia/Sydney" } });
  reopened.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("SQLite writes replace one complete application snapshot atomically", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-sqlite-"));
  const store = createSqliteStore({ dataDir });
  store.write({ alpha: 1, nested: { value: true }, list: [1, 2] });
  assert.deepEqual(store.read(), { alpha: 1, nested: { value: true }, list: [1, 2] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8")), { alpha: 1, nested: { value: true }, list: [1, 2] });
  store.write({ alpha: 2, list: [] });
  assert.deepEqual(store.read(), { alpha: 2, list: [] });
  store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("an intentionally empty migrated store never reimports a later stale db.json", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-sqlite-empty-"));
  const legacyFile = path.join(dataDir, "db.json");
  fs.writeFileSync(legacyFile, "{}");
  const store = createSqliteStore({ dataDir, legacyFile });
  assert.equal(store.migratedLegacy, true);
  assert.deepEqual(store.read(), {});
  store.close();

  fs.writeFileSync(legacyFile, JSON.stringify({ stale: "must-not-return" }));
  const reopened = createSqliteStore({ dataDir, legacyFile });
  assert.equal(reopened.migratedLegacy, false);
  assert.deepEqual(reopened.read(), {});
  assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile, "utf8")), {});
  reopened.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("photo mutations update only changed store rows while keeping the index and rollback shadow current", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-sqlite-partial-photo-write-"));
  const store = createSqliteStore({ dataDir });
  store.write({
    wv_albums: JSON.stringify([{ id: "album", title: "Album", photos: [{ id: "p1", title: "Portrait", src: "/uploads/p1.jpg" }] }]),
    wv_photo_library: JSON.stringify([]),
    wv_settings: { timezone: "Australia/Sydney" },
    wv_bookings: JSON.stringify([{ id: "booking" }]),
  });
  const observer = new Database(store.filePath, { readonly: true });
  const rowUpdatedAt = key => observer.prepare("SELECT updated_at FROM app_store WHERE key = ?").get(key).updated_at;
  const originalTimes = Object.fromEntries(["wv_albums", "wv_photo_library", "wv_settings", "wv_bookings"].map(key => [key, rowUpdatedAt(key)]));
  const originalRevision = store.photoIndexSummary().revision;
  await new Promise(resolve => setTimeout(resolve, 5));

  const next = store.read();
  next.wv_photo_library = JSON.stringify([{ id: "p2", title: "Loose photo", src: "/uploads/p2.jpg" }]);
  assert.deepEqual(store.writePhotoData(next, ["wv_photo_library"]), ["wv_photo_library"]);

  assert.equal(rowUpdatedAt("wv_albums"), originalTimes.wv_albums);
  assert.equal(rowUpdatedAt("wv_settings"), originalTimes.wv_settings);
  assert.equal(rowUpdatedAt("wv_bookings"), originalTimes.wv_bookings);
  assert.notEqual(rowUpdatedAt("wv_photo_library"), originalTimes.wv_photo_library);
  assert.equal(store.photoIndexSummary().revision, originalRevision + 1);
  assert.equal(store.queryPhotoPage({ source: "unassigned", limit: 10 }).photos[0].id, "p2");
  const shadow = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
  assert.deepEqual(shadow, store.read());

  observer.close();
  store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("a failed photo-index startup migration rolls back its schema and can recover after metadata repair", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-photo-index-recovery-"));
  const legacyFile = path.join(dataDir, "db.json");
  const originalLibrary = JSON.stringify([{ id: "kept", src: "/uploads/kept.jpg" }]);
  fs.writeFileSync(legacyFile, JSON.stringify({ wv_albums: "{malformed", wv_photo_library: originalLibrary }));

  assert.throws(
    () => createSqliteStore({ dataDir, legacyFile }),
    error => /photo library index migration failed and was rolled back/i.test(error.message)
      && /correct or restore/i.test(error.message)
      && error.cause instanceof SyntaxError,
  );

  const database = new Database(path.join(dataDir, "photoflow.sqlite"));
  const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photo_index'").get();
  const version = database.prepare("SELECT value FROM schema_meta WHERE key='photo_index_version'").get();
  const storedAlbumSource = JSON.parse(database.prepare("SELECT value_json FROM app_store WHERE key='wv_albums'").get().value_json);
  const storedLibrarySource = JSON.parse(database.prepare("SELECT value_json FROM app_store WHERE key='wv_photo_library'").get().value_json);
  assert.equal(table, undefined, "failed DDL must be rolled back with the backfill");
  assert.equal(version, undefined, "failed migration must not publish an index version");
  assert.equal(storedAlbumSource, "{malformed");
  assert.equal(storedLibrarySource, originalLibrary);

  database.prepare("UPDATE app_store SET value_json = ? WHERE key = 'wv_albums'").run(JSON.stringify(JSON.stringify([
    { id: "repaired", title: "Recovered", photos: [{ id: "recovered-photo", src: "/uploads/recovered.jpg" }] },
  ])));
  database.close();

  const recovered = createSqliteStore({ dataDir, legacyFile });
  assert.equal(recovered.queryPhotoPage({ limit: 10 }).total, 2);
  assert.equal(recovered.photoIndexVersion, "2");
  recovered.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
