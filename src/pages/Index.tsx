import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Camera, Calendar, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AlbumCard from "@/components/AlbumCard";
import heroBg from "@/assets/hero-bg.jpg";
import { sampleAlbums } from "@/lib/mock-data";

export default function Index() {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <section className="relative h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <img src={heroBg} alt="Hero" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-background/60" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-background/40" />
        </div>

        <div className="relative z-10 text-center px-4 max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <p className="text-xs font-body tracking-[0.4em] uppercase text-primary mb-6">
              Photography Studio
            </p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl text-foreground leading-[0.9] mb-6">
              Lumière
            </h1>
            <p className="font-body text-base md:text-lg text-muted-foreground max-w-md mx-auto mb-10 leading-relaxed">
              Capturing moments that last forever. View your gallery, select your favorites, and download with ease.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link to="/gallery">
                <Button size="lg" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-body tracking-wider uppercase text-xs px-8 py-6">
                  View Gallery
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link to="/booking">
                <Button size="lg" variant="outline" className="gap-2 border-border text-foreground hover:bg-secondary font-body tracking-wider uppercase text-xs px-8 py-6">
                  <Calendar className="w-4 h-4" />
                  Book a Session
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 1 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <div className="w-px h-16 bg-gradient-to-b from-transparent via-primary/50 to-transparent" />
        </motion.div>
      </section>

      {/* Services */}
      <section className="py-24 bg-card/30">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <p className="text-xs font-body tracking-[0.3em] uppercase text-primary mb-3">How It Works</p>
            <h2 className="font-display text-3xl md:text-4xl text-foreground">Your Photos, Your Way</h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { icon: Camera, title: "Book & Shoot", desc: "Schedule a session through our booking system. We capture your special moments." },
              { icon: ImageIcon, title: "Browse & Select", desc: "View your watermarked gallery. Pick your favorites — some downloads are free!" },
              { icon: ArrowRight, title: "Download & Share", desc: "Purchase additional photos or the full album. Download watermark-free, high-res files." },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                className="text-center p-6"
              >
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                  <item.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-display text-lg text-foreground mb-2">{item.title}</h3>
                <p className="text-sm font-body text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Albums */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <div className="flex items-end justify-between mb-12">
            <div>
              <p className="text-xs font-body tracking-[0.3em] uppercase text-primary mb-3">Portfolio</p>
              <h2 className="font-display text-3xl md:text-4xl text-foreground">Recent Work</h2>
            </div>
            <Link to="/gallery" className="text-xs font-body tracking-wider uppercase text-muted-foreground hover:text-primary transition-colors flex items-center gap-2">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
