import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BookingQuestionField } from "@/pages/Booking";
import { TenantBookingQuestionField } from "@/pages/TenantBookingPage";
import type { QuestionField } from "@/lib/types";

afterEach(cleanup);

const renderers = [
  ["main booking", BookingQuestionField],
  ["tenant booking", TenantBookingQuestionField],
] as const;

function question(type: QuestionField["type"]): QuestionField {
  return {
    id: "preferred-setting",
    label: "Preferred setting",
    type,
    required: true,
    placeholder: "Tell us",
    options: ["Studio", "Outdoors"],
  };
}

describe.each(renderers)("%s custom-question labels", (_name, QuestionFieldRenderer) => {
  it.each(["text", "textarea", "instagram"] as const)("gives the %s textbox its visible label", type => {
    const onChange = vi.fn();
    render(<QuestionFieldRenderer field={question(type)} value="" onChange={onChange} />);

    const textbox = screen.getByRole("textbox", { name: /Preferred setting/ });
    expect(textbox).toHaveAttribute("id", expect.stringContaining("preferred-setting"));
    fireEvent.change(textbox, { target: { value: "Studio" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("gives a select its visible label", () => {
    render(<QuestionFieldRenderer field={question("select")} value="" onChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: /Preferred setting/ })).toHaveAttribute("id", expect.stringContaining("preferred-setting"));
  });

  it("gives the boolean button group its visible label", () => {
    const onChange = vi.fn();
    render(<QuestionFieldRenderer field={question("boolean")} value="No" onChange={onChange} />);

    expect(screen.getByRole("group", { name: /Preferred setting/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onChange).toHaveBeenCalledWith("Yes");
  });
});
