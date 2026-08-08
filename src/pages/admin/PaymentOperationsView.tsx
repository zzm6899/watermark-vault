import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Clock3, CreditCard, RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAdminPaymentHealth, syncFromServer, type AdminPaymentHealth } from "@/lib/api";
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
  const [queue, setQueue] = useState<Queue>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    await syncFromServer();
    setBookings(getBookings().filter(booking => !booking.tenantSlug && booking.archived !== true));
    setHealth(await getAdminPaymentHealth());
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

  return <div className="space-y-6 max-w-6xl mx-auto">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div><p className="text-xs uppercase tracking-[.22em] text-primary">Money desk</p><h1 className="font-display text-3xl text-foreground">Payment Operations</h1><p className="text-sm text-muted-foreground mt-1">One queue for card verification, PayID checks, expired holds and balances.</p></div>
      <Button variant="outline" onClick={() => void refresh()} disabled={loading} className="gap-2"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
    </div>
    {health && (!health.stripe.ready || health.stripe.unsafeUnsignedWebhooks || health.counts.reviews > 0) && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0" /><div><strong>Payment attention required.</strong> {!health.stripe.ready ? "Card payments are not fully configured. " : ""}{health.stripe.unsafeUnsignedWebhooks ? "Unsigned webhooks are enabled and should be disabled. " : ""}{health.counts.reviews ? `${health.counts.reviews} payment${health.counts.reviews === 1 ? " needs" : "s need"} manual reconciliation.` : ""}</div></div>}
    {health?.stripe.ready && !health.stripe.unsafeUnsignedWebhooks && health.counts.reviews === 0 && <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Stripe secret and webhook verification are configured.</div>}
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{Object.entries(queueMeta).map(([key, meta]) => { const Icon = meta.icon; return <button key={key} onClick={() => setQueue(key as Queue)} className={`text-left rounded-xl border p-4 transition ${meta.tone} ${queue === key ? "ring-2 ring-primary/50" : "hover:border-primary/30"}`}><Icon className="w-4 h-4 mb-3" /><span className="block text-2xl font-display">{counts[key] || 0}</span><span className="text-xs">{meta.label}</span></button>; })}</div>
    <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search client, email, reference or shoot…" className="pl-9" /></div>
    <div className="space-y-3">{visible.map(booking => { const kind = queueFor(booking); const meta = queueMeta[kind]; const Icon = meta.icon; return <button key={booking.id} onClick={() => navigate(`/admin/bookings?search=${encodeURIComponent(bookingPaymentReference(booking))}`)} className="w-full rounded-xl border border-border bg-card/60 p-4 text-left hover:border-primary/40 transition flex flex-col sm:flex-row sm:items-center gap-3"><span className={`rounded-lg border p-2 ${meta.tone}`}><Icon className="w-4 h-4" /></span><span className="min-w-0 flex-1"><span className="font-medium text-foreground block truncate">{booking.clientName} · {booking.type}</span><span className="text-xs text-muted-foreground">{booking.date} at {booking.time} · {bookingPaymentReference(booking)}</span></span><span className={`text-xs border rounded-full px-2.5 py-1 ${meta.tone}`}>{meta.label}</span></button>; })}{!visible.length && <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No payments in this queue.</div>}</div>
  </div>;
}
