import { useState } from "react";

interface ProgressiveImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  thumbSrc?: string;
  fullSrc: string;
}

/** Returns true for local file:// URIs that cannot be loaded by a web browser. */
function isLocalFileUri(src?: string): boolean {
  return typeof src === "string" && src.startsWith("file://");
}

/** Shows thumbSrc only. Falls back to a placeholder if no thumbnail yet (avoids loading full-res).
 *  Also shows a placeholder for local file:// URIs that browsers cannot load. */
export default function ProgressiveImg({ thumbSrc, fullSrc, className, ...props }: ProgressiveImgProps) {
  // Only render the thumbnail — never load fullSrc in grids.
  // Skip file:// URIs (Android local paths) that are inaccessible from a web browser.
  const validThumb = thumbSrc && !isLocalFileUri(thumbSrc) ? thumbSrc : undefined;

  if (validThumb) {
    return <img {...props} src={validThumb} className={className} loading="lazy" decoding="async" />;
  }
  // No accessible thumbnail — show a lightweight placeholder instead of the full-res image
  return (
    <div className={`flex items-center justify-center bg-secondary/50 text-muted-foreground/30 ${className || ""}`} style={{ aspectRatio: "1" }}>
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    </div>
  );
}
