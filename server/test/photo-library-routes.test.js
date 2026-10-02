const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createSqliteStore } = require("../sqlite-store");
const { registerPhotoLibraryRoutes } = require("../photo-library-routes");

test("photo routes enforce auth, validate bounded queries, resolve selected IDs, and reject stale pages", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photoflow-photo-routes-"));
  const store = createSqliteStore({ dataDir });
  const original = {
    wv_albums: JSON.stringify([{ id: "album", title: "Album", clientName: "Client", photos: [{ id: "p1", title: "Portrait", src: "/uploads/p1.jpg" }] }]),
    wv_photo_library: JSON.stringify([{ id: "p1", title: "Portrait", src: "/uploads/p1.jpg", starred: false }, { id: "loose", title: "Loose", src: "/uploads/loose.jpg" }]),
    wv_settings: { timezone: "Australia/Sydney" },
  };
  store.write(original);
  let cache = store.read();
  const partialWrites = [];
  let failNextPhotoWrite = false;
  const app = express();
  app.use(express.json());
  const requireAuth = (req, res, next) => req.get("x-test-auth") === "valid" ? next() : res.status(401).json({ error: "Authentication required" });
  registerPhotoLibraryRoutes(app, {
    requireAuth,
    store,
    readDb: () => cache,
    writeDb: next => { store.write(next); cache = next; },
    writePhotoData: (next, keys) => {
      if (failNextPhotoWrite) { failNextPhotoWrite = false; throw new Error("fixture write failure"); }
      partialWrites.push(keys);
      store.writePhotoData(next, keys);
      for (const key of keys) cache[key] = next[key];
    },
    stripPhotos: photos => photos,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const authHeaders = { "x-test-auth": "valid", "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${origin}/api/admin/photos?limit=60`)).status, 401);
    assert.equal((await fetch(`${origin}/api/admin/photos?limit=61`, { headers: authHeaders })).status, 400);
    assert.equal((await fetch(`${origin}/api/admin/photos?source=album`, { headers: authHeaders })).status, 400);

    const firstResponse = await fetch(`${origin}/api/admin/photos?limit=60`, { headers: authHeaders });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.total, 2);
    assert.equal(first.photos[0].sourceAlbumId, "album");
    assert.equal(typeof first.revision, "number");

    const selectedResponse = await fetch(`${origin}/api/admin/photos/records`, {
      method: "POST", headers: authHeaders, body: JSON.stringify({ items: [{ id: "p1", sourceType: "library" }] }),
    });
    assert.equal(selectedResponse.status, 200);
    assert.equal((await selectedResponse.json()).photos[0].id, "p1");

    const invalidMutation = await fetch(`${origin}/api/admin/photos/mutations`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ operations: [
        { type: "star", photoId: "p1", sourceType: "library", starred: true },
        { type: "unknown", photoId: "p1" },
      ] }),
    });
    assert.equal(invalidMutation.status, 400);
    assert.equal(cache.wv_photo_library, original.wv_photo_library, "failed validation must not mutate the shared cache");

    const mutation = await fetch(`${origin}/api/admin/photos/mutations`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ operations: [{ type: "star", photoId: "p1", sourceType: "library", starred: true }] }),
    });
    assert.equal(mutation.status, 200);
    assert.equal((await mutation.json()).changed, 1);
    assert.deepEqual(partialWrites, [["wv_photo_library"]]);
    assert.deepEqual(cache.wv_settings, original.wv_settings, "photo writes preserve the unrelated shared cache row");

    const stale = await fetch(`${origin}/api/admin/photos?limit=60&revision=${first.revision}`, { headers: authHeaders });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).stale, true);
    const filtered = await fetch(`${origin}/api/admin/photos?source=library&starred=true&limit=60`, { headers: authHeaders });
    assert.deepEqual((await filtered.json()).photos.map(photo => photo.id), ["p1"]);
    const summary = await fetch(`${origin}/api/admin/photos/summary`, { headers: authHeaders });
    assert.deepEqual(await summary.json(), { all: 2, library: 2, unassigned: 1, starred: 0, albumMemberships: 1, revision: first.revision + 1 });

    const [albumStar, libraryRemove] = await Promise.all([
      fetch(`${origin}/api/admin/photos/mutations`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ operations: [{ type: "star", photoId: "p1", sourceType: "album", albumId: "album", starred: true }] }),
      }),
      fetch(`${origin}/api/admin/photos/mutations`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ operations: [{ type: "remove", photoId: "loose", sourceType: "library" }] }),
      }),
    ]);
    assert.equal(albumStar.status, 200);
    assert.equal(libraryRemove.status, 200);
    assert.deepEqual(partialWrites.slice(1), [["wv_albums"], ["wv_photo_library"]]);
    assert.equal(store.getPhotoRecords({ items: [{ id: "p1", sourceAlbumId: "album" }] })[0].starred, true);
    assert.equal(store.queryPhotoPage({ limit: 60 }).total, 1);
    assert.equal(store.queryPhotoPage({ source: "unassigned", limit: 60 }).total, 0);

    failNextPhotoWrite = true;
    const failedCommit = await fetch(`${origin}/api/admin/photos/mutations`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ operations: [{ type: "star", photoId: "p1", sourceType: "album", albumId: "album", starred: false }] }),
    });
    assert.equal(failedCommit.status, 503);
    assert.equal(store.getPhotoRecords({ items: [{ id: "p1", sourceAlbumId: "album" }] })[0].starred, true);
    assert.equal(JSON.parse(cache.wv_albums)[0].photos[0].starred, true, "failed commit must not leak speculative state into the cache");
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
