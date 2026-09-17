import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TenantBookingPage, { tenantBookingBrandStyle } from "@/pages/TenantBookingPage";
import { getTenantPublicData, getTenantStripeStatus } from "@/lib/api";

vi.mock("@/lib/api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/api")>(),
  getTenantPublicData: vi.fn(),
  getTenantStripeStatus: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("tenant booking appearance", () => {
  it("renders tenant copy as text, hides the optional bio, and resets appearance when changing tenants", async () => {
    vi.mocked(getTenantStripeStatus).mockResolvedValue({ configured: false });
    vi.mocked(getTenantPublicData).mockImplementation(async slug => ({
      tenant: { slug, displayName: slug, bio: "Profile biography", timezone: "Australia/Sydney" },
      eventTypes: [],
      ...(slug === "alpha" ? {
        bookingPageTitle: "Book with Alpha",
        bookingPageIntro: "<img src=x onerror=alert(1)>Bring your outfit",
        bookingShowBio: false,
        brandColor: "#ffffff",
      } : {}),
    } as NonNullable<Awaited<ReturnType<typeof getTenantPublicData>>>));
    const { rerender, container } = render(<MemoryRouter><TenantBookingPage overrideSlug="alpha" /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Book with Alpha" })).toBeVisible();
    expect(screen.getByText("<img src=x onerror=alert(1)>Bring your outfit")).toBeVisible();
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(screen.queryByText("About alpha")).toBeNull();

    rerender(<MemoryRouter><TenantBookingPage overrideSlug="beta" /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Book a session" })).toBeVisible();
    expect(screen.getByText("About beta")).toBeVisible();
    expect(screen.queryByText("Book with Alpha")).toBeNull();
    expect(screen.queryByText(/Bring your outfit/)).toBeNull();
  });

  it("uses valid HSL tokens and readable button text for light and dark tenant accents", () => {
    expect(tenantBookingBrandStyle("#ffffff")).toEqual({ "--primary": "0 0% 100%", "--primary-foreground": "0 0% 0%" });
    expect(tenantBookingBrandStyle("#000000")).toEqual({ "--primary": "0 0% 0%", "--primary-foreground": "0 0% 100%" });
    expect(tenantBookingBrandStyle("#ff0000")).toEqual({ "--primary": "0 100% 50%", "--primary-foreground": "0 0% 0%" });
    expect(tenantBookingBrandStyle("url(https://example.com)")).toEqual({});
    expect(tenantBookingBrandStyle(null)).toEqual({});
  });
});
