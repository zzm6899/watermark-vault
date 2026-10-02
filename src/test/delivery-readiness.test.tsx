import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DeliveryReadiness from "@/pages/admin/DeliveryReadiness";
import { deliverAlbum } from "@/lib/api";
import type { DeliveryChecklistItem } from "@/lib/album-workflow";

vi.mock("@/lib/api", () => ({ deliverAlbum: vi.fn() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

const checks: DeliveryChecklistItem[] = [
  { id: "photos", label: "Photos ready", detail: "120 photos in this album", status: "ok" },
  { id: "proofing", label: "Proofing state", detail: "Client selections submitted", status: "warning" },
  { id: "payment", label: "Payment", detail: "One invoice still outstanding", status: "warning" },
];
const photos = [{ id: "photo-1", src: "/uploads/photo-1.jpg" } as import("@/lib/types").Photo];

describe("DeliveryReadiness", () => {
  it("shows proofing and payment warnings instead of a green ready state", () => {
    render(<DeliveryReadiness albumId="album-1" photos={photos} checks={checks} onDelivered={vi.fn()} />);
    expect(screen.getByText("Review 2 warnings")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Delivery items needing attention" })).toHaveTextContent("Proofing state: Client selections submitted");
    expect(screen.getByRole("list", { name: "Delivery items needing attention" })).toHaveTextContent("Payment: One invoice still outstanding");
    expect(screen.getByRole("button", { name: "Deliver gallery" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "All checks (3)" }));
    expect(screen.getByRole("list", { name: "All delivery checks" })).toBeInTheDocument();
  });

  it("blocks delivery when a photo or final is missing and does not ask for confirmation", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const incomplete = [...checks, { id: "finals", label: "Final images", detail: "1 photo still needs a final image", status: "blocker" as const }];
    render(<DeliveryReadiness albumId="album-1" photos={photos} checks={incomplete} onDelivered={vi.fn()} />);
    expect(screen.getByText("1 blocker")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Delivery items needing attention" })).toHaveTextContent("Final images: 1 photo still needs a final image");
    expect(screen.getByRole("button", { name: "Deliver gallery" })).toBeDisabled();
    expect(deliverAlbum).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("includes every warning and delivery consequence in the confirmation", async () => {
    const confirm = vi.fn((_message?: string) => false);
    vi.stubGlobal("confirm", confirm);
    render(<DeliveryReadiness albumId="album-1" photos={photos} photoRevision="revision-1" checks={checks} onDelivered={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Deliver gallery" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    const message = confirm.mock.calls[0][0];
    expect(message).toContain("turns off gallery watermarks");
    expect(message).toContain("Client selections submitted");
    expect(message).toContain("One invoice still outstanding");
    expect(deliverAlbum).not.toHaveBeenCalled();
  });
});
