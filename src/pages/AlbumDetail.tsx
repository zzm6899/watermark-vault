import { useParams, Link } from "react-router-dom";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Info } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WatermarkedImage from "@/components/WatermarkedImage";
import PurchasePanel from "@/components/PurchasePanel";
import { sampleAlbums } from "@/lib/mock-data";
import { toast } from "sonner";

export default function AlbumDetail() {
  const { albumId } = useParams();
  const album = sampleAlbums.find((a) => a.id === albumId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  if (!album) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground font-body">Album not found</p>
      </div>
    );
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const freeRemaining = Math.max(0, album.freeDownloads - selectedIds.size);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <section className="pt-28 pb-32">
        <div className="container mx-auto px-4">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <Link to="/gallery" className="inline-flex items-center gap-2 text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors mb-6">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Galleries
            </Link>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-4xl md:text-5xl text-foreground mb-2">{album.title}</h1>
                <p className="text-sm font-body text-muted-foreground">{album.description}</p>
              </div>

              <div className="glass-panel rounded-lg p-4 flex items-center gap-6">
                <div className="text-center">
                  <p className="text-lg font-display text-primary">{album.freeDownloads}</p>
                  <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Free</p>
                </div>
                <div className="w-px h-8 bg-border" />
                <div className="text-center">
                  <p className="text-lg font-display text-foreground">${album.pricePerPhoto}</p>
                  <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Per Photo</p>
                </div>
                <div className="w-px h-8 bg-border" />
                <div className="text-center">
                  <p className="text-lg font-display text-foreground">${album.priceFullAlbum}</p>
                  <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Full Album</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-primary/5 border border-primary/10">
              <Info className="w-4 h-4 text-primary flex-shrink-0" />
              <p className="text-xs font-body text-muted-foreground">
                Click photos to select. You get <span className="text-primary font-medium">{album.freeDownloads} free downloads</span>. Additional photos can be purchased individually or as a full album.
              </p>
            </div>
          </motion.div>

          {/* Masonry Grid */}
          <div className="masonry-grid">
            {album.photos.map((photo, i) => (
              <WatermarkedImage
                key={photo.id}
                src={photo.src}
                title={photo.title}
                selected={selectedIds.has(photo.id)}
                onSelect={() => toggleSelect(photo.id)}
                locked={selectedIds.size >= album.freeDownloads && !selectedIds.has(photo.id)}
                index={i}
              />
            ))}
          </div>
        </div>
      </section>

      <PurchasePanel
        selectedCount={selectedIds.size}
        freeRemaining={album.freeDownloads}
        pricePerPhoto={album.pricePerPhoto}
        priceFullAlbum={album.priceFullAlbum}
        totalPhotos={album.photos.length}
        onDownloadFree={() => toast.success("Downloading free photos (watermark removed)!")}
        onPurchaseSelected={() => toast.info("Payment portal would open here — connect Stripe to enable")}
        onPurchaseAlbum={() => toast.info("Full album purchase — connect Stripe to enable")}
      />

      <Footer />
    </div>
  );
}
