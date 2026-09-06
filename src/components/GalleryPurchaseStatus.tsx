import { Button } from "@/components/ui/button";
import type { AlbumDownloadRecord, Photo } from "@/lib/types";

export default function GalleryPurchaseStatus({ requests, photos, paidCount, ready, refreshing, onRefresh, onBankDetails, onSelect }: {
  requests: AlbumDownloadRecord[]; photos: Photo[]; paidCount: number; ready: boolean;
  refreshing: boolean; onRefresh: () => void; onBankDetails?: (request: AlbumDownloadRecord) => void;
  onSelect?: (request: AlbumDownloadRecord) => void;
}) {
  if (!requests.length && !paidCount) return null;
  const names = new Map(photos.map(photo => [photo.id, photo.originalName || photo.title || photo.id]));
  return <section aria-label="Purchase status" className="border-b border-border pb-4 space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Your purchases</h3><Button size="sm" variant="ghost" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Checking…" : "Refresh status"}</Button></div>
    {paidCount > 0 && <p role="status" className="text-sm">{paidCount} purchased photo{paidCount === 1 ? "" : "s"} {ready ? "ready to download" : "unlocked; downloads currently unavailable"}.</p>}
    {requests.map((request, index) => <div key={request.id || index} className="border border-border rounded p-3 text-sm space-y-2">
      <p className="font-medium">{request.status === "pending" ? "Awaiting bank transfer confirmation" : ready ? request.billablePhotoIds ? "Payment confirmed — paid photos unlocked" : "Payment confirmed — ready to download" : "Payment confirmed — downloads unavailable"}</p>
      <p className="text-muted-foreground">{request.fullAlbum ? "Complete gallery" : `${request.photoIds.length} photos`}{typeof request.amount === "number" && ` · $${request.amount.toFixed(2)}`}</p>
      {request.billablePhotoIds && <p className="text-xs text-muted-foreground">{request.billablePhotoIds.length} paid · {request.complimentaryPhotoIds?.length || 0} covered by your complimentary allowance</p>}
      {request.requestedAt && <p className="text-xs text-muted-foreground">Requested {new Date(request.requestedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p>}
      <details><summary className="cursor-pointer text-xs py-2">View file numbers</summary><p className="text-xs leading-6 break-words">{request.photoIds.map(id => names.get(id) || "Photo no longer available").join(" · ")}</p></details>
      {request.status === "pending" && onBankDetails && <Button variant="outline" size="sm" onClick={() => onBankDetails(request)}>View bank details</Button>}
      {request.status !== "pending" && ready && onSelect && <Button variant="outline" size="sm" onClick={() => onSelect(request)}>Review these photos</Button>}
    </div>)}
  </section>;
}
