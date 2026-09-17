/** Missing ownership in an old queue is ambiguous: never assign it on login. */
export function ownsCapture(item: { tenantSlug?: string | null }, tenantSlug: string | null): boolean {
  return item.tenantSlug === tenantSlug;
}

export type FtpCaptureDestination = { albumId: string; tenantSlug: string | null };

export function captureAlbum(destination: FtpCaptureDestination | string | undefined, tenantSlug: string | null): string | undefined {
  return destination && typeof destination === "object" && ownsCapture(destination, tenantSlug)
    ? destination.albumId : undefined;
}
