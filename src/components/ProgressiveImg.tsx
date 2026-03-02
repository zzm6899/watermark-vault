import { useState } from "react";

interface ProgressiveImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  thumbSrc?: string;
  fullSrc: string;
}

/** Shows thumbSrc only (no upgrade to fullSrc). */
export default function ProgressiveImg({ thumbSrc, fullSrc, className, ...props }: ProgressiveImgProps) {
  const displaySrc = thumbSrc || fullSrc;
  return <img {...props} src={displaySrc} className={className} />;
}
