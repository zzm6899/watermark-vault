import { useId, useState } from "react";
import { Mail, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function GalleryRecovery({ albumId, compact = false }: { albumId?: string; compact?: boolean }) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  return <section className={compact && !open ? "gallery-recovery-link" : "rounded-lg border border-border p-4"}>
    <div className="flex items-start gap-3">
      {(!compact || open) && <Mail className="mt-1 h-5 w-5 shrink-0 text-primary" />}
      <div className="min-w-0 flex-1">
        {(!compact || open) && <><h2 className="text-sm font-semibold">Already purchased photos?</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Restore purchases on this device using your checkout email.</p></>}
        {!open && <Button type="button" variant={compact ? "ghost" : "outline"} size="sm" className={compact ? "px-0 text-muted-foreground" : "mt-3"} onClick={() => setOpen(true)}>Find my purchases</Button>}
        {open && compact && <button type="button" className="mt-2 text-xs underline" onClick={() => setOpen(false)}>Close recovery</button>}
        {open && status !== "sent" && <form className="mt-3 space-y-2" onSubmit={async event => {
          event.preventDefault();
          if (status === "sending") return;
          setStatus("sending");
          try {
            const response = await fetch("/api/client-portal/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase(), albumId }) });
            if (!response.ok) throw new Error("Request failed");
            setStatus("sent");
          } catch { setStatus("error"); }
        }}>
          <label htmlFor={inputId} className="block text-xs font-medium">Email used at checkout</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id={inputId} type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" disabled={status === "sending"} />
            <Button disabled={status === "sending"} className="shrink-0" type="submit">{status === "sending" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Email secure link</Button>
          </div>
          <p className="text-xs text-muted-foreground">Open the email link to verify it’s you. Recovery links expire after 30 minutes.</p>
          {status === "error" && <p role="alert" className="text-xs text-destructive">We couldn’t request the link. Check your connection and try again.</p>}
        </form>}
        {status === "sent" && <div role="status" className="mt-3 text-sm"><p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-primary" />Check your inbox</p><p className="mt-1 text-xs text-muted-foreground">If purchases match {email}, a link will arrive from your photographer. Check spam too.</p><button className="mt-2 text-xs underline" onClick={() => setStatus("idle")}>Use another email</button></div>}
      </div>
    </div>
  </section>;
}
