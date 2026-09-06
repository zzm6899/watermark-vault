import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import GallerySelectionReview from "@/components/GallerySelectionReview";
import GalleryPurchaseStatus from "@/components/GalleryPurchaseStatus";
import ClientActivityTimeline from "@/pages/admin/ClientActivityTimeline";
import type { AlbumDownloadRecord, Photo } from "@/lib/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const photos = [1, 2, 3].map(id => ({ id: String(id), title: `Photo ${id}`, originalName: `IMG_00${id}.jpg`, src: `/uploads/${id}.jpg` })) as Photo[];
it("reviews file numbers and charges only additional photos after purchased and free allowances", () => {
  const onRemove = vi.fn(), onContinue = vi.fn();
  render(<GallerySelectionReview open onOpenChange={() => {}} photos={photos} fullAlbum={false} paidIds={new Set(["1"])} freeRemaining={1} pricePerPhoto={7.5} priceFullAlbum={30} photoSrc={photo => photo.src} onRemove={onRemove} onContinue={onContinue} />);
  expect(screen.getByText("IMG_001.jpg")).toBeInTheDocument();
  expect(screen.getByText("1 photo · Already purchased")).toBeInTheDocument();
  expect(screen.getByText("1 photo · Complimentary")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove IMG_003.jpg" }));
  expect(onRemove).toHaveBeenCalledWith("3");
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment · $7.50" }));
  expect(onContinue).toHaveBeenCalledOnce();
});
it("lists pending transfer files and reopens the exact request's bank details", () => {
  const onBankDetails = vi.fn(), onRefresh = vi.fn();
  const request = { id: "r1", photoIds: ["1", "3"], amount: 15, status: "pending", method: "bank-transfer", requestedAt: "2026-09-02T01:00:00Z" } as AlbumDownloadRecord;
  const view = render(<GalleryPurchaseStatus requests={[request]} photos={photos} paidCount={0} ready refreshing={false} onRefresh={onRefresh} onBankDetails={onBankDetails} />);
  expect(screen.getByText("Awaiting bank transfer confirmation")).toBeInTheDocument();
  expect(screen.getByText("IMG_001.jpg · IMG_003.jpg")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View bank details" }));
  expect(onBankDetails).toHaveBeenCalledWith(request);
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(onRefresh).toHaveBeenCalledOnce();
  view.rerender(<GalleryPurchaseStatus requests={[{ ...request, status: "approved" }]} photos={photos} paidCount={2} ready refreshing={false} onRefresh={onRefresh} onBankDetails={onBankDetails} />);
  expect(screen.getByText("Payment confirmed — ready to download")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "View bank details" })).not.toBeInTheDocument();
});
it("loads authoritative client activity with readable extra descriptions and paginates past twelve records", async () => {
  const fetcher = vi.fn(async (input) => {
    const second = String(input).includes("offset=40");
    return { ok: true, json: async () => ({ total: 42, items: [{ id: second ? "last" : "first", at: null, type: "booking", title: second ? "Older booking" : "Portrait session", detail: "$100.00", extras: [{ name: "Composite", description: "Agreed background and finishing", quantity: 2, amount: "$30.00" }], files: ["IMG_001.jpg"] }] }) } as Response;
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ClientActivityTimeline contactId="client-one" />);
  expect(await screen.findByText("Agreed background and finishing")).toBeInTheDocument();
  expect(screen.getByText("Date not recorded")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Older booking")).toBeInTheDocument();
  expect(fetcher.mock.calls.some(call => String(call[0]).includes("offset=40"))).toBe(true);
  expect(within(screen.getByRole("region", { name: "Client activity timeline" })).getByText("41–42 of 42")).toBeInTheDocument();
});
