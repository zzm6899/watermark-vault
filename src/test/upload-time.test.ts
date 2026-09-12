import { expect, it } from "vitest";
import { uploadTimeRemaining } from "@/lib/upload-time";

it("estimates remaining upload time from bytes rather than photo count", () => {
  expect(uploadTimeRemaining(456_000_000, 3_800_000)).toBe("About 2 min remaining");
  expect(uploadTimeRemaining(1_000_000, 3_800_000)).toBe("Less than a minute remaining");
  expect(uploadTimeRemaining(3700, 1)).toBe("About 1 hr 2 min remaining");
});
it("waits for a measured speed and handles completion", () => {
  for (const speed of [null, 0, -1, Infinity, NaN]) expect(uploadTimeRemaining(100, speed)).toBe("Estimating time…");
  expect(uploadTimeRemaining(0, 100)).toBe("Finishing…");
});
