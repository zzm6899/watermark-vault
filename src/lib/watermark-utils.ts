/**
 * Shared watermark baking utilities.
 * Used by Admin and MobileCapture to bake watermarked image variants
 * client-side (thumbnail, medium, full) so the gallery can serve them
 * without waiting for on-the-fly server processing.
 */
import type { WatermarkPosition } from "./types";

export type BakedAssetKind = "thumbnail" | "medium" | "full";

export type WatermarkBakeSettings = {
  watermarkText?: string;
  watermarkImage?: string;
  watermarkPosition?: WatermarkPosition;
  watermarkOpacity?: number;
  watermarkSize?: number;
  watermarkVersion?: number;
};

// Per-kind config: gallery thumbnail, lightbox medium, download full
const KIND_CONFIG: Record<BakedAssetKind, { maxSide: number; targetBytes: number; quality: number }> = {
  thumbnail: { maxSide: 900, targetBytes: 280 * 1024, quality: 0.82 },
  medium:    { maxSide: 2200, targetBytes: 600 * 1024, quality: 0.86 },
  full:      { maxSide: 3600, targetBytes: 1600 * 1024, quality: 0.9 },
};

async function loadImageFromSrc(src: string): Promise<HTMLImageElement> {
  const cleanSrc = src.replace(/([?&])wm=0(?=&|$)/g, "$1").replace(/[?&]$/, "");
  const response = await fetch(cleanSrc);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}

