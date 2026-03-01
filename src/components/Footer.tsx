import { Camera } from "lucide-react";
import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-card/50 py-12">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <Camera className="w-4 h-4 text-primary" />
            <span className="font-display text-base text-foreground">Lumière</span>
          </div>
          <div className="flex items-center gap-8 text-xs font-body tracking-widest uppercase text-muted-foreground">
            <Link to="/gallery" className="hover:text-primary transition-colors">Portfolio</Link>
            <Link to="/booking" className="hover:text-primary transition-colors">Booking</Link>
            <a href="mailto:hello@lumiere.photo" className="hover:text-primary transition-colors">Contact</a>
          </div>
          <p className="text-xs text-muted-foreground/50 font-body">
            © 2026 Lumière Photography
          </p>
        </div>
      </div>
    </footer>
  );
}
