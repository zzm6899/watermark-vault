type PhotoWithId = { id: string };

/**
 * Describe an intentional editor replacement without treating photos uploaded
 * after the editor opened as deletions.
 */
export function buildAlbumPhotoSaveMarkers(
  basePhotoIds: readonly string[],
  currentPhotos: readonly PhotoWithId[],
  pendingRemovedPhotoIds: readonly string[] = [],
) {
  const currentIds = new Set(currentPhotos.map(photo => String(photo.id)).filter(Boolean));
  const removedPhotoIds = [...new Set([
    ...pendingRemovedPhotoIds.map(String),
    ...basePhotoIds.map(String).filter(id => id && !currentIds.has(id)),
  ].filter(Boolean))];

  return {
    _replacePhotos: true as const,
    _basePhotoIds: [...new Set(basePhotoIds.map(String).filter(Boolean))],
    _removedPhotoIds: removedPhotoIds,
  };
}
