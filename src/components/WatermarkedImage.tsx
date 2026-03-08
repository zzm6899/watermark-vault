import { useState } from "react";
import { Check, Download, Lock } from "lucide-react";
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
  /** Use only in admin/settings live preview. Client galleries should use baked assets instead. */
  renderWatermarkOverlay?: boolean;
}

const positionStyle: Record<WatermarkPosition, React.CSSProperties> = {
  center:         { top: 0, right: 0, bottom: 0, left: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  "top-left":     { top: "1rem", left: "1rem" },
  "top-right":    { top: "1rem", right: "1rem" },
  "bottom-left":  { bottom: "1rem", left: "1rem" },
  "bottom-right": { bottom: "1rem", right: "1rem" },
  tiled:          { top: 0, right: 0, bottom: 0, left: 0 },
};

export default function WatermarkedImage({
  src,
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
  renderWatermarkOverlay = false,
}: WatermarkedImageProps) {
  const [loaded, setLoaded] = useState(false);

  const opacityValue = watermarkOpacity / 100;
  const imgSizePx = `${watermarkSize}%`;
  const fontSizeEm = `${(watermarkSize / 40).toFixed(2)}em`;
  const tiledImageHeightPx = Math.max(20, watermarkSize * 0.4);
  const tiledTextSizePx = Math.max(10, watermarkSize * 0.3);

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
        <div className="absolute pointer-events-none select-none" style={positionStyle[watermarkPosition]}>
          <div className={watermarkPosition === "center" ? "rotate-[-30deg]" : ""}>
            <img
              src={watermarkImage}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ opacity: opacityValue, width: imgSizePx, maxWidth: "100%", height: "auto" }}
            />
          </div>
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
                className="font-display text-foreground tracking-widest whitespace-nowrap"
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
      <div className="absolute pointer-events-none select-none" style={positionStyle[watermarkPosition]}>
        <div className={watermarkPosition === "center" ? "rotate-[-30deg]" : ""}>
          <p
            className={`font-display text-foreground tracking-widest whitespace-nowrap ${
              watermarkPosition === "center" ? "text-3xl md:text-5xl" : "text-lg md:text-xl"
            }`}
            style={{ opacity: opacityValue, fontSize: fontSizeEm }}
          >
            {watermarkText}
          </p>
        </div>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.5), duration: 0.4 }}
      className="break-inside-avoid mb-4 group relative cursor-pointer rounded-lg overflow-hidden"
      onClick={onSelect}
    >
      <img
        src={src}
        alt={title}
        className={`w-full block transition-all duration-500 ${loaded ? "opacity-100" : "opacity-0"} group-hover:scale-[1.02]`}
        onLoad={() => setLoaded(true)}
        loading="lazy"
        decoding="async"
      />

      {showWatermark && renderWatermarkOverlay && renderWatermark()}

      <div className="absolute inset-0 bg-background/0 group-hover:bg-background/40 transition-all duration-300 flex items-center justify-center">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center gap-3">
          {locked ? (
            <div className="flex items-center gap-2 bg-card/90 backdrop-blur-sm px-4 py-2 rounded-full">
              <Lock className="w-4 h-4 text-primary" />
              <span className="text-xs font-body tracking-wider uppercase text-foreground">Purchase</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-card/90 backdrop-blur-sm px-4 py-2 rounded-full">
              <Download className="w-4 h-4 text-primary" />
              <span className="text-xs font-body tracking-wider uppercase text-foreground">Select</span>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-lg">
          <Check className="w-4 h-4 text-primary-foreground" />
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-background/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-xs font-body text-foreground tracking-wide">{title}</p>
      </div>
    </motion.div>
  );
}
