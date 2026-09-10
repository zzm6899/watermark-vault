const ALBUM_SOURCE_PREFIX = "album:";

export function albumPhotoSourceKey(albumId: string): string {
  return `${ALBUM_SOURCE_PREFIX}${albumId}`;
}

export function albumIdFromPhotoSourceKey(source: string): string | undefined {
  return source.startsWith(ALBUM_SOURCE_PREFIX)
    ? source.slice(ALBUM_SOURCE_PREFIX.length) || undefined
    : undefined;
}
