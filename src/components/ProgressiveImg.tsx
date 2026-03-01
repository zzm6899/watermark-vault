import { useState } from "react";

interface ProgressiveImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  thumbSrc?: string;
  fullSrc: string;
}

/** Shows thumbSrc immediately, then swaps to fullSrc once loaded. */
export default function ProgressiveImg({ thumbSrc, fullSrc, className, ...props }: ProgressiveImgProps) {
  const initial = thumbSrc || fullSrc;
  const [src, setSrc] = useState(initial);

  const handleLoad = () => {
    if (thumbSrc && fullSrc !== thumbSrc && src === thumbSrc) {
      const img = new window.Image();
      img.onload = () => setSrc(fullSrc);
      img.src = fullSrc;
    }
  };

  return <img {...props} src={src} className={className} onLoad={handleLoad} />;
}
