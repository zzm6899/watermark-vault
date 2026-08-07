import { useEffect, useMemo, useState } from "react";

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "P";
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join("");
}

export default function BookingAvatar({ src, name, className = "" }: { src?: string | null; name: string; className?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = useMemo(() => initialsFor(name), [name]);

  useEffect(() => setImageFailed(false), [src]);

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-primary/25 to-primary/10 text-primary ring-1 ring-primary/25 ${className}`}
      role={!src || imageFailed ? "img" : undefined}
      aria-label={!src || imageFailed ? `${name} profile` : undefined}
    >
      {src && !imageFailed ? (
        <img
          src={src}
          alt={`${name} profile`}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="font-body text-sm font-semibold tracking-wide" aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}
