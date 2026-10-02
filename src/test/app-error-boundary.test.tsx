import { render, screen } from "@testing-library/react";
import AppErrorBoundary from "@/components/AppErrorBoundary";

function BrokenPage(): never {
  throw new Error("route failed");
}

describe("AppErrorBoundary", () => {
  it("keeps a render failure recoverable with a named reload action", () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const swallowExpectedRenderError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", swallowExpectedRenderError);
    try {
      render(<AppErrorBoundary><BrokenPage /></AppErrorBoundary>);
      expect(screen.getByRole("heading", { name: "We couldn’t load this page" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Reload the page to try again.");
      expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    } finally {
      window.removeEventListener("error", swallowExpectedRenderError);
      logError.mockRestore();
    }
  });
});
