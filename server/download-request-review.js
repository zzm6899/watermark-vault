"use strict";

function approveDownloadRequest(album, requestId, expected, now = new Date()) {
  const requests = Array.isArray(album.downloadRequests) ? album.downloadRequests : [];
  const request = requests.find((item, index) => (item.id || `legacy-${index}`) === requestId);
  if (!request) return { ok: false, status: 404, error: "Download request not found" };
  if (request.requestedAt !== expected?.requestedAt || JSON.stringify(request.photoIds) !== JSON.stringify(expected?.photoIds)) {
    return { ok: false, status: 409, error: "The request changed. Refresh and review it again." };
  }
  if (typeof request.sessionKey !== "string" || !request.sessionKey.trim()) {
    return { ok: false, status: 409, error: "This older request has no visitor identity. Ask the client to submit a new request from their gallery." };
  }
  if (["approved", "completed"].includes(request.status)) return { ok: true, request, requests };
  if (request.status !== "pending" || request.method !== "bank-transfer") {
    return { ok: false, status: 409, error: "This request cannot be approved as a bank transfer" };
  }
  const approved = { ...request, status: "approved", approvedAt: now.toISOString() };
  // Entitlement checks use the request's visitor session. Never add these IDs
  // to album.paidPhotoIds, which would unlock them for every gallery visitor.
  return { ok: true, request: approved, requests: requests.map(item => item === request ? approved : item) };
}

module.exports = { approveDownloadRequest };
