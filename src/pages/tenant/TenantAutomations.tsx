import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { getTenantEmailAutomations, getTenantSettings, getTenantStoreKey, previewTenantEmailAutomation, saveTenantEmailAutomations } from "@/lib/api";
import type { EmailAutomationRule, EmailAutomationTrigger, EmailAutomationReminderType, EventType } from "@/lib/types";

const triggers: { value: EmailAutomationTrigger; label: string }[] = [
  { value: "after_booking", label: "After booking" },
  { value: "before_event", label: "Before session" },
  { value: "after_event", label: "After session" },
  { value: "after_payment", label: "After payment" },
  { value: "payment_overdue", label: "Payment overdue" },
];

export default function TenantAutomations({ slug }: { slug: string }) {
  const [rules, setRules] = useState<EmailAutomationRule[]>([]);
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [smtpReady, setSmtpReady] = useState(false);
  const [events, setEvents] = useState<EventType[]>([]);
  const [preview, setPreview] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    Promise.all([getTenantEmailAutomations(slug), getTenantSettings(slug), getTenantStoreKey<EventType[]>(slug, "wv_event_types")]).then(([loaded, settings, eventTypes]) => {
      if (!active) return;
      setRules(loaded);
      setSaved(JSON.stringify(loaded));
      setSmtpReady(!!(settings.smtpHost && settings.smtpUser && settings.smtpPasswordSet));
      setEvents(Array.isArray(eventTypes) ? eventTypes : []);
      setLoading(false);
    });
    return () => { active = false; };
  }, [slug]);

  const update = (id: string, patch: Partial<EmailAutomationRule>) => {
    setRules(current => current.map(rule => rule.id === id ? { ...rule, ...patch } : rule));
    setPreview(current => { const next = { ...current }; delete next[id]; return next; });
  };
  const add = () => setRules(current => [{
    id: `auto-${crypto.randomUUID()}`, name: "New email", enabled: false,
    trigger: "before_event", delayHours: 24, reminderType: "booking",
    templateSubject: "Your {event} is coming up",
    templateBody: "Hi {name}, your {event} is on {date} at {time}.",
  }, ...current]);
  const showPreview = async (rule: EmailAutomationRule) => {
    const result = await previewTenantEmailAutomation(slug, rule);
    if (!result) { toast.error("Could not preview this email"); return; }
    const sample = result.matches[0];
    setPreview(current => ({ ...current, [rule.id]: `${result.summary.due} ready to send · ${result.summary.upcoming} upcoming${sample ? ` · Example: ${sample.clientName} (${sample.status})` : ""}` }));
  };
  const save = async () => {
    if (rules.some(rule => rule.enabled) && !smtpReady) { toast.error("Set up your email account in Settings → Notifications first"); return; }
    setSaving(true);
    const previews = await Promise.all(rules.filter(rule => rule.enabled).map(rule => previewTenantEmailAutomation(slug, rule)));
    if (previews.some(result => !result)) { setSaving(false); toast.error("Could not check recipients"); return; }
    const due = previews.reduce((count, result) => count + (result?.summary.due || 0), 0);
    if (due > 0 && !window.confirm(`${due} email${due === 1 ? " is" : "s are"} ready to send. Save these rules?`)) { setSaving(false); return; }
    const result = await saveTenantEmailAutomations(slug, rules);
    setSaving(false);
    if (!result) { toast.error("Could not save automatic emails"); return; }
    setRules(result); setSaved(JSON.stringify(result)); toast.success("Automatic emails saved");
  };

  return <div className="space-y-5 max-w-4xl">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-display text-2xl text-foreground">Automatic Emails</h2><p className="text-sm text-muted-foreground mt-1">Send reminders and follow-ups for your bookings. Each rule sends once per booking.</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={add} disabled={loading}><Plus className="size-4 mr-1" />Add email</Button><Button onClick={save} disabled={loading || saving || saved === JSON.stringify(rules)}><Save className="size-4 mr-1" />{saving ? "Saving…" : "Save"}</Button></div>
    </div>
    {!smtpReady && !loading && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-foreground">Set up your email account in Settings → Notifications before turning on automatic emails.</p>}
    {loading ? <p className="text-sm text-muted-foreground">Loading emails…</p> : rules.length === 0 ? <p className="text-sm text-muted-foreground">No automatic emails yet. Add one to get started.</p> : rules.map(rule => <section key={rule.id} className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex items-center gap-3"><Switch checked={rule.enabled} onCheckedChange={enabled => update(rule.id, { enabled })} aria-label={`Enable ${rule.name || "email"}`} /><Input aria-label="Email name" maxLength={100} value={rule.name || ""} onChange={event => update(rule.id, { name: event.target.value })} placeholder="Email name" className="font-medium" /><Button variant="ghost" size="icon" aria-label={`Delete ${rule.name || "email"}`} onClick={() => setRules(current => current.filter(item => item.id !== rule.id))}><Trash2 className="size-4" /></Button></div>
      <div className="grid sm:grid-cols-3 gap-3"><label className="text-xs text-muted-foreground">When<select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" value={rule.trigger} onChange={event => update(rule.id, { trigger: event.target.value as EmailAutomationTrigger })}>{triggers.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="text-xs text-muted-foreground">Hours<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" type="number" min="0" max="8760" value={rule.delayHours} onChange={event => update(rule.id, { delayHours: Math.min(8760, Math.max(0, Number(event.target.value) || 0)) })} /></label><label className="text-xs text-muted-foreground">Message type<select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" value={rule.reminderType} onChange={event => update(rule.id, { reminderType: event.target.value as EmailAutomationReminderType })}><option value="booking">Booking reminder</option><option value="payment">Payment reminder</option></select></label></div>
      <div className="grid sm:grid-cols-3 gap-3"><label className="text-xs text-muted-foreground">Event<select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" value={rule.eventTypeId || ""} onChange={event => update(rule.id, { eventTypeId: event.target.value || undefined })}><option value="">All events</option>{rule.eventTypeId && !events.some(item => item.id === rule.eventTypeId) && <option value={rule.eventTypeId}>Archived event</option>}{events.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="text-xs text-muted-foreground">Booking status<select className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" value={rule.bookingStatus || ""} onChange={event => update(rule.id, { bookingStatus: event.target.value || undefined })}><option value="">Any active booking</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option></select></label><label className="text-xs text-muted-foreground">Created on or after<input className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" type="date" value={rule.createdAfter || ""} onChange={event => update(rule.id, { createdAfter: event.target.value || undefined })} /></label></div>
      <label className="block text-xs text-muted-foreground">Subject<Input className="mt-1" maxLength={200} value={rule.templateSubject || ""} onChange={event => update(rule.id, { templateSubject: event.target.value })} /></label>
      <label className="block text-xs text-muted-foreground">Message<Textarea className="mt-1 min-h-28" maxLength={2000} value={rule.templateBody || ""} onChange={event => update(rule.id, { templateBody: event.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" onClick={() => showPreview(rule)}>Check recipients</Button><span className="text-xs text-muted-foreground">Use {"{name}"}, {"{event}"}, {"{date}"}, {"{time}"}, {"{location}"}, {"{balance}"} in your email.</span>{preview[rule.id] && <span role="status" className="text-xs text-foreground">{preview[rule.id]}</span>}</div>
    </section>)}
  </div>;
}
