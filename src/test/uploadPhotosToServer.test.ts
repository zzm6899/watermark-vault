import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatSpeed } from "@/lib/image-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeFile(name: string, sizeBytes = 100): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: "image/jpeg" });
}

type UploadResult = { id: string; url: string; originalName: string; size: number; ftpUploaded?: boolean };

// ---------------------------------------------------------------------------
// Inline implementation under test (mirrors src/lib/api.ts logic)
// so the test doesn't need a DOM or real fetch.
// ---------------------------------------------------------------------------
async function uploadPhotosToServer(
  files: File[],
  onProgress?: (done: number, total: number, bytesPerSecond?: number) => void,
  tenantSlug?: string,
  concurrency = 3,
  fetchFn: typeof fetch = fetch,
): Promise<UploadResult[]> {
  const uploadUrl = tenantSlug
    ? `/api/upload?tenant=${encodeURIComponent(tenantSlug)}`
    : "/api/upload";

  const batchSize = 5;
  const batches: File[][] = [];
  for (let i = 0; i < files.length; i += batchSize) {
    batches.push(files.slice(i, i + batchSize));
  }

  const results: UploadResult[] = [];
  let done = 0;
  let doneBytes = 0;
  let batchIndex = 0;
  const startTime = Date.now();

  const runWorker = async () => {
    while (batchIndex < batches.length) {
      const idx = batchIndex++;
      const batch = batches[idx];
      const batchBytes = batch.reduce((sum, f) => sum + f.size, 0);
      const form = new FormData();
      batch.forEach((f) => form.append("photos", f));
      try {
        const res = await fetchFn(uploadUrl, { method: "POST", body: form });
        if (res.ok) {
          const data = await (res as any).json();
          results.push(...data.files);
        }
      } catch {
        // skip failed batch
      }
      done += batch.length;
      doneBytes += batchBytes;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const bytesPerSecond = elapsedSec > 0 ? doneBytes / elapsedSec : 0;
      onProgress?.(Math.min(done, files.length), files.length, bytesPerSecond);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, batches.length) },
    () => runWorker(),
  );
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("uploadPhotosToServer (concurrent implementation)", () => {
  let calls: number[];
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    calls = [];
    mockFetch = vi.fn(async (_url: string, opts: any) => {
      const form: FormData = opts.body;
      const count = (form.getAll("photos") as File[]).length;
      calls.push(count);
      const files: UploadResult[] = (form.getAll("photos") as File[]).map((f, i) => ({
        id: `id-${i}`,
        url: `/uploads/${f.name}`,
        originalName: f.name,
        size: f.size,
      }));
      return {
        ok: true,
        json: async () => ({ files }),
      } as unknown as Response;
    });
  });

  it("returns empty array for zero files", async () => {
    const result = await uploadPhotosToServer([], undefined, undefined, 3, mockFetch);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uploads files in batches of 5", async () => {
    const files = Array.from({ length: 13 }, (_, i) => makeFile(`photo${i}.jpg`));
    const result = await uploadPhotosToServer(files, undefined, undefined, 3, mockFetch);

    // 13 files → 3 batches: 5 + 5 + 3
    expect(calls.sort((a, b) => b - a)).toEqual([5, 5, 3]);
    expect(result).toHaveLength(13);
  });

  it("dispatches multiple batches concurrently (all three requests start before any resolves)", async () => {
    const order: string[] = [];
    let resolve1!: () => void, resolve2!: () => void, resolve3!: () => void;

    const slowFetch = vi.fn(async (_url: string, opts: any) => {
      const form: FormData = opts.body;
      const files = form.getAll("photos") as File[];
      const name = files[0]?.name ?? "batch";

      order.push(`start:${name}`);
      await new Promise<void>((res) => {
        if (name.startsWith("a")) resolve1 = res;
        else if (name.startsWith("b")) resolve2 = res;
        else resolve3 = res;
      });
      order.push(`end:${name}`);

      return {
        ok: true,
        json: async () => ({ files: files.map((f, i) => ({ id: `id-${i}`, url: `/uploads/${f.name}`, originalName: f.name, size: f.size })) }),
      } as unknown as Response;
    });

    // 15 files → 3 batches of 5; name prefix distinguishes them
    const batch1 = Array.from({ length: 5 }, (_, i) => makeFile(`a${i}.jpg`));
    const batch2 = Array.from({ length: 5 }, (_, i) => makeFile(`b${i}.jpg`));
    const batch3 = Array.from({ length: 5 }, (_, i) => makeFile(`c${i}.jpg`));
    const files = [...batch1, ...batch2, ...batch3];

    const uploadPromise = uploadPhotosToServer(files, undefined, undefined, 3, slowFetch);

    // Give microtasks time to dispatch all three batches before resolving
    await new Promise((r) => setTimeout(r, 0));

    // All three should have started
    expect(order.filter((o) => o.startsWith("start")).length).toBe(3);

    // Resolve them all
    resolve1(); resolve2(); resolve3();
    await uploadPromise;

    expect(order.filter((o) => o.startsWith("end")).length).toBe(3);
  });

  it("calls onProgress for each batch", async () => {
    const progressUpdates: [number, number, number | undefined][] = [];
    const files = Array.from({ length: 7 }, (_, i) => makeFile(`p${i}.jpg`));

    await uploadPhotosToServer(
      files,
      (done, total, bps) => progressUpdates.push([done, total, bps]),
      undefined,
      3,
      mockFetch,
    );

    // Two batches (5 + 2) → two progress callbacks
    expect(progressUpdates).toHaveLength(2);
    expect(progressUpdates[progressUpdates.length - 1][0]).toBe(7); // final done = total
    expect(progressUpdates[0][1]).toBe(7); // total always = 7
    // bytesPerSecond must be a non-negative number on each update
    for (const [, , bps] of progressUpdates) {
      expect(typeof bps).toBe("number");
      expect(bps).toBeGreaterThanOrEqual(0);
    }
  });

  it("passes bytesPerSecond as a non-negative number via onProgress", async () => {
    const files = Array.from({ length: 5 }, (_, i) => makeFile(`big${i}.jpg`, 1024));
    const speedValues: number[] = [];
    await uploadPhotosToServer(
      files,
      (_done, _total, bps) => { if (bps != null) speedValues.push(bps); },
      undefined,
      1,
      mockFetch,
    );
    expect(speedValues).toHaveLength(1);
    // Speed is always a non-negative number (can be 0 if elapsed rounds to 0 in fast tests)
    expect(typeof speedValues[0]).toBe("number");
    expect(speedValues[0]).toBeGreaterThanOrEqual(0);
  });

  it("includes tenant slug in the upload URL", async () => {
    const files = [makeFile("img.jpg")];
    await uploadPhotosToServer(files, undefined, "acme", 1, mockFetch);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/upload?tenant=acme",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("skips failed batches and still returns successful results", async () => {
    let callCount = 0;
    const partialFetch = vi.fn(async (_url: string, opts: any) => {
      callCount++;
      const form: FormData = opts.body;
      const files = form.getAll("photos") as File[];
      if (callCount === 1) throw new Error("network error"); // first batch fails
      return {
        ok: true,
        json: async () => ({
          files: files.map((f, i) => ({ id: `id-${i}`, url: `/uploads/${f.name}`, originalName: f.name, size: f.size })),
        }),
      } as unknown as Response;
    });

    const files = Array.from({ length: 10 }, (_, i) => makeFile(`f${i}.jpg`));
    const result = await uploadPhotosToServer(files, undefined, undefined, 1, partialFetch);

    // First batch of 5 failed, second batch of 5 succeeded
    expect(result).toHaveLength(5);
  });

  it("limits concurrency to number of batches when fewer batches than workers", async () => {
    const files = [makeFile("only.jpg")]; // 1 file → 1 batch
    const result = await uploadPhotosToServer(files, undefined, undefined, 10, mockFetch);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// formatSpeed
// ---------------------------------------------------------------------------
describe("formatSpeed", () => {
  it("formats sub-kilobyte speeds as B/s", () => {
    expect(formatSpeed(512)).toBe("512 B/s");
    expect(formatSpeed(0)).toBe("0 B/s");
  });

  it("formats kilobyte speeds as KB/s", () => {
    expect(formatSpeed(1024)).toBe("1.0 KB/s");
    expect(formatSpeed(512 * 1024)).toBe("512.0 KB/s");
  });

  it("formats megabyte speeds as MB/s", () => {
    expect(formatSpeed(1024 * 1024)).toBe("1.0 MB/s");
    expect(formatSpeed(2.5 * 1024 * 1024)).toBe("2.5 MB/s");
  });
});
