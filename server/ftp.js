/**
 * FTP upload helper.
 * Uses the `basic-ftp` library to upload files to a configured FTP server.
 * FTP credentials (especially the password) are only ever stored server-side
 * and are never returned to the browser.
 */

const ftp = require("basic-ftp");
const path = require("path");
const { Readable } = require("stream");

/**
 * Sanitize a filename for use as an FTP STOR target.
 * Strips any directory components so that the STOR command always operates on
 * a plain filename relative to the current working directory.  Without this,
 * a slash embedded in originalName / title (e.g. "2023/photo.jpg") would make
 * STOR try to navigate a sub-directory that doesn't exist, returning 550.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeRemoteFilename(name) {
  // Replace all path separators (/ and \) with underscores to ensure a flat
  // filename; without this, STOR "2023/photo.jpg" would tell the server to
  // store into a sub-directory that may not exist, returning 550.
  return name.replace(/[\\/]/g, "_").trim() || "file";
}

/**
 * Upload a single local file to an FTP server.
 *
 * @param {string} localFilePath - Absolute path to the file on disk.
 * @param {{ ftpHost: string; ftpPort?: number; ftpUser?: string; ftpPassword?: string; ftpRemotePath?: string }} settings
 * @param {{ subFolder?: string; remoteFilename?: string }} [options]
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
async function uploadFileToFtp(localFilePath, settings, options = {}) {
  const { ftpHost, ftpPort = 21, ftpUser = "anonymous", ftpPassword = "", ftpRemotePath = "/" } = settings;
  const { subFolder, remoteFilename } = options;

  if (!ftpHost) return { ok: false, error: "FTP host not configured" };

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: ftpHost,
      port: Number(ftpPort) || 21,
      user: ftpUser || "anonymous",
      password: ftpPassword || "",
      secure: false,
    });

    // Ensure the remote directory exists (with optional sub-folder).
    // ensureDir sets the CWD to remotePath after creating it.
    const remotePath = subFolder
      ? path.posix.join(ftpRemotePath || "/", sanitizeFolderName(subFolder))
      : (ftpRemotePath || "/");
    await client.ensureDir(remotePath);

    // Upload using the filename relative to CWD rather than a full absolute
    // path; many FTP servers don't support absolute paths in STOR.
    // Also strip any directory separators from the filename to prevent the
    // STOR command from inadvertently referencing a sub-directory path.
    const raw = remoteFilename || path.basename(localFilePath);
    const fname = sanitizeRemoteFilename(raw);
    await client.uploadFrom(localFilePath, fname);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "FTP upload failed" };
  } finally {
    client.close();
  }
}

/**
 * Upload multiple local files to an FTP server.
 *
 * Each entry in `localFilePaths` may be either a plain string (local path) or
 * an object `{ localPath: string, remoteFilename?: string }`.  When
 * `remoteFilename` is provided it is used as the destination file name on the
 * FTP server (preserving the original upload name); otherwise the basename of
 * the local path is used.
 *
 * @param {(string | { localPath: string; remoteFilename?: string })[]} localFilePaths
 * @param {object} settings
 * @param {{ subFolder?: string; onProgress?: (done: number, total: number) => void }} [options]
 * @returns {Promise<{ ok: boolean; failed: number; error?: string }>}
 */
async function uploadFilesToFtp(localFilePaths, settings, options = {}) {
  if (!localFilePaths || localFilePaths.length === 0) return { ok: true, failed: 0 };

  const { ftpHost, ftpPort = 21, ftpUser = "anonymous", ftpPassword = "", ftpRemotePath = "/" } = settings;
  const { subFolder, onProgress } = options;

  if (!ftpHost) return { ok: false, failed: localFilePaths.length, error: "FTP host not configured" };

  // Normalise entries to { localPath, remoteFilename? } objects
  const entries = localFilePaths.map(f =>
    typeof f === "string" ? { localPath: f } : f
  );

  const client = new ftp.Client();
  client.ftp.verbose = false;

  let failed = 0;
  let done = 0;
  try {
    await client.access({
      host: ftpHost,
      port: Number(ftpPort) || 21,
      user: ftpUser || "anonymous",
      password: ftpPassword || "",
      secure: false,
    });

    const remotePath = subFolder
      ? path.posix.join(ftpRemotePath || "/", sanitizeFolderName(subFolder))
      : (ftpRemotePath || "/");
    // ensureDir creates the directory if needed and sets the CWD to remotePath.
    await client.ensureDir(remotePath);

    for (const { localPath, remoteFilename } of entries) {
      try {
        // Use just the filename (relative to CWD) rather than the full absolute
        // path.  Many FTP servers do not support absolute paths in STOR and
        // treat them as relative to the current working directory, which would
        // cause uploads to fail silently after ensureDir() changed the CWD.
        // Also sanitize to strip any embedded directory separators that would
        // make STOR try to navigate a non-existent sub-directory (→ 550).
        const raw = remoteFilename || path.basename(localPath);
        const fname = sanitizeRemoteFilename(raw);
        await client.uploadFrom(localPath, fname);
      } catch (err) {
        const displayName = remoteFilename || path.basename(localPath);
        console.warn(`[FTP] File upload failed for ${displayName}:`, err.message);
        failed++;
      }
      done++;
      if (onProgress) onProgress(done, entries.length);
    }
  } catch (err) {
    return { ok: false, failed: localFilePaths.length, error: err.message || "FTP connection failed" };
  } finally {
    client.close();
  }

  return { ok: failed === 0, failed };
}

