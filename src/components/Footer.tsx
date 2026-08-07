import { Camera } from "lucide-react";
import { Link } from "react-router-dom";
import { useCustomDomainSlug } from "@/lib/custom-domain-context";

interface FooterProps {
  tenantName?: string;
  tenantEmail?: string;
  tenantSlug?: string;
}

export default function Footer({ tenantName, tenantEmail, tenantSlug }: FooterProps) {
  const customDomainSlug = useCustomDomainSlug();
  const displayName = tenantName || "Zacmphotos";
  const contactEmail = tenantEmail || "hello@zacmphotos.com";
  const bookingPath = tenantSlug ? (customDomainSlug === tenantSlug ? "/" : `/book/${tenantSlug}`) : "/";
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card/50 py-12">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <Camera className="w-4 h-4 text-primary" />
            <span className="font-display text-base text-foreground">{displayName}</span>
          </div>
          <div className="flex items-center gap-8 text-xs font-body tracking-widest uppercase text-muted-foreground">
            <Link to={bookingPath} className="hover:text-primary transition-colors">Booking</Link>
            <a href={`mailto:${contactEmail}`} className="hover:text-primary transition-colors">Contact</a>
          </div>
          <p className="text-xs text-muted-foreground/50 font-body">
            © {year} {displayName}
          </p>
        </div>
      </div>
    </footer>
  );
}
