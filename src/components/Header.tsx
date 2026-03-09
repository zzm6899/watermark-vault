import { Link, useLocation } from "react-router-dom";
import { Camera, Menu, X } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getProfile } from "@/lib/storage";
import { useCustomDomainSlug } from "@/lib/custom-domain-context";

export default function Header({ tenantSlug, tenantName }: { tenantSlug?: string | null; tenantName?: string | null }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const profile = getProfile();
  const customDomainSlug = useCustomDomainSlug();

  const displayName = tenantName || profile.name;
  // On a custom domain, the tenant's canonical booking page is always "/".
  // On the main platform domain, use the explicit /book/:slug path.
  const bookingPath = tenantSlug
    ? (customDomainSlug === tenantSlug ? "/" : `/book/${tenantSlug}`)
    : "/";

  const navItems = [
    { label: "Book a Session", path: bookingPath },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass-panel">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to={bookingPath} className="flex items-center gap-2.5 group">
          {!tenantSlug && profile.avatar ? (
            <img src={profile.avatar} alt="Logo" className="w-6 h-6 rounded-full object-cover" />
          ) : (
            <Camera className="w-5 h-5 text-primary transition-transform group-hover:rotate-12" />
          )}
          <span className="font-display text-lg tracking-wide text-foreground">
            {displayName}
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`text-sm font-body tracking-widest uppercase transition-colors hover:text-primary ${
                location.pathname === item.path ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {!tenantSlug && (
            <Link
              to="/admin"
              className="text-xs font-body tracking-widest uppercase text-muted-foreground/50 hover:text-primary transition-colors"
            >
              Admin
            </Link>
          )}
        </nav>

        <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden text-foreground">
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="md:hidden glass-panel border-t border-border/50">
            <nav className="flex flex-col p-4 gap-4">
              {navItems.map((item) => (
                <Link key={item.path} to={item.path} onClick={() => setMobileOpen(false)} className="text-sm font-body tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors">
                  {item.label}
                </Link>
              ))}
              {!tenantSlug && (
                <Link to="/admin" onClick={() => setMobileOpen(false)} className="text-xs font-body tracking-widest uppercase text-muted-foreground/50 hover:text-primary transition-colors">
                  Admin
                </Link>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
