import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { nextBookingDate, toBookingDateString } from "@/lib/booking-utils";
import type { EventType } from "@/lib/types";
import TenantBookingPage from "@/pages/TenantBookingPage";
import { getTenantPublicData, getTenantStripeStatus } from "@/lib/api";
import { fetchPublicAvailability } from "@/lib/booking-public-api";

vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), getTenantPublicData: vi.fn(), getTenantStripeStatus: vi.fn() }));
vi.mock("@/lib/booking-public-api", () => ({ fetchPublicAvailability: vi.fn() }));
const event = {
  id: "pax", title: "PAX Melbourne", active: true, durations: [30], price: 75, questions: [],
  availability: { recurring: [], blockedDates: [], specificDates: [{ date: "2026-10-09", startTime: "15:00", endTime: "18:00" }] },
} as unknown as EventType;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); sessionStorage.clear(); });

it("opens October from September, skips blocked dates and respects the studio timezone", () => {
  const now = new Date("2026-09-22T01:00:00Z");
  expect(toBookingDateString(nextBookingDate(event, "Australia/Sydney", undefined, now)!)).toBe("2026-10-09");
  expect(nextBookingDate({ ...event, availability: { ...event.availability, blockedDates: ["2026-10-09"] } }, "Australia/Sydney", undefined, now)).toBeNull();
  const recurring = { ...event, availability: { recurring: [{ day: 3, startTime: "09:00", endTime: "10:00" }], specificDates: [], blockedDates: [] } };
  expect(toBookingDateString(nextBookingDate(recurring, "Australia/Sydney", undefined, new Date("2026-09-22T23:30:00Z"))!)).toBe("2026-09-23");
  expect(toBookingDateString(nextBookingDate(recurring, "Australia/Sydney", undefined, new Date("2026-09-23T01:00:00Z"))!)).toBe("2026-09-30");
});

it("selecting a service selects its next date and shows that calendar month with live times", async () => {
  // Date construction uses the same fixed clock without faking async timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T01:00:00Z"));
  vi.stubGlobal("scrollTo", vi.fn());
  vi.mocked(getTenantPublicData).mockResolvedValue({ tenant: { slug: "studio", displayName: "Studio", timezone: "Australia/Sydney" }, eventTypes: [event] } as NonNullable<Awaited<ReturnType<typeof getTenantPublicData>>>);
  vi.mocked(getTenantStripeStatus).mockResolvedValue({ configured: false });
  vi.mocked(fetchPublicAvailability).mockResolvedValue({ slots: ["15:00"], timezone: "Australia/Sydney" });
  render(<MemoryRouter><TenantBookingPage overrideSlug="studio" /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Book" }));
  const selected = await screen.findByRole("button", { name: /Friday, October 9, 2026, available/ });
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(await screen.findByText("3:00 PM")).toBeVisible();
  expect(fetchPublicAvailability).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-09", tenantSlug: "studio" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(screen.queryByRole("button", { name: /Friday, October 9, 2026, available/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next available →" }));
  expect(screen.getByRole("button", { name: /Friday, October 9, 2026, available/ })).toHaveAttribute("aria-pressed", "true");
});
