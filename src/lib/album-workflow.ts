import type { Album, Booking, Invoice } from "@/lib/types";

export type DeliveryChecklistItem = {
  id: string;
  label: string;
  detail: string;
  status: "ok" | "warning" | "blocker";
};

export type AlbumWorkflowStepId = "photos" | "proofing" | "finals" | "delivery";

export type AlbumWorkflowSummary = {
  stage: "photos" | "proofing" | "finals" | "delivery" | "delivered" | "archived";
  label: string;
  detail: string;
  nextAction: string;
  targetId: string | null;
  progressIndex: number;
  blockerCount: number;
  warningCount: number;
  delivered: boolean;
};

export const ALBUM_WORKFLOW_STEPS: ReadonlyArray<{ id: AlbumWorkflowStepId; label: string }> = [
  { id: "photos", label: "Photos" },
  { id: "proofing", label: "Proofing" },
  { id: "finals", label: "Finals" },
  { id: "delivery", label: "Delivery" },
];

export function currentAlbumPhotoCount(album: Album): number {
  if (!album._photosStripped && Array.isArray(album.photos)) return album.photos.length;
  const savedCount = Number(album.photoCount);
  return Number.isFinite(savedCount) ? Math.max(0, savedCount) : 0;
}

export function buildDeliveryChecklist(album: Album, linkedBooking?: Booking, linkedInvoices: Invoice[] = []): DeliveryChecklistItem[] {
  const photoCount = currentAlbumPhotoCount(album);
  const photosLoaded = !album._photosStripped && Array.isArray(album.photos);
  const photos = photosLoaded ? album.photos : [];
  const finalWorkflowActive = !!album.proofingEnabled && ["selections-submitted", "editing"].includes(album.proofingStage || "not-started");
  const hasLightroomFinals = photos.some(photo => !!photo.finalSrc);
  const missingFinals = photos.filter(photo => (photo.proofSrc && !photo.finalSrc) || (hasLightroomFinals && !photo.finalSrc));
  const pendingRequests = (album.downloadRequests || []).filter((request) => request.status === "pending").length;
  const outstandingInvoices = linkedInvoices.filter((invoice) => !["paid", "cancelled"].includes(invoice.status));
  const proofingStage = album.proofingStage || "not-started";
  const proofingInProgress = !!album.proofingEnabled && ["proofing", "selections-submitted", "editing"].includes(proofingStage);

  return [
    {
      id: "photos",
      label: "Photos ready",
      detail: photoCount > 0 ? `${photoCount} photo${photoCount !== 1 ? "s" : ""} in this album` : "Add photos before delivery",
      status: photoCount > 0 ? "ok" : "blocker",
    },
    {
      id: "finals",
      label: "Final images",
      detail: photoCount === 0
        ? "No photos to check"
        : missingFinals.length > 0
          ? `${missingFinals.length} of ${photoCount} photo${photoCount !== 1 ? "s" : ""} still need a final image`
          : !photosLoaded && finalWorkflowActive
            ? "Open the album to verify final images"
            : finalWorkflowActive && !hasLightroomFinals
              ? "No Lightroom finals recorded; current photo versions will be delivered"
              : hasLightroomFinals
                ? `Final image ready for all ${photoCount} photo${photoCount !== 1 ? "s" : ""}`
                : "Current photo versions will be delivered",
      status: missingFinals.length > 0
        ? "blocker"
        : photoCount > 0 && finalWorkflowActive && (!photosLoaded || !hasLightroomFinals)
          ? "warning"
          : "ok",
    },
    {
      id: "client-email",
      label: "Client email",
      detail: album.clientEmail ? album.clientEmail : "Delivery can continue, but no email will be sent",
      status: album.clientEmail ? "ok" : "warning",
    },
    {
      id: "proofing",
      label: "Proofing state",
      detail: !album.proofingEnabled
        ? "Proofing is not enabled for this album"
        : proofingStage === "finals-delivered"
          ? "Finals already marked delivered"
          : proofingInProgress
            ? `Current stage: ${proofingStage.replace("-", " ")}`
            : "No active proofing round",
      status: proofingInProgress && proofingStage !== "finals-delivered" ? "warning" : "ok",
    },
    {
      id: "payment",
      label: "Payment",
      detail: outstandingInvoices.length > 0
        ? `${outstandingInvoices.length} linked invoice${outstandingInvoices.length !== 1 ? "s" : ""} still outstanding`
        : linkedBooking?.paymentStatus && !["paid", "cash"].includes(linkedBooking.paymentStatus)
          ? `Booking payment is ${linkedBooking.paymentStatus.replace("-", " ")}`
          : "No outstanding linked payment found",
      status: outstandingInvoices.length > 0 || (!!linkedBooking?.paymentStatus && !["paid", "cash"].includes(linkedBooking.paymentStatus)) ? "warning" : "ok",
    },
    {
      id: "downloads",
      label: "Download requests",
      detail: pendingRequests > 0
        ? `${pendingRequests} pending request${pendingRequests !== 1 ? "s" : ""}`
        : album.lockDownloadsDuringProofing
          ? "Downloads will unlock when finals are delivered"
          : "No pending download requests",
      status: pendingRequests > 0 ? "warning" : "ok",
    },
    {
      id: "gallery-link",
      label: "Gallery link",
      detail: album.slug ? `/gallery/${album.slug}` : "A slug is required for a clean gallery link",
      status: album.slug ? "ok" : "blocker",
    },
  ];
}

