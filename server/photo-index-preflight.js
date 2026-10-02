const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createSqliteStore } = require("./sqlite-store");

/**
 * Preflight the photo-index startup migration against a consistent temporary
 * copy. The supplied source directory is opened read-only and never modified.
 */
async function preflightPhotoIndex(sourceDataDir) {
  if (!sourceDataDir || !fs.existsSync(sourceDataDir) || !fs.statSync(sourceDataDir).isDirectory()) {
    throw new Error("Pass an existing data directory containing photoflow.sqlite or db.json.");
  }
  const sourceSqlite = path.join(sourceDataDir, "photoflow.sqlite");
  const sourceLegacy = path.join(sourceDataDir, "db.json");
  if (!fs.existsSync(sourceSqlite) && !fs.existsSync(sourceLegacy)) {
    throw new Error("The source data directory contains neither photoflow.sqlite nor db.json.");
  }

  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-photo-index-preflight-"));
  const stagedSqlite = path.join(temporaryDir, "photoflow.sqlite");
  const stagedLegacy = path.join(temporaryDir, "db.json");
  let sourceDatabase;
  let store;
  try {
    const snapshotStarted = Date.now();
    if (fs.existsSync(sourceSqlite)) {
      sourceDatabase = new Database(sourceSqlite, { readonly: true, fileMustExist: true });
      await sourceDatabase.backup(stagedSqlite);
      sourceDatabase.close();
      sourceDatabase = null;
    }
    if (fs.existsSync(sourceLegacy)) fs.copyFileSync(sourceLegacy, stagedLegacy);
    const snapshotMs = Date.now() - snapshotStarted;
    const sqliteBytesBefore = fs.existsSync(stagedSqlite) ? fs.statSync(stagedSqlite).size : 0;

    const migrationStarted = Date.now();
    store = createSqliteStore({ dataDir: temporaryDir, legacyFile: stagedLegacy });
    const storeStartupMs = Date.now() - migrationStarted;
    const photoIndexMigrationMs = store.photoIndexMigrationMs;
    const summary = store.photoIndexSummary("main");
    const version = store.photoIndexVersion;
    const migration = store.photoIndexMigration;
    const sourceSnapshot = store.read();
    const firstPage = store.queryPhotoPage({ limit: 60 });
    const fullLibraryJsonBytes = Buffer.byteLength(String(sourceSnapshot.wv_photo_library || ""));
    const photoSourceJsonBytes = Buffer.byteLength(String(sourceSnapshot.wv_photo_library || ""))
      + Buffer.byteLength(String(sourceSnapshot.wv_albums || ""));
    const firstPageResponseBytes = Buffer.byteLength(JSON.stringify(firstPage));
    const indexRows = store.photoIndexStats("main");
    store.close();
    store = null;

    const sqliteBytesAfter = fs.statSync(stagedSqlite).size;
    return {
      result: "ok",
      source_was_modified: false,
      snapshot_ms: snapshotMs,
      store_startup_ms: storeStartupMs,
      photo_index_migration_transaction_ms: photoIndexMigrationMs,
      sqlite_bytes_before: sqliteBytesBefore,
      sqlite_bytes_after: sqliteBytesAfter,
      sqlite_growth_bytes: sqliteBytesAfter - sqliteBytesBefore,
      full_library_json_bytes: fullLibraryJsonBytes,
      album_and_library_json_bytes: photoSourceJsonBytes,
      first_page_response_bytes: firstPageResponseBytes,
      first_page_to_library_ratio: fullLibraryJsonBytes > 0 ? Number((firstPageResponseBytes / fullLibraryJsonBytes).toFixed(4)) : 0,
      migration,
      photo_index_version: version,
      indexed_membership_rows: indexRows,
      indexed_photo_counts: summary,
    };
  } catch (error) {
    throw new Error(`Photo-index preflight failed on the temporary copy: ${error?.message || error}`, { cause: error });
  } finally {
    try { sourceDatabase?.close(); } catch {}
    try { store?.close(); } catch {}
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const sourceDataDir = process.argv[2];
  preflightPhotoIndex(sourceDataDir).then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    if (error.cause) process.stderr.write(`Cause: ${error.cause.message || error.cause}\n`);
    process.exitCode = 1;
  });
}

module.exports = { preflightPhotoIndex };
