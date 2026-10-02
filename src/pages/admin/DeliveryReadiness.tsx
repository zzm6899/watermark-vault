import { useState } from "react";
import { AlertCircle, AlertTriangle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { deliverAlbum } from "@/lib/api";
import type { DeliveryChecklistItem } from "@/lib/album-workflow";
import type { Photo } from "@/lib/types";

export default function DeliveryReadiness({
  albumId,
  photos,
  photoRevision,
  checks,
  onDelivered,
}: {
  albumId: string;
  photos: Photo[];
  photoRevision?: string;
  checks: DeliveryChecklistItem[];
  onDelivered: () => void;
}) {
  const [showAllChecks, setShowAllChecks] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const blockers = checks.filter(item => item.status === "blocker");
  const warnings = checks.filter(item => item.status === "warning");
  const attention = checks.filter(item => item.status !== "ok");

  const handleDeliver = async () => {
    if (delivering || blockers.length > 0) return;
    const warningText = warnings.length > 0
      ? "\n\nReview warnings:\n" + warnings.map(item => "- " + item.label + ": " + item.detail).join("\n")
      : "";
    if (!confirm("Deliver this gallery? This turns off gallery watermarks, makes the gallery public, and emails the client when an email is set." + warningText)) return;
    setDelivering(true);
    try {
      const result = await deliverAlbum(albumId, photos, warnings.map(({ id, detail }) => ({ id, detail })), photoRevision);
      if (result?.ok) {
        toast.success("Gallery delivered!" + (result.emailSent ? " Client notified by email." : ""));
        onDelivered();
      } else {
        toast.error(result?.error || "Delivery failed. Check the server connection and readiness checks.");
      }
    } finally {
      setDelivering(false);
    }
  };

  return (
    <section id="album-editor-delivery" aria-labelledby="album-delivery-title" className="scroll-mt-40 rounded-md border border-border/70 bg-background/40 p-3 space-y-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="min-w-0">
          <h3 id="album-delivery-title" className="text-sm font-body font-medium text-foreground">Delivery readiness</h3>
          <p className="text-[11px] text-muted-foreground">Blockers stop delivery. Review warnings before confirming.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={blockers.length > 0 ? "rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive" : warnings.length > 0 ? "rounded border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-[11px] text-orange-300" : "rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary"}>
            {blockers.length > 0 ? blockers.length + " blocker" + (blockers.length === 1 ? "" : "s") : warnings.length > 0 ? "Review " + warnings.length + " warning" + (warnings.length === 1 ? "" : "s") : "Ready to deliver"}
          </span>
          <Button type="button" size="sm" variant="ghost" aria-expanded={showAllChecks} onClick={() => setShowAllChecks(value => !value)} className="min-h-9 px-2 text-xs">
            {showAllChecks ? "Hide checks" : "All checks"} ({checks.length})
          </Button>
        </div>
      </div>
      {attention.length > 0 ? (
        <ul aria-label="Delivery items needing attention" className="divide-y divide-border/60 border-y border-border/60">
          {attention.map(item => (
            <li key={item.id} className="flex items-start gap-2 py-1.5">
              {item.status === "blocker" ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-300" />}
              <p className="min-w-0 text-xs"><span className={item.status === "blocker" ? "font-medium text-destructive" : "font-medium text-orange-300"}>{item.label}:</span> <span className="text-muted-foreground">{item.detail}</span></p>
            </li>
          ))}
        </ul>
      ) : <p role="status" className="border-y border-border/60 py-1.5 text-xs text-muted-foreground">All delivery checks passed.</p>}
      {showAllChecks && (
        <ul aria-label="All delivery checks" className="divide-y divide-border/50">
          {checks.map(item => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-1.5 text-xs">
              <span className="font-medium text-foreground">{item.label}</span>
              <span className="text-right text-muted-foreground">{item.detail} · {item.status === "ok" ? "Ready" : item.status === "warning" ? "Review" : "Blocked"}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">Delivery turns off gallery watermarks, marks the gallery public, and emails the client when an address is set.</p>
      <Button
        type="button"
        disabled={blockers.length > 0 || delivering}
        onClick={() => void handleDeliver()}
        className="min-h-10 w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send className="h-3.5 w-3.5" /> {delivering ? "Delivering…" : "Deliver gallery"}
      </Button>
    </section>
  );
}
