import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { EventType } from "@/lib/types";
import { bookingQuote } from "@/lib/booking-pricing";

const text = z.string().max(5000);
const draftSchema = z.object({
  eventId: z.string().max(200), duration: z.number().nullable(), date: z.string().nullable(),
  name: text, email: text, phone: text, answers: z.record(text),
  extras: z.record(z.number().finite()),
  notes: text.optional(), cosplayCharacter: text.optional(), cosplayCostume: text.optional(), conventionName: text.optional(),
});
export type BookingDraft = z.infer<typeof draftSchema>;
const draftKey = (scope: string) => `wv_booking_draft:${scope}`;
const lifetime = 2 * 60 * 60 * 1000;

export function clearBookingDraft(scope: string) {
  try { sessionStorage.removeItem(draftKey(scope)); } catch { /* Storage is optional. */ }
}

export function readBookingDraft(scope: string, events: EventType[]): { draft: BookingDraft; event: EventType } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey(scope)) || "null");
    if (!saved || !Number.isFinite(saved.savedAt) || Date.now() - saved.savedAt > lifetime || saved.savedAt > Date.now()) return null;
    const draft = draftSchema.parse(saved.draft);
    const event = events.find(event => event.id === draft.eventId && event.active);
    if (!event) return null;
    const duration = draft.duration && event.durations.includes(draft.duration) ? draft.duration : event.durations[0] || null;
    return { event, draft: {
      ...draft, duration,
      date: draft.date && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && !Number.isNaN(Date.parse(draft.date)) ? draft.date : null,
      answers: Object.fromEntries((event.questions || []).filter(question => typeof draft.answers[question.id] === "string").map(question => [question.id, draft.answers[question.id]])),
      extras: Object.fromEntries(bookingQuote(event, duration || 0, draft.extras).lineItems.map(item => [item.id, item.quantity])),
    } };
  } catch { return null; }
}

export function writeBookingDraft(scope: string, draft: BookingDraft) {
  try { sessionStorage.setItem(draftKey(scope), JSON.stringify({ savedAt: Date.now(), draft: draftSchema.parse(draft) })); }
  catch { /* A blocked or full browser store must not prevent booking. */ }
}

export function useBookingDraft({ scope, ready, completed, events, draft, onRestore }: {
  scope: string; ready: boolean; completed: boolean; events: EventType[]; draft: BookingDraft | null;
  onRestore: (draft: BookingDraft, event: EventType) => void;
}) {
  const [restored, setRestored] = useState(false);
  const clear = useCallback(() => clearBookingDraft(scope), [scope]);
  useEffect(() => {
    if (!ready || restored) return;
    const saved = !completed && readBookingDraft(scope, events);
    if (saved) onRestore(saved.draft, saved.event);
    else clear();
    setRestored(true);
  }, [ready, restored, completed, scope, events, onRestore, clear]);
  useEffect(() => {
    if (!restored) return;
    if (completed || !draft) clear();
    else writeBookingDraft(scope, draft);
  }, [restored, completed, scope, draft, clear]);
  return clear;
}
