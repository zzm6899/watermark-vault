const PHOTO_INDEX_VERSION = "2";
const DERIVED_BAKED_FIELDS = ["thumbnailWatermarked", "mediumWatermarked", "fullWatermarked"];
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".tif", ".tiff", ".heic", ".heif"]);
const IGNORED_UPLOAD_FILENAMES = new Set(["thumbs.db", ".ds_store", "desktop.ini"]);

const CREATE_PHOTO_INDEX_SQL = `
  CREATE TABLE IF NOT EXISTS photo_index (
    scope TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('album', 'library')),
    album_id TEXT NOT NULL DEFAULT '',
    photo_id TEXT NOT NULL,
    album_order INTEGER NOT NULL DEFAULT 0,
    photo_order INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    src TEXT NOT NULL DEFAULT '',
    source_label TEXT NOT NULL DEFAULT '',
    client_name TEXT NOT NULL DEFAULT '',
    taken_at TEXT NOT NULL DEFAULT '',
    uploaded_at TEXT NOT NULL DEFAULT '',
    file_size REAL,
    starred INTEGER NOT NULL DEFAULT 0,
    photo_json TEXT NOT NULL,
    PRIMARY KEY(scope, source_key, photo_order)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS photo_index_scope_source_order
    ON photo_index(scope, source_type, album_id, album_order, photo_order, photo_id);
  CREATE INDEX IF NOT EXISTS photo_index_scope_starred
    ON photo_index(scope, starred, source_type, album_id, album_order, photo_order);
  CREATE INDEX IF NOT EXISTS photo_index_scope_dates
    ON photo_index(scope, taken_at, uploaded_at);
`;

function parseArray(value, sourceName) {
  if (value == null || value === "") return [];
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error(`Photo index source ${sourceName} must be an array`);
  return parsed;
}

function normalizedPhotoId(photo) {
  return photo && (typeof photo.id === "string" || typeof photo.id === "number")
    ? String(photo.id).trim()
    : "";
}

