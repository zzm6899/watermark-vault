import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Album } from "@/lib/types";

interface AlbumPhotoFilterStripProps {
  albums: Album[];
  selectedAlbumId?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (albumId: string) => void;
  getPhotoCount: (album: Album) => number;
}

export default function AlbumPhotoFilterStrip({
  albums,
  selectedAlbumId,
  search,
  onSearchChange,
  onSelect,
  getPhotoCount,
}: AlbumPhotoFilterStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const filteredAlbums = albums.filter(album => !search || album.title.toLowerCase().includes(search.toLowerCase()));

  const updateScrollButtons = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    setCanScrollLeft(node.scrollLeft > 1);
    setCanScrollRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    updateScrollButtons();
    node.addEventListener("scroll", updateScrollButtons, { passive: true });
    window.addEventListener("resize", updateScrollButtons);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateScrollButtons);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", updateScrollButtons);
      window.removeEventListener("resize", updateScrollButtons);
      observer?.disconnect();
    };
  }, [filteredAlbums.length, updateScrollButtons]);

  const scroll = (direction: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(node.clientWidth * 0.8, 120), behavior: "smooth" });
  };

  return (
    <div className="flex min-w-0 items-center gap-2" aria-label="Album photo filters">
      <div className="relative w-24 shrink-0 sm:w-32">
        <Search aria-hidden="true" className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          aria-label="Search albums"
          placeholder="Search albums"
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          className="h-8 w-full rounded-full border border-border/50 bg-secondary pl-6 pr-2 font-body text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <button
        type="button"
        aria-label="Scroll albums left"
        title="Scroll albums left"
        disabled={!canScrollLeft}
        onClick={() => scroll(-1)}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      <div
        ref={scrollerRef}
        role="group"
        aria-label="Filter photos by album"
        tabIndex={0}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {filteredAlbums.map(album => {
          const selected = selectedAlbumId === album.id;
          return (
            <button
              key={album.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(album.id)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 font-body text-xs transition-colors ${selected ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
            >
              {album.title} ({getPhotoCount(album)})
            </button>
          );
        })}
        {filteredAlbums.length === 0 && <span className="whitespace-nowrap text-xs text-muted-foreground">No matching albums</span>}
      </div>
      <button
        type="button"
        aria-label="Scroll albums right"
        title="Scroll albums right"
        disabled={!canScrollRight}
        onClick={() => scroll(1)}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
