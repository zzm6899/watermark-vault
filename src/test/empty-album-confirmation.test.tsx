import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EmptyAlbumConfirmation from "@/pages/admin/EmptyAlbumConfirmation";

afterEach(cleanup);

describe("EmptyAlbumConfirmation", () => {
  it("shows the album and photo count, and cancellation makes no request", () => {
    const onConfirm = vi.fn(async () => "emptied" as const);
    render(<EmptyAlbumConfirmation albumTitle="Animaga Saturday" photoCount={120} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Empty album: 120 photos" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Empty “Animaga Saturday”?");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("all 120 photos");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("prevents double submission and closes after a stale-target refresh", async () => {
    let finish!: (outcome: "emptied" | "stale" | "failed") => void;
    const onConfirm = vi.fn(() => new Promise<"emptied" | "stale" | "failed">(resolve => { finish = resolve; }));
    render(<EmptyAlbumConfirmation albumTitle="Animaga Saturday" photoCount={120} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Empty album: 120 photos" }));
    const confirm = screen.getByRole("button", { name: "Empty 120 photos" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Emptying album…" })).toBeDisabled();

    finish("stale");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps a failed request open with a recoverable error", async () => {
    const onConfirm = vi.fn(async () => "failed" as const);
    render(<EmptyAlbumConfirmation albumTitle="Portraits" photoCount={1} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Empty album: 1 photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Empty 1 photo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The album was not emptied");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
