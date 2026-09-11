const test = require("node:test");
const assert = require("node:assert/strict");
const { approveDownloadRequest, cancelDownloadRequest } = require("../download-request-review");
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

test("mixed requests grant paid access only to the billed photos, retaining the free quota rules", () => {
  const mixedRequest = { ...request, photoIds: ["p1", "p2"], billablePhotoIds: ["p2"], complimentaryPhotoIds: ["p1"] };
  const mixed = { ...album, freeDownloads: 1, downloadRequests: [mixedRequest] };
  const result = approveDownloadRequest(mixed, request.id, mixedRequest);
  const updated = { ...mixed, downloadRequests: result.requests };
  assert.equal(galleryPhotoDownloadEntitlement({ album: updated, photo: album.photos[1], sessionKey: "visitor-a" }).reason, "approved-request");
  assert.equal(galleryPhotoDownloadEntitlement({ album: updated, photo: album.photos[0], sessionKey: "visitor-a" }).reason, "free-quota");
  assert.equal(galleryPhotoDownloadEntitlement({ album: { ...updated, usedFreeDownloads: { "visitor-a": 1 } }, photo: album.photos[0], sessionKey: "visitor-a" }).accessible, false);
});

test("cancellation preserves an audit record without granting access and is idempotent", () => {
  const result = cancelDownloadRequest(album, request.id, request);
  assert.equal(result.ok, true);
  assert.equal(result.request.status, "cancelled");
  assert.ok(result.request.cancelledAt);
  assert.equal(request.status, "pending");
  const updated = { ...album, downloadRequests: result.requests };
  assert.equal(galleryPhotoDownloadEntitlement({ album: updated, photo: album.photos[0], sessionKey: "visitor-a" }).clean, false);
  assert.equal(cancelDownloadRequest(updated, request.id, request).request.cancelledAt, result.request.cancelledAt);
});

test("only pending requests can be cancelled and stale requests are rejected", () => {
  assert.equal(cancelDownloadRequest(album, "missing", request).status, 404);
  assert.equal(cancelDownloadRequest(album, request.id, { ...request, photoIds: ["p2"] }).status, 409);
  assert.equal(cancelDownloadRequest({ ...album, downloadRequests: [{ ...request, status: "approved" }] }, request.id, request).status, 409);
  assert.equal(cancelDownloadRequest({ ...album, downloadRequests: [{ ...request, status: "completed" }] }, request.id, request).status, 409);
});
