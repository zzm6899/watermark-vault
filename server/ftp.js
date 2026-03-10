/**
 * FTP upload helper.
 * Uses the `basic-ftp` library to upload files to a configured FTP server.
 * FTP credentials (especially the password) are only ever stored server-side
 * and are never returned to the browser.
 */

const ftp = require("basic-ftp");
const path = require("path");

/**
 * Upload a single local file to an FTP server.
 *
 * @param {string} localFilePath - Absolute path to the file on disk.
 * @param {{ ftpHost: string; ftpPort?: number; ftpUser?: string; ftpPassword?: string; ftpRemotePath?: string }} settings
 * @returns {Promise<{ ok: boolean; error?: string }>}
 */
async function uploadFileToFtp(localFilePath, settings) {
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

    // Ensure the remote directory exists
    const remotePath = ftpRemotePath || "/";
    await client.ensureDir(remotePath);

    const remoteFile = path.posix.join(remotePath, path.basename(localFilePath));
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
 * @param {string[]} localFilePaths
 * @param {object} settings
 * @returns {Promise<{ ok: boolean; failed: number; error?: string }>}
 */
async function uploadFilesToFtp(localFilePaths, settings) {
  if (!localFilePaths || localFilePaths.length === 0) return { ok: true, failed: 0 };

  const { ftpHost, ftpPort = 21, ftpUser = "anonymous", ftpPassword = "", ftpRemotePath = "/" } = settings;

  if (!ftpHost) return { ok: false, failed: localFilePaths.length, error: "FTP host not configured" };

  const client = new ftp.Client();
  client.ftp.verbose = false;

  let failed = 0;
  try {
    await client.access({
      host: ftpHost,
      port: Number(ftpPort) || 21,
      user: ftpUser || "anonymous",
      password: ftpPassword || "",
      secure: false,
    });

    const remotePath = ftpRemotePath || "/";
    await client.ensureDir(remotePath);

    for (const localFilePath of localFilePaths) {
      try {
        const remoteFile = path.posix.join(remotePath, path.basename(localFilePath));
        await client.uploadFrom(localFilePath, remoteFile);
      } catch (err) {
        console.warn(`[FTP] File upload failed for ${path.basename(localFilePath)}:`, err.message);
        failed++;
      }
    }
  } catch (err) {
    return { ok: false, failed: localFilePaths.length, error: err.message || "FTP connection failed" };
  } finally {
    client.close();
  }

  return { ok: failed === 0, failed };
}

/**
 * Test a connection to an FTP server without uploading any files.
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

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "FTP connection failed" };
  } finally {
    client.close();
  }
}

module.exports = { uploadFileToFtp, uploadFilesToFtp, testFtpConnection };
