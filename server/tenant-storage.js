const fs = require("fs");
const path = require("path");

const GIB = 1024 ** 3;

function tenantStorageLimitBytes(license) {
  const gigabytes = Number(license?.storageLimitGb);
  return Number.isFinite(gigabytes) && gigabytes > 0 ? Math.floor(gigabytes * GIB) : null;
}

function storedArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function tenantStorageUsage(db, slug, uploadsDir) {
  const albums = storedArray(db[`t_${slug}_wv_albums`]);
  const library = storedArray(db[`t_${slug}_wv_photo_library`]);
  const names = new Set();
  const validFilename = filename => filename && filename !== "." && filename !== ".." && path.basename(filename) === filename && !filename.includes("\\");
  const addSource = (source) => {
    if (typeof source !== "string" || !source.startsWith("/uploads/")) return;
    const filename = source.slice(9).split("?")[0];
    if (validFilename(filename)) names.add(filename);
  };
  for (const photo of library) for (const field of ["src", "thumbnail", "beforeSrc", "editedSrc"]) addSource(photo?.[field]);
  for (const album of albums) {
    addSource(album?.coverImage);
    for (const photo of storedArray(album?.photos)) for (const field of ["src", "thumbnail", "beforeSrc", "editedSrc"]) addSource(photo?.[field]);
  }
  const ownersValue = db.wv_upload_owners;
  let owners = ownersValue;
  if (typeof ownersValue === "string") {
    try { owners = JSON.parse(ownersValue); } catch { owners = {}; }
  }
  for (const [filename, owner] of Object.entries(owners || {})) {
    if (owner?.tenantSlug === slug && validFilename(filename)) names.add(filename);
  }

  let totalBytes = 0;
  const allFileNames = [];
  for (const filename of names) {
    try {
      const stat = fs.lstatSync(path.join(uploadsDir, filename));
      if (!stat.isFile()) continue;
      totalBytes += stat.size;
      allFileNames.push(filename);
    } catch { /* A missing file must not consume storage. */ }
  }
  allFileNames.sort();
  return { totalBytes, fileCount: allFileNames.length, albumCount: albums.length, allFileNames };
}

module.exports = { tenantStorageLimitBytes, tenantStorageUsage };
