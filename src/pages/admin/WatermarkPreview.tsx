import React, { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { drawServerAlignedWatermark } from "@/lib/watermark-render";
import type { AppSettings } from "@/lib/types";
import sampleLandscape from "@/assets/sample-landscape.jpg";
import samplePortrait from "@/assets/sample-portrait.jpg";
import sampleWedding from "@/assets/sample-wedding.jpg";
import sampleEvent from "@/assets/sample-event.jpg";
import sampleFood from "@/assets/sample-food.jpg";

type WatermarkBakeSettings = Pick<AppSettings, "watermarkText" | "watermarkImage" | "watermarkPosition" | "watermarkOpacity" | "watermarkSize">;

async function loadImage(src: string): Promise<HTMLImageElement> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Failed to fetch preview: ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  return await new Promise((resolve, reject) => {
    const image = document.createElement("img");
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load preview")); };
    image.src = url;
  });
}

async function loadOptionalImage(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  return await new Promise(resolve => {
    const image = document.createElement("img");
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function renderWatermarkPreviewAsset(src: string, settings: WatermarkBakeSettings): Promise<string> {
  const baseImage = await loadImage(src);
  const watermarkImage = await loadOptionalImage(settings.watermarkImage || undefined);
  const scale = Math.min(1, 1400 / Math.max(1, baseImage.width));
  const width = Math.max(1, Math.round(baseImage.width * scale));
  const height = Math.max(1, Math.round(baseImage.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas not available");
  context.drawImage(baseImage, 0, 0, width, height);
  drawServerAlignedWatermark(context, width, height, watermarkImage, settings);
  return canvas.toDataURL("image/jpeg", 0.9);
}

const SAMPLE_IMAGES = [
  { src: sampleLandscape, label: "Landscape" },
  { src: samplePortrait, label: "Portrait" },
  { src: sampleWedding, label: "Wedding" },
  { src: sampleEvent, label: "Event" },
  { src: sampleFood, label: "Food" },
];

function WatermarkPreviewWithSamples({ settings, dirty }: { settings: AppSettings; dirty: boolean }) {
  const [selectedSample, setSelectedSample] = useState(0);
  const currentSrc = SAMPLE_IMAGES[selectedSample].src;
  const hasVisibleWatermark = !!settings.watermarkImage || !!(settings.watermarkText || "").trim();
  const [renderedPreview, setRenderedPreview] = useState("");
  const [previewRendering, setPreviewRendering] = useState(true);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const previewSettings: WatermarkBakeSettings = {
      watermarkImage: settings.watermarkImage,
      watermarkOpacity: settings.watermarkOpacity,
      watermarkPosition: settings.watermarkPosition,
      watermarkSize: settings.watermarkSize,
      watermarkText: settings.watermarkText,
    };
    setRenderedPreview("");
    setPreviewRendering(true);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      renderWatermarkPreviewAsset(currentSrc, previewSettings)
        .then(result => {
          if (!cancelled) setRenderedPreview(result);
        })
        .catch(() => {
          if (!cancelled) setPreviewError("Preview rendering failed. Your saved source image was not changed.");
        })
        .finally(() => {
          if (!cancelled) setPreviewRendering(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentSrc, settings.watermarkImage, settings.watermarkOpacity, settings.watermarkPosition, settings.watermarkSize, settings.watermarkText]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-body tracking-wider uppercase text-muted-foreground">Live preview</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">Switch photos to check contrast and placement.</p>
        </div>
        <span className={`text-[10px] font-body rounded-full px-2 py-1 ${dirty ? "bg-amber-500/10 text-amber-300" : "bg-green-500/10 text-green-400"}`}>
          {dirty ? "Unsaved" : "Saved"}
        </span>
      </div>
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Preview photo">
        {SAMPLE_IMAGES.map((img, i) => (
          <button key={img.label} type="button" onClick={() => setSelectedSample(i)} aria-pressed={selectedSample === i}
            className={`text-[10px] font-body px-2.5 py-1 rounded-full border transition-all ${
              selectedSample === i ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"
            }`}>{img.label}</button>
        ))}
      </div>
      <div className="rounded-xl border border-border/60 p-2 sm:p-3 shadow-inner"
        style={{ backgroundColor: "#18181b", backgroundImage: "linear-gradient(45deg,#27272a 25%,transparent 25%),linear-gradient(-45deg,#27272a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#27272a 75%),linear-gradient(-45deg,transparent 75%,#27272a 75%)", backgroundSize: "18px 18px", backgroundPosition: "0 0,0 9px,9px -9px,-9px 0" }}>
        <div className="relative rounded-lg overflow-hidden bg-black shadow-xl min-h-52 flex items-center justify-center">
          {renderedPreview ? (
            <img src={renderedPreview} alt={`${SAMPLE_IMAGES[selectedSample].label} watermark preview`} className="block w-full h-auto" />
          ) : (
            <div className="aspect-[3/2] w-full flex flex-col items-center justify-center gap-2 text-muted-foreground bg-secondary/40">
              <RefreshCw className={`w-5 h-5 ${previewRendering ? "animate-spin" : ""}`} />
              <span className="text-[10px] font-body">{previewRendering ? "Rendering server-aligned preview…" : "Preview unavailable"}</span>
            </div>
          )}
        </div>
      </div>
      {previewError && <p role="alert" className="text-[10px] font-body text-destructive">{previewError}</p>}
      {!hasVisibleWatermark && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
          <p className="text-[10px] font-body text-amber-200">No text or image is set, so gallery previews will have no visible watermark.</p>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-secondary/40 p-2 text-center">
          <p className="text-[9px] font-body uppercase tracking-wider text-muted-foreground">Position</p>
          <p className="text-[11px] font-body text-foreground mt-0.5 capitalize">{settings.watermarkPosition.replace("-", " ")}</p>
        </div>
        <div className="rounded-lg bg-secondary/40 p-2 text-center">
          <p className="text-[9px] font-body uppercase tracking-wider text-muted-foreground">Opacity</p>
          <p className="text-[11px] font-mono text-foreground mt-0.5">{settings.watermarkOpacity}%</p>
        </div>
        <div className="rounded-lg bg-secondary/40 p-2 text-center">
          <p className="text-[9px] font-body uppercase tracking-wider text-muted-foreground">Scale</p>
          <p className="text-[11px] font-mono text-foreground mt-0.5">{settings.watermarkSize ?? 40}%</p>
        </div>
      </div>
    </div>
  );
}


export default WatermarkPreviewWithSamples;

