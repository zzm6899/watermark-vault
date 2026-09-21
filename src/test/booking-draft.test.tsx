import { useState } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearBookingDraft, readBookingDraft, useBookingDraft, writeBookingDraft, type BookingDraft } from "@/hooks/use-booking-draft";
import type { EventType } from "@/lib/types";
const event = { id: "portrait", active: true, durations: [30], price: 100, questions: [{ id: "pose" }], extras: [{ id: "print", maxQuantity: 2, price: 10 }] } as unknown as EventType;
const draft: BookingDraft = { eventId: event.id, duration: 60, date: "2026-12-10", name: "Alex", email: "alex@example.test", phone: "123", answers: { pose: "Standing", removed: "Old answer" }, extras: { print: 8, removed: 1 } };
beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("isolates photographers, expires drafts and revalidates event options", () => {
  writeBookingDraft("tenant:a", draft);
  expect(readBookingDraft("tenant:b", [event])).toBeNull();
  expect(readBookingDraft("tenant:a", [{ ...event, active: false }])).toBeNull();
  expect(readBookingDraft("tenant:a", [event])?.draft).toEqual({ ...draft, duration: 30, answers: { pose: "Standing" }, extras: { print: 2 } });
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000);
  expect(readBookingDraft("tenant:a", [event])).toBeNull();
  clearBookingDraft("tenant:a");
  expect(sessionStorage.length).toBe(0);
});

it("restores only after config loads, preserves the restored draft and clears on completion", async () => {
  writeBookingDraft("main", draft);
  const { result, rerender } = renderHook(({ ready, completed }) => {
    const [value, setValue] = useState<BookingDraft | null>(null);
    useBookingDraft({ scope: "main", ready, completed, events: [event], draft: value, onRestore: restored => setValue(restored) });
    return value;
  }, { initialProps: { ready: false, completed: false } });
  expect(result.current).toBeNull();
  rerender({ ready: true, completed: false });
  await waitFor(() => expect(result.current?.name).toBe("Alex"));
  expect(readBookingDraft("main", [event])?.draft.name).toBe("Alex");
  rerender({ ready: true, completed: true });
  expect(readBookingDraft("main", [event])).toBeNull();
});

it("ignores malformed data and unavailable browser storage", () => {
  sessionStorage.setItem("wv_booking_draft:main", "not json");
  expect(readBookingDraft("main", [event])).toBeNull();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  expect(() => writeBookingDraft("main", draft)).not.toThrow();
});
