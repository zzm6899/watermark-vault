const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
