import { buildClientEmail, escapeEmailHtml } from "./client-email";
import type { Invoice, InvoiceItem, InvoiceParty, InvoiceStatus } from "@/lib/types";

function generateId(prefix: string) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function calcInvSubtotal(items: InvoiceItem[]) {
  return items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
}
export function calcInvTotal(inv: Invoice) {
  const sub = calcInvSubtotal(inv.items);
  const disc = inv.discount ?? 0;
  return (sub - disc) * (1 + (inv.tax ?? 0) / 100);
}

export const INV_STATUS_META: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  draft:     { label: "Draft",     color: "text-gray-400",    bg: "bg-gray-500/10"    },
  sent:      { label: "Sent",      color: "text-blue-400",    bg: "bg-blue-500/10"    },
  paid:      { label: "Paid",      color: "text-green-400",   bg: "bg-green-500/10"   },
  partial:   { label: "Partial",   color: "text-amber-400",   bg: "bg-amber-500/10"   },
  overdue:   { label: "Overdue",   color: "text-red-400",     bg: "bg-red-500/10"     },
  cancelled: { label: "Cancelled", color: "text-gray-400",    bg: "bg-gray-500/10"    },
};

export function emptyParty(): InvoiceParty { return { name: "", email: "", address: "", abn: "" }; }
export function emptyItem(): InvoiceItem   { return { id: generateId("item"), description: "", quantity: 1, unitPrice: 0 }; }

export function invoiceCurrency(inv: Pick<Invoice, "currency">) {
  return inv.currency || "AUD";
}

export function formatInvMoney(inv: Pick<Invoice, "currency">, amount: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: invoiceCurrency(inv),
    minimumFractionDigits: 2,
  }).format(amount);
}

export function buildInvoiceEmailHtml(inv: Invoice, shareUrl: string, isReminder = false): string {
  const total = calcInvTotal(inv);
  const sub   = calcInvSubtotal(inv.items);
  const disc  = inv.discount ?? 0;
  const taxRate = inv.tax ?? 0;
  const taxAmt  = (sub - disc) * (taxRate / 100);
  const rows = inv.items.map(it =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #e8e6e1">${escapeEmailHtml(it.description)}${it.subdescription ? `<br><span style="font-size:11px;color:#73716c">${escapeEmailHtml(it.subdescription)}</span>` : ""}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #e8e6e1;text-align:right">${it.quantity}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #e8e6e1;text-align:right">${formatInvMoney(inv, it.unitPrice)}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #e8e6e1;text-align:right">${formatInvMoney(inv, it.quantity * it.unitPrice)}</td></tr>`
  ).join("");
  return buildClientEmail({
    title: `${isReminder ? "Payment reminder" : "Invoice"}: ${inv.number}`,
    label: inv.from.name || "",
    bodyHtml: `<p style="font-size:15px;line-height:1.7;margin:0 0 24px;">Hi ${escapeEmailHtml(inv.to.name)}, ${isReminder ? "your invoice is due. The details are below." : "here are your invoice details."}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead><tr style="background:#f7f6f3">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#73716c">Description</th>
        <th style="padding:8px 12px;text-align:right;font-size:11px;color:#73716c">Qty</th>
        <th style="padding:8px 12px;text-align:right;font-size:11px;color:#73716c">Unit</th>
        <th style="padding:8px 12px;text-align:right;font-size:11px;color:#73716c">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table style="width:220px;margin-left:auto;border-collapse:collapse;margin-bottom:24px">
      <tr><td style="padding:4px 8px;color:#73716c">Subtotal</td><td style="padding:4px 8px;text-align:right">${formatInvMoney(inv, sub)}</td></tr>
      ${disc > 0 ? `<tr><td style="padding:4px 8px;color:#494742">Discount</td><td style="padding:4px 8px;text-align:right;color:#494742">−${formatInvMoney(inv, disc)}</td></tr>` : ""}
      ${taxRate > 0 ? `<tr><td style="padding:4px 8px;color:#73716c">Tax (${taxRate}%)</td><td style="padding:4px 8px;text-align:right">${formatInvMoney(inv, taxAmt)}</td></tr>` : ""}
      <tr style="background:#f7f6f3"><td style="padding:8px;font-weight:bold">Total</td><td style="padding:8px;text-align:right;font-size:18px;font-weight:bold">${formatInvMoney(inv, total)}</td></tr>
    </table>
    ${inv.notes ? `<p style="padding:12px;background:#f7f6f3;border-radius:8px;color:#494742;margin-bottom:24px">${escapeEmailHtml(inv.notes)}</p>` : ""}
`,
    action: shareUrl ? { label: "View invoice and pay", url: shareUrl } : undefined,
    footer: `Invoice ${inv.number} · Due ${inv.dueDate || "on receipt"}`,
  });
}


