

## Plan: Fix Build Errors and Multiple Bugs

There are several interconnected issues to resolve: TypeScript build errors from missing type definitions, a server-side crash, sync storage not deleting orphans, photo library uploads not generating thumbnails properly, and no visibility into background rendering. Here's the breakdown:

---

### 1. Add missing type definitions to `src/lib/types.ts`

The `types.ts` file is missing several properties and types that `Admin.tsx` and `storage.ts` reference:

- **`WaitlistEntry`** interface (used in storage.ts and Admin.tsx)
- **`EmailTemplate`** interface (used in storage.ts and Admin.tsx)
- **`watermarkSize`** on `AppSettings`
- **`proofingEnabled`** on `AppSettings`
- **`proofingEnabled`**, **`proofingStage`**, **`proofingRounds`**, **`clientToken`**, **`downloadExpiresAt`**, **`watermarkDisabled`**, **`purchasingDisabled`** on `Album`
- **`gcalEventId`**, **`answerLabels`**, **`emailLog`** on `Booking`
- **`purchaserEmail`** on `AlbumDownloadRecord`
- **`prices`** on `EventType`
- **`"deposit-paid"`** added to `PaymentStatus` union
- **`stage`** added to preview job state type in Admin.tsx

This is the bulk of the ~60 build errors — all stem from the types file not being updated to match the features already coded in Admin.tsx.

---

### 2. Fix server crash: `clearImageCache is not defined` in `server/index.js`

The `/api/cache/clear` and `/api/upload/all` endpoints call `clearImageCache()` but this function is never defined. Will add a simple implementation that clears any cached/resized images from the uploads directory (or make it a no-op if there's no cache directory).

---

### 3. Fix "Sync Storage" not deleting orphaned files

Currently `handleSyncFromStorage` in Admin.tsx finds orphaned files and reports them in a toast, but never actually calls `bulkDeleteFiles()` to remove them. Will add the actual deletion call after identifying orphans, with a confirmation step.

---

### 4. Fix photo library uploads not generating thumbnails when filtered to an album

In the Photos tab `handleUpload` (server mode path, line ~3040), uploaded photos get a query-string thumbnail (`?w=200&wm=0`) but no actual canvas-generated thumbnail. The background `useBackfillThumbnails` hook should handle this, but the uploaded photos may not have `uploadedAt` set (line 3041 is missing it). Will add `uploadedAt` to ensure the backfill hook picks them up, and trigger a thumbnail generation pass after upload completes.

---

### 5. Show background rendering progress in `/admin/storage`

The storage view already shows a "Preview & Watermark Rendering" section. The `useBackfillThumbnails` hook runs but doesn't expose its progress. Will add a visible indicator showing which photos are currently being processed by the background thumbnail backfill, with a count of pending/completed items.

---

### Technical Details

**Types to add to `src/lib/types.ts`:**
```typescript
export interface WaitlistEntry {
  id: string;
  eventTypeId: string;
  eventTypeTitle: string;
  date: string;
  clientName: string;
  clientEmail: string;
  note?: string;
  createdAt: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
  text?: string;
}
```

Add to `PaymentStatus`: `"deposit-paid"`

Add to `AppSettings`: `watermarkSize: number`, `proofingEnabled: boolean`

Add to `Album`: `proofingEnabled?: boolean`, `proofingStage?: string`, `proofingRounds?: number`, `clientToken?: string`, `downloadExpiresAt?: string`, `watermarkDisabled?: boolean`, `purchasingDisabled?: boolean`

Add to `Booking`: `gcalEventId?: string`, `answerLabels?: Record<string, string>`, `emailLog?: any[]`

Add to `AlbumDownloadRecord`: `purchaserEmail?: string`

Add to `EventType`: `prices?: Record<string, number>`

**Server fix** (`server/index.js`): Define `clearImageCache` as a function that removes any `_cache` subdirectory or is a no-op.

**Sync storage fix**: After finding orphans, call `bulkDeleteFiles(orphanedFileNames)` and report deleted count.

**Upload fix**: Add `uploadedAt` timestamp to photos created in the Photos tab server-mode upload path.

**Background rendering visibility**: Add progress state from `useBackfillThumbnails` hook and display in the storage view panel.

