import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import BookingBusiness from "@/components/admin/BookingBusiness";
import type { Booking } from "@/lib/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("submits the entered instalment once, preserves an unsuccessful form and reloads acknowledged records", async () => {
  let saved: Record<string, unknown> | undefined;
  let fail = true;
  const onChange = vi.fn();
  const fetchMock = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
    if (options.method === "POST") {
      saved = JSON.parse(String(options.body));
      return { ok: !fail, json: async () => fail ? { error: "Server rejected save" } : saved };
    }
    return { ok: true, json: async () => url.includes("contracts") ? [] : !fail && saved ? [{ ...saved, status: "pending", currency: "aud" }] : [] };
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<BookingBusiness booking={{ id: "booking", status: "confirmed", paymentAmount: 100 } as Booking} tenantSlug="a" onChange={onChange} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByText("Payment schedule (0)"));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "60" } });
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2027-09-15" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Final balance" } });
  fireEvent.click(screen.getByRole("button", { name: "Add instalment" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Amount")).toHaveValue(60);
  expect(saved).toEqual(expect.objectContaining({ amount: 60, dueDate: "2027-09-15", note: "Final balance" }));
  const firstIdentity = saved!.id;
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Add instalment" }));
  await screen.findByText(/2027-09-15 · AUD 60.00 · pending Final balance/);
  expect(saved!.id).toBe(firstIdentity);
  expect(onChange).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith("/api/bookings/booking/instalments?tenant=a", expect.objectContaining({ method: "POST" }));
});
