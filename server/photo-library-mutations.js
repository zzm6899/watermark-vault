const ALBUMS_KEY = "wv_albums";
const LIBRARY_KEY = "wv_photo_library";

const PATCHABLE_FIELDS = new Set([
  "title", "src", "thumbnail", "thumbnailWatermarked", "mediumWatermarked", "fullWatermarked",
  "beforeSrc", "afterSrc", "starred", "width", "height", "fileSize", "takenAt", "uploadedAt",
  "originalName", "originalFileNumber", "ftpUploaded", "proofId", "watermarkVersion", "watermarkUpdatedAt",
  "alt", "description", "tags", "color", "cullScore", "cullGroupId", "cullReason", "aiEditedAt",
]);

function parseArray(value, label) {
  if (value == null || value === "") return [];
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`);
  return parsed;
}

function readArray(db, key) {
  return parseArray(db[key], key);
}

function writeArray(db, key, value) {
  db[key] = typeof db[key] === "string" ? JSON.stringify(value) : value;
}

function normalizePhotoPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Photo patch must be an object");
  const entries = Object.entries(patch);
  if (entries.length === 0 || entries.some(([key]) => !PATCHABLE_FIELDS.has(key))) throw new Error("Photo patch contains unsupported fields");
  for (const [key, value] of entries) {
    if (value === null && !["beforeSrc", "afterSrc"].includes(key)) throw new Error(`Photo field ${key} cannot be cleared`);
    if (typeof value === "string" && value.length > 8192) throw new Error(`Photo field ${key} is too long`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Photo field ${key} must be finite`);
  }
  return patch;
}

