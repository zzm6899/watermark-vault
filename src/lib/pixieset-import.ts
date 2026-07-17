import type { Contact, Invoice, InvoiceParty, InvoiceStatus } from "./types";

export const PIXIESET_SOURCE = "pixieset" as const;
const EMPTY_PARTY: InvoiceParty = { name: "", email: "", address: "" };

export interface PixiesetSourceMetadata {
  provider: "pixieset";
  source: string;
  sourceId: string;
  importedAt: string;
  raw: Record<string, unknown>;
}

export type PixiesetContact = Contact & {
  source: typeof PIXIESET_SOURCE;
  sourceId: string;
  sourceType?: string;
  sourceMetadata: PixiesetSourceMetadata;
};

export type PixiesetInvoice = Invoice & {
  source: typeof PIXIESET_SOURCE;
  sourceId: string;
  sourceMetadata: PixiesetSourceMetadata;
};

declare module "./types" {
  interface Contact {
    source?: typeof PIXIESET_SOURCE;
    sourceId?: string;
    sourceType?: string;
    sourceMetadata?: PixiesetSourceMetadata;
  }

  interface Invoice {
    source?: typeof PIXIESET_SOURCE;
    sourceId?: string;
    sourceMetadata?: PixiesetSourceMetadata;
  }
}

export interface PixiesetImportOptions {
  from?: Partial<InvoiceParty>;
  importedAt?: string;
}

