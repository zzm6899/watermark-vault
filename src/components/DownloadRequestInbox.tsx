import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ExternalLink, Search, XCircle } from "lucide-react";
import type { Album, AlbumDownloadRecord, Photo } from "@/lib/types";
import { adminAuthHeaders, fetchAlbumPhotos, isServerMode } from "@/lib/api";
import { getAlbums } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function DownloadRequestInbox({ albums, onOpenAlbum, onUpdated, tenantSlug }: {
  albums: Album[];
  tenantSlug?: string;
  onOpenAlbum?: (album: Album) => void;
  onUpdated?: (album: Album) => void;
}) {
  const inboxId = useId();
  const [notice, setNotice] = useState<{ text: string; warning: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, AlbumDownloadRecord[]>>({});
  const [requestPhotos, setRequestPhotos] = useState<Record<string, Photo[]>>({});
  const [loadingPhotos, setLoadingPhotos] = useState<string | null>(null);
  useEffect(() => { setOverrides({}); }, [albums]);
  const all = albums.flatMap(album => (overrides[album.id] || album.downloadRequests || []).map((request, index) => ({ album, request, key: request.id || `legacy-${index}` })));
  const rows = all.filter(({ album, request }) => (status === "all" || request.status === status) &&
    [album.title, album.clientName, request.email, request.purchaserEmail, request.clientNote, ...(request.photoIds || [])].some(value => value?.toLowerCase().includes(search.trim().toLowerCase())))
    .sort((a, b) => b.request.requestedAt.localeCompare(a.request.requestedAt));
  const approve = async (album: Album, request: AlbumDownloadRecord, key: string) => {
    setBusy(`approve:${album.id}:${key}`);
    try {
      const response = await fetch(`/api/albums/${encodeURIComponent(album.id)}/download-requests/${encodeURIComponent(key)}/approve${tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ""}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ requestedAt: request.requestedAt, photoIds: request.photoIds }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not approve this request");
      const updated = { ...album, downloadRequests: result.downloadRequests, updatedAt: result.updatedAt };
      // Cache only the server-confirmed metadata; never PUT a stale album/photo array.
      if (!tenantSlug) try { localStorage.setItem("wv_albums", JSON.stringify(getAlbums().map(item => item.id === album.id ? { ...item, downloadRequests: result.downloadRequests, updatedAt: result.updatedAt } : item))); } catch { /* a full cache must not hide a successful server update */ }
      setOverrides(previous => ({ ...previous, [album.id]: result.downloadRequests }));
      onUpdated?.(updated);
      setNotice({ text: result.email?.warning || `Downloads approved for ${request.email || request.purchaserEmail || "this visitor"}.${result.email?.status === "sent" ? " A secure recovery link was emailed." : ""}`, warning: !!result.email?.warning });
      if (result.email?.warning) toast.warning(result.email.warning);
      else toast.success(result.email?.status === "sent" ? "Transfer confirmed. Downloads approved and confirmation email sent." : "Transfer confirmed. Downloads are available to this visitor.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not approve request"); }
    finally { setBusy(null); }
  };
  const cancel = async (album: Album, request: AlbumDownloadRecord, key: string) => {
    setBusy(`cancel:${album.id}:${key}`);
    try {
      const response = await fetch(`/api/albums/${encodeURIComponent(album.id)}/download-requests/${encodeURIComponent(key)}/cancel${tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ""}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
        body: JSON.stringify({ requestedAt: request.requestedAt, photoIds: request.photoIds }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not cancel this request");
      const updated = { ...album, downloadRequests: result.downloadRequests, updatedAt: result.updatedAt };
      if (!tenantSlug) try { localStorage.setItem("wv_albums", JSON.stringify(getAlbums().map(item => item.id === album.id ? { ...item, downloadRequests: result.downloadRequests, updatedAt: result.updatedAt } : item))); } catch { /* a full cache must not hide a successful server update */ }
      setOverrides(previous => ({ ...previous, [album.id]: result.downloadRequests }));
      onUpdated?.(updated);
      setNotice({ text: "Download request cancelled. No photos were unlocked.", warning: false });
      toast.success("Download request cancelled.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not cancel request"); }
    finally { setBusy(null); }
  };
  const loadRequestedPhotos = async (album: Album) => {
    if (!album._photosStripped || tenantSlug || requestPhotos[album.id] || loadingPhotos) return;
    setLoadingPhotos(album.id);
    try {
      const photos = await fetchAlbumPhotos(album.id);
      if (photos) setRequestPhotos(previous => ({ ...previous, [album.id]: photos }));
      else toast.error("Could not load photo names. Close and reopen the photo list to retry.");
    } finally { setLoadingPhotos(null); }
  };
  return <section id={inboxId} className="glass-panel rounded-xl p-4 sm:p-5 space-y-4 scroll-mt-24" aria-label="Download request inbox">
    <div className="flex items-start gap-3">
      <span className="rounded-xl bg-primary/10 p-3 text-primary"><Download className="size-5" aria-hidden="true" /></span>
      <div><p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Gallery payments</p><h3 className="font-display text-xl">Download requests</h3><p className="mt-1 text-sm text-muted-foreground">Check the transfer in your bank, then approve photo access. The buyer receives a secure email link.</p></div>
    </div>
    <div className="grid grid-cols-3 gap-2" aria-label="Request summary">
      {([['pending', 'Awaiting review'], ['approved', 'Approved'], ['all', 'All requests']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${status === value ? 'border-primary/50 bg-primary/10' : 'border-border bg-background/50 hover:bg-secondary'}`}><span className="block text-xl font-semibold tabular-nums">{value === 'all' ? all.length : all.filter(row => row.request.status === value).length}</span><span className="text-xs text-muted-foreground">{label}</span></button>)}
    </div>
    {notice && <div role={notice.warning ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${notice.warning ? 'border-amber-500/40 bg-amber-500/10' : 'border-primary/30 bg-primary/5'}`}><p>{notice.text}</p><button type="button" aria-label="Dismiss update" className="shrink-0 p-1 underline" onClick={() => setNotice(null)}>Dismiss</button></div>}
    <div className="flex flex-wrap gap-2">
      <div className="relative w-full sm:w-auto flex-1 min-w-0"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search download requests" placeholder="Album, visitor, note or photo ID" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
      <select aria-label="Download request status" className="min-h-11 w-full sm:w-auto rounded-md border border-border bg-background px-3 py-2 text-sm" value={status} onChange={e => setStatus(e.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All requests</option></select>
    </div>
    <p role="status" className="text-xs text-muted-foreground">{rows.length} matching request{rows.length === 1 ? "" : "s"}</p>
    <div className="space-y-3">
      {!rows.length && <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center"><Download className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden="true" /><p className="font-medium">{all.length ? "No requests in this view" : "No download requests yet"}</p><p className="mt-1 text-sm text-muted-foreground">{all.length ? "Try another status or clear your search." : "Bank-transfer requests from your galleries will appear here."}</p>{all.length > 0 && <Button variant="outline" className="mt-3" onClick={() => { setSearch(""); setStatus("all"); }}>Show all requests</Button>}</div>}
      {rows.map(({ album, request, key }) => <article key={`${album.id}:${key}`} className="rounded-xl border border-border bg-background/40 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h4 className="font-medium break-words">{album.title}</h4>
            <p className="text-sm break-all">{request.email || request.purchaserEmail || "Visitor email not provided"}</p>
            {album.clientName && <p className="text-xs text-muted-foreground">Album client: {album.clientName}</p>}</div>
          <span className={`rounded-full px-2.5 py-1 text-xs ${request.status === "pending" ? "bg-amber-500/15 text-amber-500" : request.status === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>{request.status === "pending" ? "Awaiting transfer review" : request.status === "approved" ? "Downloads approved" : request.status === "completed" ? "Completed" : "Cancelled"}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-secondary/50 p-3"><div><p className="text-sm font-medium">{request.fullAlbum ? "Full album" : `${request.photoIds?.length || 0} selected photos`}</p><p className="text-xs text-muted-foreground">{request.method === "bank-transfer" ? "Bank transfer" : request.method}</p></div><div className="text-right"><p className="text-lg font-semibold tabular-nums">{typeof request.amount === "number" && Number.isFinite(request.amount) ? `$${request.amount.toFixed(2)}` : "Amount unknown"}</p><p className="text-[11px] text-muted-foreground">{typeof request.amount === "number" && Number.isFinite(request.amount) ? "AUD" : "Check the original request"}</p></div></div>
        <p className="text-xs text-muted-foreground">Requested {new Date(request.requestedAt).toLocaleString()}{request.approvedAt ? ` · Approved ${new Date(request.approvedAt).toLocaleString()}` : ""}{request.cancelledAt ? ` · Cancelled ${new Date(request.cancelledAt).toLocaleString()}` : ""}</p>
        {request.clientNote && <p className="text-sm whitespace-pre-wrap break-words">{request.clientNote}</p>}
        <details className="text-xs" onToggle={event => { if (event.currentTarget.open) void loadRequestedPhotos(album); }}><summary className="cursor-pointer text-muted-foreground">Requested photos ({request.photoIds?.length || 0})</summary>{loadingPhotos === album.id && <p role="status" className="mt-2">Loading photo names…</p>}<ul className="mt-2 max-h-48 overflow-y-auto space-y-2">{(request.photoIds || []).map(id => {
          const photo = (requestPhotos[album.id] || album.photos || []).find(photo => photo.id === id);
          return <li key={id} className="flex items-center gap-2 break-all">{photo?.thumbnail && <img src={photo.thumbnail} alt="" loading="lazy" className="size-10 rounded object-cover shrink-0" />}<span>{photo?.originalName || id}</span></li>;
        })}</ul></details>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 border-t border-border/60 pt-3 [&>button]:min-h-11 [&>a]:min-h-11">
          {onOpenAlbum ? <Button size="sm" variant="outline" onClick={() => onOpenAlbum(album)}><ExternalLink className="mr-2 size-3.5" /> Open album</Button> : !tenantSlug && <Button size="sm" variant="outline" asChild><Link to={`/admin/albums?album=${encodeURIComponent(album.id)}&panel=requests`}>Open album</Link></Button>}
          {request.status === "pending" && <Button size="sm" disabled={busy !== null || !isServerMode() || !request.sessionKey || request.method !== "bank-transfer"} onClick={() => approve(album, request, key)}>{busy === `approve:${album.id}:${key}` ? "Approving…" : "Confirm transfer & approve"}</Button>}
          {request.status === "pending" && <AlertDialog>
            <AlertDialogTrigger asChild><Button size="sm" variant="outline" disabled={busy !== null || !isServerMode()}><XCircle className="mr-2 size-3.5" /> {busy === `cancel:${album.id}:${key}` ? "Cancelling…" : "Cancel request"}</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Cancel this download request?</AlertDialogTitle><AlertDialogDescription>This removes it from the pending queue and does not unlock any photos. The request remains visible under Cancelled, and the visitor can submit a new request.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Keep request</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void cancel(album, request, key)}>Cancel request</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>}
        </div>
        {request.status === "pending" && !request.sessionKey && <p className="text-xs text-muted-foreground">This older request has no visitor identity. Ask the client to request again from their gallery so access reaches the right person.</p>}
      </article>)}
    </div>
  </section>;
}
