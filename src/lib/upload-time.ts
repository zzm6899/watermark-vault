export function uploadTimeRemaining(remainingBytes: number, bytesPerSecond: number | null): string {
  if (remainingBytes <= 0) return "Finishing…";
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "Estimating time…";
  const seconds = Math.ceil(remainingBytes / bytesPerSecond);
  if (seconds < 60) return "Less than a minute remaining";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `About ${minutes} min remaining`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `About ${hours} hr${rest ? ` ${rest} min` : ""} remaining`;
}
