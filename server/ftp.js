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

    // Ensure the remote directory exists (with optional sub-folder)
    const remotePath = subFolder
      ? path.posix.join(ftpRemotePath || "/", sanitizeFolderName(subFolder))
      : (ftpRemotePath || "/");
    await client.ensureDir(remotePath);

    const fname = remoteFilename || path.basename(localFilePath);
    const remoteFile = path.posix.join(remotePath, fname);
    await client.uploadFrom(localFilePath, remoteFile);

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
    await client.ensureDir(remotePath);

    for (const { localPath, remoteFilename } of entries) {
      try {
        const fname = remoteFilename || path.basename(localPath);
        const remoteFile = path.posix.join(remotePath, fname);
        await client.uploadFrom(localPath, remoteFile);
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

    // Ensure the target directory exists
    const toDir = path.posix.dirname(toRemotePath);
    await client.ensureDir(toDir);

    // Try to rename/move the file; fall back to upload if rename fails
    try {
      await client.rename(fromRemotePath, toRemotePath);
    } catch (_renameErr) {
      // File may not exist at fromRemotePath yet — upload it directly to the target path
      if (localFilePath) {
        await client.uploadFrom(localFilePath, toRemotePath);
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
    const testFileName = `_wv_test_${Date.now()}.tmp`;
    const testRemotePath = path.posix.join(remotePath, testFileName);
    await client.uploadFrom(Readable.from(Buffer.from("wv")), testRemotePath);
    try { await client.remove(testRemotePath); } catch { /* ignore cleanup failure */ }

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

module.exports = { uploadFileToFtp, uploadFilesToFtp, moveFileOnFtp, testFtpConnection, sanitizeFolderName };
