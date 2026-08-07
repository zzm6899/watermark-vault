import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WatermarkedImage from "@/components/WatermarkedImage";
import { drawServerAlignedWatermark, watermarkRenderPlan } from "@/lib/watermark-render";

describe("admin watermark preview", () => {
  it("uses the server's distinct tiled text cells, image gaps, font scale, and source inset", () => {
    const plan = watermarkRenderPlan(1400, 933, {
      watermarkText: "STUDIO",
      watermarkImage: "",
      watermarkPosition: "bottom-right",
      watermarkOpacity: 25,
      watermarkSize: 40,
    });

    expect(plan).toMatchObject({
      opacity: 0.25,
      fontSize: 42,
      imageTileWidth: 168,
      imageGapX: 490,
      imageGapY: 233,
      textCellWidth: 532,
      textCellHeight: 205,
      positionedInset: 20,
      positionedImageWidth: 560,
      positionedImageMaxHeight: 893,
    });
  });

  it("renders tiled server text as fill-only without the legacy client stroke", () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      globalAlpha: 1,
      fillStyle: "",
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
      letterSpacing: "0px",
    } as unknown as CanvasRenderingContext2D;

    drawServerAlignedWatermark(ctx, 1400, 933, null, {
      watermarkText: "STUDIO",
      watermarkImage: "",
      watermarkPosition: "tiled",
      watermarkOpacity: 25,
      watermarkSize: 40,
    });

    expect(ctx.fillText).toHaveBeenCalled();
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });

  it("sizes positioned logo watermarks against the full preview canvas", () => {
    const { container } = render(
      <WatermarkedImage
        src="/sample.jpg"
        title="Preview"
        renderWatermarkOverlay
        previewMode
        watermarkImage="data:image/png;base64,aGVsbG8="
        watermarkPosition="bottom-right"
        watermarkOpacity={25}
        watermarkSize={60}
      />,
    );

    const watermark = container.querySelector('img[alt=""]') as HTMLImageElement | null;
    expect(watermark).not.toBeNull();
    expect(watermark?.style.width).toBe("60%");
    expect(watermark?.style.opacity).toBe("0.25");
    expect(watermark?.parentElement?.className).toContain("inset-0");
    expect(watermark?.parentElement?.className).toContain("justify-end");
    expect(screen.queryByText("Select")).not.toBeInTheDocument();
  });
});
