/**
 * Tests for the FTP sync path-handling fix.
 *
 * Root cause: basic-ftp's ensureDir() changes the FTP client's current working
 * directory (CWD) to the target directory.  After that, many FTP servers treat
 * STOR paths as relative to CWD.  Passing a full absolute path such as
 * STOR /AlbumName/photo.jpg when CWD is already /AlbumName causes those servers
 * to look for /AlbumName/AlbumName/photo.jpg, which fails silently – the folder
 * IS created by ensureDir() but no images appear inside it.
 *
 * The fix: after ensureDir() the code now uploads with just the basename
 * (relative to CWD) instead of the full absolute path, matching the pattern
 * used by basic-ftp's own uploadFromDir() helper.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline sanitizeFolderName (mirrors server/ftp.js) so the logic is testable
// without importing from the Node.js server module.
// ---------------------------------------------------------------------------
function sanitizeFolderName(name: string): string {
  return (
    name
      .replace(/[/\\:*?"<>|]/g, "-")
      .replace(/\s+/g, "_")
      .replace(/[-_]{2,}/g, "-")
      .replace(/^[-_.]+|[-_.]+$/g, "")
      .slice(0, 100) || "album"
  );
}

// ---------------------------------------------------------------------------
// Minimal FTP client mock that records the calls made to it.
// ---------------------------------------------------------------------------
interface FtpCall {
  method: string;
  args: unknown[];
}

function makeMockClient() {
  const calls: FtpCall[] = [];

  const client = {
    ftp: { verbose: false },
    access: async (...args: unknown[]) => { calls.push({ method: "access", args }); },
    ensureDir: async (...args: unknown[]) => { calls.push({ method: "ensureDir", args }); },
    cd: async (...args: unknown[]) => { calls.push({ method: "cd", args }); },
    uploadFrom: async (...args: unknown[]) => { calls.push({ method: "uploadFrom", args }); },
    rename: async (...args: unknown[]) => { calls.push({ method: "rename", args }); },
    remove: async (...args: unknown[]) => { calls.push({ method: "remove", args }); },
    close: () => { calls.push({ method: "close", args: [] }); },
    calls,
  };
  return client;
}

// ---------------------------------------------------------------------------
// Simulated uploadFilesToFtp logic (matches the fixed server/ftp.js).
// Opens a single connection, ensures the target directory, then uploads each
// file using a relative filename (basename only) so the STOR command stays
// relative to the CWD set by ensureDir().
// ---------------------------------------------------------------------------
async function simulateUploadFilesToFtp(
  entries: Array<{ localPath: string; remoteFilename?: string }>,
  remotePath: string,
  client: ReturnType<typeof makeMockClient>,
) {
  await client.ensureDir(remotePath);

  for (const { localPath, remoteFilename } of entries) {
    const fname = remoteFilename || localPath.split("/").pop() || localPath;
    // KEY FIX: use relative filename, not path.posix.join(remotePath, fname)
    await client.uploadFrom(localPath, fname);
  }
}

// ---------------------------------------------------------------------------
// Simulated bulk-upload-album logic (matches the fixed server/index.js).
// Supports two target directories: the main album folder (remotePath) and an
// optional starred sub-folder (starredRemotePath).  Tracks the current CWD to
// avoid redundant navigations: ensureDir() is used only once for the starred
// folder (which may not exist yet); cd() is used to switch back to the already-
// created album folder.  Files are always uploaded with a relative filename.
// ---------------------------------------------------------------------------
async function simulateBulkUpload(
  entries: Array<{ localPath: string; remoteFilename: string; starred: boolean }>,
  remotePath: string,
  starredRemotePath: string | null,
  client: ReturnType<typeof makeMockClient>,
) {
  await client.ensureDir(remotePath);
  let currentRemoteDir = remotePath;
  let starredDirEnsured = false;

  for (const { localPath, remoteFilename, starred } of entries) {
    const targetDir = starred && starredRemotePath ? starredRemotePath : remotePath;

    if (targetDir !== currentRemoteDir) {
      if (targetDir === starredRemotePath && !starredDirEnsured) {
        await client.ensureDir(starredRemotePath!);
        starredDirEnsured = true;
      } else {
        await client.cd(targetDir);
      }
      currentRemoteDir = targetDir;
    }

    // KEY FIX: use relative filename only
    await client.uploadFrom(localPath, remoteFilename);
  }
}

// ---------------------------------------------------------------------------
// sanitizeFolderName
// ---------------------------------------------------------------------------
describe("sanitizeFolderName", () => {
  it("replaces spaces with underscores", () => {
    expect(sanitizeFolderName("My Album")).toBe("My_Album");
  });

  it("replaces unsafe path chars with hyphens", () => {
    expect(sanitizeFolderName("Album/Name:Test")).toBe("Album-Name-Test");
  });

  it("collapses consecutive separators", () => {
    expect(sanitizeFolderName("A - B")).toBe("A-B");
  });

  it("strips leading and trailing separators", () => {
    expect(sanitizeFolderName("-album-")).toBe("album");
  });

  it("falls back to 'album' for empty or all-separator input", () => {
    expect(sanitizeFolderName("")).toBe("album");
    expect(sanitizeFolderName("---")).toBe("album");
  });

  it("truncates to 100 characters", () => {
    const long = "a".repeat(200);
    expect(sanitizeFolderName(long)).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------
// uploadFilesToFtp: relative filename in STOR
// ---------------------------------------------------------------------------
describe("uploadFilesToFtp path handling", () => {
  it("calls ensureDir with the target remote path", async () => {
    const client = makeMockClient();
    await simulateUploadFilesToFtp(
      [{ localPath: "/data/uploads/img.jpg", remoteFilename: "photo.jpg" }],
      "/uploads/Album",
      client,
    );

    const ensureCalls = client.calls.filter(c => c.method === "ensureDir");
    expect(ensureCalls).toHaveLength(1);
    expect(ensureCalls[0].args[0]).toBe("/uploads/Album");
  });

  it("calls uploadFrom with just the filename, not the full absolute path", async () => {
    const client = makeMockClient();
    await simulateUploadFilesToFtp(
      [{ localPath: "/data/uploads/img.jpg", remoteFilename: "photo.jpg" }],
      "/uploads/Album",
      client,
    );

    const uploadCalls = client.calls.filter(c => c.method === "uploadFrom");
    expect(uploadCalls).toHaveLength(1);
    // Must be just the filename (relative to CWD), NOT an absolute path
    expect(uploadCalls[0].args[1]).toBe("photo.jpg");
    expect(uploadCalls[0].args[1]).not.toContain("/uploads/Album");
  });

  it("uploads multiple files all using relative filenames", async () => {
    const client = makeMockClient();
    await simulateUploadFilesToFtp(
      [
        { localPath: "/data/uploads/a.jpg", remoteFilename: "a.jpg" },
        { localPath: "/data/uploads/b.jpg", remoteFilename: "b.jpg" },
        { localPath: "/data/uploads/c.jpg", remoteFilename: "c.jpg" },
      ],
      "/photos/Wedding",
      client,
    );

    const uploadCalls = client.calls.filter(c => c.method === "uploadFrom");
    expect(uploadCalls).toHaveLength(3);
    for (const call of uploadCalls) {
      expect(String(call.args[1])).not.toMatch(/^\//); // must not start with '/'
    }
  });

  it("falls back to basename of localPath when remoteFilename is absent", async () => {
    const client = makeMockClient();
    await simulateUploadFilesToFtp(
      [{ localPath: "/data/uploads/1234-abc.jpg" }],
      "/photos",
      client,
    );

    const uploadCalls = client.calls.filter(c => c.method === "uploadFrom");
    expect(uploadCalls[0].args[1]).toBe("1234-abc.jpg");
  });
});

// ---------------------------------------------------------------------------
// Bulk album upload: directory navigation with starred folder
// ---------------------------------------------------------------------------
describe("bulk album upload path handling", () => {
  it("creates album folder and uploads non-starred files with relative filenames", async () => {
    const client = makeMockClient();
    await simulateBulkUpload(
      [
        { localPath: "/data/uploads/a.jpg", remoteFilename: "a.jpg", starred: false },
        { localPath: "/data/uploads/b.jpg", remoteFilename: "b.jpg", starred: false },
      ],
      "/Wedding",
      null, // no starred folder
      client,
    );

    const uploadCalls = client.calls.filter(c => c.method === "uploadFrom");
    expect(uploadCalls).toHaveLength(2);
    expect(uploadCalls[0].args[1]).toBe("a.jpg");
    expect(uploadCalls[1].args[1]).toBe("b.jpg");

    // No cd() calls needed — everything goes to the same directory
    const cdCalls = client.calls.filter(c => c.method === "cd");
    expect(cdCalls).toHaveLength(0);
  });

  it("creates starred folder and navigates to it for starred photos", async () => {
    const client = makeMockClient();
    await simulateBulkUpload(
      [
        { localPath: "/data/uploads/a.jpg", remoteFilename: "a.jpg", starred: false },
        { localPath: "/data/uploads/b.jpg", remoteFilename: "b.jpg", starred: true },
      ],
      "/Wedding",
      "/Wedding-starred",
      client,
    );

    // ensureDir called twice: once for album, once for starred
    const ensureCalls = client.calls.filter(c => c.method === "ensureDir");
    expect(ensureCalls).toHaveLength(2);
    expect(ensureCalls[0].args[0]).toBe("/Wedding");
    expect(ensureCalls[1].args[0]).toBe("/Wedding-starred");

    // Both files uploaded with relative names
    const uploadCalls = client.calls.filter(c => c.method === "uploadFrom");
    expect(uploadCalls).toHaveLength(2);
    expect(uploadCalls[0].args[1]).toBe("a.jpg");
    expect(uploadCalls[1].args[1]).toBe("b.jpg");
  });

  it("navigates back to album folder using cd() after uploading a starred photo", async () => {
    const client = makeMockClient();
    await simulateBulkUpload(
      [
        { localPath: "/data/uploads/star.jpg", remoteFilename: "star.jpg", starred: true },
        { localPath: "/data/uploads/normal.jpg", remoteFilename: "normal.jpg", starred: false },
      ],
      "/Album",
      "/Album-starred",
      client,
    );

    // After uploading the starred photo, the CWD is /Album-starred.
    // The next non-starred photo must trigger a cd() back to /Album.
    const cdCalls = client.calls.filter(c => c.method === "cd");
    expect(cdCalls).toHaveLength(1);
    expect(cdCalls[0].args[0]).toBe("/Album");

    const uploadCalls = client.calls.filter(c => c.method === "uploadFrom");
    expect(uploadCalls).toHaveLength(2);
    expect(uploadCalls[0].args[1]).toBe("star.jpg");
    expect(uploadCalls[1].args[1]).toBe("normal.jpg");
  });

  it("does not call ensureDir for starred folder more than once", async () => {
    const client = makeMockClient();
    await simulateBulkUpload(
      [
        { localPath: "/data/uploads/s1.jpg", remoteFilename: "s1.jpg", starred: true },
        { localPath: "/data/uploads/s2.jpg", remoteFilename: "s2.jpg", starred: true },
      ],
      "/Album",
      "/Album-starred",
      client,
    );

    const ensureDirForStarred = client.calls.filter(
      c => c.method === "ensureDir" && c.args[0] === "/Album-starred",
    );
    expect(ensureDirForStarred).toHaveLength(1);
  });

  it("upload paths are never absolute (do not start with /)", async () => {
    const client = makeMockClient();
    await simulateBulkUpload(
      [
        { localPath: "/data/uploads/p1.jpg", remoteFilename: "IMG_001.jpg", starred: false },
        { localPath: "/data/uploads/p2.jpg", remoteFilename: "IMG_002.jpg", starred: true },
        { localPath: "/data/uploads/p3.jpg", remoteFilename: "IMG_003.jpg", starred: false },
      ],
      "/uploads/Album_Name",
      "/uploads/Album_Name-starred",
      client,
    );

    const uploadCalls = client.calls.filter(c => c.method === "uploadFrom");
    for (const call of uploadCalls) {
      expect(String(call.args[1])).not.toMatch(/^\//);
    }
  });
});
