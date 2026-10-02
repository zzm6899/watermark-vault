const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { createPhotoIndex } = require("./photo-index");

function parseLegacyDatabase(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Legacy database root must be an object");
  return value;
}

function createSqliteStore({ dataDir, legacyFile = path.join(dataDir, "db.json") }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, "photoflow.sqlite");
  const database = new Database(filePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_store (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `);
  const selectAll = database.prepare("SELECT key, value_json FROM app_store");
  const upsert = database.prepare("INSERT INTO app_store(key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at");
  const remove = database.prepare("DELETE FROM app_store WHERE key = ?");
  const setMeta = database.prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const getMeta = database.prepare("SELECT value FROM schema_meta WHERE key = ?");
  let photoIndex = null;
  let photoIndexReady = false;

  function writeLegacyShadow(value) {
    if (!legacyFile) return;
    const temporary = `${legacyFile}.${process.pid}.${Date.now()}.sqlite-shadow.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, legacyFile);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  }

  function refreshLegacyShadow(value) {
    try { writeLegacyShadow(value); }
    catch (error) {
      // The committed SQLite transaction remains authoritative. A rollback
      // shadow failure must not make callers retry an already-committed write.
      console.error("Unable to refresh the db.json rollback shadow:", error?.message || error);
    }
  }

  function read() {
    const result = {};
    for (const row of selectAll.all()) result[row.key] = JSON.parse(row.value_json);
    return result;
  }

  function write(input) {
    const normalized = JSON.parse(JSON.stringify(input || {}));
    const currentRows = selectAll.all();
    const currentByKey = new Map(currentRows.map(row => [row.key, row.value_json]));
    const existing = new Set(currentByKey.keys());
    const changedPhotoKeys = new Set();
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, value] of Object.entries(normalized)) {
        const valueJson = JSON.stringify(value);
        if (currentByKey.get(key) !== valueJson && /^(?:wv_(?:albums|photo_library)|t_[a-z0-9-]+_wv_(?:albums|photo_library))$/.test(key)) changedPhotoKeys.add(key);
        upsert.run(key, valueJson, now);
        existing.delete(key);
      }
      for (const key of existing) {
        remove.run(key);
        if (/^(?:wv_(?:albums|photo_library)|t_[a-z0-9-]+_wv_(?:albums|photo_library))$/.test(key)) changedPhotoKeys.add(key);
      }
      if (photoIndexReady && changedPhotoKeys.size) photoIndex.syncChangedSources(normalized, changedPhotoKeys);
      setMeta.run("schema_version", "1");
      if (!getMeta.get("store_initialized_at")?.value) setMeta.run("store_initialized_at", now);
      database.exec("COMMIT");
      // Keep a current rollback shadow for older application images that still
      // understand db.json. SQLite remains authoritative on this version.
      refreshLegacyShadow(normalized);
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function writePhotoData(input, keys) {
    if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(keys) || keys.length === 0) {
      throw new Error("Photo data write requires a store object and changed keys");
    }
    const allowedKeys = new Set(["wv_albums", "wv_photo_library"]);
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.some(key => !allowedKeys.has(key) || !Object.prototype.hasOwnProperty.call(input, key))) {
      throw new Error("Photo data write can update only present main photo store keys");
    }
    const normalizedPhotos = new Map(uniqueKeys.map(key => [key, JSON.parse(JSON.stringify(input[key]))]));
    const selectValue = database.prepare("SELECT value_json FROM app_store WHERE key = ?");
    const now = new Date().toISOString();
    const changedKeys = new Set();
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, value] of normalizedPhotos) {
        const valueJson = JSON.stringify(value);
        if (selectValue.get(key)?.value_json === valueJson) continue;
        upsert.run(key, valueJson, now);
        changedKeys.add(key);
      }
      if (photoIndexReady && changedKeys.size) photoIndex.syncChangedSources(input, changedKeys);
      setMeta.run("schema_version", "1");
      database.exec("COMMIT");
      if (changedKeys.size) refreshLegacyShadow(read());
      return [...changedKeys];
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  const rowCount = Number(database.prepare("SELECT COUNT(*) AS count FROM app_store").get().count || 0);
  const initialized = !!getMeta.get("store_initialized_at")?.value;
  let migratedLegacy = false;
  if (!initialized) {
    if (rowCount === 0 && legacyFile && fs.existsSync(legacyFile)) {
      const legacy = parseLegacyDatabase(legacyFile);
      write(legacy);
      setMeta.run("legacy_imported_at", new Date().toISOString());
      migratedLegacy = true;
    } else refreshLegacyShadow(read());
    setMeta.run("store_initialized_at", new Date().toISOString());
  } else refreshLegacyShadow(read());

  // The sidecar index is a derived, rebuildable copy. Backfill it transactionally
  // from the authoritative JSON rows and leave those legacy rows untouched. DDL
  // is inside the same transaction so a failed backfill leaves no half-installed
  // index schema behind.
  let photoIndexMigration;
  let photoIndexMigrationMs = 0;
  const photoIndexMigrationStarted = process.hrtime.bigint();
  database.exec("BEGIN IMMEDIATE");
  try {
    photoIndex = createPhotoIndex(database);
    photoIndexMigration = photoIndex.migrate(read());
    database.exec("COMMIT");
    photoIndexMigrationMs = Number(process.hrtime.bigint() - photoIndexMigrationStarted) / 1e6;
    photoIndexReady = true;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    database.close();
    throw new Error(
      "Photo library index migration failed and was rolled back; the original photo records remain authoritative and the server will not start with a partial index. Back up db.json and photoflow.sqlite, correct or restore the malformed photo metadata, then restart.",
      { cause: error },
    );
  }

  function checkpoint() { database.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
  function close() { checkpoint(); database.close(); }

  return {
    filePath,
    legacyFile,
    migratedLegacy,
    photoIndexMigration,
    photoIndexMigrationMs,
    read,
    write,
    writePhotoData,
    queryPhotoPage: options => photoIndex.query(options),
    getPhotoRecords: options => photoIndex.getPhotosByIds(options),
    photoIndexSummary: scope => photoIndex.summary(scope),
    photoIndexStats: scope => photoIndex.stats(scope),
    photoIndexVersion: photoIndex.version,
    checkpoint,
    close,
  };
}

module.exports = { createSqliteStore, parseLegacyDatabase };
