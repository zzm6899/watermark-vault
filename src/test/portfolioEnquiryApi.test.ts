import { afterEach, describe, expect, it, vi } from "vitest";
import { submitPortfolioEnquiry, type PortfolioEnquiry } from "@/lib/portfolio";

afterEach(() => vi.unstubAllGlobals());

describe("portfolio enquiry request", () => {
  it("posts the enquiry to the public endpoint and returns delivery warnings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, emailDelivered: false, webhookDelivered: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const enquiry: PortfolioEnquiry = {
      name: "Preview Client",
      email: "preview@example.com",
      eventTypeTitle: "Corporate event",
      message: "Test only.",
    };

    await expect(submitPortfolioEnquiry(enquiry)).resolves.toEqual({ emailDelivered: false, webhookDelivered: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/portfolio/enquiry", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enquiry),
    }));
  });

  it("surfaces the server error when the enquiry request is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Try again shortly" }),
    }));

    await expect(submitPortfolioEnquiry({ name: "Preview Client", email: "preview@example.com", eventTypeTitle: "Corporate event", message: "Test only." }))
      .rejects.toThrow("Try again shortly");
  });
});
