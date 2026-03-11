import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import { getInvoiceByToken, createInvoiceCheckout, getStripeStatus } from "@/lib/api";
import type { Invoice } from "@/lib/types";
import { Loader2, CheckCircle2, Clock, AlertCircle, XCircle, CreditCard, Building2, Printer, ExternalLink, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function CopyButton({ value, fieldKey, copiedField, onCopy }: {
  value: string;
  fieldKey: string;
  copiedField: string | null;
  onCopy: (value: string, field: string) => void;
}) {
  return (
    <button
      onClick={() => onCopy(value, fieldKey)}
      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
      title={`Copy ${fieldKey}`}
    >
      {copiedField === fieldKey
        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
        : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function calcSubtotal(items: Invoice["items"]) {
  return items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
}

function calcTotals(invoice: Invoice) {
  const sub = calcSubtotal(invoice.items);
  const disc = invoice.discount ?? 0;
  const taxRate = invoice.tax ?? 0;
  const taxAmt = (sub - disc) * (taxRate / 100);
  return { sub, disc, taxAmt, taxRate, total: sub - disc + taxAmt };
}

const STATUS_STYLES: Record<Invoice["status"], { label: string; icon: React.ReactNode; className: string }> = {
  draft:     { label: "Draft",                    icon: <Clock className="w-4 h-4" />,        className: "text-gray-400 bg-gray-500/15"   },
  sent:      { label: "Sent – Awaiting Payment",  icon: <Clock className="w-4 h-4" />,        className: "text-yellow-400 bg-yellow-500/15"},
  paid:      { label: "Paid",                     icon: <CheckCircle2 className="w-4 h-4" />, className: "text-green-400 bg-green-500/15" },
  overdue:   { label: "Overdue",                  icon: <AlertCircle className="w-4 h-4" />,  className: "text-red-400 bg-red-500/15"    },
  cancelled: { label: "Cancelled",                icon: <XCircle className="w-4 h-4" />,      className: "text-gray-400 bg-gray-500/15"  },
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function InvoiceView() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const isPrintMode = searchParams.get("print") === "1";
  const justPaid = searchParams.get("paid") === "1";

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stripeAvailable, setStripeAvailable] = useState(false);
  const [payingStripe, setPayingStripe] = useState(false);
  // Poll for paid status after Stripe redirect
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  usePageTitle(invoice ? `Invoice ${invoice.number}` : loading ? "Invoice — Loading…" : "Invoice");

  useEffect(() => {
    if (!token) { setError("Invalid link"); setLoading(false); return; }
    getInvoiceByToken(token).then(({ invoice: inv, error: err }) => {
      if (err || !inv) { setError("Invoice not found"); setLoading(false); return; }
      setInvoice(inv);
      setLoading(false);
      // Check Stripe availability if needed
      if ((inv.paymentMethods || []).includes("stripe") && inv.status !== "paid" && !justPaid) {
        getStripeStatus().then(s => setStripeAvailable(s.configured));
      }
    });
  }, [token, justPaid]);

  // Auto-trigger print dialog when ?print=1
  useEffect(() => {
    if (isPrintMode && invoice && !loading) {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [isPrintMode, invoice, loading]);

  // Poll for paid status after Stripe success redirect
  useEffect(() => {
    if (!justPaid || !token || !invoice || invoice.status === "paid") return;
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      const { invoice: updated } = await getInvoiceByToken(token);
      if (updated?.status === "paid") {
        setInvoice(updated);
        if (pollRef.current) clearInterval(pollRef.current);
      }
      if (attempts >= 10) {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [justPaid, token, invoice]);

  const handleStripePayment = async () => {
    if (!invoice) return;
    setPayingStripe(true);
    const { sub, disc, taxAmt } = calcTotals(invoice);
    const total = sub - disc + taxAmt;
    const { url, error: err } = await createInvoiceCheckout({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      clientName: invoice.to.name,
      clientEmail: invoice.to.email,
      amount: total,
      shareToken: invoice.shareToken,
    });
    if (err || !url) {
      toast.error(err || "Could not start payment");
      setPayingStripe(false);
      return;
    }
    window.location.href = url;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="font-display text-2xl text-foreground mb-2">Invoice Not Found</p>
          <p className="text-sm font-body text-muted-foreground">This link may be invalid or the invoice has been removed.</p>
        </div>
      </div>
    );
  }

  const { sub, disc, taxAmt, taxRate, total } = calcTotals(invoice);
  const methods = invoice.paymentMethods || [];
  const statusInfo = invoice.status === "sent" && methods.length === 0
    ? { ...STATUS_STYLES.sent, label: "Sent" }
    : STATUS_STYLES[invoice.status];
  const canPay = !justPaid && invoice.status !== "paid" && invoice.status !== "cancelled" && methods.length > 0;

  return (
    <>
      {/* ── Print-only global style ── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          .print-page { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      {/* ── Sticky download bar (hidden in print) ── */}
      <div className="no-print fixed top-0 left-0 right-0 z-40 bg-background/90 backdrop-blur-sm border-b border-border/50 px-4 py-2 flex items-center justify-between gap-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}>
        <p className="text-xs font-body text-muted-foreground truncate">Invoice {invoice?.number ?? ""}</p>
        <Button
          size="sm"
          variant="default"
          className="gap-1.5 font-body text-xs shrink-0"
          onClick={() => window.print()}
        >
          <Printer className="w-3.5 h-3.5" /> Download PDF
        </Button>
      </div>

      <div className="min-h-screen bg-background px-4 print-page" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 4rem)", paddingBottom: "2rem" }}>
        <div className="max-w-2xl mx-auto">

          {/* ── Header ── */}
          <div className="flex items-start justify-between mb-8">
            <div>
              <p className="text-xs font-body text-muted-foreground uppercase tracking-wider mb-1">Invoice</p>
              <h1 className="font-display text-3xl text-foreground">{invoice.number}</h1>
            </div>
            <span className={`no-print inline-flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-full ${statusInfo.className}`}>
              {statusInfo.icon} {statusInfo.label}
            </span>
          </div>

          {/* ── Paid confirmation banner ── */}
          {(justPaid || invoice.status === "paid") && (
            <div className="mb-6 rounded-xl bg-green-500/10 border border-green-500/30 p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
              <div>
                <p className="text-sm font-body text-green-400 font-medium">Payment received – thank you!</p>
                {invoice.paidAt && (
                  <p className="text-xs font-body text-green-400/70 mt-0.5">
                    Paid on {new Date(invoice.paidAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── From / To ── */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="space-y-1">
              <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground mb-2">From</p>
              <p className="text-sm font-body text-foreground font-medium">{invoice.from.name}</p>
              {invoice.from.abn && <p className="text-xs font-body text-muted-foreground">ABN: {invoice.from.abn}</p>}
              {invoice.from.address && <p className="text-xs font-body text-muted-foreground whitespace-pre-line">{invoice.from.address}</p>}
              {invoice.from.email && <p className="text-xs font-body text-muted-foreground">{invoice.from.email}</p>}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground mb-2">To</p>
              <p className="text-sm font-body text-foreground font-medium">{invoice.to.name}</p>
              {invoice.to.abn && <p className="text-xs font-body text-muted-foreground">ABN: {invoice.to.abn}</p>}
              {invoice.to.address && <p className="text-xs font-body text-muted-foreground whitespace-pre-line">{invoice.to.address}</p>}
              {invoice.to.email && <p className="text-xs font-body text-muted-foreground">{invoice.to.email}</p>}
            </div>
          </div>

          {/* ── Dates ── */}
          <div className="grid grid-cols-2 gap-4 mb-8 text-sm font-body">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Issue Date</p>
              <p className="text-foreground">{new Date(invoice.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</p>
            </div>
            {invoice.dueDate && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Due Date</p>
                <p className={invoice.status === "overdue" ? "text-red-400" : "text-foreground"}>
                  {new Date(invoice.dueDate + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
            )}
          </div>

          {/* ── Line Items ── */}
          <div className="rounded-xl overflow-hidden border border-border mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-secondary/50 text-left">
                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-normal">Description</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-normal text-right">Qty</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-normal text-right">Unit Price</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-normal text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoice.items.map(item => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-foreground">
                      {item.description}
                      {item.subdescription && <p className="text-xs text-muted-foreground mt-0.5">{item.subdescription}</p>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-muted-foreground text-right">${item.unitPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-foreground text-right">${(item.quantity * item.unitPrice).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Totals ── */}
          <div className="flex justify-end mb-8">
            <div className="w-64 space-y-2 text-sm font-body">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span><span>${sub.toFixed(2)}</span>
              </div>
              {disc > 0 && (
                <div className="flex justify-between text-green-400">
                  <span>Discount</span><span>−${disc.toFixed(2)}</span>
                </div>
              )}
              {taxRate > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>GST ({taxRate}%)</span><span>${taxAmt.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-foreground font-medium pt-2 border-t border-border">
                <span>Total</span>
                <span className="font-display text-lg">${total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* ── Notes ── */}
          {invoice.notes && (
            <div className="rounded-xl border border-border p-4 mb-6">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Notes</p>
              <p className="text-sm font-body text-muted-foreground whitespace-pre-line">{invoice.notes}</p>
            </div>
          )}

          {/* ── Payment Options (hidden in print) ── */}
          {canPay && (
            <div className="no-print space-y-4 mb-8">
              <p className="text-xs font-body uppercase tracking-wider text-muted-foreground">Payment Options</p>

              {/* Stripe */}
              {methods.includes("stripe") && stripeAvailable && (
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <CreditCard className="w-4 h-4 text-purple-400" />
                    <p className="text-sm font-body text-foreground font-medium">Pay by Card</p>
                  </div>
                  <p className="text-xs font-body text-muted-foreground mb-4">Secure card payment via Stripe. You'll be redirected to complete payment.</p>
                  <Button
                    onClick={handleStripePayment}
                    disabled={payingStripe}
                    className="gap-2 font-body text-sm w-full sm:w-auto"
                  >
                    {payingStripe ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    {payingStripe ? "Redirecting…" : `Pay $${total.toFixed(2)} with Card`}
                  </Button>
                </div>
              )}

              {/* Bank Transfer */}
              {methods.includes("bank") && (
                <BankTransferPanel invoice={invoice} />
              )}
            </div>
          )}

          <p className="text-center text-xs font-body text-muted-foreground/40 mt-8">
            Generated by PhotoFlow
          </p>
        </div>
      </div>
    </>
  );
}

// ─── Bank Transfer Panel (fetches bank details from server settings) ──────────
function BankTransferPanel({ invoice }: { invoice: Invoice }) {
  const [bank, setBank] = useState<{ accountName?: string; bsb?: string; accountNumber?: string; payId?: string; payIdType?: string; instructions?: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/store/wv_settings")
      .then(r => r.json())
      .then(raw => {
        const stored = raw?.value ?? raw;
        const s = typeof stored === "string" ? JSON.parse(stored) : stored;
        if (s?.bankTransfer?.enabled) setBank(s.bankTransfer);
      })
      .catch(() => {});
  }, []);

  const copyToClipboard = (value: string, field: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }).catch(() => {});
  };

  const { total: grandTotal } = calcTotals(invoice);

  if (!bank) return null;

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-3 mb-3">
        <Building2 className="w-4 h-4 text-blue-400" />
        <p className="text-sm font-body text-foreground font-medium">Pay by Bank Transfer</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm font-body mb-3">
        {bank.accountName && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Account Name</p>
            <p className="text-foreground">{bank.accountName}</p>
          </div>
        )}
        {bank.bsb && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">BSB</p>
            <div className="flex items-center gap-1.5">
              <p className="text-foreground">{bank.bsb}</p>
              <CopyButton value={bank.bsb} fieldKey="bsb" copiedField={copiedField} onCopy={copyToClipboard} />
            </div>
          </div>
        )}
        {bank.accountNumber && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Account Number</p>
            <div className="flex items-center gap-1.5">
              <p className="text-foreground">{bank.accountNumber}</p>
              <CopyButton value={bank.accountNumber} fieldKey="accountNumber" copiedField={copiedField} onCopy={copyToClipboard} />
            </div>
          </div>
        )}
        {bank.payId && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">PayID ({bank.payIdType})</p>
            <div className="flex items-center gap-1.5">
              <p className="text-foreground">{bank.payId}</p>
              <CopyButton value={bank.payId} fieldKey="payId" copiedField={copiedField} onCopy={copyToClipboard} />
            </div>
          </div>
        )}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount</p>
          <div className="flex items-center gap-1.5">
            <p className="text-foreground font-medium">${grandTotal.toFixed(2)}</p>
            <CopyButton value={grandTotal.toFixed(2)} fieldKey="amount" copiedField={copiedField} onCopy={copyToClipboard} />
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reference</p>
          <div className="flex items-center gap-1.5">
            <p className="text-foreground">{invoice.number}</p>
            <CopyButton value={invoice.number} fieldKey="reference" copiedField={copiedField} onCopy={copyToClipboard} />
          </div>
        </div>
      </div>
      {bank.instructions && (
        <p className="text-xs font-body text-muted-foreground mt-2 p-3 bg-secondary/40 rounded-lg">{bank.instructions}</p>
      )}
      <p className="text-xs font-body text-muted-foreground/60 mt-3">
        Please use <strong className="text-foreground">{invoice.number}</strong> as your payment reference. Once payment is received your invoice will be marked as paid.
      </p>
    </div>
  );
}
