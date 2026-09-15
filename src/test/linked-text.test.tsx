import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import LinkedText from "@/components/LinkedText";

it("links multiple references, including adjacent URLs, without changing the answer", () => {
  const text = "References:\nhttps://pin.it/one https://pin.it/twohttps://pin.it/three";
  const { container } = render(<LinkedText text={text} />);
  expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["https://pin.it/one", "https://pin.it/two", "https://pin.it/three"]);
  expect(container.textContent).toBe(text);
});

it("handles www links and punctuation and keeps clicks out of booking controls", () => {
  const clicked = vi.fn();
  const text = "See (https://example.com/photo_(one)), or www.example.com.";
  const { container } = render(<div onClick={clicked}><LinkedText text={text} /></div>);
  const links = screen.getAllByRole("link");
  expect(links[0]).toHaveAttribute("href", "https://example.com/photo_(one)");
  expect(links[1]).toHaveAttribute("href", "https://www.example.com/");
  expect(links[0]).toHaveAttribute("target", "_blank");
  expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  fireEvent.click(links[0]);
  expect(clicked).not.toHaveBeenCalled();
  expect(container.textContent).toBe(text);
});

it("leaves markup and non-web schemes as plain text", () => {
  const text = '<script>alert(1)</script> javascript:alert(1) data:text/html,hello https://';
  const { container } = render(<LinkedText text={text} />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toBe(text);
});
