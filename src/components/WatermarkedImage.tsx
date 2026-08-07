import { useEffect, useState } from "react";
import { Check, Download, ImageOff, Lock } from "lucide-react";
import { motion } from "framer-motion";
import type { WatermarkPosition } from "@/lib/types";

interface WatermarkedImageProps {
  src: string;
  fullSrc?: string;
  title: string;
  selected?: boolean;
  onSelect?: () => void;
  locked?: boolean;
  index?: number;
  showWatermark?: boolean;
  watermarkPosition?: WatermarkPosition;
  watermarkText?: string;
  watermarkImage?: string;
  watermarkOpacity?: number;
  watermarkSize?: number;
  width?: number;
  height?: number;
  /** Use only in admin/settings live preview. Client galleries should use baked assets instead. */
  renderWatermarkOverlay?: boolean;
  /** Removes gallery hover affordances so settings previews represent only the rendered asset. */
  previewMode?: boolean;
}

const positionAlignment: Record<Exclude<WatermarkPosition, "tiled">, string> = {
  center: "items-center justify-center",
  "top-left": "items-start justify-start",
  "top-right": "items-start justify-end",
  "bottom-left": "items-end justify-start",
  "bottom-right": "items-end justify-end",
};

export default function WatermarkedImage({
  src,
  fullSrc,
  title,
  selected,
  onSelect,
  locked,
  index = 0,
  showWatermark = true,
  watermarkPosition = "center",
  watermarkText = "ZACMPHOTOS",
  watermarkImage,
  watermarkOpacity = 15,
  watermarkSize = 40,
  width,
  height,
  renderWatermarkOverlay = false,
  previewMode = false,
}: WatermarkedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [activeSrc, setActiveSrc] = useState(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setActiveSrc(src);
    setLoaded(false);
    setFailed(false);
  }, [src, fullSrc]);

  const aspectRatio = width && height && width > 0 && height > 0 ? width / height : undefined;

  const opacityValue = watermarkOpacity / 100;
  const imgSizePx = `${watermarkSize}%`;
  const fontSizePx = Math.min(54, Math.max(14, watermarkSize * 0.45));
  const tiledImageHeightPx = Math.max(16, watermarkSize * 0.5);
  const tiledTextSizePx = Math.max(10, watermarkSize * 0.45);

  const renderWatermark = () => {
    if (watermarkImage) {
      if (watermarkPosition === "tiled") {
        return (
          <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
            <div
              className="absolute inset-0 flex flex-wrap items-start justify-start gap-x-16 gap-y-12 rotate-[-30deg] scale-150 origin-center"
              style={{ opacity: opacityValue }}
            >
              {Array.from({ length: 20 }).map((_, i) => (
                <img
                  key={i}
                  src={watermarkImage}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ height: `${tiledImageHeightPx}px`, width: "auto" }}
                />
              ))}
            </div>
          </div>
        );
      }

      return (
        <div className={`absolute inset-0 flex pointer-events-none select-none ${watermarkPosition === "center" ? "" : "p-4"} ${positionAlignment[watermarkPosition]}`}>
          <img
            src={watermarkImage}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ opacity: opacityValue, width: imgSizePx, maxWidth: "100%", maxHeight: "100%", objectFit: "contain", height: "auto" }}
          />
        </div>
      );
    }

    if (watermarkPosition === "tiled") {
      return (
        <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
          <div
            className="absolute inset-0 flex flex-wrap items-start justify-start gap-x-16 gap-y-12 rotate-[-30deg] scale-150 origin-center"
            style={{ opacity: opacityValue }}
          >
            {Array.from({ length: 20 }).map((_, i) => (
              <p
                key={i}
                className="font-display text-white tracking-widest whitespace-nowrap"
                style={{ fontSize: `${tiledTextSizePx}px` }}
              >
                {watermarkText}
              </p>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className={`absolute inset-0 flex pointer-events-none select-none ${watermarkPosition === "center" ? "" : "p-4"} ${positionAlignment[watermarkPosition]}`}>
        <p
          className="font-display text-white tracking-widest whitespace-nowrap rotate-[-30deg]"
          style={{ opacity: opacityValue, fontSize: `${fontSizePx}px` }}
        >
          {watermarkText}
        </p>
      </div>
    );
  };

  return (
    <motion.div
      initial={previewMode ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.5), duration: 0.4 }}
      className={`break-inside-avoid relative rounded-lg overflow-hidden bg-secondary/30 ${previewMode ? "cursor-default" : "mb-4 group cursor-pointer"}`}
      style={aspectRatio ? { aspectRatio } : undefined}
      onClick={onSelect}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? !!selected : undefined}
      aria-label={onSelect ? `${selected ? "Deselect" : "Select"} ${title}` : undefined}
      onKeyDown={onSelect ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      } : undefined}
    >
      {!failed ? (
        <img
          src={activeSrc}
          alt={title}
          width={width}
          height={height}
          className={`w-full ${aspectRatio ? "h-full object-cover" : "block"} transition-all duration-500 ${loaded ? "opacity-100" : "opacity-0"} ${previewMode ? "" : "group-hover:scale-[1.02]"}`}
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (fullSrc && activeSrc !== fullSrc) {
              setActiveSrc(fullSrc);
              setLoaded(false);
              return;
            }
            setFailed(true);
            setLoaded(true);
          }}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="aspect-[4/3] w-full flex flex-col items-center justify-center gap-2 text-muted-foreground" role="img" aria-label={`${title} could not be loaded`}>
          <ImageOff className="w-6 h-6" />
          <span className="text-xs font-body">Image unavailable</span>
        </div>
      )}

      {showWatermark && renderWatermarkOverlay && renderWatermark()}

      {!previewMode && <div className="absolute inset-0 bg-background/0 group-hover:bg-background/35 group-focus-visible:bg-background/35 transition-all duration-300 flex items-center justify-center pointer-events-none">
        <div className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity duration-300 flex items-center gap-3">
          {locked ? (
            <div className="flex items-center gap-2 bg-card/90 backdrop-blur-sm px-3 py-2 rounded-full shadow-lg">
              <Lock className="w-4 h-4 text-primary" />
              <span className="text-xs font-body tracking-wider uppercase text-foreground">Purchase</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-card/90 backdrop-blur-sm px-3 py-2 rounded-full shadow-lg">
              <Download className="w-4 h-4 text-primary" />
              <span className="text-xs font-body tracking-wider uppercase text-foreground">Select</span>
            </div>
          )}
        </div>
      </div>}

      {selected && (
        <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-lg">
          <Check className="w-4 h-4 text-primary-foreground" />
        </div>
      )}

      {!previewMode && <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-background/80 to-transparent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity pointer-events-none">
        <p className="text-xs font-body text-foreground tracking-wide">{title}</p>
      </div>}
    </motion.div>
  );
}
