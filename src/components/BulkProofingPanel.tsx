import { useRef, useState } from "react";
import type { Album, Booking } from "@/lib/types";
import { fetchAlbumStubs } from "@/lib/api";
import { canSendProofingInvite, proofingInviteAction, sendAlbumProofingInvite } from "@/lib/bulk-proofing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { configuredProofingMessage } from "@/lib/proofing-message-settings";
import { toast } from "sonner";

export default function BulkProofingPanel({ albums, bookings, selected, defaultHours, onSent, onBusy }: {
  albums: Album[]; bookings: Booking[]; selected: Set<string>; defaultHours: number; onSent: (id: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [hours, setHours] = useState(defaultHours);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const chosen = albums.filter(album => selected.has(album.id));
  const eligible = chosen.filter(canSendProofingInvite);
  const durationFor = (album: Album) => bookings.find(booking => booking.id === album.bookingId || booking.albumId === album.id)?.duration;
  const send = async () => {
    if (running.current || !eligible.length) return;
    running.current = true; setBusy(true); onBusy(true); setResults([]);
    let sent = 0;
    try {
      // Fetch before each album so retries see a round saved by a prior failed email.
      for (const [index, original] of chosen.entries()) {
        setProgress(`Processing ${index + 1} of ${chosen.length}: ${original.title}`);
        try {
          const fresh = await fetchAlbumStubs();
          if (!fresh) throw new Error("Server unavailable; no email sent");
          const album = fresh.find(item => item.id === original.id);
          if (!album) throw new Error("Album no longer available");
          await sendAlbumProofingInvite(album, hours, note, durationFor(album), configuredProofingMessage(album));
          sent++; onSent(album.id);
          setResults(previous => [...previous, `${album.title}: invite sent`]);
        } catch (error) {
          setResults(previous => [...previous, `${original.title}: ${error instanceof Error ? error.message : "Could not send invite"}`]);
        }
      }
      toast[ sent === chosen.length ? "success" : "warning"](`Sent ${sent} of ${chosen.length} proofing invites`);
    } finally {
      running.current = false; setBusy(false); onBusy(false); setProgress("");
    }
  };
  return <section className="glass-panel rounded-xl p-4 mb-4 space-y-3" aria-label="Bulk proofing emails">
    <h3 className="font-display text-lg">Send proofing emails · {chosen.length} selected</h3>
    <p className="text-xs text-muted-foreground">New rounds publish the selected galleries and disable purchasing. Active rounds resend the existing link without changing picks or deadlines. Albums already submitted, in editing or delivered need individual review.</p>
    <div className="max-h-52 overflow-auto space-y-2">
      {chosen.map(album => <div key={album.id} className="text-sm"><strong>{album.title}</strong> · {album.clientEmail || "No email"}<span className="block text-xs text-muted-foreground">{proofingInviteAction(album)} · {configuredProofingMessage(album)}</span></div>)}
    </div>
    <label className="block text-xs">Window for new rounds (hours)<Input aria-label="Proofing window hours" type="number" min={1} max={720} value={hours} disabled={busy} onChange={event => setHours(Number(event.target.value))} className="mt-1 w-28" /></label>
    <Textarea aria-label="Message for new proofing rounds" placeholder="Optional message for new rounds" value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
    <Button onClick={() => void send()} disabled={busy || !eligible.length || hours < 1 || hours > 720}> {busy ? "Sending…" : `Send proofing emails (${eligible.length})`}</Button>
    <p role="status" className="text-xs text-muted-foreground">{progress || "Sent albums are deselected. Skipped or failed albums stay selected."}</p>
    {results.length > 0 && <ul className="max-h-52 overflow-auto text-xs space-y-1">{results.map((result, index) => <li key={index}>{result}</li>)}</ul>}
  </section>;
}
