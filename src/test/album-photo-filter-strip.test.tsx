import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AlbumPhotoFilterStrip from "@/components/admin/AlbumPhotoFilterStrip";
import type { Album } from "@/lib/types";

const album = (id: string, title: string): Album => ({
  id,
  slug: id,
  title,
  description: "",
  coverImage: "",
  date: "2026-01-01",
  photoCount: 2,
  freeDownloads: 0,
  pricePerPhoto: 0,
  priceFullAlbum: 0,
  isPublic: false,
  photos: [],
});

describe("album photo filter strip", () => {
  it("filters albums by search and reports the selected album accessibly", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <AlbumPhotoFilterStrip
        albums={[album("alpha", "Alpha Session"), album("beta", "Beta Session")]}
        selectedAlbumId="beta"
        search=""
        onSearchChange={vi.fn()}
        onSelect={onSelect}
        getPhotoCount={item => item.photoCount}
      />,
    );

    expect(screen.getByRole("group", { name: "Filter photos by album" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta Session (2)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Alpha Session (2)" }));
    expect(onSelect).toHaveBeenCalledWith("alpha");

    rerender(
      <AlbumPhotoFilterStrip
        albums={[album("alpha", "Alpha Session"), album("beta", "Beta Session")]}
        selectedAlbumId="beta"
        search="Beta"
        onSearchChange={vi.fn()}
        onSelect={onSelect}
        getPhotoCount={item => item.photoCount}
      />,
    );
    expect(screen.queryByRole("button", { name: "Alpha Session (2)" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta Session (2)" })).toBeInTheDocument();
  });

  it("scrolls the chip row with labeled controls when it overflows", () => {
    render(
      <AlbumPhotoFilterStrip
        albums={[album("alpha", "Alpha"), album("beta", "Beta")]}
        search=""
        onSearchChange={vi.fn()}
        onSelect={vi.fn()}
        getPhotoCount={item => item.photoCount}
      />,
    );
    const scroller = screen.getByRole("group", { name: "Filter photos by album" });
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 180 },
      scrollWidth: { configurable: true, value: 540 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollBy: { configurable: true, value: vi.fn() },
    });
    fireEvent.scroll(scroller);

    const scrollRight = screen.getByRole("button", { name: "Scroll albums right" });
    expect(scrollRight).toBeEnabled();
    fireEvent.click(scrollRight);
    expect(scroller.scrollBy).toHaveBeenCalledWith({ left: 144, behavior: "smooth" });
  });
});
