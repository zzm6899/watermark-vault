import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Images } from "lucide-react";

interface AlbumCardProps {
  id: string;
  title: string;
  coverImage: string;
  photoCount: number;
  date: string;
  index?: number;
}

export default function AlbumCard({ id, title, coverImage, photoCount, date, index = 0 }: AlbumCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
    >
      <Link to={`/gallery/${id}`} className="group block">
        <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-card">
          <img
            src={coverImage}
            alt={title}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="absolute bottom-0 left-0 right-0 p-5 translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
            <div className="flex items-center gap-2 text-muted-foreground mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
              <Images className="w-3.5 h-3.5" />
              <span className="text-xs font-body">{photoCount} photos</span>
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-1">
          <h3 className="font-display text-lg text-foreground group-hover:text-primary transition-colors">
            {title}
          </h3>
          <p className="text-xs font-body text-muted-foreground tracking-wider uppercase">
            {new Date(date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
        </div>
      </Link>
    </motion.div>
  );
}
