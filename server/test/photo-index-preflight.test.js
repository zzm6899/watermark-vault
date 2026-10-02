const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createSqliteStore } = require("../sqlite-store");
const { preflightPhotoIndex } = require("../photo-index-preflight");

test("preflight measures an indexed-migration copy and leaves the supplied data directory byte-identical", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-photo-preflight-source-"));
  const store = createSqliteStore({ dataDir });
  store.write({
    wv_albums: JSON.stringify([{ id: "album", title: "Fixture", photos: [{ id: "p1", src: "/uploads/p1.jpg" }] }]),
    wv_photo_library: JSON.stringify([{ id: "p1", src: "/uploads/p1.jpg" }, { id: "p2", src: "/uploads/p2.jpg" }]),
    wv_settings: { timezone: "Australia/Sydney" },
  });
  store.close();

  const source = new Database(path.join(dataDir, "photoflow.sqlite"));
  source.exec("DROP TABLE photo_index");
  source.prepare("DELETE FROM schema_meta WHERE key LIKE 'photo_index_%'").run();
  source.close();
  const beforeDb = fs.readFileSync(path.join(dataDir, "photoflow.sqlite"));
  const beforeShadow = fs.readFileSync(path.join(dataDir, "db.json"));

  const result = await preflightPhotoIndex(dataDir);

  assert.equal(result.result, "ok");
  assert.equal(result.source_was_modified, false);
  assert.equal(result.migration.migrated, true);
  assert.equal(result.photo_index_version, "2");
  assert.equal(result.indexed_photo_counts.all, 2);
  assert.ok(result.first_page_response_bytes > 0);
  assert.ok(result.store_startup_ms >= 0);
  assert.ok(result.photo_index_migration_transaction_ms >= 0);
  assert.ok(result.sqlite_growth_bytes >= 0);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, "photoflow.sqlite")), beforeDb);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, "db.json")), beforeShadow);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("preflight reports page payload, source JSON, row counts, and growth for a 1,010-photo fixture", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-photo-preflight-large-"));
  const database = new Database(path.join(dataDir, "photoflow.sqlite"));
  database.exec(`
    CREATE TABLE app_store(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  `);
  const photo = (index, prefix = "P") => {
    const id = `${prefix}${String(index).padStart(4, "0")}`;
    return { id, title: `Photo ${String(index).padStart(4, "0")}`, src: `/uploads/${id}.jpg`, thumbnail: `/uploads/${id}.jpg?size=thumb`, fileSize: index % 3 ? 6_000_000 : 2_000_000 };
  };
  const albums = [
    { id: "alpha", title: "Alpha", clientName: "Client Alpha", photos: Array.from({ length: 500 }, (_, index) => photo(index)) },
    { id: "beta", title: "Beta", clientName: "Client Beta", photos: Array.from({ length: 500 }, (_, index) => photo(index + 500)) },
  ];
  const library = [...albums.flatMap(item => item.photos), ...Array.from({ length: 10 }, (_, index) => photo(index, "L"))];
  const source = { wv_albums: JSON.stringify(albums), wv_photo_library: JSON.stringify(library), wv_settings: { timezone: "Australia/Sydney" } };
  const insert = database.prepare("INSERT INTO app_store(key, value_json, updated_at) VALUES (?, ?, ?)");
  const now = new Date().toISOString();
  database.transaction(() => {
    for (const [key, value] of Object.entries(source)) insert.run(key, JSON.stringify(value), now);
    database.prepare("INSERT INTO schema_meta(key, value) VALUES ('store_initialized_at', ?)").run(now);
    database.prepare("INSERT INTO schema_meta(key, value) VALUES ('schema_version', '1')").run();
  })();
  database.close();
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(source));

  const result = await preflightPhotoIndex(dataDir);

  assert.equal(result.indexed_photo_counts.all, 1010);
  assert.deepEqual(result.indexed_membership_rows, { album: 1000, library: 1010 });
  assert.ok(result.first_page_response_bytes < result.full_library_json_bytes);
  assert.ok(result.sqlite_growth_bytes > 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8")), source);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
