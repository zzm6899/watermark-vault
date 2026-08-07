import type { AppSettings, WatermarkPosition } from "./types";

export type WatermarkRenderSettings = Pick<AppSettings, "watermarkText" | "watermarkImage" | "watermarkPosition" | "watermarkOpacity" | "watermarkSize">;

export type WatermarkRenderPlan = {
  width: number;
  height: number;
  position: WatermarkPosition;
  opacity: number;
  scale: number;
  fontSize: number;
  imageTileWidth: number;
  imageGapX: number;
  imageGapY: number;
  textCellWidth: number;
  textCellHeight: number;
  positionedInset: number;
  positionedImageWidth: number;
  positionedImageMaxHeight: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Mirrors server/index.js buildWatermarkOverlay geometry for a rendered source canvas. */
export function watermarkRenderPlan(widthValue: number, heightValue: number, settings: WatermarkRenderSettings): WatermarkRenderPlan {
  const width = Math.max(1, Math.round(widthValue));
  const height = Math.max(1, Math.round(heightValue));
  const position = settings.watermarkPosition || "center";
  const scale = clamp(Number(settings.watermarkSize) || 40, 10, 100);
  const opacity = clamp((Number(settings.watermarkOpacity) || 0) / 100, 0, 1);
  const baseFontSize = Math.min(48, Math.max(18, Math.round(width * 0.03)));
  const fontSize = Math.min(120, Math.max(10, Math.round(baseFontSize * (scale / 40))));
  const positionedInset = position === "center" ? 0 : 20;
  const positionedImageMaxWidth = Math.max(1, width - positionedInset * 2);
  return {
    width,
    height,
    position,
    opacity,
    scale,
    fontSize,
    imageTileWidth: Math.min(400, Math.max(24, Math.round(width * 0.12 * (scale / 40)))),
    imageGapX: Math.max(1, Math.round(width * 0.35)),
    imageGapY: Math.max(1, Math.round(height * 0.25)),
    textCellWidth: Math.max(1, Math.round(width * 0.38)),
    textCellHeight: Math.max(1, Math.round(height * 0.22)),
    positionedInset,
    positionedImageWidth: Math.min(positionedImageMaxWidth, Math.max(1, Math.round(width * (scale / 100)))),
    positionedImageMaxHeight: Math.max(1, height - positionedInset * 2),
  };
}

function positionedRect(position: Exclude<WatermarkPosition, "tiled">, width: number, height: number, drawWidth: number, drawHeight: number, inset: number, clampEdges = false) {
  switch (position) {
    case "top-left": return { x: inset, y: inset };
    case "top-right": return { x: clampEdges ? Math.max(0, width - drawWidth - inset) : width - drawWidth - inset, y: inset };
    case "bottom-left": return { x: inset, y: clampEdges ? Math.max(0, height - drawHeight - inset) : height - drawHeight - inset };
    case "bottom-right": return {
      x: clampEdges ? Math.max(0, width - drawWidth - inset) : width - drawWidth - inset,
      y: clampEdges ? Math.max(0, height - drawHeight - inset) : height - drawHeight - inset,
    };
    case "center":
    default: return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2 };
  }
}

function setCanvasLetterSpacing(ctx: CanvasRenderingContext2D, value: string) {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = value;
}

function rotatedImageCanvas(image: CanvasImageSource, width: number, height: number) {
  const angle = -Math.PI / 6;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const rotatedWidth = Math.max(1, Math.ceil(width * cos + height * sin));
  const rotatedHeight = Math.max(1, Math.ceil(width * sin + height * cos));
  const canvas = document.createElement("canvas");
  canvas.width = rotatedWidth;
  canvas.height = rotatedHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(rotatedWidth / 2, rotatedHeight / 2);
  ctx.rotate(angle);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  return canvas;
}

/** Draws only the watermark layer, with the same formulas used by the server renderer. */
export function drawServerAlignedWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  watermarkImage: HTMLImageElement | null,
  settings: WatermarkRenderSettings,
) {
  const plan = watermarkRenderPlan(width, height, settings);
  const text = settings.watermarkText || "ZACMPHOTOS";
  ctx.save();
  ctx.globalAlpha = plan.opacity;

  if (plan.position === "tiled") {
    if (watermarkImage?.naturalWidth || watermarkImage?.width) {
      const naturalWidth = watermarkImage.naturalWidth || watermarkImage.width;
      const naturalHeight = watermarkImage.naturalHeight || watermarkImage.height;
      const tileWidth = plan.imageTileWidth;
      const tileHeight = Math.max(1, Math.round(naturalHeight * (tileWidth / naturalWidth)));
      const rotated = rotatedImageCanvas(watermarkImage, tileWidth, tileHeight);
      if (rotated) {
        for (let y = -plan.imageGapY; y < plan.height + plan.imageGapY; y += plan.imageGapY) {
          for (let x = -plan.imageGapX; x < plan.width + plan.imageGapX; x += plan.imageGapX) {
            ctx.drawImage(rotated, Math.round(x), Math.round(y));
          }
        }
      }
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.font = `${plan.fontSize}px Georgia, serif`;
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      setCanvasLetterSpacing(ctx, "2px");
      const cols = Math.ceil(plan.width / plan.textCellWidth) + 2;
      const rows = Math.ceil(plan.height / plan.textCellHeight) + 2;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = Math.round((col - 0.5) * plan.textCellWidth);
          const y = Math.round((row - 0.5) * plan.textCellHeight);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-Math.PI / 6);
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.restore();
    return;
  }

  if (watermarkImage?.naturalWidth || watermarkImage?.width) {
    const naturalWidth = watermarkImage.naturalWidth || watermarkImage.width;
    const naturalHeight = watermarkImage.naturalHeight || watermarkImage.height;
    const fitScale = Math.min(plan.positionedImageWidth / naturalWidth, plan.positionedImageMaxHeight / naturalHeight);
    const drawWidth = Math.max(1, Math.round(naturalWidth * fitScale));
    const drawHeight = Math.max(1, Math.round(naturalHeight * fitScale));
    const rect = positionedRect(plan.position, plan.width, plan.height, drawWidth, drawHeight, plan.positionedInset);
    ctx.drawImage(watermarkImage, Math.round(rect.x), Math.round(rect.y), drawWidth, drawHeight);
    ctx.restore();
    return;
  }

  const drawWidth = Math.round(plan.fontSize * text.length * 0.65);
  const drawHeight = plan.fontSize * 2;
  const rect = positionedRect(plan.position, plan.width, plan.height, drawWidth, drawHeight, plan.positionedInset, true);
  ctx.fillStyle = "#ffffff";
  ctx.font = `${plan.fontSize}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setCanvasLetterSpacing(ctx, "2px");
  ctx.translate(rect.x + drawWidth / 2, rect.y + drawHeight / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.fillText(text, 0, drawHeight * 0.1);
  ctx.restore();
}
