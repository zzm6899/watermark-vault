import { motion } from "framer-motion";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AlbumCard from "@/components/AlbumCard";
import { sampleAlbums } from "@/lib/mock-data";

export default function Gallery() {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <section className="pt-28 pb-24">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <p className="text-xs font-body tracking-[0.3em] uppercase text-primary mb-3">Portfolio</p>
            <h1 className="font-display text-4xl md:text-5xl text-foreground">Galleries</h1>
            <p className="text-sm font-body text-muted-foreground mt-3 max-w-md mx-auto">
              Browse collections. Select your favorites and download watermark-free.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {sampleAlbums.map((album, i) => (
              <AlbumCard
                key={album.id}
                id={album.id}
                title={album.title}
                coverImage={album.coverImage}
                photoCount={album.photoCount}
                date={album.date}
                index={i}
              />
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
