import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getContractByToken, getInvoiceByToken, respondToQuote } from "@/lib/api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public document API contracts", () => {
  it("sends the accepting client's trimmed name and supports a minimal response", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _request?: RequestInit) =>
      jsonResponse({ status: "accepted", acceptedAt: "2026-08-08T00:00:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await respondToQuote("quote token", "accept", "  Alex Chen  ");

    expect(result).toEqual({ status: "accepted", acceptedAt: "2026-08-08T00:00:00.000Z" });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/quotes/share/quote%20token/respond");
    expect(JSON.parse(String(request?.body))).toEqual({ action: "accept", acceptedByName: "Alex Chen" });
  });

  it("uses the server-provided token-bound contract PDF URL", async () => {
    const pdfUrl = "/api/contracts/sign/contract-token/pdf";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ id: "contract-1", title: "Agreement", status: "pending", bookingId: "booking-1", pdfUrl })));

    await expect(getContractByToken("contract-token")).resolves.toMatchObject({ pdfUrl });

    const source = readFileSync(join(process.cwd(), "src/pages/ContractSign.tsx"), "utf8");
    expect(source).toContain("contract.pdfUrl || null");
    expect(source).not.toContain("/api/uploads/");
  });

  it("preserves invoice tenant scope and scoped bank details from the share response", async () => {
    const invoice = {
      id: "invoice-1",
      number: "INV-0001",
      status: "sent",
      tenantSlug: "tenant-one",
      cardPaymentAvailable: false,
      bankTransfer: { enabled: true, accountName: "Tenant Studio", accountNumber: "1234" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(invoice)));

    await expect(getInvoiceByToken("invoice-token")).resolves.toEqual({ invoice });

    const source = readFileSync(join(process.cwd(), "src/pages/InvoiceView.tsx"), "utf8");
    expect(source).toContain("if (invoice.tenantSlug !== null) return");
    expect(source).toContain("shareToken: token");
    expect(source).toContain("invoice.albumAccessUrl || legacyUnprotectedAlbumUrl");
    expect(source).toContain("invoice.albumProtected === false");
    expect(source).not.toContain("justPaid || invoice.status");
  });

  it("keeps licence plans one-time and disables unbound payment checkout", () => {
    const source = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8");
    const tenantSource = readFileSync(join(process.cwd(), "src/pages/TenantAdmin.tsx"), "utf8");
    const apiSource = readFileSync(join(process.cwd(), "src/lib/api.ts"), "utf8");
    expect(source).toContain('type: "one-time"');
    expect(source).toContain("automated renewals and cancellations are not supported");
    expect(source).not.toContain('<option value="monthly">');
    expect(source).not.toContain('<option value="yearly">');
    expect(source).toContain("Online licence checkout is disabled");
    expect(tenantSource).toContain("Online licence checkout is unavailable");
    expect(apiSource).not.toContain("getLicensePlanCheckout");
    expect(apiSource).not.toContain("createBankLicensePurchase");
  });
});
