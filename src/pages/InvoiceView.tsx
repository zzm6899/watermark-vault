import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getInvoiceByToken } from "@/lib/api";
import type { Invoice } from "@/lib/types";
import { Loader2, CheckCircle2, Clock, AlertCircle, XCircle } from "lucide-react";

function calcSubtotal(items: Invoice["items"]) {
  return items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
}

function calcTotal(invoice: Invoice) {
  const sub = calcSubtotal(invoice.items);
  const disc = invoice.discount ?? 0;
  const tax = invoice.tax ?? 0;
  return sub - disc + (sub - disc) * (tax / 100);
}

const STATUS_STYLES: Record<Invoice["status"], { label: string; icon: React.ReactNode; className: string }> = {
  draft: { label: "Draft", icon: <Clock className="w-4 h-4" />, className: "text-gray-400 bg-gray-500/15" },
  sent: { label: "Sent – Awaiting Payment", icon: <Clock className="w-4 h-4" />, className: "text-yellow-400 bg-yellow-500/15" },
  paid: { label: "Paid", icon: <CheckCircle2 className="w-4 h-4" />, className: "text-green-400 bg-green-500/15" },
  overdue: { label: "Overdue", icon: <AlertCircle className="w-4 h-4" />, className: "text-red-400 bg-red-500/15" },
  cancelled: { label: "Cancelled", icon: <XCircle className="w-4 h-4" />, className: "text-gray-400 bg-gray-500/15" },
};

export default function InvoiceView() {
  const { token } = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError("Invalid link"); setLoading(false); return; }
    getInvoiceByToken(token).then(({ invoice: inv, error: err }) => {
      if (err || !inv) setError("Invoice not found");
      else setInvoice(inv);
      setLoading(false);
    });
  }, [token]);

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

  const sub = calcSubtotal(invoice.items);
  const disc = invoice.discount ?? 0;
  const taxRate = invoice.tax ?? 0;
  const taxAmt = (sub - disc) * (taxRate / 100);
  const total = sub - disc + taxAmt;
  const statusInfo = STATUS_STYLES[invoice.status];

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-xs font-body text-muted-foreground uppercase tracking-wider mb-1">Invoice</p>
            <h1 className="font-display text-3xl text-foreground">{invoice.number}</h1>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-full ${statusInfo.className}`}>
            {statusInfo.icon} {statusInfo.label}
          </span>
        </div>

        {/* From / To */}
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

        {/* Meta */}
        <div className="grid grid-cols-2 gap-4 mb-8 text-sm font-body">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Issue Date</p>
            <p className="text-foreground">{new Date(invoice.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</p>
          </div>
          {invoice.dueDate && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Due Date</p>
              <p className={`${invoice.status === "overdue" ? "text-red-400" : "text-foreground"}`}>
                {new Date(invoice.dueDate + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
          )}
        </div>

        {/* Line Items */}
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
                  <td className="px-4 py-3 text-foreground">{item.description}</td>
                  <td className="px-4 py-3 text-muted-foreground text-right">{item.quantity}</td>
                  <td className="px-4 py-3 text-muted-foreground text-right">${item.unitPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-foreground text-right">${(item.quantity * item.unitPrice).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end mb-8">
          <div className="w-64 space-y-2 text-sm font-body">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>${sub.toFixed(2)}</span>
            </div>
            {disc > 0 && (
              <div className="flex justify-between text-green-400">
                <span>Discount</span>
                <span>−${disc.toFixed(2)}</span>
              </div>
            )}
            {taxRate > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>GST ({taxRate}%)</span>
                <span>${taxAmt.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-foreground font-medium pt-2 border-t border-border">
              <span>Total</span>
              <span className="font-display text-lg">${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div className="rounded-xl border border-border p-4 mb-6">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Notes</p>
            <p className="text-sm font-body text-muted-foreground whitespace-pre-line">{invoice.notes}</p>
          </div>
        )}

        <p className="text-center text-xs font-body text-muted-foreground/40 mt-8">
          Generated by Watermark Vault
        </p>
      </div>
    </div>
  );
}
