import { useEffect, useState } from "react";
import { adminAuthHeaders } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = { key: string; eventId: string; event: string; date: string; bookings: number; booked: number; bookingCollected: number; outstanding: number; extras: number; galleryCollected: number; collected: number; pendingTransfers: number; unpricedPurchases: number; unpricedRequests: number };
const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
export function EventRevenueReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState("event");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/admin/finance/events?${new URLSearchParams({ from, to, groupBy })}`, { headers: adminAuthHeaders(), signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Event revenue could not be loaded."); return response.json(); })
      .then(data => { setRows(data.rows); setLoading(false); })
      .catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [from, to, groupBy, retry]);
  const visible = rows.filter(row => row.event.toLowerCase().includes(search.toLowerCase()));
  const sum = (field: "collected" | "outstanding" | "pendingTransfers") => visible.reduce((total, row) => total + row[field], 0);
  const unpriced = visible.reduce((total, row) => total + row.unpricedPurchases + row.unpricedRequests, 0);
  const exportCsv = () => {
    const cell = (value: unknown) => `"${String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
    const data = [["Event", "Shoot date", "Bookings", "Booking value AUD", "Extras included AUD", "Booking collected AUD", "Gallery collected AUD", "Total collected AUD", "Booking balance AUD", "Pending transfers AUD", "Unpriced records"], ...visible.map(row => [row.event, row.date, row.bookings, row.booked, row.extras, row.bookingCollected, row.galleryCollected, row.collected, row.outstanding, row.pendingTransfers, row.unpricedPurchases + row.unpricedRequests])];
    const url = URL.createObjectURL(new Blob(["\uFEFF", data.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "event-revenue.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="rounded-xl border border-border bg-card p-5 space-y-5" aria-labelledby="event-revenue-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="event-revenue-title" className="text-lg font-semibold">Revenue by event</h3><p className="text-sm text-muted-foreground mt-1">Bookings and gallery sales, grouped by the session’s event.</p></div><Button variant="outline" onClick={exportCsv} disabled={loading || !!error || !visible.length}>Export report</Button></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm space-y-1 block">Group by<select aria-label="Revenue grouping" value={groupBy} onChange={event => setGroupBy(event.target.value)} className="block h-10 w-full rounded-md border border-border bg-background px-3"><option value="event">Event</option><option value="date">Event and shoot date</option></select></label>
      <label className="text-sm space-y-1 block">Find event<Input value={search} onChange={event => setSearch(event.target.value)} placeholder="All events" /></label>
      <label className="text-sm space-y-1 block">Shoot date from<Input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></label>
      <label className="text-sm space-y-1 block">Shoot date to<Input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></label>
    </div>
    {loading ? <p role="status">Loading event revenue…</p> : error ? <div role="alert">{error} <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Retry</Button></div> : <>
      <div className="grid sm:grid-cols-3 gap-4">{([['Collected', sum('collected')], ['Booking balances', sum('outstanding')], ['Pending gallery transfers', sum('pendingTransfers')]] as const).map(([label, value]) => <div key={label} className="rounded-lg bg-secondary/40 p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums mt-1">{money(value)}</p></div>)}</div>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Event revenue in Australian dollars</caption><thead className="text-xs text-muted-foreground border-b border-border"><tr>{["Event", "Sessions", "Booked", "Extras¹", "Booking paid", "Gallery paid", "Collected", "Balance", "Pending transfer"].map(label => <th key={label} scope="col" className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.key} className="border-b border-border/50"><th scope="row" className="p-3 font-medium min-w-44">{row.event}{row.date && <span className="block text-xs text-muted-foreground">{row.date}</span>}{!!(row.unpricedPurchases + row.unpricedRequests) && <span className="block text-xs text-amber-500">{row.unpricedPurchases + row.unpricedRequests} unpriced record(s)</span>}</th><td className="p-3">{row.bookings}</td>{[row.booked, row.extras, row.bookingCollected, row.galleryCollected, row.collected, row.outstanding, row.pendingTransfers].map((value, index) => <td key={index} className={`p-3 tabular-nums whitespace-nowrap ${index === 4 ? "font-semibold" : ""}`}>{money(value)}</td>)}</tr>)}</tbody></table>{!visible.length && <p className="p-6 text-center text-muted-foreground">No events match these filters.</p>}</div>
      {!!unpriced && <p className="text-sm text-amber-500">{unpriced} historical payment record(s) have no verified amount and are excluded from totals.</p>}
    </>}
    <p className="text-xs text-muted-foreground leading-relaxed">AUD · Dates filter the shoot date, not the payment date. Collected includes confirmed booking payments and recorded gallery sales. ¹ Extras are already included in booking value. Pending transfers are not collected revenue. Cancelled bookings, invoices, refunds, fees and expenses are outside this report.</p>
  </section>;
}
