import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DashboardCommandCenter, { type DashboardDeliveryTask } from "@/pages/admin/DashboardCommandCenter";
import AlbumWorkflowProgress from "@/pages/admin/AlbumWorkflowProgress";
import { buildDeliveryChecklist, summarizeAlbumWorkflow } from "@/lib/album-workflow";
import { AlbumListRow } from "@/pages/admin/AlbumCardUI";
import type { Album, Booking } from "@/lib/types";

afterEach(cleanup);

const album = (overrides: Partial<Album> = {}): Album => {
  const photoCount = overrides.photoCount ?? 0;
  return {
    id: "album-1", slug: "studio-session", title: "Studio Session", description: "", coverImage: "", date: "2026-09-01",
    photoCount, freeDownloads: 0, pricePerPhoto: 2, priceFullAlbum: 20, isPublic: true,
    photos: overrides.photos ?? Array.from({ length: photoCount }, (_, index) => ({ id: "photo-" + (index + 1), src: "/uploads/photo-" + (index + 1) + ".jpg" } as Album["photos"][number])),
    status: "editing", ...overrides,
  };
};

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: "booking-1", clientName: "Ari Cosplay", clientEmail: "ari@example.com", date: "2026-10-03", time: "11:30",
  eventTypeId: "portrait", type: "Portrait session", duration: 30, status: "confirmed", notes: "", createdAt: "2026-09-01T00:00:00Z", ...overrides,
});

const readyProps = {
  state: "ready" as const,
  deliveryTasks: [] as DashboardDeliveryTask[],
  onOpenSession: vi.fn(),
  onOpenBookings: vi.fn(),
  onOpenDeliveryTask: vi.fn(),
};

