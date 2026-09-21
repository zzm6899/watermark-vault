import React from "react";
import {
  Plus, Trash2, Edit, CreditCard, Building2, Save, X, ChevronDown, Image, Link2, Send, Copy, Bell,
  Download, Search, Mail, CheckCircle2, Receipt, Printer, AlertCircle, BookOpen, ArrowUpDown,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  getProfile, getBookings, getSettings, getAlbums, getInvoices, setInvoices as saveInvoices,
  cacheInvoicesLocally, updateInvoice, getNextInvoiceNumber, getContacts,
  setContacts as saveContacts,
} from "@/lib/storage";
import {
  buildInvoiceEmailHtml, calcInvSubtotal, calcInvTotal, emptyItem, emptyParty, formatInvMoney,
  invoiceCurrency, INV_STATUS_META,
} from "@/lib/admin-invoice-utils";
import {
  notifyDiscord, createInvoiceCheckout, fetchAdminInvoices, createAdminInvoice, updateAdminInvoice,
  deleteAdminInvoice, sendInvoiceEmail, getStripeStatus,
} from "@/lib/api";
import type { Invoice, InvoiceItem, InvoiceParty, InvoiceStatus } from "@/lib/types";
import { generateCapabilityToken } from "@/lib/capability-token";
import { generateId } from "@/lib/utils";
const PixiesetImportPanel = React.lazy(() => import("@/components/admin/PixiesetImportPanel"));

