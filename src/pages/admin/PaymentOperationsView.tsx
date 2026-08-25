import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Clock3, CreditCard, RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completeAdminBookingBalance, confirmAdminBankPayment, getAdminPaymentHealth, getDataIntegrityReport, reconcileAdminStripePayment, repairDataIntegrity, sendBookingReminder, syncFromServer, type AdminPaymentHealth, type DataIntegrityReport } from "@/lib/api";
import { bookingPaymentReference } from "@/lib/booking-reference";
import { getBookings } from "@/lib/storage";
import type { Booking } from "@/lib/types";

type Queue = "all" | "review" | "bank" | "card" | "expired" | "outstanding";

function queueFor(booking: Booking): Exclude<Queue, "all"> {
  if (booking.paymentNeedsReview) return "review";
  if (booking.paymentStatus === "pending-confirmation" || (booking as Booking & { bankTransferPendingAt?: string }).bankTransferPendingAt) return "bank";
  if (["open", "processing"].includes(String((booking as Booking & { stripeCheckoutStatus?: string }).stripeCheckoutStatus || ""))) return "card";
  const hold = (booking as Booking & { holdExpiresAt?: string }).holdExpiresAt;
  if (hold && new Date(hold).getTime() <= Date.now() && !["paid", "cash", "deposit-paid"].includes(booking.paymentStatus || "")) return "expired";
  return "outstanding";
}