export function summarizeAlbumWorkflow(album: Album, linkedBooking?: Booking, linkedInvoices: Invoice[] = []): AlbumWorkflowSummary {
  const checks = buildDeliveryChecklist(album, linkedBooking, linkedInvoices);
  const blockerCount = checks.filter((item) => item.status === "blocker").length;
  const warningCount = checks.filter((item) => item.status === "warning").length;
  const photoCount = currentAlbumPhotoCount(album);
  const proofingStage = album.proofingStage || "not-started";
  const delivered = album.status === "delivered" || proofingStage === "finals-delivered";

  if (album.status === "archived") {
    return {
      stage: "archived", label: "Archived", detail: "This album is outside the active delivery flow.",
      nextAction: "Open album details", targetId: "album-editor-details", progressIndex: 0,
      blockerCount, warningCount, delivered: false,
    };
  }

  if (delivered) {
    return {
      stage: "delivered", label: "Delivered", detail: "Final gallery is live for the client.",
      nextAction: "View delivered gallery", targetId: null, progressIndex: ALBUM_WORKFLOW_STEPS.length,
      blockerCount: 0, warningCount: 0, delivered: true,
    };
  }

  let stage: AlbumWorkflowSummary["stage"];
  let label: string;
  let nextAction: string;
  let targetId: string;
  let progressIndex: number;

  if (photoCount === 0) {
    stage = "photos";
    label = "Photos needed";
    nextAction = "Add photos";
    targetId = "album-editor-photos";
    progressIndex = 0;
  } else if (album.proofingEnabled && proofingStage === "not-started") {
    stage = "proofing";
    label = "Proofing not started";
    nextAction = "Start proofing";
    targetId = "album-proofing-controls";
    progressIndex = 1;
  } else if (album.proofingEnabled && proofingStage === "proofing") {
    stage = "proofing";
    label = "Awaiting client picks";
    nextAction = "Open proofing round";
    targetId = "album-proofing-controls";
    progressIndex = 1;
  } else if (album.proofingEnabled && proofingStage === "selections-submitted") {
    stage = "finals";
    label = "Client picks submitted";
    nextAction = "Review client picks";
    targetId = "album-editor-photos";
    progressIndex = 2;
  } else if (album.proofingEnabled && proofingStage === "editing") {
    stage = "finals";
    label = "Final edits in progress";
    nextAction = blockerCount > 0 ? `Resolve ${blockerCount} delivery blocker${blockerCount === 1 ? "" : "s"}` : "Review delivery checks";
    targetId = "album-editor-delivery";
    progressIndex = 2;
  } else {
    stage = album.status === "editing" ? "finals" : "delivery";
    label = album.status === "editing" ? "Finals in progress" : "Delivery checks";
    nextAction = blockerCount > 0 ? `Resolve ${blockerCount} delivery blocker${blockerCount === 1 ? "" : "s"}` : "Review delivery checks";
    targetId = "album-editor-delivery";
    progressIndex = album.status === "editing" ? 2 : 3;
  }

  const detail = blockerCount > 0
    ? `${blockerCount} delivery blocker${blockerCount === 1 ? "" : "s"} to resolve`
    : warningCount > 0
      ? `${warningCount} delivery warning${warningCount === 1 ? "" : "s"} to review`
      : "No delivery blockers detected";

  return { stage, label, detail, nextAction, targetId, progressIndex, blockerCount, warningCount, delivered: false };
}
