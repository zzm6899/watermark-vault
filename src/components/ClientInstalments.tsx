import { useEffect, useRef, useState } from "react";
import type { Booking, PaymentInstalment } from "@/lib/types";

export default function ClientInstalments({ token, onUpdate }: { token: string; onUpdate?: (booking: Partial<Booking>) => void }) {
  const [data, setData] = useState<{ unallocatedAmount?: number; instalments: PaymentInstalment[]; cardAvailable: boolean; bankTransfer?: { enabled?: boolean; accountName?: string; bsb?: string; accountNumber?: string; payId?: string } }>();
  const updateRef = useRef(onUpdate); updateRef.current = onUpdate;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/booking/${encodeURIComponent(token)}/instalments`;
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try { const response = await fetch(url, { signal: controller.signal }); if (!response.ok) throw new Error("Could not load payment schedule"); const result = await response.json(); setData(result); if (result.booking) updateRef.current?.(result.booking); setError(""); }
      catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load schedule"); }
    };
    void load(); const timer = window.setInterval(load, 10000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [url]);
  if (!data?.instalments.length && !error) return null;
  return <section className="mt-4 rounded-lg border border-border p-3 space-y-3" aria-label="Payment schedule">
    <h3 className="font-medium">Your payment schedule</h3>
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    {data?.instalments.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{row.dueDate} · {row.currency?.toUpperCase()} {row.amount.toFixed(2)} · {row.status}<span className="block text-xs text-muted-foreground">{row.note}</span></span>
      {data.cardAvailable && ["pending", "overdue"].includes(row.status) && <button disabled={busy} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50" onClick={async () => {
        setBusy(true); setError("");
        try { const response = await fetch(`${url}/${encodeURIComponent(row.id)}/checkout`, { method: "POST" }); const result = await response.json(); if (!response.ok || !result.url) throw new Error(result.error || "Could not start payment"); window.location.assign(result.url); }
        catch (error) { setError(error instanceof Error ? error.message : "Payment failed"); setBusy(false); }
      }}>Pay instalment</button>}
    </div>)}
    {data?.bankTransfer?.enabled && <div className="text-xs space-y-1"><p className="font-medium">Bank transfer</p><p>{data.bankTransfer.accountName} · {data.bankTransfer.bsb} · {data.bankTransfer.accountNumber}</p>{data.bankTransfer.payId && <p>PayID: {data.bankTransfer.payId}</p>}<p>Include your booking reference and instalment due date. Payment stays outstanding until your photographer verifies receipt.</p></div>}
    {!!data?.unallocatedAmount && <p className="text-xs text-muted-foreground">An additional {data.unallocatedAmount.toFixed(2)} remains to be scheduled. Contact your photographer for the next due date.</p>}
    <p className="text-xs text-muted-foreground">A returned checkout page is not a payment receipt. This schedule updates after payment confirmation.</p>
  </section>;
}
