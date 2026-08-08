import React from "react";
import { useNavigate } from "react-router-dom";
import { DollarSign, Download, Grid, Pencil, PlusCircle, Receipt, Search, Trash2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bookingPaymentReference } from "@/lib/booking-reference";
import { getAlbums, getBookings, getInvoices, updateAlbum } from "@/lib/storage";
import { adminAuthHeaders, convertQuoteToInvoice, createExpense, createQuote, deleteExpense, deleteQuote, getExpenses, getQuotes, updateExpense, updateQuote } from "@/lib/api";
import type { Expense, Invoice, Quote } from "@/lib/types";

function calcInvTotal(inv: Invoice) {
  const subtotal = (inv.items || []).reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discounted = subtotal - (inv.discount || 0);
  return discounted + discounted * ((inv.tax || 0) / 100);
}
function invoiceCurrency(inv: Pick<Invoice, "currency">) { return String(inv.currency || "AUD").toUpperCase(); }
function formatInvMoney(inv: Pick<Invoice, "currency">, amount: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: invoiceCurrency(inv) }).format(amount);
}
export default function FinanceView() {
  const navigate = useNavigate();
  const [albumsState, setAlbumsState] = React.useState(() => getAlbums());
  const [invoicesState] = React.useState(() => getInvoices());
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [expandedDownloadKeys, setExpandedDownloadKeys] = React.useState<Set<string>>(new Set());
  const [financeSearch, setFinanceSearch] = React.useState("");
  const [financeExpenses, setFinanceExpenses] = React.useState<Expense[]>([]);
  const [downloadCaptureStats, setDownloadCaptureStats] = React.useState<any>(null);
  React.useEffect(() => { getExpenses().then(setFinanceExpenses).catch(() => {}); }, []);
  React.useEffect(() => {
    fetch("/api/admin/download-email-stats", { headers: adminAuthHeaders() })
      .then(response => response.ok ? response.json() : null)
      .then(setDownloadCaptureStats)
      .catch(() => {});
  }, []);

  const toggleDownloadThumbs = (key: string) => {
    setExpandedDownloadKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  type PaymentRecord = {
    id: string;
    date: string;
    clientName: string;
    albumTitle: string;
    albumId: string;
    sessionKey?: string;
    purchaserEmail?: string;
    photoIds?: string[];
    method: "stripe" | "bank-transfer" | "cash";
    amount: number;
    status: "completed" | "pending";
    description: string;
    requestedAt?: string; // for bank-transfer deletion key
    bookingId?: string;
    reference?: string;
  };

  const payments: PaymentRecord[] = [];

  for (const alb of albumsState) {
    // Stripe — per-session purchases
    for (const [sKey, sp] of Object.entries((alb as any).sessionPurchases || {})) {
      const s = sp as any;
      const photoCount = s.fullAlbum ? (alb.photos?.length || 0) : (s.photoIds?.length || 0);
      const amount = s.fullAlbum ? (alb.priceFullAlbum || 0) : photoCount * (alb.pricePerPhoto || 0);
      payments.push({
        id: `session-${alb.id}-${sKey}`,
        date: s.paidAt || new Date().toISOString(),
        clientName: s.purchaserEmail || alb.clientName || "Unknown",
        albumTitle: alb.title,
        albumId: alb.id,
        sessionKey: sKey,
        purchaserEmail: s.purchaserEmail,
        photoIds: s.fullAlbum ? undefined : (s.photoIds || []),
        method: "stripe",
        amount,
        status: "completed",
        description: s.fullAlbum ? `Full album — ${photoCount} photos` : `${photoCount} photo${photoCount !== 1 ? "s" : ""} — Stripe`,
      });
    }
    // Legacy stripe full-album (pre-session-purchase)
    if (alb.stripePaidAt && alb.priceFullAlbum && !Object.keys((alb as any).sessionPurchases || {}).length) {
      payments.push({
        id: `stripe-legacy-${alb.id}`,
        date: alb.stripePaidAt,
        clientName: alb.clientName || "Unknown",
        albumTitle: alb.title,
        albumId: alb.id,
        method: "stripe",
        amount: alb.priceFullAlbum,
        status: "completed",
        description: `Full album — ${alb.photos?.length || 0} photos (legacy)`,
      });
    }
    // Bank transfer requests
    for (const req of alb.downloadRequests || []) {
      if (req.method === "bank-transfer") {
        const photoCount = req.photoIds?.length || 0;
        const amount = photoCount * (alb.pricePerPhoto || 0);
        payments.push({
          id: `bank-${alb.id}-${req.requestedAt}`,
          date: req.approvedAt || req.requestedAt,
          clientName: req.purchaserEmail || alb.clientName || "Unknown",
          albumTitle: alb.title,
          albumId: alb.id,
          purchaserEmail: req.purchaserEmail,
          photoIds: req.photoIds || [],
          method: "bank-transfer",
          amount,
          status: (req.status === "completed" || req.status === "approved") ? "completed" : "pending",
          description: `${photoCount} photo${photoCount !== 1 ? "s" : ""} — bank transfer`,
          requestedAt: req.requestedAt,
        });
      }
    }
  }

  const bookingPayments = getBookings();
  const bookingOutstanding = bookingPayments
    .filter(booking => booking.status !== "cancelled" && !["paid", "cash", "deposit-paid"].includes(booking.paymentStatus || "unpaid") && (booking.paymentAmount || 0) > 0)
    .map(booking => ({ booking, due: booking.depositRequired && booking.depositAmount ? booking.depositAmount : (booking.paymentAmount || 0) }));
  for (const booking of bookingPayments) {
    if (booking.status === "cancelled" || !["paid", "cash", "deposit-paid"].includes(booking.paymentStatus || "unpaid")) continue;
    const amount = booking.paymentStatus === "deposit-paid" ? (booking.depositAmount || 0) : (booking.paymentAmount || 0);
    if (amount <= 0) continue;
    payments.push({
      id: `booking-${booking.id}-${booking.depositPaidAt || booking.paidAt || booking.createdAt}`,
      date: booking.depositPaidAt || booking.paidAt || booking.createdAt,
      clientName: booking.clientName || "Unknown",
      albumTitle: booking.type || "Booking",
      albumId: "",
      method: booking.paymentStatus === "cash"
        ? "cash"
        : ((booking.paymentMethod || booking.depositMethod) === "bank" ? "bank-transfer" : "stripe"),
      amount,
      status: "completed",
      description: booking.paymentStatus === "deposit-paid" ? "Booking deposit" : "Booking paid in full",
      bookingId: booking.id,
      reference: bookingPaymentReference(booking),
    });
  }

  payments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const filteredPayments = payments.filter(payment => {
    const q = financeSearch.trim().toLowerCase();
    if (!q) return true;
    return [payment.reference, payment.clientName, payment.purchaserEmail, payment.albumTitle, payment.description]
      .some(value => String(value || "").toLowerCase().includes(q));
  });
  const totalRevenue = payments.filter(p => p.status === "completed").reduce((s, p) => s + p.amount, 0);
  const pendingRevenue = payments.filter(p => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const stripeTotal = payments.filter(p => p.method === "stripe" && p.status === "completed").reduce((s, p) => s + p.amount, 0);
  const bankTotal = payments.filter(p => p.method === "bank-transfer" && p.status === "completed").reduce((s, p) => s + p.amount, 0);

  // Invoice stats — reuse the module-level calcInvTotal helper
  const invoiceFinanceStats = Array.from(new Set(invoicesState.map(invoiceCurrency))).sort().map(currency => {
    const paid = invoicesState.filter(invoice => invoiceCurrency(invoice) === currency && invoice.status === "paid");
    const outstanding = invoicesState.filter(invoice => invoiceCurrency(invoice) === currency && (invoice.status === "sent" || invoice.status === "partial" || invoice.status === "overdue"));
    return {
      currency,
      paidCount: paid.length,
      paid: paid.reduce((sum, invoice) => sum + calcInvTotal(invoice), 0),
      outstandingCount: outstanding.length,
      outstanding: outstanding.reduce((sum, invoice) => sum + Math.max(0, calcInvTotal(invoice) - (invoice.amountPaid || 0)), 0),
    };
  });

  const handleDelete = (p: PaymentRecord) => {
    if (!confirm(`Delete this payment record? This will revoke the client's access to the purchased photos.`)) return;
    const albums = getAlbums();
    const alb = albums.find(a => a.id === p.albumId);
    if (!alb) return;
    const updated = { ...alb } as any;

    if (p.method === "stripe" && p.sessionKey) {
      // Remove the session purchase entry — revokes their access
      const sp = { ...(updated.sessionPurchases || {}) };
      delete sp[p.sessionKey];
      updated.sessionPurchases = sp;
      // If it was the legacy stripe flag, clear that too
      if (p.id.startsWith("stripe-legacy-")) {
        updated.stripePaidAt = undefined;
        updated.allUnlocked = false;
      }
    } else if (p.method === "bank-transfer" && p.requestedAt) {
      // Remove the download request entry
      updated.downloadRequests = (updated.downloadRequests || []).filter(
        (r: any) => r.requestedAt !== p.requestedAt
      );
    }

    updateAlbum(updated);
    setAlbumsState(getAlbums());
    toast.success("Payment record deleted — client access revoked");
  };

  const methodLabel = (m: string) => m === "stripe" ? "Stripe" : m === "cash" ? "Cash" : "Bank Transfer";
  const methodColor = (m: string) => m === "stripe" ? "text-purple-400 bg-purple-500/10" : m === "cash" ? "text-yellow-400 bg-yellow-500/10" : "text-blue-400 bg-blue-500/10";
  const statusColor = (s: string) => s === "completed" ? "text-green-400 bg-green-500/10" : "text-yellow-400 bg-yellow-500/10";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl text-foreground mb-1">Finance</h2>
        <p className="text-sm font-body text-muted-foreground">Payment history and revenue summary</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="glass-panel rounded-xl p-5">
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">Total Revenue</p>
          <p className="font-display text-2xl text-green-400">${totalRevenue.toFixed(2)}</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">{payments.filter(p => p.status === "completed").length} completed payments</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">Pending</p>
          <p className="font-display text-2xl text-yellow-400">${pendingRevenue.toFixed(2)}</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">{payments.filter(p => p.status === "pending").length} awaiting payment</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">Stripe</p>
          <p className="font-display text-2xl text-purple-400">${stripeTotal.toFixed(2)}</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">{payments.filter(p => p.method === "stripe" && p.status === "completed").length} transactions</p>
        </div>
        <div className="glass-panel rounded-xl p-5">
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">Bank Transfer</p>
          <p className="font-display text-2xl text-blue-400">${bankTotal.toFixed(2)}</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">{payments.filter(p => p.method === "bank-transfer" && p.status === "completed").length} transfers</p>
        </div>
        <button onClick={() => navigate("/admin/bookings?payment=unpaid")} className="glass-panel rounded-xl p-5 text-left hover:border-primary/40 border border-transparent transition-colors">
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">Booking deposits due</p>
          <p className="font-display text-2xl text-yellow-400">${bookingOutstanding.reduce((sum, item) => sum + item.due, 0).toFixed(2)}</p>
          <p className="text-[10px] font-body text-muted-foreground mt-1">{bookingOutstanding.length} booking{bookingOutstanding.length === 1 ? "" : "s"} · open bookings</p>
        </button>
      </div>

      {/* Invoice summary row */}
      {invoicesState.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {invoiceFinanceStats.flatMap(stat => [
            <div key={`${stat.currency}-paid`} className="glass-panel rounded-xl p-5">
              <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">{stat.currency} invoices paid</p>
              <p className="font-display text-2xl text-green-400">{formatInvMoney({ currency: stat.currency }, stat.paid)}</p>
              <p className="text-[10px] font-body text-muted-foreground mt-1">{stat.paidCount} paid invoices</p>
            </div>,
            <div key={`${stat.currency}-outstanding`} className="glass-panel rounded-xl p-5">
              <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">{stat.currency} outstanding</p>
              <p className="font-display text-2xl text-yellow-400">{formatInvMoney({ currency: stat.currency }, stat.outstanding)}</p>
              <p className="text-[10px] font-body text-muted-foreground mt-1">{stat.outstandingCount} outstanding</p>
            </div>,
          ])}
          <div className="glass-panel rounded-xl p-5 col-span-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-body text-muted-foreground tracking-wider uppercase mb-1">All Invoices</p>
              <p className="font-display text-2xl text-foreground">{invoicesState.length}</p>
              <p className="text-[10px] font-body text-muted-foreground mt-1">{invoicesState.filter(i => i.status === "draft").length} drafts · {invoicesState.filter(i => i.status === "overdue").length} overdue</p>
            </div>
            <Receipt className="w-8 h-8 text-muted-foreground/20" />
          </div>
        </div>
      )}

      {/* ── Revenue Analytics ─────────────────────────────────── */}
      {payments.filter(p => p.status === "completed").length > 0 && (() => {
        // Build last-12-months monthly buckets
        const now = new Date();
        const monthlyData = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
          const rev = payments
            .filter(p => p.status === "completed" && p.date?.startsWith(key))
            .reduce((s, p) => s + p.amount, 0);
          return { label, rev, key };
        });
        const maxRev = Math.max(...monthlyData.map(m => m.rev), 1);

        // Revenue by service type (from bookings)
        const bookings = getBookings();
        const byService: Record<string, { count: number; rev: number }> = {};
        for (const bk of bookings) {
          if (!bk.paymentAmount || !["paid", "cash", "deposit-paid"].includes(bk.paymentStatus || "unpaid")) continue;
          const key = bk.type || "Other";
          if (!byService[key]) byService[key] = { count: 0, rev: 0 };
          byService[key].count++;
          byService[key].rev += bk.paymentStatus === "deposit-paid" ? (bk.depositAmount || 0) : bk.paymentAmount;
        }
        const serviceEntries = Object.entries(byService).sort((a, b) => b[1].rev - a[1].rev);
        const confirmedPayments = payments.filter(p => p.status === "completed");
        const paidBookings = bookings.filter(b => ["paid", "cash", "deposit-paid"].includes(b.paymentStatus || "unpaid"));
        const avgBookingValue = paidBookings.length > 0
          ? paidBookings.reduce((s, b) => s + (b.paymentStatus === "deposit-paid" ? (b.depositAmount || 0) : (b.paymentAmount || 0)), 0) / paidBookings.length
          : 0;
        const conversionRate = bookings.length > 0
          ? bookings.filter(b => b.status === "confirmed" || b.status === "completed").length / bookings.length
          : 0;

        return (
          <div className="glass-panel rounded-xl p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base text-foreground">Revenue Analytics</h3>
              <span className="text-[10px] font-body text-muted-foreground uppercase tracking-wider">Last 12 months</span>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Avg Booking", value: `$${isNaN(avgBookingValue) ? "0" : avgBookingValue.toFixed(0)}`, color: "text-green-400" },
                { label: "Conversion", value: `${(conversionRate * 100).toFixed(0)}%`, color: "text-primary" },
                { label: "Transactions", value: confirmedPayments.length, color: "text-blue-400" },
                { label: "Service Types", value: serviceEntries.length, color: "text-purple-400" },
              ].map(kpi => (
                <div key={kpi.label} className="rounded-lg bg-secondary/40 border border-border/30 p-3">
                  <p className="text-[10px] font-body text-muted-foreground tracking-wider uppercase mb-1">{kpi.label}</p>
                  <p className={`font-display text-xl ${kpi.color}`}>{kpi.value}</p>
                </div>
              ))}
            </div>

            {/* Monthly bar chart */}
            <div>
              <p className="text-[10px] font-body text-muted-foreground tracking-wider uppercase mb-3">Monthly Revenue</p>
              <div className="flex items-end gap-1 h-28">
                {monthlyData.map(m => (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div
                      className="w-full rounded-t bg-primary/60 group-hover:bg-primary transition-colors"
                      style={{ height: `${Math.max(2, Math.round((m.rev / maxRev) * 100))}%` }}
                    />
                    {/* Tooltip on hover */}
                    {m.rev > 0 && (
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:flex whitespace-nowrap text-[9px] font-body bg-secondary border border-border rounded px-1.5 py-0.5 text-foreground z-10 pointer-events-none">
                        ${m.rev.toFixed(0)}
                      </div>
                    )}
                    <span className="text-[8px] font-body text-muted-foreground/50 rotate-45 origin-left hidden sm:block">{m.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1 sm:hidden">
                <span className="text-[9px] font-body text-muted-foreground/40">{monthlyData[0].label}</span>
                <span className="text-[9px] font-body text-muted-foreground/40">{monthlyData[11].label}</span>
              </div>
            </div>

            {/* Revenue by service type */}
            {serviceEntries.length > 0 && (
              <div>
                <p className="text-[10px] font-body text-muted-foreground tracking-wider uppercase mb-2">Revenue by Service</p>
                <div className="space-y-2">
                  {serviceEntries.slice(0, 6).map(([name, data]) => {
                    const pct = totalRevenue > 0 ? (data.rev / totalRevenue) * 100 : 0;
                    return (
                      <div key={name} className="flex items-center gap-3">
                        <p className="text-xs font-body text-foreground w-32 truncate flex-shrink-0">{name}</p>
                        <div className="flex-1 h-1.5 rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs font-body text-muted-foreground w-16 text-right flex-shrink-0">${data.rev.toFixed(0)}</p>
                        <p className="text-[10px] font-body text-muted-foreground/50 w-8 text-right flex-shrink-0">{pct.toFixed(0)}%</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Advanced Analytics ─────────────────────────────────── */}
      {payments.filter(p => p.status === "completed").length > 0 && (() => {
        const bookings = getBookings();

        // ── Revenue by booking source ──────────────────────────
        const SOURCE_LABELS_ADV: Record<string, string> = {
          direct: "Direct", instagram: "Instagram", referral: "Referral",
          facebook: "Facebook", tiktok: "TikTok", convention: "Convention",
          repeat: "Returning", email: "Email", other: "Other",
        };
        const SOURCE_COLORS_ADV: Record<string, string> = {
          direct: "#6366f1", instagram: "#e1306c", referral: "#10b981",
          facebook: "#1877f2", tiktok: "#69c9d0", convention: "#f59e0b",
          repeat: "#8b5cf6", email: "#3b82f6", other: "#71717a",
        };
        const revenueBySource: Record<string, { count: number; rev: number }> = {};
        for (const bk of bookings) {
          if (!bk.paymentAmount || bk.status === "cancelled" || !["paid", "cash", "deposit-paid"].includes(bk.paymentStatus || "unpaid")) continue;
          const src = (bk.source as string) || "direct";
          if (!revenueBySource[src]) revenueBySource[src] = { count: 0, rev: 0 };
          revenueBySource[src].count++;
          revenueBySource[src].rev += bk.paymentStatus === "deposit-paid" ? (bk.depositAmount || 0) : bk.paymentAmount;
        }
        const srcEntries = Object.entries(revenueBySource).sort((a, b) => b[1].rev - a[1].rev);
        const maxSrcRev = srcEntries.length > 0 ? Math.max(...srcEntries.map(e => e[1].rev), 1) : 1;

        // ── Quarterly trends (last 8 quarters) ────────────────
        const now = new Date();
        const quarters = Array.from({ length: 8 }, (_, i) => {
          const offset = 7 - i;
          const qIdx = now.getMonth() < 3 ? 0 : now.getMonth() < 6 ? 1 : now.getMonth() < 9 ? 2 : 3;
          const totalQ = now.getFullYear() * 4 + qIdx - offset;
          const yr = Math.floor(totalQ / 4);
          const q = totalQ % 4;
          const startMonth = q * 3;
          const endMonth = startMonth + 2;
          const qLabel = `Q${q + 1}'${String(yr).slice(-2)}`;
          const rev = payments.filter(p => {
            if (p.status !== "completed") return false;
            const d = new Date(p.date);
            return d.getFullYear() === yr && d.getMonth() >= startMonth && d.getMonth() <= endMonth;
          }).reduce((s, p) => s + p.amount, 0);
          const bkCount = bookings.filter(b => {
            const d = new Date(b.date);
            return d.getFullYear() === yr && d.getMonth() >= startMonth && d.getMonth() <= endMonth && b.status !== "cancelled";
          }).length;
          return { label: qLabel, rev, bkCount };
        });
        const maxQRev = Math.max(...quarters.map(q => q.rev), 1);

        // ── Expenses vs revenue (monthly, last 6 months) ───────
        const allExpenses = financeExpenses;
        const last6 = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
          const rev = payments.filter(p => p.status === "completed" && p.date?.startsWith(key)).reduce((s, p) => s + p.amount, 0);
          const exp = allExpenses.filter((e: Expense) => e.date?.startsWith(key)).reduce((s: number, e: Expense) => s + e.amount, 0);
          return { label, rev, exp, net: rev - exp };
        });
        const maxRevExp = Math.max(...last6.map(m => Math.max(m.rev, m.exp)), 1);

        // ── CSV export helper ──────────────────────────────────
        const exportCSV = () => {
          const rows = [
            ["Date", "Client", "Album", "Method", "Amount", "Status", "Description"],
            ...payments.map(p => [
              p.date ? new Date(p.date).toLocaleDateString("en-AU") : "",
              p.clientName || "",
              p.albumTitle || "",
              p.method || "",
              p.amount.toFixed(2),
              p.status || "",
              p.description || "",
            ])
          ];
          const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `photoflow-payments-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        };

        // ── Bookings CSV export ────────────────────────────────
        const exportBookingsCSV = () => {
          const rows = [
            ["Date", "Client", "Email", "Instagram", "Type", "Duration", "Status", "Payment", "Amount", "Source"],
            ...bookings.map(b => [
              b.date || "",
              b.clientName || "",
              b.clientEmail || "",
              b.instagramHandle || "",
              b.type || "",
              String(b.duration || ""),
              b.status || "",
              b.paymentStatus || "",
              b.paymentAmount ? b.paymentAmount.toFixed(2) : "0",
              (b.source as string) || "direct",
            ])
          ];
          const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `photoflow-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        };

        return (
          <div className="glass-panel rounded-xl p-5 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="font-display text-base text-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" /> Advanced Analytics
              </h3>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={exportBookingsCSV} className="gap-1.5 font-body text-xs border-border text-foreground">
                  <Download className="w-3.5 h-3.5" /> Bookings CSV
                </Button>
                <Button size="sm" variant="outline" onClick={exportCSV} className="gap-1.5 font-body text-xs border-border text-foreground">
                  <Download className="w-3.5 h-3.5" /> Payments CSV
                </Button>
              </div>
            </div>

            {/* Revenue by booking source */}
            {srcEntries.length > 0 && (
              <div>
                <p className="text-[10px] font-body text-muted-foreground tracking-wider uppercase mb-3">Revenue by Booking Source</p>
                <div className="space-y-2.5">
                  {srcEntries.map(([src, data]) => {
                    const pct = Math.round((data.rev / maxSrcRev) * 100);
                    const color = SOURCE_COLORS_ADV[src] || "#71717a";
                    return (
                      <div key={src} className="flex items-center gap-3">
                        <span className="text-xs font-body text-muted-foreground w-24 shrink-0">{SOURCE_LABELS_ADV[src] || src}</span>
                        <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-xs font-body text-foreground w-16 text-right shrink-0">${data.rev.toFixed(0)}</span>
                        <span className="text-[10px] font-body text-muted-foreground/60 w-8 text-right shrink-0">{data.count}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] font-body text-muted-foreground/50 mt-1.5">Revenue · Booking count per source</p>
              </div>
            )}

            {/* Quarterly trends */}
            <div>
              <p className="text-[10px] font-body text-muted-foreground tracking-wider uppercase mb-3">Quarterly Revenue Trend</p>
              <div className="flex items-end gap-1.5 h-24">
                {quarters.map((q, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div
                      className="w-full rounded-t bg-primary/50 group-hover:bg-primary transition-colors"
                      style={{ height: `${Math.max(2, Math.round((q.rev / maxQRev) * 100))}%` }}
                    />
                    {q.rev > 0 && (
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center whitespace-nowrap text-[9px] font-body bg-secondary border border-border rounded px-1.5 py-0.5 text-foreground z-10 pointer-events-none">
                        <span>${q.rev.toFixed(0)}</span>
                        <span className="text-muted-foreground">{q.bkCount} bk</span>
                      </div>
                    )}
                    <span className="text-[8px] font-body text-muted-foreground/50">{q.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Expenses vs Revenue (last 6 months) */}
            {allExpenses.length > 0 && (
              <div>
                <p className="text-[10px] font-body text-muted-foreground tracking-wider uppercase mb-3">Revenue vs Expenses — Last 6 Months</p>
                <div className="flex items-end gap-2 h-24">
                  {last6.map((m, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div className="w-full flex items-end gap-0.5" style={{ height: "100%" }}>
                        <div className="flex-1 rounded-t bg-green-500/50 group-hover:bg-green-500/70 transition-colors" style={{ height: `${Math.max(2, Math.round((m.rev / maxRevExp) * 100))}%`, alignSelf: "flex-end" }} />
                        <div className="flex-1 rounded-t bg-red-500/40 group-hover:bg-red-500/60 transition-colors" style={{ height: `${Math.max(2, Math.round((m.exp / maxRevExp) * 100))}%`, alignSelf: "flex-end" }} />
                      </div>
                      {(m.rev > 0 || m.exp > 0) && (
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center whitespace-nowrap text-[9px] font-body bg-secondary border border-border rounded px-1.5 py-0.5 text-foreground z-10 pointer-events-none gap-0.5">
                          <span className="text-green-400">Rev ${m.rev.toFixed(0)}</span>
                          <span className="text-red-400">Exp ${m.exp.toFixed(0)}</span>
                        </div>
                      )}
                      <span className="text-[8px] font-body text-muted-foreground/50">{m.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-2">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500/60" /><span className="text-[10px] font-body text-muted-foreground">Revenue</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500/50" /><span className="text-[10px] font-body text-muted-foreground">Expenses</span></div>
                  <span className="text-[10px] font-body text-muted-foreground/50 ml-auto">Net last 6mo: <span className={last6.reduce((s, m) => s + m.net, 0) >= 0 ? "text-green-400" : "text-red-400"}>${last6.reduce((s, m) => s + m.net, 0).toFixed(0)}</span></span>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-display text-base text-foreground">Payment History</h3>
          <div className="relative mt-3 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={financeSearch} onChange={event => setFinanceSearch(event.target.value)} placeholder="Search client, album, or BK reference…" className="pl-8 h-8 text-xs font-body" />
          </div>
        </div>
        {filteredPayments.length === 0 ? (
          <div className="p-12 text-center">
            <DollarSign className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-body text-muted-foreground">{financeSearch ? "No payments match that search." : "No payments recorded yet"}</p>
            {!financeSearch && <p className="text-xs font-body text-muted-foreground/60 mt-1">Stripe and bank transfer payments will appear here</p>}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredPayments.map(p => {
              const showThumbs = expandedDownloadKeys.has(p.id);
              const paymentAlb = showThumbs ? albumsState.find(a => a.id === p.albumId) : null;
              const purchasedPhotos = showThumbs && p.photoIds?.length
                ? p.photoIds.map(id => paymentAlb?.photos?.find((ph: any) => ph.id === id)).filter(Boolean)
                : [];
              return (
                <div key={p.id} className="px-4 py-3 hover:bg-secondary/30 transition-colors group">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-body text-foreground truncate">{p.clientName}</p>
                        <span className="text-muted-foreground/40 text-xs">·</span>
                        <p className="text-xs font-body text-muted-foreground truncate">{p.albumTitle}</p>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <p className="text-[10px] font-body text-muted-foreground/60">{p.description} · {new Date(p.date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p>
                        {p.purchaserEmail && (
                          <span className="text-[10px] font-body text-primary/60 bg-primary/5 px-1.5 py-0.5 rounded">{p.purchaserEmail}</span>
                        )}
                        {p.reference && <span className="text-[10px] font-mono text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded">{p.reference}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.photoIds && p.photoIds.length > 0 && (
                        <button
                          onClick={() => toggleDownloadThumbs(p.id)}
                          className={`flex items-center gap-1 text-[10px] font-body px-2 py-1 rounded border transition-all ${showThumbs ? "border-primary/40 text-primary bg-primary/10" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                          title={showThumbs ? "Hide photos" : "Show photos"}
                        >
                          <Grid className="w-2.5 h-2.5" />
                          {p.photoIds.length}
                        </button>
                      )}
                      <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${methodColor(p.method)}`}>{methodLabel(p.method)}</span>
                      <span className={`text-[10px] font-body px-2 py-0.5 rounded-full capitalize ${statusColor(p.status)}`}>{p.status}</span>
                      <p className="text-sm font-display text-foreground w-16 text-right">${p.amount.toFixed(2)}</p>
                      {p.bookingId ? (
                        <button onClick={() => navigate(`/admin/bookings?search=${encodeURIComponent(p.reference || p.clientName)}`)} className="text-[10px] font-body text-primary hover:underline">Booking</button>
                      ) : (
                        <button
                          onClick={() => handleDelete(p)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400"
                          title="Delete & revoke access"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {showThumbs && purchasedPhotos.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 pb-1">
                      {(purchasedPhotos as any[]).slice(0, 24).map((ph: any) => (
                        <img
                          key={ph.id}
                          src={ph.thumbnail || ph.src}
                          alt={ph.title}
                          className="w-10 h-10 rounded object-cover border border-border/50"
                          loading="lazy"
                        />
                      ))}
                      {purchasedPhotos.length > 24 && (
                        <span className="w-10 h-10 rounded bg-secondary/50 border border-border/50 flex items-center justify-center text-[10px] font-body text-muted-foreground">
                          +{purchasedPhotos.length - 24}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {filteredPayments.length > 0 && (
          <div className="p-4 border-t border-border flex justify-between items-center">
            <p className="text-xs font-body text-muted-foreground">{filteredPayments.length}{financeSearch ? ` of ${payments.length}` : ""} total records</p>
            <p className="text-sm font-body text-foreground">Total collected: <span className="text-green-400 font-medium">${totalRevenue.toFixed(2)}</span></p>
          </div>
        )}
      </div>

      {/* Download Log */}
      {(() => {
        const allDownloads = albumsState.flatMap(alb =>
          (alb.downloadHistory || []).map((h: any) => ({
            ...h,
            albumTitle: alb.title,
            albumId: alb.id,
            clientName: alb.clientName || "Unknown",
          }))
        ).sort((a: any, b: any) => new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime());

        if (allDownloads.length === 0) return null;

        const handleDeleteDownloadEntry = (albumId: string, downloadedAt: string) => {
          const albums = getAlbums();
          const album = albums.find(a => a.id === albumId);
          if (!album) return;
          const updated = { ...album, downloadHistory: (album.downloadHistory || []).filter((entry: any) => entry.downloadedAt !== downloadedAt) };
          updateAlbum(updated);
          setAlbumsState(getAlbums());
          toast.success("Download log entry removed");
        };

        const handleClearAllDownloadLog = () => {
          if (!confirm(`Clear all ${allDownloads.length} download log entries? This cannot be undone.`)) return;
          const albums = getAlbums();
          const updated = albums.map(a => ({ ...a, downloadHistory: [] }));
          updated.forEach(a => updateAlbum(a));
          setAlbumsState(getAlbums());
          toast.success("Download log cleared");
        };

        const handleExportDownloadCSV = () => {
          const rows = [
            ["Date", "Album", "Client", "Email", "Photos", "Quality", "Method"],
            ...allDownloads.map((d: any) => [
              new Date(d.downloadedAt).toLocaleString(),
              `"${(d.albumTitle || "").replace(/"/g, '""')}"`,
              `"${(d.clientName || "").replace(/"/g, '""')}"`,
              `"${(d.email || "").replace(/"/g, '""')}"`,
              d.photoCount ?? d.photoIds?.length ?? 0,
              d.quality || "standard",
              d.method || "—",
            ]),
          ];
          const csv = rows.map(r => r.join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `download-log-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success("CSV exported");
        };

        return (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-display text-base text-foreground">Download Log</h3>
                <p className="text-xs font-body text-muted-foreground mt-0.5">{allDownloads.length} download event{allDownloads.length !== 1 ? "s" : ""}{downloadCaptureStats?.uniqueEmails ? ` · ${downloadCaptureStats.uniqueEmails} captured email${downloadCaptureStats.uniqueEmails === 1 ? "" : "s"}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportDownloadCSV}
                  className="gap-1.5 font-body text-xs"
                >
                  <Download className="w-3 h-3" /> Export CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClearAllDownloadLog}
                  className="gap-1.5 font-body text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-3 h-3" /> Clear All
                </Button>
              </div>
            </div>
            {downloadCaptureStats?.totalCaptures > 0 && (
              <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
                {[
                  ["Captured emails", downloadCaptureStats.uniqueEmails],
                  ["Tracked downloads", downloadCaptureStats.downloads],
                  ["Clean photos", downloadCaptureStats.cleanPhotos],
                  ["Watermarked", downloadCaptureStats.watermarkedPhotos],
                ].map(([label, value]) => (
                  <div key={String(label)} className="bg-card px-4 py-3">
                    <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p className="mt-1 font-display text-xl text-foreground">{Number(value || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
              {allDownloads.map((d: any, i: number) => {
                const entryKey = `${d.albumId}-${d.downloadedAt}`;
                const showThumbs = expandedDownloadKeys.has(entryKey);
                const alb = showThumbs ? albumsState.find(a => a.id === d.albumId) : null;
                const downloadedPhotos = showThumbs && d.photoIds?.length
                  ? (d.photoIds as string[]).map((id: string) => alb?.photos.find((p: any) => p.id === id)).filter(Boolean)
                  : [];
                const photoCount: number = d.photoCount ?? d.photoIds?.length ?? 0;
                return (
                  <div key={i} className="px-4 py-2.5 hover:bg-secondary/30 transition-colors group">
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-body text-foreground">{d.clientName}</p>
                          <span className="text-muted-foreground/40 text-xs">·</span>
                          <p className="text-xs font-body text-muted-foreground truncate">{d.albumTitle}</p>
                          {d.email && <span className="text-[10px] font-body text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded">{d.email}</span>}
                        </div>
                        <p className="text-[10px] font-body text-muted-foreground/60 mt-0.5">
                          {new Date(d.downloadedAt).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {" · "}{d.quality || "original"}
                          {d.sessionKey && <span className="ml-1 opacity-40">({d.sessionKey.slice(0, 16)}…)</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {photoCount > 0 && (
                          <button
                            onClick={() => toggleDownloadThumbs(entryKey)}
                            className={`flex items-center gap-1 text-[10px] font-body px-2 py-1 rounded border transition-all ${showThumbs ? "border-primary/40 text-primary bg-primary/10" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                            title={showThumbs ? "Hide photos" : "Show photos"}
                          >
                            <Grid className="w-2.5 h-2.5" />
                            {photoCount}
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteDownloadEntry(d.albumId, d.downloadedAt)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400"
                          title="Remove log entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {showThumbs && downloadedPhotos.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2 pb-1">
                        {(downloadedPhotos as any[]).slice(0, 24).map((p: any) => (
                          <img
                            key={p.id}
                            src={p.thumbnail || p.src}
                            alt={p.title}
                            className="w-10 h-10 rounded object-cover border border-border/50"
                            loading="lazy"
                          />
                        ))}
                        {downloadedPhotos.length > 24 && (
                          <span className="w-10 h-10 rounded bg-secondary/50 border border-border/50 flex items-center justify-center text-[10px] font-body text-muted-foreground">
                            +{downloadedPhotos.length - 24}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Expenses Tracker ─────────────────────────────────── */}
      <ExpensesPanel />

      {/* ── Quotes ───────────────────────────────────────────── */}
      <QuotesPanel />
    </div>
  );
}

// ─── Expenses Panel ───────────────────────────────────────────────────────────

function ExpensesPanel() {
  const [expenses, setExpenses] = React.useState<Expense[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ description: "", amount: "", category: "other", date: new Date().toISOString().slice(0, 10), notes: "" });

  React.useEffect(() => { getExpenses().then(e => { setExpenses(e); setLoading(false); }); }, []);

  const reload = () => getExpenses().then(setExpenses);
  const categories = ["equipment", "travel", "software", "marketing", "venue", "props", "printing", "other"];
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const byCategory = categories.map(c => ({ category: c, total: expenses.filter(e => e.category === c).reduce((s, e) => s + e.amount, 0) })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  const handleSave = async () => {
    if (!form.description || !form.amount) return;
    if (editingId) {
      await updateExpense(editingId, { description: form.description, amount: parseFloat(form.amount), category: form.category as Expense["category"], date: form.date, notes: form.notes });
    } else {
      await createExpense({ description: form.description, amount: parseFloat(form.amount), category: form.category as Expense["category"], date: form.date, notes: form.notes });
    }
    setShowForm(false); setEditingId(null); setForm({ description: "", amount: "", category: "other", date: new Date().toISOString().slice(0, 10), notes: "" });
    reload();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this expense?")) return;
    await deleteExpense(id); reload();
  };

  const startEdit = (e: Expense) => { setForm({ description: e.description, amount: String(e.amount), category: e.category, date: e.date, notes: e.notes || "" }); setEditingId(e.id); setShowForm(true); };

  return (
    <div className="glass-panel rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-base text-foreground">Expenses</h3>
          <p className="text-xs font-body text-muted-foreground">Track business costs and overheads</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-body text-destructive">${totalExpenses.toFixed(2)} total</span>
          <button onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ description: "", amount: "", category: "other", date: new Date().toISOString().slice(0, 10), notes: "" }); }} className="inline-flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            <PlusCircle className="w-3.5 h-3.5" /> Add Expense
          </button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Description *</label>
              <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="w-full text-sm font-body bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="e.g. Adobe Lightroom subscription" />
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Amount *</label>
              <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} className="w-full text-sm font-body bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className="w-full text-sm font-body bg-background border border-border rounded-lg px-3 py-2 text-foreground capitalize">
                {categories.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Date</label>
              <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className="w-full text-sm font-body bg-background border border-border rounded-lg px-3 py-2 text-foreground" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-xs font-body px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={handleSave} className="text-xs font-body px-3 py-1.5 rounded-lg bg-primary text-background hover:bg-primary/90">{editingId ? "Update" : "Add"} Expense</button>
          </div>
        </div>
      )}

      {byCategory.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {byCategory.map(c => (
            <span key={c.category} className="text-[10px] font-body px-2 py-0.5 rounded-full bg-secondary/50 border border-border/50 text-muted-foreground capitalize">{c.category}: ${c.total.toFixed(0)}</span>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm font-body text-muted-foreground">Loading…</p>
      ) : expenses.length === 0 ? (
        <p className="text-sm font-body text-muted-foreground">No expenses recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {expenses.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(exp => (
            <div key={exp.id} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-body text-foreground truncate">{exp.description}</p>
                <p className="text-[10px] font-body text-muted-foreground capitalize">{exp.category} · {exp.date}</p>
              </div>
              <span className="text-sm font-body text-destructive font-medium">-${exp.amount.toFixed(2)}</span>
              <button onClick={() => startEdit(exp)} className="text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => handleDelete(exp.id)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Quotes Panel ─────────────────────────────────────────────────────────────

function QuotesPanel() {
  const [quotes, setQuotes] = React.useState<Quote[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState({ clientName: "", clientEmail: "", description: "", amount: "", expiryDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), notes: "" });

  React.useEffect(() => { getQuotes().then(q => { setQuotes(q); setLoading(false); }); }, []);
  const reload = () => getQuotes().then(setQuotes);

  const statusColor = (s: string) => {
    if (s === "accepted") return "text-green-400 bg-green-500/10";
    if (s === "declined") return "text-destructive bg-destructive/10";
    if (s === "converted") return "text-blue-400 bg-blue-500/10";
    if (s === "expired") return "text-muted-foreground bg-secondary/50";
    if (s === "sent") return "text-primary bg-primary/10";
    return "text-yellow-400 bg-yellow-500/10";
  };

  const handleSave = async () => {
    if (!form.clientName || !form.amount) return;
    await createQuote({
      to: { name: form.clientName, email: form.clientEmail, address: "" },
      items: [{ id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36), description: form.description || "Photography Services", quantity: 1, unitPrice: parseFloat(form.amount) || 0 }],
      notes: form.notes,
      expiryDate: form.expiryDate,
    } as any);
    setShowForm(false);
    setForm({ clientName: "", clientEmail: "", description: "", amount: "", expiryDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), notes: "" });
    reload();
    toast.success("Quote created");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this quote?")) return;
    await deleteQuote(id); reload();
  };

  const handleConvert = async (id: string) => {
    const result = await convertQuoteToInvoice(id);
    if (result) { toast.success(`Converted to invoice ${result.invoice.number}`); reload(); }
    else toast.error("Failed to convert quote");
  };

  const handleMarkSent = async (q: Quote) => {
    await updateQuote(q.id, { status: "sent", sentAt: new Date().toISOString() });
    reload(); toast.success("Quote marked as sent");
  };

  return (
    <div className="glass-panel rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-base text-foreground">Quotes & Estimates</h3>
          <p className="text-xs font-body text-muted-foreground">Send cost estimates to clients before they book</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
          <PlusCircle className="w-3.5 h-3.5" /> New Quote
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Client Name *</label>
              <input value={form.clientName} onChange={e => setForm(p => ({ ...p, clientName: e.target.value }))} className="w-full text-sm font-body bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Client name" />
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Client Email</label>
              <input type="email" value={form.clientEmail} onChange={e => setForm(p => ({ ...p, clientEmail: e.target.value }))} className="w-full text-sm font-body bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="client@email.com" />
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Service Description</label>
              <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="w-full text-sm font-body bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Photography Services" />
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Amount *</label>
              <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} className="w-full text-sm font-body bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-body text-muted-foreground mb-1 block">Expiry Date</label>
              <input type="date" value={form.expiryDate} onChange={e => setForm(p => ({ ...p, expiryDate: e.target.value }))} className="w-full text-sm font-body bg-background border border-border rounded-lg px-3 py-2 text-foreground" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="text-xs font-body px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={handleSave} className="text-xs font-body px-3 py-1.5 rounded-lg bg-primary text-background hover:bg-primary/90">Create Quote</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm font-body text-muted-foreground">Loading…</p>
      ) : quotes.length === 0 ? (
        <p className="text-sm font-body text-muted-foreground">No quotes yet. Create one above.</p>
      ) : (
        <div className="space-y-2">
          {quotes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(q => {
            const total = q.items?.reduce((s, i) => s + i.unitPrice * i.quantity, 0) || 0;
            return (
              <div key={q.id} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-body text-foreground truncate">{q.number} · {q.to?.name}</p>
                  <p className="text-[10px] font-body text-muted-foreground">Expires {q.expiryDate} · ${total.toFixed(2)}</p>
                </div>
                <span className={`text-[10px] font-body px-2 py-0.5 rounded-full capitalize ${statusColor(q.status)}`}>{q.status}</span>
                {q.status === "draft" && <button onClick={() => handleMarkSent(q)} className="text-[10px] font-body px-2 py-0.5 rounded bg-secondary hover:bg-secondary/80 text-muted-foreground">Mark Sent</button>}
                {(q.status === "accepted" || q.status === "sent") && (
                  <button onClick={() => handleConvert(q.id)} className="text-[10px] font-body px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20">→ Invoice</button>
                )}
                <button onClick={() => handleDelete(q.id)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