export interface PixiesetImportResult {
  summary: Record<string, unknown>;
  source: string;
  contacts: PixiesetContact[];
  invoices: PixiesetInvoice[];
  skipped: { contacts: number; invoices: number };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function displayText(value: unknown): string {
  return text(value).replace(/\s+/g, " ");
}

export function normalizeEmail(value: unknown): string {
  return text(value).toLocaleLowerCase("en-US");
}

export function normalizeName(value: unknown): string {
  return text(value).replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function deterministicId(kind: "contact" | "invoice" | "item" | "share", source: string, sourceId: string): string {
  return `${kind === "invoice" ? "inv" : kind}_${stableHash(`${source.toLowerCase()}\u0000${sourceId}`)}`;
}

function validIsoTimestamp(value: unknown, fallback: string): string {
  const candidate = text(value);
  if (!candidate) return fallback;
  const timestamp = Date.parse(candidate);
  return Number.isNaN(timestamp) ? fallback : new Date(timestamp).toISOString();
}

function dateOnly(value: unknown): string {
  const candidate = text(value);
  if (!candidate) return "";
  const isoDate = candidate.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/)?.[1];
  if (isoDate) {
    const parsed = new Date(`${isoDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate) return isoDate;
    return "";
  }
  const timestamp = Date.parse(candidate);
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeStatus(value: unknown): InvoiceStatus {
  const status = text(value).toLowerCase().replace(/[\s_]+/g, "-");
  if (["paid", "payment-complete", "completed"].includes(status)) return "paid";
  if (["sent", "issued", "open", "unpaid", "pending"].includes(status)) return "sent";
  if (["partial", "partially-paid"].includes(status)) return "partial";
  if (["overdue", "past-due"].includes(status)) return "overdue";
  if (["cancelled", "canceled", "void", "voided"].includes(status)) return "cancelled";
  return "draft";
}

function parseAmount(value: unknown, summaryCurrency: unknown): { amount: number; currency?: string } {
  let amountValue = value;
  let currencyValue = summaryCurrency;

  if (isRecord(value)) {
    amountValue = value.amount ?? value.value ?? value.total;
    currencyValue = value.currency ?? value.currencyCode ?? summaryCurrency;
  }

  const rawAmount = text(amountValue);
  const currencyInAmount = rawAmount.match(/\b([A-Za-z]{3})\b/)?.[1];
  const currency = text(currencyValue || currencyInAmount).toUpperCase();
  const negative = /^\s*-/.test(rawAmount) || /^\s*\(.*\)\s*$/.test(rawAmount);
  const numeric = rawAmount.replace(/[^\d.,]/g, "");
  const decimalSeparator = numeric.lastIndexOf(",") > numeric.lastIndexOf(".") ? "," : ".";
  const normalized = decimalSeparator === ","
    ? numeric.replace(/\./g, "").replace(",", ".")
    : numeric.replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);

  return {
    amount: Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
  };
}

function sourceIdForContact(row: UnknownRecord): string {
  const explicit = text(row.sourceId ?? row.id);
  if (explicit) return explicit;
  const email = normalizeEmail(row.email);
  return email ? `email:${email}` : `name:${normalizeName(row.name)}`;
}

function sourceIdForInvoice(row: UnknownRecord): string {
  return text(row.sourceId ?? row.id ?? row.number);
}

function metadata(source: string, sourceId: string, importedAt: string, raw: UnknownRecord): PixiesetSourceMetadata {
  return { provider: "pixieset", source, sourceId, importedAt, raw: { ...raw } };
}

function normalizeContact(row: UnknownRecord, source: string, importedAt: string): PixiesetContact | null {
  const name = displayText(row.name);
  const email = normalizeEmail(row.email);
  if (!name && !email) return null;

  const sourceId = sourceIdForContact(row);
  return {
    id: deterministicId("contact", source, sourceId),
    name: name || email,
    email,
    address: "",
    phone: text(row.phone),
    notes: text(row.type) ? `Pixieset contact type: ${text(row.type)}` : "",
    createdAt: validIsoTimestamp(row.created, importedAt),
    source: PIXIESET_SOURCE,
    sourceId,
    sourceType: text(row.type) || undefined,
    sourceMetadata: metadata(source, sourceId, importedAt, row),
  };
}

function normalizeInvoice(
  row: UnknownRecord,
  source: string,
  summary: UnknownRecord,
  options: PixiesetImportOptions,
  importedAt: string,
): PixiesetInvoice | null {
  const number = text(row.number);
  const sourceId = sourceIdForInvoice(row);
  if (!number || !sourceId) return null;

  const client = displayText(row.client);
  const project = displayText(row.project);
  const { amount, currency } = parseAmount(row.amount, summary.currency ?? summary.currencyCode);
  const createdAt = validIsoTimestamp(row.created, importedAt);
  const dueDate = dateOnly(row.dueOn) || createdAt.slice(0, 10);
  const from = { ...EMPTY_PARTY, ...options.from };

  return {
    id: deterministicId("invoice", source, sourceId),
    number,
    status: normalizeStatus(row.status),
    from,
    to: { ...EMPTY_PARTY, name: client },
    items: [{
      id: deterministicId("item", source, sourceId),
      description: project || `Pixieset invoice ${number}`,
      quantity: 1,
      unitPrice: amount,
    }],
    currency,
    notes: "",
    dueDate,
    createdAt,
    shareToken: deterministicId("share", source, sourceId),
    emailLog: [],
    paymentMethods: [],
    source: PIXIESET_SOURCE,
    sourceId,
    sourceMetadata: metadata(source, sourceId, importedAt, row),
  };
}

export function parsePixiesetPayload(input: unknown, options: PixiesetImportOptions = {}): PixiesetImportResult {
  let payload = input;
  if (typeof input === "string") {
    try {
      payload = JSON.parse(input);
    } catch (error) {
      throw new TypeError(`Invalid Pixieset JSON: ${error instanceof Error ? error.message : "unable to parse"}`);
    }
  }
  if (!isRecord(payload)) throw new TypeError("Pixieset payload must be a JSON object");

  const summaryValue = payload.summary ?? payload.metadata;
  const summary = isRecord(summaryValue) ? { ...summaryValue } : {};
  const sourceLabel = text(summary.source ?? payload.source) || PIXIESET_SOURCE;
  const importedAt = validIsoTimestamp(
    options.importedAt ?? summary.exportedAt ?? summary.created ?? payload.exportedAt,
    "1970-01-01T00:00:00.000Z",
  );
  const contactRowsValue = payload.contacts ?? payload.contactRows;
  const invoiceRowsValue = payload.invoices ?? payload.invoiceRows;
  const contactRows = Array.isArray(contactRowsValue) ? contactRowsValue : [];
  const invoiceRows = Array.isArray(invoiceRowsValue) ? invoiceRowsValue : [];
  const contacts = contactRows
    .filter(isRecord)
    .map((row) => normalizeContact(row, sourceLabel, importedAt))
    .filter((row): row is PixiesetContact => row !== null);
  const invoices = invoiceRows
    .filter(isRecord)
    .map((row) => normalizeInvoice(row, sourceLabel, summary, options, importedAt))
    .filter((row): row is PixiesetInvoice => row !== null);

  return {
    summary,
    source: PIXIESET_SOURCE,
    contacts,
    invoices,
    skipped: {
      contacts: contactRows.length - contacts.length,
      invoices: invoiceRows.length - invoices.length,
    },
  };
}

function importedIdentity(record: unknown): { source: string; sourceId: string } | null {
  if (!isRecord(record)) return null;
  const nested = isRecord(record.sourceMetadata) ? record.sourceMetadata : {};
  const source = text(record.source ?? nested.source);
  const sourceId = text(record.sourceId ?? nested.sourceId);
  return source && sourceId ? { source: source.toLowerCase(), sourceId } : null;
}

function sameSourceRecord(left: unknown, right: unknown): boolean {
  const a = importedIdentity(left);
  const b = importedIdentity(right);
  return Boolean(a && b && a.source === b.source && a.sourceId === b.sourceId);
}

function mergeContact(existing: Contact, incoming: PixiesetContact): PixiesetContact {
  return {
    ...existing,
    name: incoming.name,
    email: incoming.email,
    phone: incoming.phone,
    sourceType: incoming.sourceType,
    createdAt: incoming.createdAt,
    id: existing.id,
    source: incoming.source,
    sourceId: incoming.sourceId,
    sourceMetadata: incoming.sourceMetadata,
  };
}

function mergeInvoice(existing: Invoice, incoming: PixiesetInvoice): PixiesetInvoice {
  return {
    ...existing,
    number: incoming.number,
    status: incoming.status,
    to: { ...existing.to, name: incoming.to.name },
    items: incoming.items,
    currency: incoming.currency,
    dueDate: incoming.dueDate,
    createdAt: incoming.createdAt,
    id: existing.id,
    source: incoming.source,
    sourceId: incoming.sourceId,
    sourceMetadata: incoming.sourceMetadata,
  };
}

export function upsertPixiesetContacts(existing: Contact[], incoming: PixiesetContact[]): Contact[] {
  const result = [...existing];
  for (const contact of incoming) {
    const email = normalizeEmail(contact.email);
    const name = normalizeName(contact.name);
    const index = result.findIndex((candidate) =>
      sameSourceRecord(candidate, contact)
      || (email !== "" && normalizeEmail(candidate.email) === email)
      || (name !== "" && normalizeName(candidate.name) === name),
    );
    if (index === -1) result.push(contact);
    else result[index] = mergeContact(result[index], contact);
  }
  return result;
}

export function upsertPixiesetInvoices(existing: Invoice[], incoming: PixiesetInvoice[]): Invoice[] {
  const result = [...existing];
  for (const invoice of incoming) {
    const clientName = normalizeName(invoice.to.name);
    const index = result.findIndex((candidate) =>
      sameSourceRecord(candidate, invoice)
      || (normalizeName(candidate.number) === normalizeName(invoice.number)
        && normalizeName(candidate.to.name) === clientName),
    );
    if (index === -1) result.push(invoice);
    else result[index] = mergeInvoice(result[index], invoice);
  }
  return result;
}

export function importPixiesetPayload(
  input: unknown,
  existing: { contacts?: Contact[]; invoices?: Invoice[] } = {},
  options: PixiesetImportOptions = {},
) {
  const parsed = parsePixiesetPayload(input, options);
  return {
    ...parsed,
    contacts: upsertPixiesetContacts(existing.contacts ?? [], parsed.contacts),
    invoices: upsertPixiesetInvoices(existing.invoices ?? [], parsed.invoices),
  };
}
