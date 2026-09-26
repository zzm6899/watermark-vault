import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { adminAuthHeaders, studioApiUrl } from "@/lib/api";
import { ConventionDetailsFields } from "@/components/ConventionDetails";
import type { Booking, BookingContract, PaymentInstalment } from "@/lib/types";

export default function BookingBusiness({ booking, tenantSlug, onChange }: { booking: Booking; tenantSlug?: string; onChange?: () => void | Promise<void> }) {
  const [details, setDetails] = useState(booking.conventionDetails || {});
  useEffect(() => setDetails(booking.conventionDetails || {}), [booking.id, booking.conventionDetails]);
  const [contracts, setContracts] = useState<BookingContract[]>([]);
  const [payments, setPayments] = useState<PaymentInstalment[]>([]);
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useCallback(async (path: string, method = "GET", body?: object | FormData) => {
    const form = body instanceof FormData;
    const response = await fetch(studioApiUrl(path, tenantSlug), { method, headers: { ...adminAuthHeaders(), ...(!form && body ? { "Content-Type": "application/json" } : {}) }, body: body ? form ? body : JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }, [tenantSlug]);
  const load = useCallback(async () => {
    const [contracts, instalments] = await Promise.all([request(`/api/contracts?bookingId=${encodeURIComponent(booking.id)}`), request(`/api/bookings/${encodeURIComponent(booking.id)}/instalments`)]);
    if (!Array.isArray(contracts) || !Array.isArray(instalments)) throw new Error("Invalid response; reload contracts and schedule");
    setContracts(contracts); setPayments(instalments);
  }, [booking.id, request]);
  useEffect(() => { void load().catch(error => setError(error.message)); }, [load]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await action(); await load(); await onChange?.(); }
    catch (error) { setError(error instanceof Error ? error.message : "Request failed"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const button = "rounded border border-border px-3 py-2 text-xs disabled:opacity-50";
  return <section className="space-y-4 rounded-lg border border-border p-3" aria-label="Contracts and payment schedule">
    {error && <p role="alert" className="text-sm text-destructive">{error} <button className="underline" onClick={() => void run(async () => {})}>Retry</button></p>}
    <details><summary className="cursor-pointer text-sm font-medium">Edit meeting point and delivery date</summary>
      <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => { await request(`/api/bookings/${encodeURIComponent(booking.id)}/convention`, "PUT", details); toast.success("Booking details saved"); }); }}>
        <ConventionDetailsFields value={details} onChange={setDetails} booking /><button disabled={busy} className={button}>Save booking details</button>
      </form>
    </details>
    <details><summary className="cursor-pointer text-sm font-medium">Contracts ({contracts.length})</summary>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void run(async () => {
        const file = fileInput.current?.files?.[0]; if (!file) throw new Error("Choose a PDF contract");
        const body = new FormData(); body.append("pdf", file); body.append("bookingId", booking.id); body.append("title", file.name.replace(/\.pdf$/i, ""));
        await request("/api/contracts", "POST", body); if (fileInput.current) fileInput.current.value = "";
      }); }}>
        <label className="text-xs">PDF contract <input ref={fileInput} type="file" accept="application/pdf,.pdf" required disabled={busy} className="block max-w-full" /></label>
        <button disabled={busy} className={button}>Attach contract</button>
      </form>
      {contracts.map(contract => <div key={contract.id} className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <a className="underline" href={`/contract/${encodeURIComponent(contract.token)}`} target="_blank" rel="noreferrer">{contract.title}</a><span>{contract.status}{contract.signedAt ? ` · ${contract.signedName} · ${new Date(contract.signedAt).toLocaleString()}` : ""}</span>
        {contract.status === "pending" && <button disabled={busy} className={button} onClick={() => void run(async () => { await request(`/api/contracts/${contract.id}/send`, "POST"); toast.success("Contract email sent"); })}>{contract.sentAt ? "Send reminder" : "Email client"}</button>}
      </div>)}
    </details>
    <details><summary className="cursor-pointer text-sm font-medium">Payment schedule ({payments.length})</summary>
      <p className="my-2 text-xs text-muted-foreground">Schedule the remaining booking balance. Clients pay each instalment from their manage-booking link. Confirm the booking first; verify bank or cash receipt before recording payment.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void run(async () => {
        await request(`/api/bookings/${encodeURIComponent(booking.id)}/instalments`, "POST", { id: requestId.current, amount: Number(amount), dueDate, note });
        requestId.current = crypto.randomUUID(); setAmount(""); setNote("");
      }); }}>
        <label className="text-xs">Amount<input className="block w-28 bg-background border rounded p-2" type="number" min="0.01" step="0.01" required value={amount} onChange={event => { requestId.current = crypto.randomUUID(); setAmount(event.target.value); }} /></label>
        <label className="text-xs">Due date<input className="block bg-background border rounded p-2" type="date" required value={dueDate} onChange={event => { requestId.current = crypto.randomUUID(); setDueDate(event.target.value); }} /></label>
        <label className="text-xs">Description<input className="block bg-background border rounded p-2" maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
        <button disabled={busy} className={button}>Add instalment</button>
      </form>
      {payments.map(payment => <div key={payment.id} className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
        <span>{payment.dueDate} · {payment.currency?.toUpperCase()} {payment.amount.toFixed(2)} · {payment.status} {payment.note}</span>
        {["pending", "overdue"].includes(payment.status) && <>
          {(["bank", "cash"] as const).map(method => <button key={method} disabled={busy} className={button} onClick={() => {
            if (confirm(`Confirm you received ${payment.amount.toFixed(2)} by ${method}?`)) void run(async () => { await request(`/api/instalments/${payment.id}`, "PUT", { status: "paid", method }); });
          }}>Record {method} payment</button>)}
          <button disabled={busy} className={button} onClick={() => { if (confirm("Remove this unpaid instalment from the schedule? The booking balance remains due.")) void run(async () => { await request(`/api/instalments/${payment.id}`, "PUT", { status: "waived" }); }); }}>Remove instalment</button>
        </>}
      </div>)}
      {payments.length > 0 && <button disabled={busy} className={`${button} mt-3`} onClick={() => void run(async () => { await request(`/api/bookings/${booking.id}/instalments/send`, "POST"); toast.success("Payment schedule sent"); })}>Email payment schedule</button>}
    </details>
  </section>;
}
