import type { Album, ProofingRound } from "@/lib/types";
import { useState } from "react";
import { adminAuthHeaders } from "@/lib/api";

export default function ProofingReceipt({ album, round, tenantSlug }: { album: Album; round: ProofingRound; tenantSlug?: string }) {
  const [queued, setQueued] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  if (!round.submissionId) return null;
  const delivery = album.proofingNotifications?.[round.submissionId];
  const retry = async () => {
    setSending(true); setError("");
    try {
      const prefix = tenantSlug ? `/api/tenant/${encodeURIComponent(tenantSlug)}` : "/api/admin";
      const response = await fetch(`${prefix}/proofing-notifications/${encodeURIComponent(round.submissionId!)}/retry`, {
        method: "POST", headers: tenantSlug ? {} : adminAuthHeaders(),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not retry notification");
      setQueued(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not retry notification"); }
    finally { setSending(false); }
  };
  return <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
    <p className="font-medium text-foreground">Client submission saved</p>
    <p className="mt-1 break-all text-muted-foreground">Receipt: {round.submissionId}</p>
    <p className="mt-1 text-muted-foreground" role="status">{delivery?.status === "sent" ? "Email notification sent." : queued ? "Notification queued again. Refresh the album to check delivery." : delivery?.status === "failed" ? "Email notification failed. Check your email settings; the selections are saved below." : "Email notification queued. Delivery will retry automatically if needed."}</p>
    {delivery?.status === "failed" && !queued && <button type="button" onClick={retry} disabled={sending} className="mt-2 rounded-md border border-primary/30 px-3 py-2 font-medium text-foreground hover:bg-primary/10 disabled:opacity-50">{sending ? "Queuing…" : "Retry notification"}</button>}
    {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
  </div>;
}
