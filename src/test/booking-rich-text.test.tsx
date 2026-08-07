import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BookingAvatar from "@/components/BookingAvatar";
import RichTextEditor, { RichTextDisplay } from "@/components/RichTextEditor";
import { normalizePlainRichText, richTextToPlainText, sanitizeRichText } from "@/lib/rich-text";

afterEach(cleanup);

describe("booking rich text", () => {
  it("decodes legacy non-breaking-space entities and safely linkifies visible URLs", () => {
    render(<RichTextDisplay html={"Cosplay in MCEC&nbsp; with details at https://example.com/session."} />);

    expect(screen.getByText(/MCEC with details/)).not.toHaveTextContent("&nbsp;");
    expect(screen.getByRole("link", { name: "https://example.com/session" })).toHaveAttribute("href", "https://example.com/session");
    expect(screen.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
    expect(document.querySelector("[data-rich-text]")).toHaveClass("overflow-hidden", "break-words");
    expect(normalizePlainRichText("one&nbsp;two")).toBe("one two");
  });

  it("normalizes contentEditable div blocks to paragraphs and preserves only safe links", () => {
    const sanitized = sanitizeRichText('<div>First paragraph</div><div>Second <a href="javascript:alert(1)" onclick="alert(1)">unsafe</a> https://example.com/info</div><script>alert(1)</script>');
    const container = document.createElement("div");
    container.innerHTML = sanitized;

    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("div")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.querySelector("a[href^='javascript:']")).toBeNull();
    expect(container.querySelector("a[href='https://example.com/info']")).toHaveAttribute("target", "_blank");

    container.innerHTML = sanitizeRichText("First line\nSecond line\n\nThird paragraph");
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("br")).not.toBeNull();
  });

  it("converts stored rich text into readable plain calendar details", () => {
    expect(richTextToPlainText("<p>Cosplay in MCEC&nbsp;</p><p>Bring references<br>See https://example.com/details</p>"))
      .toBe("Cosplay in MCEC\nBring references\nSee https://example.com/details");
    expect(richTextToPlainText('<p>Safe</p><script>alert("unsafe")</script>')).toBe("Safe");
  });

  it("keeps long links contained in the editor surface", () => {
    const onChange = vi.fn();
    const { container } = render(<RichTextEditor value="https://example.com/a/very/long/path" onChange={onChange} placeholder="Event description" />);
    const editor = screen.getByRole("textbox", { name: "Event description" });

    expect(editor).toHaveClass("min-w-0", "max-w-full", "overflow-x-hidden", "break-words", "[overflow-wrap:anywhere]", "[&_a]:break-all");
    expect(editor).toHaveAttribute("aria-multiline", "true");

    const rawEditingMarkup = "<div>First paragraph</div><div>https://example.com/details</div>";
    editor.innerHTML = rawEditingMarkup;
    fireEvent.input(editor);

    // Input emits sanitized HTML but leaves the live DOM alone, preserving the
    // browser's selection and caret until editing finishes.
    expect(editor.innerHTML).toBe(rawEditingMarkup);
    expect(onChange).toHaveBeenLastCalledWith('<p>First paragraph</p><p><a href="https://example.com/details" target="_blank" rel="noopener noreferrer">https://example.com/details</a></p>');

    fireEvent.blur(editor);
    expect(editor.querySelector("div")).toBeNull();
    expect(editor.querySelector("a[href='https://example.com/details']")).not.toBeNull();
  });

  it("keeps date-page descriptions in naturally wrapping rich-text panels", () => {
    const bookingSource = readFileSync(join(process.cwd(), "src/pages/Booking.tsx"), "utf8");
    const tenantSource = readFileSync(join(process.cwd(), "src/pages/TenantBookingPage.tsx"), "utf8");

    expect(bookingSource).not.toContain("max-h-48 overflow-y-auto");
    expect(tenantSource).not.toContain('line-clamp-3">{selectedEvent.description}');
    expect(bookingSource).toContain("<RichTextDisplay html={selectedEvent.description}");
    expect(tenantSource).toContain("<RichTextDisplay html={selectedEvent.description}");
    expect(bookingSource).toContain("aria-pressed={selectedDuration === d}");
    expect(bookingSource).toContain("aria-pressed={selectedTime === t}");
    expect(tenantSource).toContain("aria-pressed={selectedDuration === d}");
    expect(tenantSource).toContain("aria-pressed={selectedTime === t}");
    expect(tenantSource).toContain('className="truncate font-display text-sm leading-tight text-foreground"');
    expect(bookingSource).toContain("details: richTextToPlainText(selectedEvent.description)");
  });

  it("renders admin event-card descriptions as decoded, clamped plain-text summaries", () => {
    const summary = richTextToPlainText("<p>Cosplay in MCEC&nbsp; with <strong>lighting notes</strong>.</p>");
    render(<RichTextDisplay html={summary} className="mt-1 line-clamp-2" />);

    const display = document.querySelector("[data-rich-text]");
    expect(display).toHaveTextContent("Cosplay in MCEC with lighting notes.");
    expect(display).not.toHaveTextContent("&nbsp;");
    expect(display).toHaveClass("line-clamp-2", "overflow-hidden");
    expect(display?.className).not.toContain("overflow-y-auto");

    const adminSource = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8");
    expect(adminSource).toContain("html={richTextToPlainText(et.description)}");
    expect(adminSource).not.toContain(">{et.description}</p>");
  });
});

describe("booking avatar", () => {
  it("uses initials when no image exists and falls back when an image fails", () => {
    const { rerender } = render(<BookingAvatar name="Zac Morgan" />);
    expect(screen.getByRole("img", { name: "Zac Morgan profile" })).toHaveTextContent("ZM");

    rerender(<BookingAvatar name="Zac Morgan" src="/missing-avatar.jpg" />);
    fireEvent.error(screen.getByRole("img", { name: "Zac Morgan profile" }));
    expect(screen.getByRole("img", { name: "Zac Morgan profile" })).toHaveTextContent("ZM");
  });
});
