import { useState } from "react";
import { Check, Download, Lock } from "lucide-react";
import { motion } from "framer-motion";

interface WatermarkedImageProps {
  src: string;
  title: string;
  selected?: boolean;
  onSelect?: () => void;
  locked?: boolean;
  index?: number;
}

export default function WatermarkedImage({
  src,
  title,
  selected,
  onSelect,
  locked,
  index = 0,
}: WatermarkedImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4 }}
      className="break-inside-avoid mb-4 group relative cursor-pointer rounded-lg overflow-hidden"
      onClick={onSelect}
    >
      <img
        src={src}
        alt={title}
        className={`w-full block transition-all duration-500 ${
          loaded ? "opacity-100" : "opacity-0"
        } group-hover:scale-[1.02]`}
        onLoad={() => setLoaded(true)}
      />

      {/* Watermark overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        <div className="rotate-[-30deg] opacity-[0.15]">
          <p className="font-display text-foreground text-3xl md:text-5xl tracking-widest whitespace-nowrap">
            LUMIÈRE
          </p>
        </div>
      </div>
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 100px, hsl(var(--foreground) / 0.03) 100px, hsl(var(--foreground) / 0.03) 101px)`
      }} />

      {/* Hover overlay */}
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

      {/* Selection indicator */}
      {selected && (
        <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-lg">
          <Check className="w-4 h-4 text-primary-foreground" />
        </div>
      )}

      {/* Title */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-background/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-xs font-body text-foreground tracking-wide">{title}</p>
      </div>
    </motion.div>
  );
}
