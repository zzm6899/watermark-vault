const test = require("node:test");
const assert = require("node:assert/strict");
const { approveDownloadRequest } = require("../download-request-review");
const { galleryPhotoDownloadEntitlement } = require("../security-core");
const { preserveGalleryServerState } = require("../gallery-workflow");
const request = { id: "request-1", sessionKey: "visitor-a", photoIds: ["p1"], method: "bank-transfer", status: "pending", requestedAt: "2030-01-01T00:00:00Z", amount: 10 };
const album = { id: "album", enabled: true, freeDownloads: 0, pricePerPhoto: 10, photos: [{ id: "p1" }, { id: "p2" }], downloadRequests: [request] };
test("approval grants only the requesting visitor access and is idempotent", () => {
  const result = approveDownloadRequest(album, request.id, request);
  assert.equal(result.ok, true);
  const updated = { ...album, downloadRequests: result.requests };
  assert.equal(updated.paidPhotoIds, undefined);
  assert.equal(request.status, "pending");
  assert.equal(galleryPhotoDownloadEntitlement({ album: updated, photo: album.photos[0], sessionKey: "visitor-a" }).clean, true);
  assert.equal(galleryPhotoDownloadEntitlement({ album: updated, photo: album.photos[0], sessionKey: "visitor-b" }).clean, false);
  assert.equal(galleryPhotoDownloadEntitlement({ album: updated, photo: album.photos[1], sessionKey: "visitor-a" }).clean, false);
  assert.equal(approveDownloadRequest(updated, request.id, request).request.approvedAt, result.request.approvedAt);
  assert.equal(preserveGalleryServerState(updated, album).downloadRequests[0].status, "approved");
  assert.equal(preserveGalleryServerState(updated, { ...album, downloadRequests: [] }).downloadRequests.length, 1);
});
test("stale, missing, unsupported and unidentified requests cannot be approved", () => {
  assert.equal(approveDownloadRequest(album, "missing", request).status, 404);
  assert.equal(approveDownloadRequest(album, request.id, { ...request, photoIds: ["p2"] }).status, 409);
  assert.equal(approveDownloadRequest({ ...album, downloadRequests: [{ ...request, sessionKey: undefined }] }, request.id, request).status, 409);
  assert.equal(approveDownloadRequest({ ...album, downloadRequests: [{ ...request, method: "stripe" }] }, request.id, request).status, 409);
});
