

## Optimize Image Rendering Sizes

### Problem
Currently, the gallery grid and lightbox both load full-resolution images (~2160x1440, ~319KB+). The grid progressively upgrades from thumbnails to full-res, and the lightbox loads full-res directly. This wastes bandwidth.

### Changes

**1. Grid view (gallery + admin) -- use thumbnails only, no upgrade to full-res**

- **`src/components/WatermarkedImage.tsx`**: Remove the progressive upgrade logic that loads `fullSrc` after thumbnail. The grid will only display `photo.thumbnail` (300px, ~30-50KB). The `fullSrc` prop will be ignored for grid rendering.
- **`src/components/ProgressiveImg.tsx`** (used in Admin): Same change -- stop upgrading from thumbnail to full-res. Only show the thumbnail.

**2. Lightbox (individual photo view) -- use medium-quality image (~600KB target)**

- **`src/pages/AlbumDetail.tsx`** (lines 596-601): Instead of loading `photo.src` (full-res) directly, generate a medium-quality version on-the-fly using the existing `resizeToTargetSize` utility, targeting ~600KB. Cache the result in component state so it only generates once per photo.

**3. Fix build errors (required for deployment)**

These are TypeScript type definition gaps that block the build. The code already works at runtime but TypeScript rejects it:

- **`src/lib/types.ts`**:
  - Add `"deposit-paid"` to `PaymentStatus` union
  - Add `emailLog` property to `Booking` interface
  - Add `prices` property to `EventType` interface
- **`src/pages/Booking.tsx`** (line 69): Fix import path from `"./types"` to `"@/lib/types"`

### Technical Details

Grid rendering flow (after change):
```text
Upload --> compressImage(1600px) --> stored as photo.src
       --> generateThumbnail(300px) --> stored as photo.thumbnail

Grid display: photo.thumbnail only (no upgrade)
Lightbox: photo.src loaded, then resized client-side to ~600KB blob URL
Admin grid: photo.thumbnail only (no upgrade)
Downloads: still use photo.src (original quality, user-selected size)
```

Files modified:
- `src/components/WatermarkedImage.tsx` -- remove fullSrc upgrade
- `src/components/ProgressiveImg.tsx` -- remove fullSrc upgrade  
- `src/pages/AlbumDetail.tsx` -- lightbox uses ~600KB resized version
- `src/lib/types.ts` -- add missing type fields
- `src/pages/Booking.tsx` -- fix import path

