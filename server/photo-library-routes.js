const { applyPhotoMutations } = require("./photo-library-mutations");

const PAGE_SOURCES = new Set(["all", "library", "unassigned", "album"]);
const PAGE_SORTS = new Set(["source", "date-asc", "date-desc", "name-asc", "name-desc", "size-desc"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parsePhotoPageQuery(query) {
  const values = {
    source: query.source ?? "all",
    albumId: query.albumId ?? "",
    filterAlbumId: query.filterAlbumId ?? "",
    q: query.q ?? "",
    starred: query.starred ?? "false",
    dateFrom: query.dateFrom ?? "",
    dateTo: query.dateTo ?? "",
    size: query.size ?? "",
    sort: query.sort ?? "source",
    offset: query.offset ?? "0",
    limit: query.limit ?? "60",
    revision: query.revision ?? "",
  };
  const stringFields = ["source", "albumId", "filterAlbumId", "q", "starred", "dateFrom", "dateTo", "size", "sort", "offset", "limit", "revision"];
  if (stringFields.some(key => typeof values[key] !== "string")) return null;
  if (!PAGE_SOURCES.has(values.source) || values.albumId.length > 200 || values.filterAlbumId.length > 200 || (values.source === "album" && !values.albumId)) return null;
  if (values.q.length > 200 || !["true", "false"].includes(values.starred)) return null;
  if (!["", "small", "medium", "large"].includes(values.size) || !PAGE_SORTS.has(values.sort)) return null;
  if ((values.dateFrom && !ISO_DAY.test(values.dateFrom)) || (values.dateTo && !ISO_DAY.test(values.dateTo)) || (values.dateFrom && values.dateTo && values.dateFrom > values.dateTo)) return null;
  if (!/^\d{1,8}$/.test(values.offset) || !/^\d{1,3}$/.test(values.limit) || Number(values.limit) < 1 || Number(values.limit) > 60) return null;
  if (values.revision && !/^\d{1,12}$/.test(values.revision)) return null;
  return {
    scope: "main",
    source: values.source,
    albumId: values.albumId,
    filterAlbumId: values.filterAlbumId,
    q: values.q.trim(),
    starred: values.starred === "true",
    dateFrom: values.dateFrom,
    dateTo: values.dateTo,
    size: values.size,
    sort: values.sort,
    offset: Number(values.offset),
    limit: Number(values.limit),
    ...(values.revision ? { expectedRevision: Number(values.revision) } : {}),
  };
}

function registerPhotoLibraryRoutes(app, { requireAuth, store, readDb, writeDb, writePhotoData, stripPhotos }) {
  app.get("/api/admin/photos/summary", requireAuth, (_req, res) => {
    try {
      res.setHeader("Cache-Control", "private, no-store");
      res.json(store.photoIndexSummary("main"));
    } catch (error) {
      console.error("Photo summary failed:", error?.message || error);
      res.status(503).json({ error: "Photo summary is temporarily unavailable" });
    }
  });

  app.get("/api/admin/photos", requireAuth, (req, res) => {
    const query = parsePhotoPageQuery(req.query || {});
    if (!query) return res.status(400).json({ error: "Invalid photo page query" });
    try {
      const page = store.queryPhotoPage(query);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ ...page, photos: stripPhotos ? stripPhotos(page.photos) : page.photos });
    } catch (error) {
      if (error?.code === "PHOTO_INDEX_STALE") return res.status(409).json({ error: error.message, stale: true });
      console.error("Indexed photo query failed:", error?.message || error);
      res.status(503).json({ error: "Photo library is temporarily unavailable" });
    }
  });

  app.post("/api/admin/photos/records", requireAuth, (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length > 500 || items.some(item => !item || typeof item.id !== "string" || !item.id.trim() || item.id.length > 200
      || item.sourceAlbumId != null && (typeof item.sourceAlbumId !== "string" || item.sourceAlbumId.length > 200)
      || item.sourceType != null && !["library", "album"].includes(item.sourceType))) {
      return res.status(400).json({ error: "Provide up to 500 valid photo identities" });
    }
    try {
      const records = store.getPhotoRecords({ scope: "main", items });
      const photos = stripPhotos ? stripPhotos(records.filter(Boolean)) : records.filter(Boolean);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ photos, requested: items.length, missing: records.filter(photo => !photo).length });
    } catch (error) {
      console.error("Photo record lookup failed:", error?.message || error);
      res.status(503).json({ error: "Photo records are temporarily unavailable" });
    }
  });

  app.post("/api/admin/photos/mutations", requireAuth, (req, res) => {
    const operations = req.body?.operations;
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 500) return res.status(400).json({ error: "Provide between 1 and 500 photo operations" });
    let db;
    let result;
    try {
      // Keep unrelated cached store rows shared and clone only mutable photo
      // sources. The mutation helper reads other photo keys for safe file
      // reference checks but never changes tenant or unrelated store data.
      const current = readDb();
      db = { ...current };
      for (const key of ["wv_albums", "wv_photo_library"]) {
        if (Array.isArray(current[key])) db[key] = JSON.parse(JSON.stringify(current[key]));
      }
      result = applyPhotoMutations(db, operations);
    } catch (error) {
      return res.status(400).json({ error: error?.message || "Invalid photo operation" });
    }
    if (result.changed) {
      try {
        if (writePhotoData) writePhotoData(db, result.changedKeys);
        else writeDb(db, { durable: true });
      }
      catch { return res.status(503).json({ error: "Photo changes could not be committed; retry" }); }
    }
    res.json({ ok: true, changed: result.changed, deletedFileCandidates: result.deletedFileCandidates });
  });
}

module.exports = { parsePhotoPageQuery, registerPhotoLibraryRoutes };
