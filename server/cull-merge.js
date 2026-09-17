"use strict";
// Analysis can finish after another upload or editor save. Only replace cull fields.
function mergeCullPhotos(current, analysed) {
  const byId = new Map(analysed.map(photo => [photo.id, photo]));
  return current.map(photo => {
    const result = byId.get(photo.id);
    if (!result || result.src !== photo.src) return photo;
    return { ...photo, blurScore: result.blurScore, duplicateGroupId: result.duplicateGroupId,
      duplicateRank: result.duplicateRank, cull: result.cull, cullMetadata: result.cullMetadata };
  });
}
module.exports = { mergeCullPhotos };
