import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProgressiveImg from "@/components/ProgressiveImg";

describe("ProgressiveImg thumbnail errors", () => {
  it("keeps the tile and reports a failed thumbnail without requesting the full image", () => {
    render(<ProgressiveImg thumbSrc="/uploads/thumb.jpg?size=thumb" fullSrc="/uploads/original.jpg" alt="Cosplay portrait" />);
    const thumbnail = screen.getByRole("img", { name: "Cosplay portrait" }) as HTMLImageElement;
    expect(thumbnail).toHaveAttribute("src", "/uploads/thumb.jpg?size=thumb");

    fireEvent.error(thumbnail);

    expect(screen.getByRole("img", { name: "Preview unavailable: Cosplay portrait" })).toBeInTheDocument();
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Cosplay portrait" })).not.toBeInTheDocument();
  });

  it("recovers when the thumbnail source changes after a failed request", () => {
    const { rerender } = render(<ProgressiveImg thumbSrc="/uploads/first.jpg" fullSrc="/uploads/original.jpg" alt="Portrait" />);
    fireEvent.error(screen.getByRole("img", { name: "Portrait" }));
    expect(screen.getByRole("img", { name: "Preview unavailable: Portrait" })).toBeInTheDocument();

    rerender(<ProgressiveImg thumbSrc="/uploads/recovered.jpg" fullSrc="/uploads/original.jpg" alt="Portrait" />);

    expect(screen.getByRole("img", { name: "Portrait" })).toHaveAttribute("src", "/uploads/recovered.jpg");
    expect(screen.queryByRole("img", { name: "Preview unavailable: Portrait" })).not.toBeInTheDocument();
  });
});