const queueMeta = {
  review: { label: "Manual review", icon: AlertTriangle, tone: "text-red-300 border-red-500/30 bg-red-500/10" },
  bank: { label: "PayID / bank pending", icon: Building2, tone: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  card: { label: "Card processing", icon: CreditCard, tone: "text-blue-300 border-blue-500/30 bg-blue-500/10" },
  expired: { label: "Expired holds", icon: Clock3, tone: "text-slate-300 border-slate-500/30 bg-slate-500/10" },
  outstanding: { label: "Outstanding", icon: Clock3, tone: "text-orange-300 border-orange-500/30 bg-orange-500/10" },
} as const;

export default function PaymentOperationsView() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [health, setHealth] = useState<AdminPaymentHealth | null>(null);
  const [integrity, setIntegrity] = useState<DataIntegrityReport | null>(null);
  const [queue, setQueue] = useState<Queue>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [bulkReminding, setBulkReminding] = useState(false);
  const [acting, setActing] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    await syncFromServer();
    setBookings(getBookings().filter(booking => !booking.tenantSlug && booking.archived !== true));
    setHealth(await getAdminPaymentHealth());
    setIntegrity(await getDataIntegrityReport());
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const actionable = useMemo(() => bookings.filter(booking => !["paid", "cash"].includes(booking.paymentStatus || "") || booking.paymentNeedsReview), [bookings]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(queueMeta).map(key => [key, actionable.filter(booking => queueFor(booking) === key).length])), [actionable]);
  const visible = useMemo(() => actionable.filter(booking => {
    if (queue !== "all" && queueFor(booking) !== queue) return false;
    const haystack = `${booking.clientName} ${booking.clientEmail} ${booking.type} ${bookingPaymentReference(booking)}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  }), [actionable, queue, search]);

  const withAction = async (bookingId: string, action: () => Promise<void>) => {
    setActing(current => new Set(current).add(bookingId));
    try { await action(); } finally { setActing(current => { const next = new Set(current); next.delete(bookingId); return next; }); }
  };
  const confirmBank = (booking: Booking) => withAction(booking.id, async () => {
    if (!window.confirm(`Confirm the bank transfer for ${booking.clientName}? Verify the funds in your bank first.`)) return;
    const result = await confirmAdminBankPayment(booking.id);
    if (!result.ok || !result.booking) { toast.error(result.error || "Unable to confirm bank payment"); return; }
    setBookings(current => current.map(item => item.id === booking.id ? result.booking! : item));
    toast.success("Bank payment confirmed and receipt queued");
    setHealth(await getAdminPaymentHealth());
  });
  const reconcileCard = (booking: Booking) => withAction(booking.id, async () => {
    const result = await reconcileAdminStripePayment(booking.id);
    if (!result.ok || !result.booking) {
      toast.error(result.error || "Stripe has not confirmed this payment");
      return;
    }
    setBookings(current => current.map(item => item.id === booking.id ? result.booking! : item));
    if (result.booking.paymentNeedsReview) toast.warning("Stripe found a payment that needs manual reconciliation");
    else toast.success(result.booking.paymentStatus === "deposit-paid" ? "Stripe deposit verified" : "Stripe payment verified");
    setHealth(await getAdminPaymentHealth());
  });
  const completeBalance = (booking: Booking) => withAction(booking.id, async () => {
    if (!window.confirm(`Mark the remaining balance for ${booking.clientName} as paid? Only continue after verifying the funds were received.`)) return;
    const result = await completeAdminBookingBalance(booking.id, "bank");
    if (!result.ok || !result.booking) { toast.error(result.error || "Unable to confirm the remaining balance"); return; }
    setBookings(current => current.map(item => item.id === booking.id ? result.booking! : item));
    toast.success("Remaining balance confirmed — booking is now paid in full");
    setHealth(await getAdminPaymentHealth());
  });
  const remind = (booking: Booking) => withAction(booking.id, async () => {
    const result = await sendBookingReminder(booking.id, "payment");
    if (result.ok) toast.success(`Payment reminder sent to ${booking.clientName}`);
    else toast.error(result.error || "Reminder could not be sent");
  });
  const remindVisible = async () => {
    const eligible = visible.filter(booking => queueFor(booking) === "outstanding" && !!booking.clientEmail);
    const targets = eligible.slice(0, 25);
    if (!targets.length) { toast.info("No visible clients need a payment reminder"); return; }
    if (!window.confirm(`Send payment reminders to ${targets.length} visible client${targets.length === 1 ? "" : "s"}${eligible.length > 25 ? " (first 25 only)" : ""}?`)) return;
    setBulkReminding(true);
    let sent = 0;
    try {
      for (const booking of targets) {
        setActing(current => new Set(current).add(booking.id));
        try {
          const result = await sendBookingReminder(booking.id, "payment");
          if (result.ok) sent++;
        } finally {
          setActing(current => { const next = new Set(current); next.delete(booking.id); return next; });
        }
      }
    } finally {
      setBulkReminding(false);
    }
    if (sent === targets.length) toast.success(`${sent} payment reminder${sent === 1 ? "" : "s"} sent`);
    else toast.warning(`${sent} of ${targets.length} reminders sent`);
  };
  const runRepair = async () => {
    if (!integrity?.total) return;
    if (!window.confirm(`Repair ${integrity.total} booking, payment, or invoice data issue${integrity.total === 1 ? "" : "s"}? An audit entry will be recorded.`)) return;
    setLoading(true);
    const result = await repairDataIntegrity();
    if (!result?.ok) { toast.error("Data repair could not be completed"); setLoading(false); return; }
    toast.success(`${result.total} data issue${result.total === 1 ? "" : "s"} repaired`);
    await refresh();
  };

  return <div className="space-y-6 max-w-6xl mx-auto">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div><p className="text-xs uppercase tracking-[.22em] text-primary">Money desk</p><h1 className="font-display text-3xl text-foreground">Payment Operations</h1><p className="text-sm text-muted-foreground mt-1">One queue for card verification, PayID checks, expired holds and balances.</p></div>
      <Button variant="outline" onClick={() => void refresh()} disabled={loading} className="gap-2"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
    </div>
    {health && (!health.stripe.ready || health.stripe.unsafeUnsignedWebhooks || health.counts.reviews > 0) && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0" /><div><strong>Payment attention required.</strong> {!health.stripe.ready ? "Card payments are not fully configured. " : ""}{health.stripe.unsafeUnsignedWebhooks ? "Unsigned webhooks are enabled and should be disabled. " : ""}{health.counts.reviews ? `${health.counts.reviews} payment${health.counts.reviews === 1 ? " needs" : "s need"} manual reconciliation.` : ""}</div></div>}
    {health?.stripe.ready && !health.stripe.unsafeUnsignedWebhooks && health.counts.reviews === 0 && <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Stripe secret and webhook verification are configured.</div>}
    {integrity && integrity.total > 0 && <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-4 text-sm text-cyan-100 flex flex-col sm:flex-row sm:items-center gap-3"><AlertTriangle className="w-5 h-5 shrink-0" /><div className="flex-1"><strong>{integrity.total} legacy data issue{integrity.total === 1 ? "" : "s"} found.</strong><span className="block text-xs text-cyan-100/70 mt-1">Short references: {integrity.issues.bookingReferences} · timestamps: {integrity.issues.paymentTimestamps} · paid awaiting confirmation: {integrity.issues.paidPendingBookings} · expired holds: {integrity.issues.expiredHolds} · invoice numbers: {integrity.issues.invoiceNumbers}</span></div><Button size="sm" onClick={() => void runRepair()} disabled={loading}>Repair safely</Button></div>}
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{Object.entries(queueMeta).map(([key, meta]) => { const Icon = meta.icon; return <button key={key} onClick={() => setQueue(key as Queue)} className={`text-left rounded-xl border p-4 transition ${meta.tone} ${queue === key ? "ring-2 ring-primary/50" : "hover:border-primary/30"}`}><Icon className="w-4 h-4 mb-3" /><span className="block text-2xl font-display">{counts[key] || 0}</span><span className="text-xs">{meta.label}</span></button>; })}</div>
    <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search client, email, reference or shoot…" className="pl-9" /></div><Button variant="outline" disabled={bulkReminding} onClick={() => void remindVisible()}>{bulkReminding ? "Sending reminders…" : "Remind visible clients"}</Button></div>
    <div className="space-y-3">{visible.map(booking => { const kind = queueFor(booking); const meta = queueMeta[kind]; const Icon = meta.icon; const busy = acting.has(booking.id); return <article key={booking.id} className="w-full rounded-xl border border-border bg-card/60 p-4 transition hover:border-primary/40"><button type="button" onClick={() => navigate(`/admin/bookings?search=${encodeURIComponent(bookingPaymentReference(booking))}`)} className="flex w-full flex-col gap-3 text-left sm:flex-row sm:items-center"><span className={`rounded-lg border p-2 ${meta.tone}`}><Icon className="w-4 h-4" /></span><span className="min-w-0 flex-1"><span className="font-medium text-foreground block truncate">{booking.clientName} · {booking.type}</span><span className="text-xs text-muted-foreground">{booking.date} at {booking.time} · {bookingPaymentReference(booking)}</span></span><span className={`text-xs border rounded-full px-2.5 py-1 ${meta.tone}`}>{meta.label}</span></button><div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border/50 pt-3">{kind === "outstanding" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remind(booking)}>Send reminder</Button>}{booking.paymentStatus === "deposit-paid" && <Button size="sm" disabled={busy} onClick={() => void completeBalance(booking)}>Confirm remaining balance paid</Button>}{kind === "bank" && <Button size="sm" disabled={busy} onClick={() => void confirmBank(booking)}>Confirm bank payment</Button>}{kind === "card" && <Button size="sm" disabled={busy} onClick={() => void reconcileCard(booking)}>{busy ? "Checking Stripe…" : "Check Stripe payment"}</Button>}</div></article>; })}{!visible.length && <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No payments in this queue.</div>}</div>
  </div>;
}
