import { describe, expect, it } from "vitest";
import type { Contact, Invoice } from "@/lib/types";
import {
  importPixiesetPayload,
  parsePixiesetPayload,
  upsertPixiesetContacts,
  upsertPixiesetInvoices,
} from "@/lib/pixieset-import";

const payload = {
  summary: { source: "Pixieset Studio Manager", exportedAt: "2026-07-17T23:30:00Z", currency: "aud" },
  invoices: [
    {
      number: "INV-104",
      status: "Partially Paid",
      amount: "AUD 1,234.50",
      client: "  Ada   Lovelace ",
      project: "Winter portraits",
      dueOn: "2026-08-01T00:00:00+10:00",
      created: "2026-07-01T09:15:00+10:00",
    },
  ],
  contacts: [
    { name: "  Ada   Lovelace ", type: "Client", email: " ADA@Example.COM ", phone: " 0400 000 000 ", created: "2026-06-01" },
  ],
};

describe("Pixieset import", () => {
  it("parses JSON and creates app-compatible deterministic records", () => {
    const first = parsePixiesetPayload(JSON.stringify(payload), { from: { name: "Photo Co" } });
    const second = parsePixiesetPayload(payload, { from: { name: "Photo Co" } });

    expect(first).toEqual(second);
    expect(first.skipped).toEqual({ contacts: 0, invoices: 0 });
    expect(first.contacts[0]).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "0400 000 000",
      createdAt: "2026-06-01T00:00:00.000Z",
      source: "pixieset",
      sourceId: "email:ada@example.com",
      sourceType: "Client",
    });
    expect(first.invoices[0]).toMatchObject({
      number: "INV-104",
      status: "partial",
      currency: "AUD",
      dueDate: "2026-08-01",
      createdAt: "2026-06-30T23:15:00.000Z",
      from: { name: "Photo Co", email: "", address: "" },
      to: { name: "Ada Lovelace" },
      items: [{ description: "Winter portraits", quantity: 1, unitPrice: 1234.5 }],
    });
    expect(first.invoices[0].sourceMetadata.raw.status).toBe("Partially Paid");
    expect(first.invoices[0].sourceMetadata.raw.dueOn).toBe("2026-08-01T00:00:00+10:00");
    expect(first.invoices[0].sourceMetadata.source).toBe("Pixieset Studio Manager");
  });

  it("handles amount objects, European decimals, status aliases, and missing arrays", () => {
    const parsed = parsePixiesetPayload({
      summary: { currency: "EUR" },
      invoices: [{ number: 7, status: "past due", amount: { value: "1.234,56", currencyCode: "eur" }, client: "A" }],
    });

    expect(parsed.contacts).toEqual([]);
    expect(parsed.invoices[0]).toMatchObject({ status: "overdue", currency: "EUR", dueDate: "1970-01-01" });
    expect(parsed.invoices[0].items[0].unitPrice).toBe(1234.56);
  });

  it("accepts row aliases and rejects impossible ISO calendar dates", () => {
    const parsed = parsePixiesetPayload({
      metadata: { source: "Pixieset", exportedAt: "2026-01-02T00:00:00Z" },
      contactRows: [{ name: "Alias Contact" }],
      invoiceRows: [{ number: "A-1", dueOn: "2026-02-30", created: "2026-01-01" }],
    });

    expect(parsed.contacts).toHaveLength(1);
    expect(parsed.invoices[0].dueDate).toBe("2026-01-01");
  });

  it("skips unusable rows but rejects malformed top-level input", () => {
    const parsed = parsePixiesetPayload({ contacts: [null, {}, { name: "Valid" }], invoices: ["bad", {}, { number: "I-1" }] });

    expect(parsed.skipped).toEqual({ contacts: 2, invoices: 2 });
    expect(parsed.contacts).toHaveLength(1);
    expect(parsed.invoices).toHaveLength(1);
    expect(() => parsePixiesetPayload("{bad json")).toThrow("Invalid Pixieset JSON");
    expect(() => parsePixiesetPayload([])).toThrow("must be a JSON object");
  });

  it("upserts contacts by source identity before normalized email or name", () => {
    const imported = parsePixiesetPayload(payload).contacts[0];
    const bySource = {
      ...imported,
      id: "keep-source-id",
      email: "old@example.com",
      address: "User-entered address",
      company: "User-entered company",
    } as Contact;
    const byEmail = { ...imported, id: "keep-email-id", sourceId: "different", address: "Saved address" } as Contact;

    const sourceResult = upsertPixiesetContacts([bySource], [imported]);
    const emailResult = upsertPixiesetContacts([byEmail], [imported]);

    expect(sourceResult).toHaveLength(1);
    expect(sourceResult[0]).toMatchObject({
      id: "keep-source-id",
      email: "ada@example.com",
      address: "User-entered address",
      company: "User-entered company",
    });
    expect(emailResult).toHaveLength(1);
    expect(emailResult[0]).toMatchObject({ id: "keep-email-id", address: "Saved address" });
  });

  it("upserts invoices and preserves app-maintained fields", () => {
    const imported = parsePixiesetPayload(payload).invoices[0];
    const existing = {
      ...imported,
      id: "existing-invoice-id",
      status: "sent",
      notes: "Keep this note",
      shareToken: "keep-this-token",
      emailLog: [{ sentAt: "2026-07-02T00:00:00.000Z", type: "invoice", to: "ada@example.com" }],
    } as Invoice;

    const result = upsertPixiesetInvoices([existing], [imported]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "existing-invoice-id",
      status: "partial",
      notes: "Keep this note",
      shareToken: "keep-this-token",
    });
    expect(result[0].emailLog).toHaveLength(1);
  });

  it("imports and deduplicates duplicate rows in one operation", () => {
    const duplicated = { ...payload, contacts: [...payload.contacts, { ...payload.contacts[0], name: "Ada Updated" }] };
    const result = importPixiesetPayload(duplicated);

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].name).toBe("Ada Updated");
  });
});
