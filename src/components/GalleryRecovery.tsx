import { useId, useState } from "react";
import { Mail, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function GalleryRecovery({ albumId, compact = false }: { albumId?: string; compact?: boolean }) {
  const inputId = useId();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  return <section className={compact && !open ? "gallery-recovery-link" : "rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-background p-5 sm:p-6"}>
    <div className="flex items-start gap-3">
      {(!compact || open) && <span className="rounded-xl bg-primary/10 p-2.5"><Mail className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /></span>}
      <div className="min-w-0 flex-1">
        {(!compact || open) && <><p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Your photos, any device</p><h2 className="mt-1 text-lg font-semibold">Already purchased photos?</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Restore card purchases or approved bank-transfer downloads on this device using the email you provided.</p></>}
        {!open && <Button type="button" variant={compact ? "ghost" : "outline"} size="sm" className={compact ? "px-0 text-muted-foreground min-h-11" : "mt-4 min-h-11"} onClick={() => setOpen(true)}>Find my purchases</Button>}
        {open && compact && <button type="button" className="mt-2 text-xs underline" onClick={() => setOpen(false)}>Close recovery</button>}
        {open && status !== "sent" && <form className="mt-5 space-y-3" onSubmit={async event => {
          event.preventDefault();
          if (status === "sending") return;
          setStatus("sending");
          setError("");
          try {
            const response = await fetch("/api/client-portal/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase(), albumId }) });
            if (response.status === 429) throw new Error("Too many link requests. Check your inbox for an existing link, or try again in an hour.");
            if (!response.ok) throw new Error("We couldn't request the link. Check your connection and try again.");
            setStatus("sent");
          } catch (error) { setError(error instanceof Error ? error.message : "We couldn't request the link. Please try again."); setStatus("error"); }
        }}>
          <label htmlFor={inputId} className="block text-xs font-medium">Email used for your purchase or download request</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id={inputId} type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" className="min-h-11" aria-describedby={`${inputId}-help`} aria-invalid={status === "error" || undefined} disabled={status === "sending"} />
            <Button disabled={status === "sending"} className="shrink-0 min-h-11" type="submit">{status === "sending" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Email secure link</Button>
          </div>
          <p id={`${inputId}-help`} className="text-xs leading-relaxed text-muted-foreground">Open the email link to verify it’s you. Recovery links expire after 30 minutes.</p>
          {status === "error" && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
        </form>}
        {status === "sent" && <div className="mt-5 space-y-4">
          <div role="status" className="rounded-xl border border-primary/20 bg-background/70 p-4"><p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />Check your inbox</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">If purchases match <strong className="break-all text-foreground">{email}</strong>, a secure link will arrive from your photographer.</p></div>
          <ol className="space-y-2 text-sm text-muted-foreground"><li><span className="font-medium text-foreground">1. Open the email</span> on the device where you want your photos.</li><li><span className="font-medium text-foreground">2. Follow the secure link</span> within 30 minutes to restore your downloads.</li></ol>
          <p className="text-xs leading-relaxed text-muted-foreground">Nothing yet? Check spam or junk. Bank transfers must be approved before downloads can be restored.</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => { setStatus("idle"); setError(""); }}>Use another email</Button>
        </div>}

      </div>
    </div>
  </section>;
}