describe("dashboard command center", () => {
  it("shows a real loading state and a recoverable error state", () => {
    const { rerender } = render(<DashboardCommandCenter {...readyProps} state="loading" nextSession={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your next session and delivery queue");
    const onRetry = vi.fn();
    rerender(<DashboardCommandCenter {...readyProps} state="error" errorMessage="Storage is unavailable" nextSession={null} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Storage is unavailable");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers a booking action when the schedule and delivery queue are empty", () => {
    render(<DashboardCommandCenter {...readyProps} nextSession={null} />);
    expect(screen.getByText("No upcoming sessions")).toBeInTheDocument();
    expect(screen.getByText("No unfinished deliveries.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add a booking/i }));
    expect(readyProps.onOpenBookings).toHaveBeenCalledOnce();
  });

  it("opens the selected session day and a delivery task directly", () => {
    const currentBooking = booking();
    const task: DashboardDeliveryTask = {
      id: "booking-2", booking: booking({ id: "booking-2", clientName: "Mika" }), album: album({ id: "album-2", title: "Mika gallery" }),
      stageLabel: "Client picks submitted", actionLabel: "Review client picks", detail: "2 delivery warnings to review", ageLabel: "3d since session", tone: "urgent",
    };
    render(<DashboardCommandCenter {...readyProps} nextSession={currentBooking} nextSessionEventLabel="Cosplay portrait" deliveryTasks={[task]} />);
    expect(screen.getByText("Ari Cosplay")).toBeInTheDocument();
    expect(screen.getByText("Cosplay portrait")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open session day/i }));
    fireEvent.click(screen.getByRole("button", { name: /review client picks/i }));
    expect(readyProps.onOpenSession).toHaveBeenCalledWith(currentBooking);
    expect(readyProps.onOpenDeliveryTask).toHaveBeenCalledWith(task);
  });
});

describe("album workflow readiness", () => {
  it("maps photos, proofing picks, finals, and delivered albums to their next action", () => {
    expect(summarizeAlbumWorkflow(album()).nextAction).toBe("Add photos");
    expect(summarizeAlbumWorkflow(album({ photoCount: 3, proofingEnabled: true, proofingStage: "selections-submitted" })).nextAction).toBe("Review client picks");
    expect(summarizeAlbumWorkflow(album({ photoCount: 3, proofingStage: "editing" })).nextAction).toBe("Review delivery checks");
    expect(summarizeAlbumWorkflow(album({ photoCount: 3, status: "delivered" })).label).toBe("Delivered");
  });

  it("surfaces blocker counts and moves the album workflow from the card action", () => {
    const summary = summarizeAlbumWorkflow(album({ slug: "", photoCount: 1 }));
    expect(buildDeliveryChecklist(album({ slug: "", photoCount: 1 })).filter(item => item.status === "blocker")).toHaveLength(1);
    const onContinue = vi.fn();
    render(<AlbumWorkflowProgress summary={summary} onContinue={onContinue} />);
    expect(screen.getByText("1 blocker")).toBeInTheDocument();
    expect(screen.getByText("Resolve 1 delivery blocker")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("keeps archived albums outside the active progress and readiness counts", () => {
    const summary = summarizeAlbumWorkflow(album({ status: "archived", photoCount: 0, slug: "" }));
    render(<AlbumWorkflowProgress summary={summary} />);
    expect(screen.getAllByText("Archived")).toHaveLength(2);
    expect(screen.queryByText("1 blocker")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem").every(step => step.getAttribute("data-step-state") === "upcoming")).toBe(true);
  });

  it("keeps album selection controlled and exposes the selected state to assistive tech", () => {
    const summary = summarizeAlbumWorkflow(album({ photoCount: 2, clientEmail: "ari@example.com" }));
    const onSelect = vi.fn();
    render(<AlbumListRow album={album({ photoCount: 2 })} workflow={summary} onContinue={vi.fn()} onEdit={vi.fn()} onView={vi.fn()} onReview={vi.fn()} selected onSelect={onSelect} />);
    const checkbox = screen.getByRole("checkbox", { name: "Select Studio Session" });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("treats a loaded empty photo array as authoritative over a stale saved count", () => {
    const checks = buildDeliveryChecklist(album({ photoCount: 120, photos: [] }));
    expect(checks.find(item => item.id === "photos")?.status).toBe("blocker");
    expect(summarizeAlbumWorkflow(album({ photoCount: 120, photos: [] })).nextAction).toBe("Add photos");
    expect(buildDeliveryChecklist(album({ photoCount: 120, photos: [], _photosStripped: true })).find(item => item.id === "photos")?.status).toBe("ok");
  });

  it("blocks partial or inconsistent Lightroom finals and warns while proofing is in editing", () => {
    const editingAlbum = album({
      photoCount: 2,
      proofingEnabled: true,
      proofingStage: "editing",
      photos: [
        { id: "one", src: "/uploads/one.jpg", finalSrc: "/uploads/one-final.jpg" },
        { id: "two", src: "/uploads/two.jpg" },
      ] as Album["photos"],
    });
    expect(buildDeliveryChecklist(editingAlbum).find(item => item.id === "finals")).toMatchObject({ status: "blocker", detail: "1 of 2 photos still need a final image" });

    const beforeFirstExport = album({ photoCount: 1, proofingEnabled: true, proofingStage: "editing" });
    expect(buildDeliveryChecklist(beforeFirstExport).find(item => item.id === "finals")?.status).toBe("warning");

    const brokenExport = album({ photoCount: 1, photos: [{ id: "one", src: "/uploads/one.jpg", proofSrc: "/uploads/proof.jpg" }] as Album["photos"] });
    expect(buildDeliveryChecklist(brokenExport).find(item => item.id === "finals")?.status).toBe("blocker");
  });

  it("keeps payment, active proofing, and pending-download checks visible as warnings", () => {
    const checks = buildDeliveryChecklist(album({
      photoCount: 1,
      proofingEnabled: true,
      proofingStage: "selections-submitted",
      downloadRequests: [{ photoIds: ["photo-1"], method: "free", status: "pending", requestedAt: "2026-10-01T00:00:00Z" }],
    }), booking({ paymentStatus: "deposit-paid" }), [{ id: "invoice-1", status: "sent" } as import("@/lib/types").Invoice]);
    expect(checks.find(item => item.id === "proofing")?.status).toBe("warning");
    expect(checks.find(item => item.id === "payment")?.status).toBe("warning");
    expect(checks.find(item => item.id === "downloads")?.status).toBe("warning");
  });
});
