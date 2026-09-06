import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EventRevenueReport } from "@/components/EventRevenueReport";
import { EventExtraPurchases, type ExtraPurchase } from "@/components/EventExtraPurchases";
vi.mock("@/lib/api", () => ({ adminAuthHeaders: () => ({}) }));
const purchase: ExtraPurchase = { bookingId: "bk-cari", clientName: "Cari", date: "2026-09-12", time: "09:00", status: "confirmed", paymentStatus: "deposit-paid", items: [{ id: "composite", name: "Composite image", description: "Dragon background artwork", quantity: 2, unitPrice: 35.25, total: 70.5 }] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("purchased extras in finance", () => {
  it("opens the event breakdown with purchased descriptions and booking payment status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [{ key: "event", event: "Animaga", eventId: "event", date: "", bookings: 1, booked: 171, extras: 70.5, bookingCollected: 42.75, galleryCollected: 0, collected: 42.75, outstanding: 128.25, pendingTransfers: 0, unpricedRequests: 0, unpricedPurchases: 0, extraPurchases: [purchase] }] }) }));
    render(<EventRevenueReport />);
    fireEvent.click(await screen.findByRole("button", { name: "View purchased extras for Animaga" }));
    expect(screen.getByText("Cari")).toBeInTheDocument();
    expect(screen.getByText("Dragon background artwork")).toBeInTheDocument();
    expect(screen.getByText("Deposit paid")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close extras" }));
    expect(screen.queryByText("Dragon background artwork")).not.toBeInTheDocument();
  });
  it("searches saved descriptions and clients and labels missing descriptions", () => {
    const legacy = { ...purchase, bookingId: "legacy", clientName: "Alex", items: [{ ...purchase.items[0], description: undefined }] };
    render(<EventExtraPurchases event="Animaga" purchases={[purchase, legacy]} onClose={() => {}} />);
    expect(screen.getByText("No description recorded for this purchase.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Find purchased extras" }), { target: { value: "dragon background" } });
    expect(screen.getByText("Cari")).toBeInTheDocument();
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Find purchased extras" }), { target: { value: "Alex" } });
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.queryByText("Cari")).not.toBeInTheDocument();
  });
  it("limits rendered bookings and resets paging when searching", () => {
    render(<EventExtraPurchases event="Animaga" purchases={Array.from({ length: 11 }, (_, index) => ({ ...purchase, bookingId: `booking-${index}`, clientName: `Client ${index}` }))} onClose={() => {}} />);
    expect(screen.getAllByRole("article")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Client 10")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Find purchased extras" }), { target: { value: "Client 0" } });
    expect(screen.getByText("Client 0")).toBeInTheDocument();
  });
});
