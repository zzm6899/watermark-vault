import { ChangeEvent, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileJson,
  ReceiptText,
  Upload,
  Users,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  importPixiesetJson,
  type PixiesetContact,
  type PixiesetInvoice,
} from "@/lib/pixiesetImport";
import { getPixiesetImportAudit, setPixiesetImportAudit } from "@/lib/storage";
import type { Contact, Invoice, PixiesetCurrencySummary, PixiesetImportAudit } from "@/lib/types";

type ImportResult = {
  contacts: Contact[];
  invoices: Invoice[];
  importedAt?: string;
};

type CurrencyStats = {
  currency: string;
  count: number;
  paid: number;
  upcoming: number;
  pastDue: number;
};

export interface PixiesetImportPanelProps {
  contacts: Contact[];
  invoices: Invoice[];
  onReplaceContacts: (contacts: Contact[]) => void;
  onReplaceInvoices: (invoices: Invoice[]) => void;
}

function invoiceTotal(invoice: Invoice) {
  const subtotal = invoice.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discounted = Math.max(0, subtotal - (invoice.discount ?? 0));
  return discounted + discounted * ((invoice.tax ?? 0) / 100);
}

function currencyStatistics(invoices: Invoice[]): CurrencyStats[] {
  const today = new Date().toISOString().slice(0, 10);
  const groups = new Map<string, CurrencyStats>();

  invoices.forEach((invoice) => {
    const currency = (invoice.currency || "AUD").toUpperCase();
    const stats = groups.get(currency) ?? { currency, count: 0, paid: 0, upcoming: 0, pastDue: 0 };
    const total = invoiceTotal(invoice);
    const paid = invoice.status === "paid" ? total : Math.min(total, invoice.amountPaid ?? 0);
    const outstanding = Math.max(0, total - paid);
    const isPastDue = invoice.status === "overdue" ||
      ((invoice.status === "sent" || invoice.status === "partial") && Boolean(invoice.dueDate) && invoice.dueDate < today);

    stats.count += 1;
    stats.paid += paid;
    if (isPastDue) stats.pastDue += outstanding;
    else if (invoice.status === "sent" || invoice.status === "partial") stats.upcoming += outstanding;
    groups.set(currency, stats);
  });

  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function isPixiesetContact(record: Contact): record is PixiesetContact {
  const value = (record as Contact & { sourceMetadata?: unknown }).sourceMetadata;
  return typeof value === "object" && value !== null && "provider" in value && value.provider === "pixieset";
}

function isPixiesetInvoice(record: Invoice): record is PixiesetInvoice {
  const value = (record as Invoice & { sourceMetadata?: unknown }).sourceMetadata;
  return typeof value === "object" && value !== null && "provider" in value && value.provider === "pixieset";
}

function runImport(raw: string, contacts: Contact[], invoices: Invoice[]): ImportResult {
  return importPixiesetJson(raw, contacts, invoices, { importedAt: new Date().toISOString() });
}

export default function PixiesetImportPanel({
  contacts,
  invoices,
  onReplaceContacts,
  onReplaceInvoices,
}: PixiesetImportPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [rawJson, setRawJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [audit, setAudit] = useState<PixiesetImportAudit | null>(getPixiesetImportAudit);
  const latestImport = audit?.importedAt || null;
  const sourceInvoices = useMemo(() => invoices.filter(isPixiesetInvoice), [invoices]);
  const stats = useMemo(() => currencyStatistics(sourceInvoices), [sourceInvoices]);
  const contactTypes = useMemo(() => {
    const counts = new Map<string, number>();
    contacts.filter(isPixiesetContact).forEach((contact) => {
      const rawType = contact.sourceMetadata.raw.type;
      const type = (typeof rawType === "string" ? rawType.trim() : "") || contact.company?.trim() || "Unspecified";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    });
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [contacts]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
      setSuccess(null);
      setError("Choose a Pixieset JSON export file.");
      return;
    }
    try {
      setRawJson(await file.text());
      setError(null);
      setSuccess(`${file.name} is ready to validate and import.`);
    } catch {
      setSuccess(null);
      setError("The selected file could not be read.");
    }
  };

  const handleImport = async () => {
    if (!rawJson.trim()) {
      setSuccess(null);
      setError("Paste Pixieset JSON or choose an export file first.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = runImport(rawJson, contacts, invoices);
      onReplaceContacts(result.contacts);
      onReplaceInvoices(result.invoices);
      const importedAt = result.importedAt || new Date().toISOString();
      const sourceContactCount = result.contacts.filter(isPixiesetContact).length;
      const sourceInvoiceCount = result.invoices.filter(isPixiesetInvoice).length;
      const rawSummaries = Array.isArray(result.summary.currencySummaries) ? result.summary.currencySummaries : [];
      const currencySummaries = rawSummaries.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object").map((value): PixiesetCurrencySummary => ({
        currency: String(value.currency || "AUD").toUpperCase(),
        paid: Number(value.paid) || 0,
        upcoming: Number(value.upcoming) || 0,
        pastDue: Number(value.pastDue) || 0,
        rowTotal: Number(value.rowTotal) || 0,
        invoiceCount: Number(value.invoiceCount) || 0,
      }));
      const contactTypes = result.contacts.filter(isPixiesetContact).reduce<Record<string, number>>((counts, contact) => {
        const type = String(contact.sourceMetadata.raw.type || "Unspecified");
        counts[type] = (counts[type] || 0) + 1;
        return counts;
      }, {});
      const nextAudit: PixiesetImportAudit = { source: "pixieset", version: 1, importedAt, currencySummaries, contactCount: sourceContactCount, contactTypes };
      setPixiesetImportAudit(nextAudit);
      setAudit(nextAudit);
      setSuccess(`Import complete: ${sourceContactCount.toLocaleString()} Pixieset contacts and ${sourceInvoiceCount.toLocaleString()} Pixieset invoices are now in the library.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Pixieset export could not be imported.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="pixieset-import-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="pixieset-import-title" className="font-display text-2xl text-foreground">Pixieset import</h3>
          <p className="text-xs text-muted-foreground">Safely merge contacts and invoices from a validated Pixieset JSON export. Re-imports update existing source records.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="h-4 w-4" />
          <span>{latestImport ? `Last imported ${new Date(latestImport).toLocaleString()}` : "No imports yet"}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><FileJson className="h-4 w-4 text-primary" />Import data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="pixieset-json">Pixieset JSON</Label>
              <input ref={fileInput} className="hidden" type="file" accept=".json,application/json" onChange={handleFile} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />Choose file
              </Button>
            </div>
            <Textarea
              id="pixieset-json"
              value={rawJson}
              onChange={(event) => setRawJson(event.target.value)}
              rows={11}
              spellCheck={false}
              className="resize-y font-mono text-xs"
              placeholder={'Paste the Pixieset JSON export here, for example { "contacts": [...] }'}
            />
            <div className="flex justify-end">
              <Button type="button" onClick={handleImport} disabled={busy || !rawJson.trim()}>
                <ReceiptText className="mr-2 h-4 w-4" />{busy ? "Validating..." : "Validate and import"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Contacts by type</CardTitle></CardHeader>
            <CardContent>
              {contactTypes.length === 0 ? <p className="text-sm text-muted-foreground">No imported contacts.</p> : (
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
                  {contactTypes.map(([type, count]) => (
                    <div className="bg-card p-4" key={type}><Users className="mb-2 h-4 w-4 text-primary" /><p className="font-display text-2xl">{count.toLocaleString()}</p><p className="text-[10px] uppercase text-muted-foreground">{type}</p></div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Invoice source statistics</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {stats.length === 0 ? <p className="text-sm text-muted-foreground">No imported invoices.</p> : stats.map((group) => {
                const source = audit?.currencySummaries.find(item => item.currency === group.currency);
                const difference = source ? source.paid - group.paid : 0;
                return (
                <div key={group.currency} className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between"><span className="font-medium">{group.currency}</span><span className="text-xs text-muted-foreground">{group.count.toLocaleString()} invoices</span></div>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-muted-foreground">Source paid</dt><dd className="mt-1 font-medium text-foreground">{formatMoney(source?.paid ?? group.paid, group.currency)}</dd></div>
                    <div><dt className="text-muted-foreground">Upcoming</dt><dd className="mt-1 font-medium text-foreground">{formatMoney(group.upcoming, group.currency)}</dd></div>
                    <div><dt className="text-muted-foreground">Past due</dt><dd className="mt-1 font-medium text-destructive">{formatMoney(group.pastDue, group.currency)}</dd></div>
                  </dl>
                  {source && <p className={`text-[11px] ${Math.abs(difference) > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>Imported rows: {formatMoney(source.rowTotal, group.currency)}{Math.abs(difference) > 0.005 ? ` · ${formatMoney(difference, group.currency)} source difference` : " · reconciled"}</p>}
                </div>
              );})}
            </CardContent>
          </Card>
        </div>
      </div>

      {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Import failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {success && <Alert className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><AlertTitle>Import ready</AlertTitle><AlertDescription>{success}</AlertDescription></Alert>}
    </section>
  );
}