export default function InvoicesView() {
  const profile = getProfile();
  const settings = getSettings();
  const bankSettings = settings.bankTransfer;

  const [invoices, setInvoices] = React.useState<Invoice[]>(() => getInvoices());
  const [view, setView] = React.useState<"list" | "form">("list");
  const [editing, setEditing] = React.useState<Invoice | null>(null);
  const [filterStatus, setFilterStatus] = React.useState<InvoiceStatus | "all">("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterFrom, setFilterFrom] = React.useState("");
  const [filterTo, setFilterTo] = React.useState("");
  const [sortDir, setSortDir] = React.useState<"desc" | "asc">("desc");
  const [expandedEmailLog, setExpandedEmailLog] = React.useState<string | null>(null);
  const [overflowMenuId, setOverflowMenuId] = React.useState<string | null>(null);
  const [stripeAvailable, setStripeAvailable] = React.useState(false);
  const [sendingEmail, setSendingEmail] = React.useState(false);
  const [processingPay, setProcessingPay] = React.useState(false);

  React.useEffect(() => {
    getStripeStatus().then(s => setStripeAvailable(s.configured));
    fetchAdminInvoices().then(async result => {
      if (!result.ok) { toast.error(result.error || "Unable to load invoices"); return; }
      cacheInvoicesLocally(result.invoices);
      setInvoices(result.invoices);
      // Use confirmed server data, never a stale cached payment status.
      const today = new Date().toISOString().slice(0, 10);
      for (const invoice of result.invoices) {
        if (invoice.status !== "sent" || !invoice.dueDate || invoice.dueDate >= today) continue;
        try { await updateInvoice({ ...invoice, status: "overdue" }); }
        catch (error) { toast.error(error instanceof Error ? error.message : "Could not mark invoice overdue"); }
      }
      setInvoices(getInvoices());
    });
  }, []);

  const acceptCanonicalInvoice = React.useCallback((invoice: Invoice) => {
    setInvoices(current => {
      const next = current.some(item => item.id === invoice.id)
        ? current.map(item => item.id === invoice.id ? invoice : item)
        : [...current, invoice];
      cacheInvoicesLocally(next);
      return next;
    });
  }, []);

  const reload = React.useCallback(async () => {
    const result = await fetchAdminInvoices();
    if (!result.ok) return;
    cacheInvoicesLocally(result.invoices);
    setInvoices(result.invoices);
  }, []);

  // ── helpers ──────────────────────────────────────────────
  const shareUrl = (inv: Invoice) => `${window.location.origin}/invoice/${inv.shareToken}`;

  const openCreate = () => {
    const now = new Date();
    const due = new Date(now); due.setDate(due.getDate() + 30);
    const invFrom = settings.invoiceFrom;
    const blankInv: Invoice = {
      id: generateId("inv"),
      number: getNextInvoiceNumber(),
      status: "draft",
      from: {
        name: (invFrom?.name) || profile.name || "",
        email: invFrom?.email || "",
        address: invFrom?.address || "",
        abn: invFrom?.abn || "",
      },
      to: emptyParty(),
      items: [emptyItem()],
      notes: settings.invoiceNotes || "",
      dueDate: due.toISOString().slice(0, 10),
      createdAt: now.toISOString(),
      shareToken: generateCapabilityToken("inv"),
      emailLog: [],
      paymentMethods: [],
    };
    setEditing(blankInv);
    setView("form");
  };

  const openEdit = (inv: Invoice) => { setEditing({ ...inv }); setView("form"); };

  const handleClone = async (inv: Invoice) => {
    const now = new Date();
    const due = new Date(now); due.setDate(due.getDate() + 30);
    const cloned: Invoice = {
      ...inv,
      id: generateId("inv"),
      number: getNextInvoiceNumber(),
      status: "draft",
      createdAt: now.toISOString(),
      dueDate: due.toISOString().slice(0, 10),
      sentAt: undefined,
      paidAt: undefined,
      stripeSessionId: undefined,
      shareToken: generateCapabilityToken("inv"),
      emailLog: [],
    };
    const result = await createAdminInvoice(cloned);
    if (!result.ok || !result.invoice) { toast.error(result.error || "Unable to clone invoice"); return; }
    acceptCanonicalInvoice(result.invoice);
    toast.success(`Invoice cloned as ${result.invoice.number}`);
  };

  const handleDelete = async (inv: Invoice) => {
    if (!confirm(`Delete invoice ${inv.number}? This cannot be undone.`)) return;
    const result = await deleteAdminInvoice(inv.id);
    if (!result.ok) { toast.error(result.error || "Unable to delete invoice"); return; }
    setInvoices(current => {
      const next = current.filter(item => item.id !== inv.id);
      cacheInvoicesLocally(next);
      return next;
    });
    toast.success("Invoice deleted");
  };

  const handleMarkPaid = async (inv: Invoice) => {
    if (!confirm(`Mark ${inv.number} as paid?`)) return;
    const updated: Invoice = { ...inv, status: "paid", paidAt: new Date().toISOString() };
    const result = await updateAdminInvoice(updated);
    if (!result.ok || !result.invoice) { toast.error(result.error || "Unable to update invoice"); return; }
    acceptCanonicalInvoice(result.invoice);
    notifyDiscord({ event: "invoice-paid", invoice: result.invoice });
    toast.success("Invoice marked as paid");
  };

  const handleMarkOverdue = async (inv: Invoice) => {
    const updated: Invoice = { ...inv, status: "overdue" };
    const result = await updateAdminInvoice(updated);
    if (!result.ok || !result.invoice) { toast.error(result.error || "Unable to update invoice"); return; }
    acceptCanonicalInvoice(result.invoice);
    notifyDiscord({ event: "invoice-overdue", invoice: result.invoice });
    toast.info("Invoice marked as overdue");
  };

  const handleCopyLink = (inv: Invoice) => {
    navigator.clipboard.writeText(shareUrl(inv));
    toast.success("Share link copied");
  };

  const handleExportPDF = (inv: Invoice) => {
    window.open(`${shareUrl(inv)}?print=1`, "_blank");
  };

  /** RFC 4180-compliant CSV cell: wraps in quotes and escapes internal quotes. */
  const csvCell = (v: string | number | undefined | null) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const handleExportAllCSV = () => {
    const rows: string[][] = [
      ["Invoice #", "Date", "Due Date", "Status", "Currency", "Client Name", "Client Email", "From", "Item Description", "Quantity", "Unit Price", "Line Total", "Subtotal", "Tax %", "Discount Amount", "Total"],
    ];
    invoices.forEach(inv => {
      const sub = calcInvSubtotal(inv.items);
      const total = calcInvTotal(inv);
      if (inv.items.length === 0) {
        rows.push([inv.number, inv.createdAt.slice(0, 10), inv.dueDate || "", inv.status, inv.currency || "AUD", inv.to.name || "", inv.to.email || "", inv.from.name || "", "", "", "", "", sub.toFixed(2), String(inv.tax ?? 0), String(inv.discount ?? 0), total.toFixed(2)]);
      } else {
        inv.items.forEach((it, idx) => {
          rows.push([
            idx === 0 ? inv.number : "",
            idx === 0 ? inv.createdAt.slice(0, 10) : "",
            idx === 0 ? (inv.dueDate || "") : "",
            idx === 0 ? inv.status : "",
            idx === 0 ? (inv.currency || "AUD") : "",
            idx === 0 ? (inv.to.name || "") : "",
            idx === 0 ? (inv.to.email || "") : "",
            idx === 0 ? (inv.from.name || "") : "",
            it.description,
            String(it.quantity),
            it.unitPrice.toFixed(2),
            (it.quantity * it.unitPrice).toFixed(2),
            idx === 0 ? sub.toFixed(2) : "",
            idx === 0 ? String(inv.tax ?? 0) : "",
            idx === 0 ? String(inv.discount ?? 0) : "",
            idx === 0 ? total.toFixed(2) : "",
          ]);
        });
      }
    });
    const csv = rows.map(r => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${invoices.length} invoice${invoices.length !== 1 ? "s" : ""} to CSV`);
  };

  const handleSendInvoice = async (inv: Invoice) => {
    if (!inv.to.email) { toast.error("No client email on invoice"); return; }
    setSendingEmail(true);
    const url = shareUrl(inv);
    const html = buildInvoiceEmailHtml(inv, url, false);
    const subject = `Invoice ${inv.number} from ${inv.from.name || "your photographer"}`;
    const text = `Hi ${inv.to.name},\n\nPlease find your invoice ${inv.number} for $${calcInvTotal(inv).toFixed(2)}.\n\nView and pay online: ${url}\n\nDue: ${inv.dueDate || "on receipt"}\n\n${inv.notes || ""}`.trim();
    const { ok, error } = await sendInvoiceEmail(inv.to.email, subject, html, text);
    if (!ok) { toast.error(error || "Failed to send email"); setSendingEmail(false); return; }
    const logEntry = { sentAt: new Date().toISOString(), type: "invoice" as const, to: inv.to.email, subject };
    const updated: Invoice = { ...inv, status: inv.status === "draft" ? "sent" : inv.status, sentAt: inv.sentAt || new Date().toISOString(), emailLog: [...(inv.emailLog || []), logEntry] };
    const saved = await updateAdminInvoice(updated);
    if (!saved.ok || !saved.invoice) { toast.error(saved.error || "Email sent, but invoice history could not be saved"); setSendingEmail(false); return; }
    acceptCanonicalInvoice(saved.invoice);
    notifyDiscord({ event: "invoice-sent", invoice: saved.invoice });
    setSendingEmail(false);
    toast.success(`Invoice sent to ${inv.to.email}`);
  };

  const handleSendReminder = async (inv: Invoice) => {
    if (!inv.to.email) { toast.error("No client email on invoice"); return; }
    setSendingEmail(true);
    const url = shareUrl(inv);
    const html = buildInvoiceEmailHtml(inv, url, true);
    const subject = `Payment Reminder — ${inv.number}`;
    const reminderText = `Hi ${inv.to.name},\n\nThis is a reminder that invoice ${inv.number} for $${calcInvTotal(inv).toFixed(2)} is due ${inv.dueDate ? `on ${inv.dueDate}` : "now"}.\n\nView and pay: ${url}`.trim();
    const { ok, error } = await sendInvoiceEmail(inv.to.email, subject, html, reminderText);
    if (!ok) { toast.error(error || "Failed to send reminder"); setSendingEmail(false); return; }
    const logEntry = { sentAt: new Date().toISOString(), type: "reminder" as const, to: inv.to.email, subject };
    const updated: Invoice = { ...inv, emailLog: [...(inv.emailLog || []), logEntry] };
    const saved = await updateAdminInvoice(updated);
    if (!saved.ok || !saved.invoice) { toast.error(saved.error || "Reminder sent, but invoice history could not be saved"); setSendingEmail(false); return; }
    acceptCanonicalInvoice(saved.invoice);
    notifyDiscord({ event: "invoice-reminder", invoice: saved.invoice });
    setSendingEmail(false);
    toast.success("Payment reminder sent");
  };

  const handleStripeCheckout = async (inv: Invoice) => {
    setProcessingPay(true);
    const { url, error } = await createInvoiceCheckout({
      invoiceId: inv.id,
      shareToken: inv.shareToken,
    });
    setProcessingPay(false);
    if (error || !url) { toast.error(error || "Stripe checkout failed"); return; }
    window.open(url, "_blank");
  };

  const filteredInvoices = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return invoices.filter(i => {
      if (filterStatus !== "all" && i.status !== filterStatus) return false;
      if (q && !(
        i.number.toLowerCase().includes(q) ||
        i.to.name.toLowerCase().includes(q) ||
        i.to.email.toLowerCase().includes(q) ||
        (i.from.name || "").toLowerCase().includes(q)
      )) return false;
      // createdAt is always ISO 8601 (set via new Date().toISOString()), so YYYY-MM-DD slice is lexicographically safe
      if (filterFrom && i.createdAt.slice(0, 10) < filterFrom) return false;
      if (filterTo   && i.createdAt.slice(0, 10) > filterTo)   return false;
      return true;
    });
  }, [invoices, filterStatus, searchQuery, filterFrom, filterTo]);

  const sortedInvoices = React.useMemo(() =>
    [...filteredInvoices].sort((a, b) => {
      const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return sortDir === "desc" ? diff : -diff;
    }),
    [filteredInvoices, sortDir],
  );

  // ── LIST VIEW ──────────────────────────────────────────────
  if (view === "list") {
    const hasActiveFilter = searchQuery.trim() || filterFrom || filterTo || filterStatus !== "all";
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl text-foreground mb-1">Invoices</h2>
            <p className="text-sm font-body text-muted-foreground">Create and manage invoices &amp; quotes</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleExportAllCSV} variant="outline" className="gap-2 font-body text-sm border-border text-foreground" title="Export all invoices as CSV">
              <Download className="w-4 h-4" /> CSV
            </Button>
            <Button onClick={openCreate} className="gap-2 font-body text-sm">
              <Plus className="w-4 h-4" /> New Invoice
            </Button>
          </div>
        </div>

        <React.Suspense fallback={<div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">Loading importer…</div>}><PixiesetImportPanel
          contacts={getContacts()}
          invoices={invoices}
          onReplaceContacts={saveContacts}
          onReplaceInvoices={async nextInvoices => { try { await saveInvoices(nextInvoices); } finally { setInvoices(getInvoices()); } }}
        /></React.Suspense>

        {/* Search + Date range + Sort */}
        <div className="glass-panel rounded-xl p-3 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by number, client name, or email…"
                className="pl-8 bg-secondary border-border text-foreground font-body text-sm h-9"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {/* Date from */}
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[10px] font-body uppercase tracking-wider text-muted-foreground whitespace-nowrap">From</label>
              <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
                className="bg-secondary border border-border text-foreground font-body text-xs rounded-lg px-2 h-9 focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            {/* Date to */}
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[10px] font-body uppercase tracking-wider text-muted-foreground whitespace-nowrap">To</label>
              <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
                className="bg-secondary border border-border text-foreground font-body text-xs rounded-lg px-2 h-9 focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
            {/* Sort toggle */}
            <button
              onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}
              className="shrink-0 h-9 px-3 rounded-lg bg-secondary border border-border text-xs font-body text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
              title="Toggle sort order"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sortDir === "desc" ? "Newest first" : "Oldest first"}
            </button>
          </div>

          {/* Status pills */}
          <div className="flex gap-2 flex-wrap">
            {(["all", "draft", "sent", "paid", "partial", "overdue", "cancelled"] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-body transition-colors ${filterStatus === s ? "bg-primary/20 text-primary border border-primary/30" : "bg-secondary/50 text-muted-foreground border border-border hover:text-foreground"}`}
              >
                {s === "all" ? `All (${invoices.length})` : `${INV_STATUS_META[s].label} (${invoices.filter(i => i.status === s).length})`}
              </button>
            ))}
            {hasActiveFilter && (
              <button
                onClick={() => { setSearchQuery(""); setFilterFrom(""); setFilterTo(""); setFilterStatus("all"); }}
                className="px-3 py-1.5 rounded-full text-xs font-body text-destructive border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Results count when filtering */}
        {hasActiveFilter && (
          <p className="text-xs font-body text-muted-foreground -mt-3">
            Showing {sortedInvoices.length} of {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
          </p>
        )}

        {sortedInvoices.length === 0 ? (
          <div className="glass-panel rounded-xl p-12 text-center">
            <Receipt className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-body text-muted-foreground">{invoices.length === 0 ? "No invoices yet" : "No invoices match your filters"}</p>
            {invoices.length === 0 ? (
              <>
                <p className="text-xs font-body text-muted-foreground/60 mt-1">Create your first invoice to get started</p>
                <Button onClick={openCreate} className="mt-4 gap-2 font-body text-sm" variant="outline">
                  <Plus className="w-4 h-4" /> Create Invoice
                </Button>
              </>
            ) : (
              <button onClick={() => { setSearchQuery(""); setFilterFrom(""); setFilterTo(""); setFilterStatus("all"); }} className="mt-2 text-xs font-body text-primary hover:underline">Clear filters</button>
            )}
          </div>
        ) : (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="divide-y divide-border">
              {sortedInvoices.map(inv => {
                const meta = INV_STATUS_META[inv.status];
                const total = calcInvTotal(inv);
                const logOpen = expandedEmailLog === inv.id;
                const menuOpen = overflowMenuId === inv.id;
                const canAct = inv.status !== "paid" && inv.status !== "cancelled";
                const rowBorder = inv.status === "sent" ? "border-l-4 border-amber-500" : inv.status === "overdue" ? "border-l-4 border-red-500" : inv.status === "paid" ? "border-l-4 border-green-500" : inv.status === "partial" ? "border-l-4 border-amber-400/60" : "";
                const amountColor = inv.status === "sent" ? "text-amber-400" : inv.status === "overdue" ? "text-red-400" : inv.status === "partial" ? "text-amber-300" : "text-foreground";
                return (
                  <div key={inv.id} className={`group ${rowBorder}`}>
                    {/* ── Row ── */}
                    <div className="flex items-start sm:items-center gap-3 px-3 sm:px-4 py-3 hover:bg-secondary/30 transition-colors">
                      {/* Left info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-body text-foreground font-medium">{inv.number}</p>
                          <span className={`text-[10px] font-body px-2 py-0.5 rounded-full ${meta.color} ${meta.bg}`}>{meta.label}</span>
                          {inv.bookingId && <span className="text-[10px] font-body px-1.5 py-0.5 rounded-full text-primary/70 bg-primary/10"><BookOpen className="w-2.5 h-2.5 inline mr-0.5" />Booking</span>}
                          {inv.albumId && <span className="text-[10px] font-body px-1.5 py-0.5 rounded-full text-purple-400/70 bg-purple-500/10"><Image className="w-2.5 h-2.5 inline mr-0.5" />Album</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs font-body text-muted-foreground flex-wrap">
                          <span className="font-medium text-foreground/80">{inv.to.name || "—"}</span>
                          {inv.to.email && <span className="text-primary/60 hidden sm:inline">{inv.to.email}</span>}
                          <span>· Due {inv.dueDate || "—"}</span>
                        </div>
                        {/* Mobile-only: action row */}
                        <div className="flex items-center gap-1.5 mt-2 sm:hidden flex-wrap">
                          <button onClick={() => openEdit(inv)} className="flex items-center gap-1 text-[10px] font-body px-2 py-1 rounded-md bg-secondary text-muted-foreground hover:text-foreground"><Edit className="w-3 h-3" />Edit</button>
                          {canAct && <button onClick={() => handleMarkPaid(inv)} className="flex items-center gap-1 text-[10px] font-body px-2 py-1 rounded-md bg-green-500/10 text-green-400 hover:bg-green-500/20"><CheckCircle2 className="w-3 h-3" />Mark Paid</button>}
                          {canAct && <button onClick={() => handleSendInvoice(inv)} disabled={sendingEmail} className="flex items-center gap-1 text-[10px] font-body px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"><Send className="w-3 h-3" />Send</button>}
                          <button onClick={() => handleExportPDF(inv)} className="flex items-center gap-1 text-[10px] font-body px-2 py-1 rounded-md bg-secondary text-muted-foreground hover:text-foreground"><Printer className="w-3 h-3" />PDF</button>
                          {/* ⋯ overflow menu trigger */}
                          <div className="relative">
                            <button
                              onClick={() => setOverflowMenuId(menuOpen ? null : inv.id)}
                              onKeyDown={e => { if (e.key === "Escape") setOverflowMenuId(null); }}
                              aria-label="More actions"
                              aria-haspopup="menu"
                              aria-expanded={menuOpen}
                              className="flex items-center gap-0.5 text-[10px] font-body px-2 py-1 rounded-md bg-secondary text-muted-foreground hover:text-foreground"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                            {menuOpen && (
                              <div
                                role="menu"
                                className="absolute left-0 bottom-full mb-1 z-50 bg-card border border-border rounded-xl shadow-xl p-1 min-w-[160px] space-y-0.5"
                                onClick={e => e.stopPropagation()}
                                onKeyDown={e => { if (e.key === "Escape") setOverflowMenuId(null); }}
                              >
                                <button role="menuitem" onClick={() => { handleCopyLink(inv); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg"><Link2 className="w-3.5 h-3.5" />Copy share link</button>
                                <button role="menuitem" onClick={() => { setExpandedEmailLog(logOpen ? null : inv.id); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg"><Mail className="w-3.5 h-3.5" />Email history</button>
                                {canAct && <button role="menuitem" onClick={() => { handleSendReminder(inv); setOverflowMenuId(null); }} disabled={sendingEmail} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-yellow-400 hover:bg-secondary rounded-lg"><Bell className="w-3.5 h-3.5" />Reminder</button>}
                                {inv.status === "sent" && <button role="menuitem" onClick={() => { handleMarkOverdue(inv); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-red-400 hover:bg-secondary rounded-lg"><AlertCircle className="w-3.5 h-3.5" />Mark overdue</button>}
                                {stripeAvailable && canAct && (inv.paymentMethods || []).includes("stripe") && <button role="menuitem" onClick={() => { handleStripeCheckout(inv); setOverflowMenuId(null); }} disabled={processingPay} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-purple-400 hover:bg-secondary rounded-lg"><CreditCard className="w-3.5 h-3.5" />Stripe checkout</button>}
                                <button role="menuitem" onClick={() => { handleClone(inv); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg"><Copy className="w-3.5 h-3.5" />Clone</button>
                                <div className="h-px bg-border my-0.5" />
                                <button role="menuitem" onClick={() => { handleDelete(inv); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 className="w-3.5 h-3.5" />Delete</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Amount */}
                      <div className="text-right shrink-0 w-20">
                        <p className={`text-sm font-display ${amountColor}`}>{formatInvMoney(inv, total)}</p>
                        {inv.status === "partial" && inv.amountPaid != null && inv.amountPaid > 0 && (
                          <p className="text-[10px] font-body text-amber-400/70">{formatInvMoney(inv, inv.amountPaid)} paid</p>
                        )}
                      </div>
                      {/* Desktop actions */}
                      <TooltipProvider delayDuration={300}>
                        <div className="hidden sm:flex items-center gap-1.5 shrink-0 relative">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => openEdit(inv)}
                                aria-label={`Edit ${inv.number}`}
                                className="h-8 px-2 rounded-md bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Edit invoice</TooltipContent>
                          </Tooltip>
                          {canAct && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSendInvoice(inv)}
                                disabled={sendingEmail}
                                className="h-8 inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2.5 text-[10px] font-body uppercase tracking-wider text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
                              >
                                <Send className="w-3.5 h-3.5" /> Send
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSendReminder(inv)}
                                disabled={sendingEmail}
                                className="h-8 inline-flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-2.5 text-[10px] font-body uppercase tracking-wider text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-50"
                              >
                                <Bell className="w-3.5 h-3.5" /> Reminder
                              </button>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => handleMarkPaid(inv)}
                                    aria-label={`Mark ${inv.number} paid`}
                                    className="h-8 px-2 rounded-md bg-green-500/10 text-green-300 hover:bg-green-500/20 transition-colors"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Mark paid</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => setOverflowMenuId(menuOpen ? null : inv.id)}
                            onKeyDown={e => { if (e.key === "Escape") setOverflowMenuId(null); }}
                            aria-label={`More actions for ${inv.number}`}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            className="h-8 inline-flex items-center gap-1 rounded-md bg-secondary/70 px-2 text-[10px] font-body uppercase tracking-wider text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" /> More
                          </button>
                          {menuOpen && (
                            <div
                              role="menu"
                              className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-xl p-1 min-w-[180px] space-y-0.5"
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => { if (e.key === "Escape") setOverflowMenuId(null); }}
                            >
                              <button role="menuitem" onClick={() => { handleCopyLink(inv); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg"><Link2 className="w-3.5 h-3.5" />Copy share link</button>
                              <button role="menuitem" onClick={() => { handleExportPDF(inv); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg"><Printer className="w-3.5 h-3.5" />Export PDF</button>
                              <button role="menuitem" onClick={() => { setExpandedEmailLog(logOpen ? null : inv.id); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg"><Mail className="w-3.5 h-3.5" />Email history</button>
                              {inv.status === "sent" && <button role="menuitem" onClick={() => { handleMarkOverdue(inv); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-red-400 hover:bg-secondary rounded-lg"><AlertCircle className="w-3.5 h-3.5" />Mark overdue</button>}
                              {stripeAvailable && canAct && (inv.paymentMethods || []).includes("stripe") && <button role="menuitem" onClick={() => { handleStripeCheckout(inv); setOverflowMenuId(null); }} disabled={processingPay} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-purple-400 hover:bg-secondary rounded-lg"><CreditCard className="w-3.5 h-3.5" />Stripe checkout</button>}
                              <button role="menuitem" onClick={() => { handleClone(inv); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg"><Copy className="w-3.5 h-3.5" />Duplicate</button>
                              <div className="h-px bg-border my-0.5" />
                              <button role="menuitem" onClick={() => { handleDelete(inv); setOverflowMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-body text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 className="w-3.5 h-3.5" />Delete</button>
                            </div>
                          )}
                        </div>
                      </TooltipProvider>
                    </div>

                    {/* Email History Panel */}
                    {logOpen && (
                      <div className="px-4 pb-3 bg-secondary/20">
                        <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground mb-2">Email History</p>
                        {(inv.emailLog || []).length === 0 ? (
                          <p className="text-xs font-body text-muted-foreground/50">No emails sent yet</p>
                        ) : (
                          <div className="space-y-1">
                            {[...(inv.emailLog || [])].reverse().map((log, i) => (
                              <div key={i} className="flex items-center gap-2 sm:gap-3 text-xs font-body flex-wrap sm:flex-nowrap">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.type === "invoice" ? "bg-blue-400" : log.type === "reminder" ? "bg-yellow-400" : "bg-gray-400"}`} />
                                <span className="capitalize text-muted-foreground">{log.type}</span>
                                <span className="text-muted-foreground/50 hidden sm:inline">→</span>
                                <span className="text-foreground truncate">{log.to}</span>
                                <span className="text-muted-foreground/50 sm:ml-auto text-[10px]">{new Date(log.sentAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── FORM VIEW ──────────────────────────────────────────────
  return editing ? (
    <InvoiceForm
      invoice={editing}
      stripeAvailable={stripeAvailable}
      bankSettings={bankSettings}
      bookings={getBookings()}
      albums={getAlbums()}
      onSave={async (inv) => {
        const existing = getInvoices().find(i => i.id === inv.id);
        const result = existing ? await updateAdminInvoice(inv) : await createAdminInvoice(inv);
        if (!result.ok || !result.invoice) throw new Error(result.error || "Unable to save invoice");
        acceptCanonicalInvoice(result.invoice);
        if (!existing) notifyDiscord({ event: "invoice-created", invoice: result.invoice });
        setView("list");
        setEditing(null);
        toast.success(`Invoice ${result.invoice.number} saved`);
      }}
      onCancel={() => { setView("list"); setEditing(null); }}
    />
  ) : null;
}

// ─── Invoice Form ─────────────────────────────────────────────────────────────
function InvoiceForm({
  invoice: initial, stripeAvailable, bankSettings, bookings, albums, onSave, onCancel,
}: {
  invoice: Invoice;
  stripeAvailable: boolean;
  bankSettings: import("@/lib/types").BankTransferSettings;
  bookings: import("@/lib/types").Booking[];
  albums: import("@/lib/types").Album[];
  onSave: (inv: Invoice) => Promise<void>;
  onCancel: () => void;
}) {
  const [inv, setInv] = React.useState<Invoice>({ ...initial });
  const savingRef = React.useRef(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState("");
  const contacts = React.useMemo(() => getContacts(), []);
  const [selectedContact, setSelectedContact] = React.useState("");
  const [showAdvancedInvoiceMetadata, setShowAdvancedInvoiceMetadata] = React.useState(
    Boolean(initial.serviceDate || initial.serviceDateNote || initial.eventManagerSubmission || initial.receiptAttachmentNote),
  );

  const setFrom = (patch: Partial<InvoiceParty>) => setInv(p => ({ ...p, from: { ...p.from, ...patch } }));
  const setTo   = (patch: Partial<InvoiceParty>) => setInv(p => ({ ...p, to:   { ...p.to,   ...patch } }));

  const addItem = () => setInv(p => ({ ...p, items: [...p.items, emptyItem()] }));
  const removeItem = (id: string) => setInv(p => ({ ...p, items: p.items.filter(it => it.id !== id) }));
  const setItem = (id: string, patch: Partial<InvoiceItem>) =>
    setInv(p => ({ ...p, items: p.items.map(it => it.id === id ? { ...it, ...patch } : it) }));

  const toggleMethod = (m: "stripe" | "bank") =>
    setInv(p => {
      const methods = p.paymentMethods || [];
      return { ...p, paymentMethods: methods.includes(m) ? methods.filter(x => x !== m) : [...methods, m] };
    });

  // Auto-fill "To" from linked booking
  const handleBookingLink = (bookingId: string) => {
    setInv(p => {
      if (!bookingId) return { ...p, bookingId: undefined };
      const bk = bookings.find(b => b.id === bookingId);
      if (!bk) return { ...p, bookingId };
      return { ...p, bookingId, to: { ...p.to, name: bk.clientName || p.to.name, email: bk.clientEmail || p.to.email } };
    });
  };

  // Auto-fill "To" from linked album
  const handleAlbumLink = (albumId: string) => {
    setInv(p => {
      if (!albumId) return { ...p, albumId: undefined, albumSlug: undefined, albumTitle: undefined, showAlbumLinkAfterPayment: false };
      const alb = albums.find(a => a.id === albumId);
      if (!alb) return { ...p, albumId };
      return {
        ...p,
        albumId,
        albumSlug: alb.slug || alb.id,
        albumTitle: alb.title,
        to: { ...p.to, name: alb.clientName || p.to.name, email: alb.clientEmail || p.to.email },
      };
    });
  };

  // Auto-fill "To" from a saved contact
  const handleContactSelect = (contactId: string) => {
    if (!contactId) return;
    const c = contacts.find(ct => ct.id === contactId);
    if (!c) return;
    setTo({
      name: c.name,
      email: c.email,
      address: c.address,
      abn: c.abn || "",
      taxNumber: c.taxNumber || "",
      vatId: c.vatId || "",
      iban: c.iban || "",
      bicSwift: c.bicSwift || "",
      accountHolder: c.accountHolder || "",
      bankName: c.bankName || "",
      accountNumber: c.accountNumber || "",
      paymentProvider: c.paymentProvider,
      wiseEmail: c.wiseEmail || "",
      revolutHandle: c.revolutHandle || "",
      paypalEmail: c.paypalEmail || "",
    });
  };

  const sub = calcInvSubtotal(inv.items);
  const disc = inv.discount ?? 0;
  const taxRate = inv.tax ?? 0;
  const taxAmt = (sub - disc) * (taxRate / 100);
  const total = sub - disc + taxAmt;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    if (!inv.to.name.trim()) { toast.error("Client name is required"); return; }
    if (inv.items.length === 0) { toast.error("Add at least one line item"); return; }
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try { await onSave(inv); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Unable to save invoice"); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const fieldClass = "w-full bg-secondary border border-border text-foreground font-body text-sm rounded-lg px-3 py-2 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50";
  const labelClass = "block text-[10px] font-body uppercase tracking-wider text-muted-foreground mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-foreground mb-1">{initial.status === "draft" && !getInvoices().find(i => i.id === initial.id) ? "New" : "Edit"} Invoice</h2>
          <p className="text-xs font-body text-muted-foreground">{inv.number} · <span className={`${INV_STATUS_META[inv.status].color}`}>{INV_STATUS_META[inv.status].label}</span></p>
        </div>
        <div className="flex gap-2 sm:justify-end">
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel} className="font-body text-sm gap-1.5 flex-1 sm:flex-none"><X className="w-4 h-4" />Cancel</Button>
          <Button type="submit" disabled={saving} className="font-body text-sm gap-1.5 flex-1 sm:flex-none"><Save className="w-4 h-4" />{saving ? "Saving…" : saveError ? "Retry save" : "Save Invoice"}</Button>
        </div>
      </div>

      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}. Your edits are still here; retry saving.</p>}
      <fieldset disabled={saving} className="space-y-6">
      {/* Status + Due */}
      <div className="glass-panel rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div>
          <label className={labelClass}>Status</label>
          <select value={inv.status} onChange={e => setInv(p => ({ ...p, status: e.target.value as InvoiceStatus }))} className={fieldClass}>
            {(["draft","sent","paid","partial","overdue","cancelled"] as InvoiceStatus[]).map(s => <option key={s} value={s}>{INV_STATUS_META[s].label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Due Date</label>
          <input type="date" value={inv.dueDate} onChange={e => setInv(p => ({ ...p, dueDate: e.target.value }))} className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Currency</label>
          <select value={inv.currency || "AUD"} onChange={e => setInv(p => ({ ...p, currency: e.target.value }))} className={fieldClass}>
            <option value="AUD">AUD</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
            <option value="NZD">NZD</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Link to Booking</label>
          <select value={inv.bookingId || ""} onChange={e => handleBookingLink(e.target.value)} className={fieldClass}>
            <option value="">None</option>
            {bookings.map(b => <option key={b.id} value={b.id}>{b.clientName} — {b.date}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Link to Album</label>
          <select value={inv.albumId || ""} onChange={e => handleAlbumLink(e.target.value)} className={fieldClass}>
            <option value="">None</option>
            {albums.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </div>
      </div>
      <div>
        <button
          type="button"
          onClick={() => setShowAdvancedInvoiceMetadata(v => !v)}
          className="text-xs font-body text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvancedInvoiceMetadata ? "rotate-180" : ""}`} />
          Advanced invoice metadata
        </button>
        {showAdvancedInvoiceMetadata && (
          <div className="glass-panel rounded-xl p-4 space-y-3 mt-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-body text-foreground font-medium">Service / submission details</p>
                <p className="text-[11px] font-body text-muted-foreground mt-0.5">Only needed for clients that require service dates, receipt notes, or Event Manager upload wording.</p>
              </div>
              <label className="flex items-center gap-2 text-xs font-body text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!!inv.eventManagerSubmission}
                  onChange={e => setInv(p => ({ ...p, eventManagerSubmission: e.target.checked }))}
                  className="accent-primary"
                />
                Event Manager / EM2.0
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Service Date</label>
                <input value={inv.serviceDate || ""} onChange={e => setInv(p => ({ ...p, serviceDate: e.target.value || undefined }))} className={fieldClass} placeholder="YYYY-MM or YYYY-MM-DD" />
              </div>
              <div>
                <label className={labelClass}>Service Date Note</label>
                <input className={fieldClass} value={inv.serviceDateNote || ""} onChange={e => setInv(p => ({ ...p, serviceDateNote: e.target.value || undefined }))} placeholder="Invoice date corresponds to service date" />
              </div>
              <div>
                <label className={labelClass}>Receipt Note</label>
                <input className={fieldClass} value={inv.receiptAttachmentNote || ""} onChange={e => setInv(p => ({ ...p, receiptAttachmentNote: e.target.value || undefined }))} placeholder="Attach copies of receipts if claimed" />
              </div>
            </div>
          </div>
        )}
      </div>
      {inv.albumId && (
        <div className="glass-panel rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs font-body text-foreground font-medium">Reveal album link after payment</p>
            <p className="text-[11px] font-body text-muted-foreground mt-0.5">
              Shows an "Open album" button on the online invoice only after the invoice is paid. Hidden from PDF export.
            </p>
          </div>
          <Switch
            checked={!!inv.showAlbumLinkAfterPayment}
            onCheckedChange={checked => setInv(p => ({ ...p, showAlbumLinkAfterPayment: checked }))}
          />
        </div>
      )}
      {inv.status === "partial" && (
        <div className="glass-panel rounded-xl p-4">
          <label className={labelClass}>Amount Already Paid ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={inv.amountPaid ?? ""}
            onChange={e => setInv(p => ({ ...p, amountPaid: e.target.value === "" ? undefined : parseFloat(e.target.value) }))}
            placeholder="0.00"
            className={fieldClass + " max-w-xs"}
          />
          <p className="text-[11px] font-body text-muted-foreground mt-1.5">
            {inv.amountPaid != null && inv.amountPaid > 0
              ? `Balance remaining: $${Math.max(0, calcInvTotal(inv) - inv.amountPaid).toFixed(2)}`
              : "Enter the deposit or partial payment already received."}
          </p>
        </div>
      )}

      {/* From / To */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* FROM */}
        <div className="glass-panel rounded-xl p-4 space-y-3">
          <p className="text-xs font-body uppercase tracking-wider text-muted-foreground font-medium">From</p>
          <div><label className={labelClass}>Name</label><input className={fieldClass} value={inv.from.name} onChange={e => setFrom({ name: e.target.value })} placeholder="Your business name" /></div>
          <div><label className={labelClass}>ABN</label><input className={fieldClass} value={inv.from.abn || ""} onChange={e => setFrom({ abn: e.target.value })} placeholder="12 345 678 901" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label className={labelClass}>Tax Number</label><input className={fieldClass} value={inv.from.taxNumber || ""} onChange={e => setFrom({ taxNumber: e.target.value })} placeholder="Tax number" /></div>
            <div><label className={labelClass}>VAT ID</label><input className={fieldClass} value={inv.from.vatId || ""} onChange={e => setFrom({ vatId: e.target.value })} placeholder="VAT identification number" /></div>
          </div>
          <div><label className={labelClass}>Email</label><input className={fieldClass} type="email" value={inv.from.email} onChange={e => setFrom({ email: e.target.value })} /></div>
          <div><label className={labelClass}>Address</label><textarea className={fieldClass} rows={2} value={inv.from.address} onChange={e => setFrom({ address: e.target.value })} placeholder="Street address" /></div>
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-3 space-y-2">
            <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">International Payment Details</p>
            <div>
              <label className={labelClass}>Payment Preference</label>
              <select className={fieldClass} value={inv.from.paymentProvider || "bank"} onChange={e => setFrom({ paymentProvider: e.target.value as InvoiceParty["paymentProvider"] })}>
                <option value="bank">European IBAN / Bank Transfer</option>
                <option value="wise">Wise</option>
                <option value="revolut">Revolut</option>
                <option value="paypal">PayPal</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className={labelClass}>Account Holder</label><input className={fieldClass} value={inv.from.accountHolder || ""} onChange={e => setFrom({ accountHolder: e.target.value })} /></div>
              <div><label className={labelClass}>Bank Name</label><input className={fieldClass} value={inv.from.bankName || ""} onChange={e => setFrom({ bankName: e.target.value })} /></div>
              <div><label className={labelClass}>IBAN</label><input className={fieldClass} value={inv.from.iban || ""} onChange={e => setFrom({ iban: e.target.value })} placeholder="IBAN" /></div>
              <div><label className={labelClass}>BIC / Swift</label><input className={fieldClass} value={inv.from.bicSwift || ""} onChange={e => setFrom({ bicSwift: e.target.value })} placeholder="BIC or Swift code" /></div>
              <div><label className={labelClass}>Account Number</label><input className={fieldClass} value={inv.from.accountNumber || ""} onChange={e => setFrom({ accountNumber: e.target.value })} /></div>
              <div><label className={labelClass}>Wise Email</label><input className={fieldClass} value={inv.from.wiseEmail || ""} onChange={e => setFrom({ wiseEmail: e.target.value })} /></div>
              <div><label className={labelClass}>Revolut</label><input className={fieldClass} value={inv.from.revolutHandle || ""} onChange={e => setFrom({ revolutHandle: e.target.value })} placeholder="@username or account" /></div>
              <div><label className={labelClass}>PayPal Email</label><input className={fieldClass} value={inv.from.paypalEmail || ""} onChange={e => setFrom({ paypalEmail: e.target.value })} /></div>
            </div>
          </div>
        </div>
        {/* TO */}
        <div className="glass-panel rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-body uppercase tracking-wider text-muted-foreground font-medium">Bill To</p>
            {contacts.length > 0 && (
              <select
                className="text-xs font-body bg-secondary border border-border text-muted-foreground rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/50"
                value={selectedContact}
                onChange={e => {
                  const id = e.target.value;
                  handleContactSelect(id);
                  setSelectedContact("");
                }}
              >
                <option value="">Fill from contact…</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>)}
              </select>
            )}
          </div>
          <div><label className={labelClass}>Name *</label><input className={fieldClass} value={inv.to.name} onChange={e => setTo({ name: e.target.value })} placeholder="Client name" required /></div>
          <div><label className={labelClass}>ABN</label><input className={fieldClass} value={inv.to.abn || ""} onChange={e => setTo({ abn: e.target.value })} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label className={labelClass}>Tax Number</label><input className={fieldClass} value={inv.to.taxNumber || ""} onChange={e => setTo({ taxNumber: e.target.value })} /></div>
            <div><label className={labelClass}>VAT ID</label><input className={fieldClass} value={inv.to.vatId || ""} onChange={e => setTo({ vatId: e.target.value })} /></div>
          </div>
          <div><label className={labelClass}>Email</label><input className={fieldClass} type="email" value={inv.to.email} onChange={e => setTo({ email: e.target.value })} /></div>
          <div><label className={labelClass}>Address</label><textarea className={fieldClass} rows={2} value={inv.to.address} onChange={e => setTo({ address: e.target.value })} /></div>
        </div>
      </div>

      {/* Line Items */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <p className="text-sm font-body font-medium text-foreground">Line Items</p>
          <Button type="button" size="sm" variant="outline" onClick={addItem} className="gap-1.5 font-body text-xs">
            <Plus className="w-3.5 h-3.5" /> Add Item
          </Button>
        </div>
        <div className="divide-y divide-border">
          {inv.items.map((item, idx) => (
            <div key={item.id} className="px-4 py-3">
              {/* Mobile: stacked layout */}
              <div className="flex items-end gap-2 sm:hidden">
                <div className="flex-1">
                  {idx === 0 && <label className={labelClass}>Description</label>}
                  <input className={fieldClass} value={item.description} onChange={e => setItem(item.id, { description: e.target.value })} placeholder="Photography session" />
                  <input className={`${fieldClass} mt-1`} value={item.subdescription ?? ""} onChange={e => setItem(item.id, { subdescription: e.target.value || undefined })} placeholder="Subdescription (optional)" />
                </div>
                <button type="button" onClick={() => removeItem(item.id)} className="shrink-0 mb-0.5 p-2 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 sm:hidden">
                <div>
                  <label className={labelClass}>Qty</label>
                  <input className={fieldClass} type="number" min="0.01" step="0.01" value={item.quantity} onChange={e => setItem(item.id, { quantity: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className={labelClass}>Unit ({invoiceCurrency(inv)})</label>
                  <input className={fieldClass} type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => setItem(item.id, { unitPrice: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className={labelClass}>Total</label>
                  <p className="text-sm font-body text-foreground pt-2 pl-1">{formatInvMoney(inv, item.quantity * item.unitPrice)}</p>
                </div>
              </div>
              {/* Desktop: grid layout */}
              <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  {idx === 0 && <label className={labelClass}>Description</label>}
                  <input className={fieldClass} value={item.description} onChange={e => setItem(item.id, { description: e.target.value })} placeholder="Photography session" />
                  <input className={`${fieldClass} mt-1`} value={item.subdescription ?? ""} onChange={e => setItem(item.id, { subdescription: e.target.value || undefined })} placeholder="Subdescription (optional)" />
                </div>
                <div className="col-span-2">
                  {idx === 0 && <label className={labelClass}>Qty</label>}
                  <input className={fieldClass} type="number" min="0.01" step="0.01" value={item.quantity} onChange={e => setItem(item.id, { quantity: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="col-span-3">
                  {idx === 0 && <label className={labelClass}>Unit Price ({invoiceCurrency(inv)})</label>}
                  <input className={fieldClass} type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => setItem(item.id, { unitPrice: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="col-span-1 text-right">
                  {idx === 0 && <label className={labelClass}>Total</label>}
                  <p className="text-sm font-body text-foreground pt-1">{formatInvMoney(inv, item.quantity * item.unitPrice)}</p>
                </div>
                <div className="col-span-1 flex justify-end">
                  {idx === 0 && <div className="invisible text-[10px]">x</div>}
                  <button type="button" onClick={() => removeItem(item.id)} className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* Totals */}
        <div className="p-4 border-t border-border flex flex-col items-end gap-1 text-sm font-body">
          <div className="grid grid-cols-2 gap-4 w-full sm:w-64">
            <label className={labelClass}>Discount ({invoiceCurrency(inv)})</label>
            <input className={fieldClass} type="number" min="0" step="0.01" value={inv.discount ?? ""} placeholder="0" onChange={e => setInv(p => ({ ...p, discount: parseFloat(e.target.value) || 0 }))} />
            <label className={labelClass}>Tax Rate (%)</label>
            <input className={fieldClass} type="number" min="0" step="0.1" value={inv.tax ?? ""} placeholder="0" onChange={e => setInv(p => ({ ...p, tax: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div className="w-full sm:w-64 mt-2 space-y-1 text-right">
            <p className="text-muted-foreground">Subtotal <span className="text-foreground ml-4">{formatInvMoney(inv, sub)}</span></p>
            {disc > 0 && <p className="text-green-400">Discount <span className="ml-4">−{formatInvMoney(inv, disc)}</span></p>}
            {taxRate > 0 && <p className="text-muted-foreground">Tax ({taxRate}%) <span className="text-foreground ml-4">{formatInvMoney(inv, taxAmt)}</span></p>}
            <p className="text-foreground font-medium pt-1 border-t border-border">Total <span className="font-display text-lg ml-4">{formatInvMoney(inv, total)}</span></p>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="glass-panel rounded-xl p-4">
        <label className={labelClass}>Notes / Terms</label>
        <textarea className={fieldClass} rows={3} value={inv.notes} onChange={e => setInv(p => ({ ...p, notes: e.target.value }))} placeholder="Payment terms, thank-you note, etc." />
      </div>

      {/* Payment Methods */}
      <div className="glass-panel rounded-xl p-4">
        <p className="text-xs font-body uppercase tracking-wider text-muted-foreground mb-3">Available Payment Methods</p>
        <div className="flex flex-col gap-3">
          {/* Stripe */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={(inv.paymentMethods || []).includes("stripe")} onChange={() => toggleMethod("stripe")} className="mt-0.5 accent-purple-500" disabled={!stripeAvailable} />
            <div>
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-purple-400" />
                <p className={`text-sm font-body ${stripeAvailable ? "text-foreground" : "text-muted-foreground/50"}`}>Card payment (Stripe)</p>
                {!stripeAvailable && <span className="text-[10px] font-body text-muted-foreground/40 bg-secondary px-1.5 py-0.5 rounded">Stripe not configured</span>}
              </div>
              <p className="text-xs font-body text-muted-foreground/60">Client can pay with a card from the invoice link</p>
            </div>
          </label>
          {/* Bank */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={(inv.paymentMethods || []).includes("bank")} onChange={() => toggleMethod("bank")} className="mt-0.5 accent-blue-500" disabled={!bankSettings?.enabled} />
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                <p className={`text-sm font-body ${bankSettings?.enabled ? "text-foreground" : "text-muted-foreground/50"}`}>Bank transfer</p>
                {!bankSettings?.enabled && <span className="text-[10px] font-body text-muted-foreground/40 bg-secondary px-1.5 py-0.5 rounded">Bank transfer not enabled in settings</span>}
              </div>
              {bankSettings?.enabled && <p className="text-xs font-body text-muted-foreground/60">BSB {bankSettings.bsb} · {bankSettings.accountNumber}</p>}
            </div>
          </label>
        </div>
      </div>
      </fieldset>
    </form>
  );
}