function applyPhotoMutations(db, operations) {
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 500) throw new Error("Provide between 1 and 500 photo operations");
  const candidates = new Set();
  let changed = 0;
  let libraryChanged = false;
  let albumsChanged = false;

  const albums = readArray(db, ALBUMS_KEY);
  let library = readArray(db, LIBRARY_KEY);

  const locateAlbum = albumId => albums.find(album => String(album?.id || "") === albumId || String(album?.slug || "") === albumId);
  const rememberSrc = src => { if (typeof src === "string" && src.split("?", 1)[0].startsWith("/uploads/")) candidates.add(src.split("?", 1)[0]); };

  for (const operation of operations) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new Error("Invalid photo operation");
    const photoId = String(operation.photoId || "").trim();
    if (operation.type !== "append-library" && operation.type !== "append-album" && !photoId) throw new Error("Photo ID is required");

    if (operation.type === "star") {
      if (typeof operation.starred !== "boolean" || !["library", "album"].includes(operation.sourceType)) throw new Error("Invalid photo star operation");
      if (operation.sourceType === "library") {
        library = library.map(photo => {
          if (String(photo?.id || "") !== photoId) return photo;
          if (!!photo.starred === operation.starred) return photo;
          changed += 1;
          libraryChanged = true;
          return { ...photo, starred: operation.starred };
        });
      } else {
        const album = locateAlbum(String(operation.albumId || ""));
        if (!album) throw new Error("Album not found");
        let albumChanged = false;
        const photos = (album.photos || []).map(photo => {
          if (String(photo?.id || "") !== photoId) return photo;
          if (!!photo.starred === operation.starred) return photo;
          albumChanged = true;
          changed += 1;
          return { ...photo, starred: operation.starred };
        });
        if (albumChanged) album.photos = photos;
        if (albumChanged) albumsChanged = true;
      }
      continue;
    }

    if (operation.type === "patch-everywhere") {
      const patch = normalizePhotoPatch(operation.patch);
      library = library.map(photo => {
        if (String(photo?.id || "") !== photoId) return photo;
        rememberSrc(photo.src);
        changed += 1;
        libraryChanged = true;
        const next = { ...photo, ...patch };
        for (const [key, value] of Object.entries(patch)) if (value === null) delete next[key];
        return next;
      });
      for (const album of albums) {
        let albumChanged = false;
        const coverBase = String(album.coverImage || "").split("?", 1)[0];
        let photoWasCover = false;
        const photos = (album.photos || []).map(photo => {
          if (String(photo?.id || "") !== photoId) return photo;
          rememberSrc(photo.src);
          if (String(photo.src || "").split("?", 1)[0] === coverBase) photoWasCover = true;
          albumChanged = true;
          changed += 1;
          const next = { ...photo, ...patch };
          for (const [key, value] of Object.entries(patch)) if (value === null) delete next[key];
          return next;
        });
        if (albumChanged) {
          album.photos = photos;
          albumsChanged = true;
          if (patch.src && photoWasCover) album.coverImage = patch.src;
        }
      }
      continue;
    }

    if (operation.type === "append-library") {
      const photo = operation.photo;
      if (!photo || typeof photo !== "object" || !String(photo.id || "").trim() || typeof photo.src !== "string") throw new Error("Invalid photo record");
      if (!library.some(existing => String(existing?.id || "") === String(photo.id))) {
        library = [...library, photo];
        libraryChanged = true;
        changed += 1;
      }
      continue;
    }

    if (operation.type === "append-album") {
      const album = locateAlbum(String(operation.albumId || ""));
      if (!album || !Array.isArray(operation.photos)) throw new Error("Invalid album append operation");
      const existingPhotos = Array.isArray(album.photos) ? album.photos : [];
      const ids = new Set(existingPhotos.map(photo => String(photo?.id || "")));
      const srcs = new Set(existingPhotos.map(photo => String(photo?.src || "")));
      const additions = operation.photos.filter(photo => photo && typeof photo === "object" && String(photo.id || "").trim() && !ids.has(String(photo.id)) && !srcs.has(String(photo.src || ""))).map(photo => {
        const { source: _source, sourceAlbumId: _sourceAlbumId, ...cleanPhoto } = photo;
        ids.add(String(photo.id));
        srcs.add(String(photo.src || ""));
        return cleanPhoto;
      });
      if (additions.length) {
        album.photos = [...existingPhotos, ...additions];
        albumsChanged = true;
        album.photoCount = album.photos.length;
        album._photosStripped = false;
        album._removedPhotoIds = (album._removedPhotoIds || []).filter(id => !ids.has(String(id)));
        if (!album.coverImage) album.coverImage = additions[0].src;
        changed += additions.length;
      }
      continue;
    }

    if (operation.type === "remove") {
      if (operation.sourceType === "library") {
        const removed = library.filter(photo => String(photo?.id || "") === photoId);
        if (removed.length) {
          removed.forEach(photo => rememberSrc(photo.src));
          library = library.filter(photo => String(photo?.id || "") !== photoId);
          libraryChanged = true;
          changed += removed.length;
        }
      } else if (operation.sourceType === "album") {
        const album = locateAlbum(String(operation.albumId || ""));
        if (!album) throw new Error("Album not found");
        const photos = album.photos || [];
        const removed = photos.filter(photo => String(photo?.id || "") === photoId);
        if (removed.length) {
          removed.forEach(photo => rememberSrc(photo.src));
          album.photos = photos.filter(photo => String(photo?.id || "") !== photoId);
          albumsChanged = true;
          album.photoCount = album.photos.length;
          album._removedPhotoIds = [...new Set([...(album._removedPhotoIds || []), photoId])];
          if (removed.some(photo => photo.src && photo.src.split("?", 1)[0] === String(album.coverImage || "").split("?", 1)[0])) album.coverImage = album.photos[0]?.src || "";
          changed += removed.length;
        }
      } else throw new Error("Invalid photo removal scope");
      continue;
    }

    throw new Error("Unsupported photo operation");
  }

  if (libraryChanged) writeArray(db, LIBRARY_KEY, library);
  if (albumsChanged) writeArray(db, ALBUMS_KEY, albums);
  const allReferenced = [];
  for (const [key, value] of Object.entries(db)) {
    if (key === ALBUMS_KEY || /^t_[a-z0-9-]+_wv_albums$/.test(key)) {
      for (const album of parseArray(value, key)) allReferenced.push(...(album.photos || []).map(photo => String(photo?.src || "").split("?", 1)[0]));
    } else if (key === LIBRARY_KEY || /^t_[a-z0-9-]+_wv_photo_library$/.test(key)) {
      allReferenced.push(...parseArray(value, key).map(photo => String(photo?.src || "").split("?", 1)[0]));
    }
  }
  const references = new Set(allReferenced);
  const deletedFileCandidates = [...candidates].filter(src => !references.has(src));
  const changedKeys = [];
  if (albumsChanged) changedKeys.push(ALBUMS_KEY);
  if (libraryChanged) changedKeys.push(LIBRARY_KEY);
  return { changed, changedKeys, deletedFileCandidates };
}

module.exports = { applyPhotoMutations, normalizePhotoPatch };
