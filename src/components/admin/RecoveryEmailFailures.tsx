import { useCallback, useEffect, useRef, useState } from "react";
import { adminAuthHeaders } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Failure = { id: string; email: string; tenantSlug: string | null; albumIds: string[]; errorCode: string; attempts: number; lastAttemptAt: string };

export default function RecoveryEmailFailures() {
  const [failures, setFailures] = useState<Failure[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const retrying = useRef(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/client-portal/failures", { headers: adminAuthHeaders(), cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.failures)) throw new Error(body.error || "Could not load recovery email failures");
      setFailures(body.failures); setError(""); setLoaded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load recovery email failures"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const retry = async (failure: Failure) => {
    if (retrying.current) return;
    retrying.current = true; setBusy(failure.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/client-portal/failures/${encodeURIComponent(failure.id)}/retry`, { method: "POST", headers: adminAuthHeaders() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not resend gallery links");
      setNotice(`Gallery links sent to ${failure.email}.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not resend gallery links"); }
    finally { retrying.current = false; setBusy(null); }
  };
  return <section className="glass-panel rounded-xl p-4 space-y-3" aria-labelledby="recovery-email-title">
    <div className="flex items-center justify-between gap-3">
      <h3 id="recovery-email-title" className="font-display text-base">Gallery recovery emails</h3>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void load()}>Refresh</Button>
    </div>
    <p className="text-xs text-muted-foreground">Recent failed requests for gallery links. Fix the photographer’s email settings before retrying; retries check current gallery access and generate fresh links.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!loaded && !error && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
    {loaded && failures.length === 0 && <p className="text-sm text-muted-foreground">No recorded delivery failures.</p>}
    {failures.map(failure => <div key={failure.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
      <div className="min-w-0 text-sm"><p className="break-all">{failure.email}</p><p className="text-xs text-muted-foreground">{failure.tenantSlug || "Main studio"} · {failure.albumIds.length} galleries · {new Date(failure.lastAttemptAt).toLocaleString()} · {failure.attempts} attempts</p><p className="text-xs text-destructive">{failure.errorCode === "EMAIL_NOT_CONFIGURED" ? "Email is not configured" : "Email delivery failed"}</p></div>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void retry(failure)}>{busy === failure.id ? "Sending…" : "Retry email"}</Button>
    </div>)}
  </section>;
}
