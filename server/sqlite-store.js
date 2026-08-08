const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

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

  function read() {
    const result = {};
    for (const row of selectAll.all()) result[row.key] = JSON.parse(row.value_json);
    return result;
  }

  function write(input) {
    const normalized = JSON.parse(JSON.stringify(input || {}));
    const existing = new Set(selectAll.all().map(row => row.key));
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, value] of Object.entries(normalized)) {
        upsert.run(key, JSON.stringify(value), now);
        existing.delete(key);
      }
      for (const key of existing) remove.run(key);
      setMeta.run("schema_version", "1");
      database.exec("COMMIT");
      // Keep a current rollback shadow for older application images that still
      // understand db.json. SQLite remains authoritative on this version.
      writeLegacyShadow(normalized);
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  const rowCount = Number(database.prepare("SELECT COUNT(*) AS count FROM app_store").get().count || 0);
  let migratedLegacy = false;
  if (rowCount === 0 && fs.existsSync(legacyFile)) {
    const legacy = parseLegacyDatabase(legacyFile);
    write(legacy);
    setMeta.run("legacy_imported_at", new Date().toISOString());
    migratedLegacy = true;
  } else if (rowCount > 0) writeLegacyShadow(read());

  function checkpoint() { database.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
  function close() { checkpoint(); database.close(); }

  return { filePath, legacyFile, migratedLegacy, read, write, checkpoint, close };
}

module.exports = { createSqliteStore, parseLegacyDatabase };
