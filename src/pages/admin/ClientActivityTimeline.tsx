import { useEffect, useState } from "react";
import { adminAuthHeaders } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Activity = { id: string; at: string | null; type: string; title: string; detail: string; albumTitle?: string; identityNote?: string; files?: string[]; extras?: { name: string; description: string; quantity: number; amount: string }[] };
export default function ClientActivityTimeline({ contactId }: { contactId: string }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => { setOffset(0); setQuery(search.trim()); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ offset: String(offset), kind, q: query });
    void fetch(`/api/admin/clients/${encodeURIComponent(contactId)}/activity?${params}`, { headers: adminAuthHeaders(), signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to load client activity." : "Could not load client activity.");
      const data = await response.json();
      if (!controller.signal.aborted) { setItems(data.items); setTotal(data.total); }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message || "Could not load client activity."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [contactId, offset, kind, query, refresh]);
  return <section aria-label="Client activity timeline" className="mt-4 border-t border-border pt-4 space-y-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-lg">Client activity</h3><Button size="sm" variant="outline" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh activity</Button></div>
    <div className="flex flex-col sm:flex-row gap-2">
      <Input aria-label="Search client activity" placeholder="Search extras, file numbers or activity…" value={search} onChange={event => setSearch(event.target.value)} />
      <select aria-label="Activity type" className="min-h-11 rounded border border-border bg-secondary px-3 text-sm" value={kind} onChange={event => { setOffset(0); setKind(event.target.value); }}>
        {[["all", "All activity"], ["booking", "Bookings & extras"], ["payment", "Payments"], ["request", "Photo & payment requests"], ["download", "Downloads"], ["album", "Galleries"], ["invoice", "Invoices"], ["email", "Emails"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading activity…</p> : error ? <p role="alert" className="text-sm text-destructive">{error} Use Refresh activity to retry.</p> : !items.length ? <p className="text-sm text-muted-foreground">No matching activity found.</p> : <ol className="border-l border-border ml-1 space-y-5">
      {items.map(item => <li key={item.id} className="pl-4 relative">
        <span className="absolute -left-1 top-1.5 size-2 rounded-full bg-primary" />
        <div className="flex flex-col sm:flex-row sm:justify-between gap-1"><p className="text-sm font-medium break-words">{item.title}</p><time className="text-xs text-muted-foreground shrink-0" dateTime={item.at || undefined}>{item.at ? new Date(item.at.length === 10 ? `${item.at}T12:00:00` : item.at).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", ...(item.at.length > 10 ? { hour: "numeric", minute: "2-digit" } : {}) }) : "Date not recorded"}</time></div>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words mt-1">{item.detail}</p>
        {item.identityNote && <p className="mt-1 text-xs text-muted-foreground">{item.identityNote}</p>}
        {!!item.extras?.length && <ul className="mt-2 space-y-2 rounded border border-border p-3">{item.extras.map((extra, index) => <li key={index}><p className="text-sm">{extra.quantity} × {extra.name} · {extra.amount}</p>{extra.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{extra.description}</p>}</li>)}</ul>}
        {!!item.files?.length && <details className="mt-2"><summary className="text-xs cursor-pointer py-1">View {item.files.length} file numbers</summary><p className="text-xs text-muted-foreground leading-6 break-words">{item.files.join(" · ")}</p></details>}
      </li>)}
    </ol>}
    {!error && <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{total ? `${offset + 1}–${Math.min(offset + 40, total)} of ${total}` : "0 records"}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 40))}>Previous</Button><Button size="sm" variant="outline" disabled={loading || offset + 40 >= total} onClick={() => setOffset(value => value + 40)}>Next</Button></div></div>}
  </section>;
}
