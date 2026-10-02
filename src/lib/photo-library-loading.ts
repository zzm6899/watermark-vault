export interface StrippedPhotoAlbum {
  id: string;
  _photosStripped?: boolean;
}

export interface AlbumPhotoLoadProgress<TPhoto> {
  albumId: string;
  photos: TPhoto[] | null;
  completed: number;
  total: number;
}

/** Load stripped album photo lists without flooding the API with one request per album. */
export async function hydrateStrippedAlbums<TAlbum extends StrippedPhotoAlbum, TPhoto>(
  albums: TAlbum[],
  fetchPhotos: (albumId: string) => Promise<TPhoto[] | null>,
  onProgress: (progress: AlbumPhotoLoadProgress<TPhoto>) => void,
  concurrency = 4,
  shouldCancel: () => boolean = () => false,
): Promise<string[]> {
  const pending = albums.filter(album => album._photosStripped);
  if (pending.length === 0) return [];

  let nextIndex = 0;
  let completed = 0;
  const failedAlbumIds: string[] = [];
  const workerCount = Math.min(pending.length, Math.max(1, Math.floor(concurrency) || 1));

  const worker = async () => {
    while (nextIndex < pending.length && !shouldCancel()) {
      const album = pending[nextIndex++];
      let photos: TPhoto[] | null = null;
      try {
        photos = await fetchPhotos(album.id);
      } catch {
        // A failed album remains retryable; successful albums can still appear immediately.
      }
      if (shouldCancel()) return;
      completed += 1;
      if (photos === null) failedAlbumIds.push(album.id);
      onProgress({ albumId: album.id, photos, completed, total: pending.length });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  return failedAlbumIds;
}
