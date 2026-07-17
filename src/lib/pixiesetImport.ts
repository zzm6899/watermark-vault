import type { Contact, Invoice } from "./types";
import {
  importPixiesetPayload,
  type PixiesetImportOptions,
  type PixiesetImportResult,
} from "./pixieset-import";

export * from "./pixieset-import";

export type PixiesetUiImportResult = Omit<PixiesetImportResult, "contacts" | "invoices"> & {
  contacts: Contact[];
  invoices: Invoice[];
  importedAt?: string;
};

/** Adapts the domain import API to the UI's three-argument callback contract. */
export function importPixiesetJson(
  input: unknown,
  contacts: Contact[] = [],
  invoices: Invoice[] = [],
  options: PixiesetImportOptions = {},
): PixiesetUiImportResult {
  const result = importPixiesetPayload(input, { contacts, invoices }, options);
  const exportedAt = result.summary.exportedAt;
  const importedAt = options.importedAt
    ?? (typeof exportedAt === "string" ? exportedAt : undefined);
  return { ...result, importedAt };
}

export const importPixiesetExport = importPixiesetJson;
export const importPixiesetData = importPixiesetJson;
