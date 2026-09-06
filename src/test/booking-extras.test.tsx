import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import type { EventType } from "@/lib/types";
import { bookingQuote } from "@/lib/booking-pricing";
import { BookingExtras, BookingPriceBreakdown } from "@/components/BookingExtras";
const event: EventType = { id: "portrait", title: "Portrait", description: "", active: true, color: "primary", durations: [30, 60], questions: [], availability: { recurring: [], specificDates: [], blockedDates: [] }, price: 100.5, durationPrices: { 60: 200 }, extras: [{ id: "composite", name: "Composite image", price: 35.25, maxQuantity: 10 }], depositEnabled: true, depositType: "percentage", depositAmount: 25 };
describe("booking extras", () => {
  it("explains an extra accessibly without changing its price", () => {
    const described = { ...event, extras: [{ ...event.extras![0], description: "Combine photos into one finished artwork." }] };
    render(<BookingExtras event={described} quantities={{}} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton", { name: "Composite image" })).toHaveAccessibleDescription("Combine photos into one finished artwork. $35.25 each · up to 10");
    expect(bookingQuote(described, 30, { composite: 2 })).toEqual(bookingQuote(event, 30, { composite: 2 }));
  });
  it("updates the displayed itemized total and enforces quantity bounds", () => {
    function Form() {
      const [quantities, setQuantities] = useState({});
      const quote = bookingQuote(event, 30, quantities);
      return <><BookingExtras event={event} quantities={quantities} onChange={setQuantities} /><BookingPriceBreakdown base={quote.sessionPrice} items={quote.lineItems} total={quote.total} /></>;
    }
    render(<Form />);
    const input = screen.getByRole("spinbutton", { name: /Composite image/ });
    expect(input).toHaveValue(0);
    fireEvent.change(input, { target: { value: "2" } });
    expect(screen.getByText("$171.00")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "99" } });
    expect(input).toHaveValue(10);
    fireEvent.change(input, { target: { value: "-1" } });
    expect(input).toHaveValue(0);
  });
  it("matches server cents, duration overrides and deposit rules", () => {
    expect(bookingQuote(event, 30, { composite: 2 })).toMatchObject({ total: 171, deposit: 42.75 });
    expect(bookingQuote(event, 60, { composite: 2 })).toMatchObject({ total: 270.5, deposit: 67.63 });
    expect(bookingQuote({ ...event, depositType: "fixed", depositAmount: 500 }, 30)).toMatchObject({ total: 100.5, deposit: 100.5 });
  });
});