/**
 * Move a file from one remote FTP path to another (for starred folder feature).
 * If the file does not exist at fromPath, attempts to upload from localFilePath instead.
 *
 * @param {string} localFilePath - Absolute local path (used as fallback upload source).
 * @param {string} fromRemotePath - Current remote path of the file (e.g. /photos/album/photo.jpg).
 * @param {string} toRemotePath - Target remote path (e.g. /photos/album-starred/photo.jpg).
 * @param {object} settings - FTP connection settings.
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
async function moveFileOnFtp(localFilePath, fromRemotePath, toRemotePath, settings) {
  const { ftpHost, ftpPort = 21, ftpUser = "anonymous", ftpPassword = "" } = settings;

  if (!ftpHost) return { ok: false, error: "FTP host not configured" };

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: ftpHost,
      port: Number(ftpPort) || 21,
      user: ftpUser || "anonymous",
      password: ftpPassword || "",
      secure: false,
    });

    // Ensure the target directory exists and set CWD to it.
    const toDir = path.posix.dirname(toRemotePath);
    await client.ensureDir(toDir);

    // Try to rename/move the file; fall back to upload if rename fails.
    // Note: RNFR/RNTO use absolute paths which all FTP servers support.
    try {
      await client.rename(fromRemotePath, toRemotePath);
    } catch (_renameErr) {
      // File may not exist at fromRemotePath yet — upload it directly to the
      // target directory.  CWD is already toDir after ensureDir(), so use the
      // filename only (relative) to avoid absolute-path issues in STOR.
      if (localFilePath) {
        await client.uploadFrom(localFilePath, path.posix.basename(toRemotePath));
      } else {
        throw _renameErr;
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "FTP move failed" };
  } finally {
    client.close();
  }
}

/**
 * Test a connection to an FTP server AND verify file write permissions.
 * Uploads a tiny test file then deletes it so that permission issues (e.g.
 * "553 Permission denied" on STOR) are caught here rather than only failing
 * on the first real album upload.
 *
 * When `settings.ftpOrganizeByAlbum` is true the test also creates a
 * temporary sub-directory, uploads into it and removes it, mirroring what
 * the actual album-upload code does.  This catches the common scenario where
 * the FTP user can write files to `ftpRemotePath` but cannot create
 * sub-directories within it — which would cause a "550 Permission denied"
 * error at upload time even though the basic connection test passed.
 *
 * @param {object} settings
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
async function testFtpConnection(settings) {
  const { ftpHost, ftpPort = 21, ftpUser = "anonymous", ftpPassword = "", ftpRemotePath = "/" } = settings;

  if (!ftpHost) return { ok: false, error: "FTP host not configured" };

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: ftpHost,
      port: Number(ftpPort) || 21,
      user: ftpUser || "anonymous",
      password: ftpPassword || "",
      secure: false,
    });

    // Verify the remote path is reachable / creatable
    const remotePath = ftpRemotePath || "/";
    await client.ensureDir(remotePath);

    // Verify write (STOR) permissions by uploading a tiny test file then
    // deleting it.  This catches cases where the user can connect and list
    // directories but cannot actually write files.
    // CWD is remotePath after ensureDir(), so use just the filename (relative).
    const testFileName = `_wv_test_${Date.now()}.tmp`;
    await client.uploadFrom(Readable.from(Buffer.from("wv")), testFileName);
    try { await client.remove(testFileName); } catch { /* ignore cleanup failure */ }

    // When "Organise by Album" is enabled, actual uploads go to a sub-folder
    // (remotePath/<AlbumName>/) rather than to remotePath directly.  Test that
    // sub-directory creation AND writing within it both work, so that
    // permission problems are surfaced here rather than at upload time with a
    // cryptic "550 Permission denied" error.
    if (settings.ftpOrganizeByAlbum) {
      const testSubDir = `_wv_test_dir_${Date.now()}`;
      const testSubPath = path.posix.join(remotePath, testSubDir);
      // ensureDir navigates into the new sub-directory (MKD + cd).
      await client.ensureDir(testSubPath);
      // Verify that STOR works inside the sub-directory too.
      const subTestFileName = `_wv_test_${Date.now()}.tmp`;
      await client.uploadFrom(Readable.from(Buffer.from("wv")), subTestFileName);
      try { await client.remove(subTestFileName); } catch { /* ignore cleanup failure */ }
      // Navigate back up and remove the temporary test directory.
      await client.cdup();
      try { await client.removeEmptyDir(testSubDir); } catch { /* ignore cleanup failure */ }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "FTP connection failed" };
  } finally {
    client.close();
  }
}

/**
 * Sanitize a string for use as an FTP folder name.
 * Strips characters that are unsafe in FTP paths.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeFolderName(name) {
  return name
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 100) || "album";
}

module.exports = { uploadFileToFtp, uploadFilesToFtp, moveFileOnFtp, testFtpConnection, sanitizeFolderName, sanitizeRemoteFilename };
