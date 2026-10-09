export function formatProofingWindow(hours: number): string {
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return [days ? `${days} day${days === 1 ? "" : "s"}` : "", remainingHours ? `${remainingHours} hrs` : ""]
    .filter(Boolean).join(" ") || `${hours} hrs`;
}
