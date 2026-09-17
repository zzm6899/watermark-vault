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
  return { ok: true, newlyApproved: true, request: approved, requests: requests.map(item => item === request ? approved : item) };
}

function cancelDownloadRequest(album, requestId, expected, now = new Date()) {
  const requests = Array.isArray(album.downloadRequests) ? album.downloadRequests : [];
  const request = requests.find((item, index) => (item.id || `legacy-${index}`) === requestId);
  if (!request) return { ok: false, status: 404, error: "Download request not found" };
  if (request.requestedAt !== expected?.requestedAt || JSON.stringify(request.photoIds) !== JSON.stringify(expected?.photoIds)) {
    return { ok: false, status: 409, error: "The request changed. Refresh and review it again." };
  }
  if (request.status === "cancelled") return { ok: true, request, requests };
  if (request.status !== "pending") {
    return { ok: false, status: 409, error: "Only pending download requests can be cancelled" };
  }
  const cancelled = { ...request, status: "cancelled", cancelledAt: now.toISOString() };
  return { ok: true, request: cancelled, requests: requests.map(item => item === request ? cancelled : item) };
}

async function sendDownloadApprovalEmail({ result, album, transport, from, galleryUrl }) {
  if (!result.newlyApproved) return { status: "not-needed" };
  const recipient = String(result.request.email || result.request.purchaserEmail || "").trim();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) return { status: "failed", warning: "Approval saved, but the visitor has no valid email address." };
  try {
    if (!transport || !from) throw new Error("Email is not configured");
    const delivery = await transport.sendMail({
      from, to: recipient, subject: "Your photo downloads are approved",
      text: `Your bank transfer has been confirmed and your requested downloads for ${album.title || "your gallery"} are approved.\n\nOpen this secure link on the device where you want to download your photos:\n${galleryUrl}\n\nThis link expires after 30 minutes. To get a new link, open the gallery and choose "Find my purchases" using this email address. Keep this email private: the link grants access to your purchases.`,
    });
    if (delivery?.rejected?.length && !delivery?.accepted?.length) throw new Error("Recipient rejected");
    return { status: "sent" };
  } catch {
    return { status: "failed", warning: "Approval saved, but the confirmation email could not be sent. Please contact the visitor." };
  }
}

module.exports = { approveDownloadRequest, cancelDownloadRequest, sendDownloadApprovalEmail };