function isIndexablePhoto(photo) {
  const src = String(photo?.src || photo?.url || "").trim();
  if (!src) return false;
  if (src.startsWith("data:")) return true;
  let pathname;
  try { pathname = /^https?:\/\//i.test(src) ? new URL(src).pathname : src.split(/[?#]/, 1)[0]; }
  catch { return true; }
  if (!pathname.startsWith("/uploads/")) return true;
  const filename = pathname.split(/[\\/]/).pop()?.toLowerCase() || "";
  if (!filename || filename === "_cache" || filename.startsWith("._") || IGNORED_UPLOAD_FILENAMES.has(filename)) return false;
  const dot = filename.lastIndexOf(".");
  const extension = dot < 0 ? "" : filename.slice(dot);
  return SUPPORTED_IMAGE_EXTENSIONS.has(extension);
}

function serializeIndexedPhoto(photo) {
  const indexed = { ...photo };
  for (const field of [
    ...DERIVED_BAKED_FIELDS,
    "id", "title", "src", "takenAt", "uploadedAt", "fileSize", "starred", "source", "sourceAlbumId",
  ]) delete indexed[field];
  return JSON.stringify(indexed);
}

function restoreIndexedPhoto(row) {
  const photo = JSON.parse(row.photo_json);
  photo.id = row.photo_id;
  if (row.title) photo.title = row.title;
  if (row.src) photo.src = row.src;
  if (row.taken_at) photo.takenAt = row.taken_at;
  if (row.uploaded_at) photo.uploadedAt = row.uploaded_at;
  if (row.file_size !== null && !Object.prototype.hasOwnProperty.call(photo, "fileSize")) photo.fileSize = row.file_size;
  photo.starred = !!row.starred;
  photo.source = row.source_label;
  if (row.source_type === "album") photo.sourceAlbumId = row.album_id;
  return photo;
}

function createPhotoIndex(database) {
  database.exec(CREATE_PHOTO_INDEX_SQL);
  const insertPhoto = database.prepare(`
    INSERT INTO photo_index(
      scope, source_key, source_type, album_id, photo_id, album_order, photo_order,
      title, src, source_label, client_name, taken_at, uploaded_at, file_size, starred, photo_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteSource = database.prepare("DELETE FROM photo_index WHERE scope = ? AND source_key = ?");
  const deleteType = database.prepare("DELETE FROM photo_index WHERE scope = ? AND source_type = ?");
  const getVersion = database.prepare("SELECT value FROM schema_meta WHERE key = 'photo_index_version'");
  const getSkipped = database.prepare("SELECT value FROM schema_meta WHERE key = 'photo_index_skipped_records'");
  const getRevision = database.prepare("SELECT value FROM schema_meta WHERE key = 'photo_index_revision'");
  const setVersion = database.prepare("INSERT INTO schema_meta(key, value) VALUES ('photo_index_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const setSkipped = database.prepare("INSERT INTO schema_meta(key, value) VALUES ('photo_index_skipped_records', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");

  function addPhotos({ scope, sourceKey, sourceType, albumId = "", albumOrder = 0, albumTitle = "", clientName = "", photos }) {
    if (!Array.isArray(photos)) throw new Error(`Photo index source ${sourceKey} must contain photos`);
    deleteSource.run(scope, sourceKey);
    let skipped = 0;
    photos.forEach((photo, photoOrder) => {
      const photoId = normalizedPhotoId(photo);
      if (!photo || typeof photo !== "object" || !photoId) {
        skipped += 1;
        return;
      }
      // Match the server's persisted-photo policy so a page cannot count a row
      // that the response sanitizer later drops, leaving holes across offsets.
      if (!isIndexablePhoto(photo)) {
        skipped += 1;
        return;
      }
      const fileSize = Number(photo.fileSize);
      insertPhoto.run(
        scope,
        sourceKey,
        sourceType,
        albumId,
        photoId,
        albumOrder,
        photoOrder,
        String(photo.title || ""),
        String(photo.src || ""),
        sourceType === "album" ? albumTitle : "Library",
        clientName,
        String(photo.takenAt || ""),
        String(photo.uploadedAt || ""),
        Number.isFinite(fileSize) ? fileSize : null,
        photo.starred ? 1 : 0,
        serializeIndexedPhoto(photo),
      );
    });
    return skipped;
  }

  function updateAlbumSource(store, { scope, key, albums }) {
    deleteType.run(scope, "album");
    const rows = parseArray(store[key], key);
    let skipped = 0;
    rows.forEach((album, albumOrder) => {
      if (!album || typeof album !== "object" || !String(album.id || "").trim()) return;
      const photos = parseArray(album.photos, `${key}/${album.id}/photos`);
      skipped += addPhotos({
        scope,
        sourceKey: `album:${String(album.id)}`,
        sourceType: "album",
        albumId: String(album.id),
        albumOrder,
        albumTitle: String(album.title || ""),
        clientName: String(album.clientName || ""),
        photos,
      });
    });
    return skipped;
  }

  function updateLibrarySource(store, { scope, key }) {
    return addPhotos({
      scope,
      sourceKey: "library",
      sourceType: "library",
      photos: parseArray(store[key], key),
    });
  }

  function rebuild(store) {
    database.exec("DELETE FROM photo_index");
    let skipped = updateAlbumSource(store, { scope: "main", key: "wv_albums" });
    skipped += updateLibrarySource(store, { scope: "main", key: "wv_photo_library" });
    for (const slug of findTenantSlugs(store)) {
      const albumsKey = `t_${slug}_wv_albums`;
      const libraryKey = `t_${slug}_wv_photo_library`;
      skipped += updateAlbumSource(store, { scope: `tenant:${slug}`, key: albumsKey });
      skipped += updateLibrarySource(store, { scope: `tenant:${slug}`, key: libraryKey });
    }
    setSkipped.run(String(skipped));
    setVersion.run(PHOTO_INDEX_VERSION);
    if (!getRevision.get()) database.prepare("INSERT INTO schema_meta(key, value) VALUES ('photo_index_revision', '1')").run();
    return { skipped };
  }

  function findTenantSlugs(store) {
    return [...new Set(Object.keys(store)
      .map(key => /^t_([a-z0-9-]+)_wv_(?:albums|photo_library)$/.exec(key)?.[1])
      .filter(Boolean))];
  }

  function syncChangedSources(store, changedKeys) {
    let skipped = 0;
    if (changedKeys.has("wv_albums")) skipped += updateAlbumSource(store, { scope: "main", key: "wv_albums" });
    if (changedKeys.has("wv_photo_library")) skipped += updateLibrarySource(store, { scope: "main", key: "wv_photo_library" });
    for (const key of changedKeys) {
      const match = /^t_([a-z0-9-]+)_wv_(albums|photo_library)$/.exec(key);
      if (!match) continue;
      const [, slug, suffix] = match;
      const scope = `tenant:${slug}`;
      if (suffix === "albums") skipped += updateAlbumSource(store, { scope, key });
      else skipped += updateLibrarySource(store, { scope, key });
    }
    database.prepare("INSERT INTO schema_meta(key, value) VALUES ('photo_index_revision', '1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER) + 1 AS TEXT)").run();
    if (skipped) {
      const current = Number(getSkipped.get()?.value || 0);
      setSkipped.run(String(current + skipped));
    }
  }

  function migrate(store) {
    if (getVersion.get()?.value === PHOTO_INDEX_VERSION) return { migrated: false, skipped: Number(database.prepare("SELECT value FROM schema_meta WHERE key = 'photo_index_skipped_records'").get()?.value || 0) };
    const result = rebuild(store);
    return { migrated: true, ...result };
  }

  function query({ scope = "main", source = "all", albumId = "", filterAlbumId = "", q = "", starred = false, dateFrom = "", dateTo = "", size = "", sort = "source", offset = 0, limit = 60, expectedRevision }) {
    const where = [];
    const params = [scope];
    if (source === "library") where.push("p.source_type = 'library'");
    else if (source === "unassigned") where.push("p.source_type = 'library' AND NOT EXISTS (SELECT 1 FROM photo_index a WHERE a.scope = p.scope AND a.source_type = 'album' AND a.photo_id = p.photo_id)");
    else if (source === "album") { params.push(albumId); }
    if (starred) where.push("p.starred = 1");
    if (filterAlbumId) { where.push("p.album_id = ?"); params.push(filterAlbumId); }
    if (dateFrom) { where.push("(COALESCE(NULLIF(substr(p.taken_at, 1, 10), ''), NULLIF(substr(p.uploaded_at, 1, 10), '')) IS NULL OR COALESCE(NULLIF(substr(p.taken_at, 1, 10), ''), NULLIF(substr(p.uploaded_at, 1, 10), '')) >= ?)"); params.push(dateFrom); }
    if (dateTo) { where.push("(COALESCE(NULLIF(substr(p.taken_at, 1, 10), ''), NULLIF(substr(p.uploaded_at, 1, 10), '')) IS NULL OR COALESCE(NULLIF(substr(p.taken_at, 1, 10), ''), NULLIF(substr(p.uploaded_at, 1, 10), '')) <= ?)"); params.push(dateTo); }
    if (size === "small") where.push("(p.file_size IS NULL OR p.file_size < 5242880)");
    if (size === "medium") where.push("(p.file_size IS NULL OR (p.file_size >= 5242880 AND p.file_size <= 15728640))");
    if (size === "large") where.push("(p.file_size IS NULL OR p.file_size > 15728640)");
    if (q) {
      const needle = `%${q.toLocaleLowerCase().replace(/[\\%_]/g, value => `\\${value}`)}%`;
      where.push("(LOWER(p.title) LIKE ? ESCAPE '\\' OR LOWER(p.src) LIKE ? ESCAPE '\\' OR LOWER(p.source_label) LIKE ? ESCAPE '\\' OR LOWER(p.client_name) LIKE ? ESCAPE '\\')");
      params.push(needle, needle, needle, needle);
    }
    const cte = `WITH ranked AS (
      SELECT i.*, CASE WHEN i.source_type = 'album' THEN 0 ELSE 1 END AS source_priority,
        ROW_NUMBER() OVER (PARTITION BY i.photo_id ORDER BY CASE WHEN i.source_type = 'album' THEN 0 ELSE 1 END, i.album_order, i.photo_order, i.source_key) AS duplicate_rank
      FROM photo_index i WHERE i.scope = ?${source === "library" || source === "unassigned" ? " AND i.source_type = 'library'" : source === "album" ? " AND i.source_type = 'album' AND i.album_id = ?" : ""}
    ), filtered AS (SELECT p.* FROM ranked p WHERE p.duplicate_rank = 1${where.length ? ` AND ${where.join(" AND ")}` : ""})`;
    // source-specific predicates are applied before de-duplication to match the
    // library/album views, but the remaining filters are applied after it.
    const cteParams = params;
    const orderBy = {
      source: "source_priority ASC, album_order ASC, photo_order ASC, source_key ASC, photo_id ASC",
      "date-asc": "CASE WHEN taken_at = '' THEN uploaded_at ELSE taken_at END ASC, photo_id ASC, source_key ASC",
      "date-desc": "CASE WHEN taken_at = '' THEN uploaded_at ELSE taken_at END DESC, photo_id ASC, source_key ASC",
      "name-asc": "LOWER(title) ASC, photo_id ASC, source_key ASC",
      "name-desc": "LOWER(title) DESC, photo_id ASC, source_key ASC",
      "size-desc": "file_size DESC, photo_id ASC, source_key ASC",
    }[sort] || "source_priority ASC, album_order ASC, photo_order ASC, source_key ASC, photo_id ASC";
    database.exec("BEGIN");
    try {
      const revision = Number(getRevision.get()?.value || 1);
      if (expectedRevision != null && Number(expectedRevision) !== revision) {
        const error = new Error("Photo index changed; refresh the current page");
        error.code = "PHOTO_INDEX_STALE";
        throw error;
      }
      const total = Number(database.prepare(`${cte} SELECT COUNT(*) AS total FROM filtered`).get(...cteParams)?.total || 0);
      const rows = database.prepare(`${cte} SELECT * FROM filtered ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...cteParams, limit, offset);
      database.exec("COMMIT");
      return {
        photos: rows.map(restoreIndexedPhoto),
        total,
        offset,
        limit,
        revision,
        hasMore: offset + rows.length < total,
      };
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function getPhotosByIds({ scope = "main", items = [] }) {
    if (!Array.isArray(items) || items.length > 500) throw new Error("Photo record request must contain at most 500 IDs");
    const ids = [...new Set(items.map(item => String(item?.id || "").trim()).filter(Boolean))];
    if (!ids.length) return [];
    const rows = database.prepare(`
      SELECT * FROM photo_index WHERE scope = ? AND photo_id IN (${ids.map(() => "?").join(",")})
      ORDER BY CASE WHEN source_type = 'album' THEN 0 ELSE 1 END, album_order, photo_order, source_key
    `).all(scope, ...ids);
    const byId = new Map();
    for (const row of rows) {
      const record = restoreIndexedPhoto(row);
      const list = byId.get(row.photo_id) || [];
      list.push({ type: row.source_type, albumId: row.album_id, record });
      byId.set(row.photo_id, list);
    }
    return items.map(item => {
      const matches = byId.get(String(item?.id || "").trim()) || [];
      const selected = item?.sourceAlbumId
        ? matches.find(match => match.type === "album" && match.albumId === String(item.sourceAlbumId))
        : item?.sourceType === "library"
          ? matches.find(match => match.type === "library")
          : matches[0];
      return selected?.record || null;
    });
  }

  function summary(scope = "main") {
    database.exec("BEGIN");
    try {
      const revision = Number(getRevision.get()?.value || 1);
      const all = Number(database.prepare(`WITH ranked AS (
        SELECT photo_id, ROW_NUMBER() OVER (PARTITION BY photo_id ORDER BY CASE WHEN source_type='album' THEN 0 ELSE 1 END, album_order, photo_order, source_key) AS rn
        FROM photo_index WHERE scope = ?
      ) SELECT COUNT(*) AS n FROM ranked WHERE rn = 1`).get(scope).n || 0);
      const library = Number(database.prepare("SELECT COUNT(DISTINCT photo_id) AS n FROM photo_index WHERE scope = ? AND source_type = 'library'").get(scope).n || 0);
      const unassigned = Number(database.prepare(`SELECT COUNT(DISTINCT l.photo_id) AS n FROM photo_index l
        WHERE l.scope = ? AND l.source_type = 'library' AND NOT EXISTS (
          SELECT 1 FROM photo_index a WHERE a.scope = l.scope AND a.source_type = 'album' AND a.photo_id = l.photo_id
        )`).get(scope).n || 0);
      const starred = Number(database.prepare(`WITH ranked AS (
        SELECT starred, ROW_NUMBER() OVER (PARTITION BY photo_id ORDER BY CASE WHEN source_type='album' THEN 0 ELSE 1 END, album_order, photo_order, source_key) AS rn
        FROM photo_index WHERE scope = ?
      ) SELECT COUNT(*) AS n FROM ranked WHERE rn = 1 AND starred = 1`).get(scope).n || 0);
      const albumMemberships = Number(database.prepare("SELECT COUNT(*) AS n FROM photo_index WHERE scope = ? AND source_type = 'album'").get(scope).n || 0);
      database.exec("COMMIT");
      return { all, library, unassigned, starred, albumMemberships, revision };
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function stats(scope = "main") {
    const counts = database.prepare("SELECT source_type, COUNT(*) AS count FROM photo_index WHERE scope = ? GROUP BY source_type").all(scope);
    return Object.fromEntries(counts.map(row => [row.source_type, Number(row.count)]));
  }

  return { migrate, rebuild, syncChangedSources, query, getPhotosByIds, summary, stats, version: PHOTO_INDEX_VERSION };
}

module.exports = { createPhotoIndex, PHOTO_INDEX_VERSION };
