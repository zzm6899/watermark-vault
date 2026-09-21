import { beforeEach, expect, it, vi } from "vitest";
import { addInvoice, updateInvoice, deleteInvoice, setInvoices, getInvoices, cacheInvoicesLocally } from "@/lib/storage";
import { createAdminInvoice, updateAdminInvoice, deleteAdminInvoice } from "@/lib/api";
import type { Invoice } from "@/lib/types";

vi.mock("@/lib/api", () => ({ createAdminInvoice: vi.fn(), updateAdminInvoice: vi.fn(), deleteAdminInvoice: vi.fn() }));
const invoice = { id: "a", number: "INV-0001", status: "draft", to: { name: "Alex" }, items: [] } as unknown as Invoice;
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });

it("does not change cached invoices until the server confirms create, update or delete", async () => {
  vi.mocked(createAdminInvoice).mockResolvedValue({ ok: false, error: "Offline" });
  await expect(addInvoice(invoice)).rejects.toThrow("Offline");
  expect(getInvoices()).toEqual([]);
  cacheInvoicesLocally([invoice]);
  vi.mocked(updateAdminInvoice).mockResolvedValue({ ok: false, error: "Offline" });
  vi.mocked(deleteAdminInvoice).mockResolvedValue({ ok: false, error: "Offline" });
  await expect(updateInvoice({ ...invoice, status: "paid" })).rejects.toThrow("Offline");
  await expect(deleteInvoice(invoice.id)).rejects.toThrow("Offline");
  expect(getInvoices()).toEqual([invoice]);
  const canonical = { ...invoice, number: "INV-0002" };
  vi.mocked(createAdminInvoice).mockResolvedValue({ ok: true, invoice: canonical });
  await expect(addInvoice(invoice)).resolves.toEqual(canonical);
  expect(getInvoices()).toEqual([canonical]);
});

it("keeps confirmed import progress and retries only unfinished invoices", async () => {
  cacheInvoicesLocally([invoice]);
  const second = { ...invoice, id: "b" };
  const third = { ...invoice, id: "c" };
  vi.mocked(createAdminInvoice).mockResolvedValueOnce({ ok: true, invoice: second }).mockResolvedValueOnce({ ok: false, error: "Connection lost" });
  await expect(setInvoices([invoice, second, third])).rejects.toThrow("Connection lost");
  expect(getInvoices()).toEqual([invoice, second]);
  vi.mocked(createAdminInvoice).mockResolvedValue({ ok: true, invoice: third });
  await setInvoices([invoice, second, third]);
  expect(vi.mocked(createAdminInvoice).mock.calls.map(([item]) => item.id)).toEqual(["b", "c", "c"]);
  expect(updateAdminInvoice).not.toHaveBeenCalled();
  expect(getInvoices()).toEqual([invoice, second, third]);
});