async function loadOptionalImage(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function computeWatermarkRect(
  position: WatermarkPosition,
  canvasWidth: number,
  canvasHeight: number,
  drawWidth: number,
  drawHeight: number,
) {
  const padX = Math.max(16, canvasWidth * 0.03);
  const padY = Math.max(16, canvasHeight * 0.03);
  switch (position) {
    case "top-left": return { x: padX, y: padY };
    case "top-right": return { x: canvasWidth - drawWidth - padX, y: padY };
    case "bottom-left": return { x: padX, y: canvasHeight - drawHeight - padY };
    case "bottom-right": return { x: canvasWidth - drawWidth - padX, y: canvasHeight - drawHeight - padY };
    default: return { x: (canvasWidth - drawWidth) / 2, y: (canvasHeight - drawHeight) / 2 };
  }
}

export async function bakeWatermarkedAsset(
  src: string,
  settings: WatermarkBakeSettings,
  kind: BakedAssetKind,
): Promise<string> {
  const baseImg = await loadImageFromSrc(src);
  const watermarkImg = await loadOptionalImage(settings.watermarkImage || undefined);

  const cfg = KIND_CONFIG[kind];
  const scale = Math.min(1, cfg.maxSide / Math.max(baseImg.width, baseImg.height));
  const width = Math.max(1, Math.round(baseImg.width * scale));
  const height = Math.max(1, Math.round(baseImg.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");

  ctx.drawImage(baseImg, 0, 0, width, height);

  const opacity = Math.max(0.05, Math.min(0.95, (settings.watermarkOpacity ?? 15) / 100));
  const sizePct = Math.max(10, Math.min(100, settings.watermarkSize ?? 40));
  const position = settings.watermarkPosition ?? "center";
  const shortSide = Math.min(width, height);

  ctx.save();
  ctx.globalAlpha = opacity;

  if (position === "tiled") {
    ctx.translate(width / 2, height / 2);
    ctx.rotate((-30 * Math.PI) / 180);
    ctx.translate(-width / 2, -height / 2);

    const stepX = Math.max(140, width * 0.18);
    const stepY = Math.max(110, height * 0.16);

    if (watermarkImg) {
      const tileH = Math.max(24, shortSide * (sizePct / 100) * 0.18);
      const tileW = watermarkImg.width * (tileH / watermarkImg.height);
      for (let y = -height * 0.4; y < height * 1.4; y += stepY) {
        for (let x = -width * 0.4; x < width * 1.4; x += stepX) {
          ctx.drawImage(watermarkImg, x, y, tileW, tileH);
        }
      }
    } else {
      ctx.fillStyle = "white";
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = Math.max(1, shortSide * 0.002);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `600 ${Math.max(18, shortSide * (sizePct / 100) * 0.055)}px serif`;
      const text = settings.watermarkText || "ZACMPHOTOS";
      for (let y = -height * 0.4; y < height * 1.4; y += stepY) {
        for (let x = -width * 0.4; x < width * 1.4; x += stepX) {
          ctx.strokeText(text, x, y);
          ctx.fillText(text, x, y);
        }
      }
    }
  } else if (watermarkImg) {
    const drawWidth = Math.max(80, width * (sizePct / 100) * (position === "center" ? 0.55 : 0.3));
    const drawHeight = drawWidth * (watermarkImg.height / watermarkImg.width);
    const rect = computeWatermarkRect(position, width, height, drawWidth, drawHeight);
    if (position === "center") {
      ctx.translate(width / 2, height / 2);
      ctx.rotate((-30 * Math.PI) / 180);
      ctx.drawImage(watermarkImg, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    } else {
      ctx.drawImage(watermarkImg, rect.x, rect.y, drawWidth, drawHeight);
    }
  } else {
    const text = settings.watermarkText || "ZACMPHOTOS";
    const fontSize = Math.max(20, shortSide * (sizePct / 100) * (position === "center" ? 0.08 : 0.05));
    ctx.font = `600 ${fontSize}px serif`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "white";
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = Math.max(1, fontSize * 0.08);

    const metrics = ctx.measureText(text);
    const drawWidth = metrics.width;
    const drawHeight = fontSize;
    const rect = computeWatermarkRect(position, width, height, drawWidth, drawHeight);

    if (position === "center") {
      ctx.translate(width / 2, height / 2);
      ctx.rotate((-30 * Math.PI) / 180);
      ctx.strokeText(text, -drawWidth / 2, -drawHeight / 2);
      ctx.fillText(text, -drawWidth / 2, -drawHeight / 2);
    } else {
      ctx.strokeText(text, rect.x, rect.y);
      ctx.fillText(text, rect.x, rect.y);
    }
  }

  ctx.restore();

  let quality = cfg.quality;
  let out = canvas.toDataURL("image/jpeg", quality);
  while ((out.length * 0.75) > cfg.targetBytes && quality > 0.45) {
    quality -= 0.05;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

/** Returns true if the photo's baked watermarks are stale vs current settings version */
export function photoNeedsBakedRefresh(photo: any, settings: WatermarkBakeSettings, forceAll = false): boolean {
  if (forceAll) return true;
  const version = settings.watermarkVersion ?? 0;
  return !photo.thumbnailWatermarked || !photo.mediumWatermarked || !photo.fullWatermarked || photo.watermarkVersion !== version;
}

/** Rebuild baked watermark assets for all photos that need it */
export async function rebuildWatermarkedAssets(
  settings: WatermarkBakeSettings,
  photos: any[],
  forceAll: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<{ success: number; failed: number; total: number }> {
  const version = settings.watermarkVersion ?? 0;
  const targets = forceAll ? photos : photos.filter(p => photoNeedsBakedRefresh(p, settings));

  let success = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const photo = targets[i];
    try {
      const [thumbnailWatermarked, mediumWatermarked, fullWatermarked] = await Promise.all([
        bakeWatermarkedAsset(photo.src, settings, "thumbnail"),
        bakeWatermarkedAsset(photo.src, settings, "medium"),
        bakeWatermarkedAsset(photo.src, settings, "full"),
      ]);
      // Persist via callback
      onProgress?.(i, targets.length); // signal before persist so UI updates
      photo._bakedResult = { thumbnailWatermarked, mediumWatermarked, fullWatermarked, watermarkVersion: version, watermarkUpdatedAt: new Date().toISOString() };
      success++;
    } catch {
      failed++;
    }
    onProgress?.(i + 1, targets.length);
  }

  return { success, failed, total: targets.length };
}
