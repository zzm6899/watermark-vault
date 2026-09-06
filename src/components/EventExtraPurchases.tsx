import { useState } from "react";
import type { BookingLineItem } from "@/lib/types";
import { BookingLineItems } from "@/components/BookingExtras";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ExtraPurchase = { bookingId: string; clientName: string; date: string; time: string; status: string; paymentStatus: string; items: BookingLineItem[] };
const paymentLabels: Record<string, string> = { paid: "Paid in full", cash: "Paid in cash", "deposit-paid": "Deposit paid", "pending-confirmation": "Transfer awaiting confirmation", unpaid: "Unpaid" };
const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
export function EventExtraPurchases({ event, purchases, onClose }: { event: string; purchases: ExtraPurchase[]; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const query = search.trim().toLowerCase();
  const filtered = purchases.filter(purchase => `${purchase.clientName} ${purchase.bookingId} ${purchase.date} ${purchase.items.map(item => `${item.name} ${item.description || ""}`).join(" ")}`.toLowerCase().includes(query));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const exportCsv = () => {
    const cell = (value: unknown) => `"${String(value ?? "").replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"', '""')}"`;
    const rows = [["Event", "Client", "Booking reference", "Shoot date", "Time", "Extra", "Description at booking", "Quantity", "Unit price AUD", "Extra total AUD", "Booking status", "Booking payment status"], ...filtered.flatMap(purchase => purchase.items.map(item => [event, purchase.clientName, purchase.bookingId, purchase.date, purchase.time, item.name, item.description || "No description recorded", item.quantity, item.unitPrice, item.total, purchase.status, paymentLabels[purchase.paymentStatus] || purchase.paymentStatus]))];
    const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "event-extra-purchases.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="rounded-xl border border-primary/30 bg-secondary/20 p-4 space-y-4" aria-label={`Purchased extras for ${event}`}>
    <div className="flex flex-wrap justify-between gap-3">
      <div><h4 className="font-semibold">Purchased extras · {event}</h4><p className="text-sm text-muted-foreground mt-1">Descriptions and prices saved with each booking. Payment status applies to the whole booking.</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={!filtered.length} onClick={exportCsv}>Export purchases</Button><Button variant="ghost" size="sm" onClick={onClose}>Close extras</Button></div>
    </div>
    <Input aria-label="Find purchased extras" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Find client, extra or description…" />
    <p className="text-sm text-muted-foreground">{filtered.length} booking(s) · Extras booked: {money(filtered.reduce((sum, purchase) => sum + purchase.items.reduce((total, item) => total + item.total, 0), 0))}. Included in booking value; this is not a separate paid total.</p>
    <div className="grid gap-3 lg:grid-cols-2">{filtered.slice(currentPage * 10, currentPage * 10 + 10).map(purchase => <article key={purchase.bookingId} className="min-w-0 rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h5 className="font-semibold break-words">{purchase.clientName}</h5><p className="text-xs text-muted-foreground">{purchase.date} · {purchase.time} · {purchase.status}</p></div><span className="rounded-full bg-secondary px-2 py-1 text-xs">{paymentLabels[purchase.paymentStatus] || purchase.paymentStatus}</span></div>
      <BookingLineItems items={purchase.items} showMissingDescriptions />
      <p className="text-xs text-muted-foreground break-all">Booking reference: {purchase.bookingId}</p>
    </article>)}</div>
    {!filtered.length && <p className="text-sm text-muted-foreground">No purchases match this search.</p>}
    {pageCount > 1 && <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm">Page {currentPage + 1} of {pageCount}</span><Button variant="outline" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button></div>}
  </section>;
}
