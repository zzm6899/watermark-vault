import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DownloadRequestInbox from "@/components/DownloadRequestInbox";
import type { Album } from "@/lib/types";

afterEach(cleanup);
const albums = [{ id: "album", title: "Event gallery", photos: [], downloadRequests: [
  { id: "pending", method: "bank-transfer", status: "pending", email: "buyer@example.com", sessionKey: "buyer-session", photoIds: ["one"], requestedAt: "2026-09-18T00:00:00Z", amount: 15 },
  { id: "approved", method: "bank-transfer", status: "approved", email: "approved@example.com", photoIds: ["two"], requestedAt: "2026-09-17T00:00:00Z" },
] }] as Album[];

it("filters request cards with summary buttons and recovers an empty search", () => {
  render(<MemoryRouter><DownloadRequestInbox albums={albums} /></MemoryRouter>);
  expect(screen.getByText("buyer@example.com")).toBeInTheDocument();
  expect(screen.getByText("$15.00")).toBeInTheDocument();
  expect(screen.getByText("AUD")).toBeInTheDocument();
  expect(screen.queryByText("approved@example.com")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "1 Approved" }));
  expect(screen.getByText("approved@example.com")).toBeInTheDocument();
  expect(screen.getByText("Amount unknown")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm transfer & approve" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Search download requests" }), { target: { value: "missing" } });
  fireEvent.click(screen.getByRole("button", { name: "Show all requests" }));
  expect(screen.getByText("buyer@example.com")).toBeInTheDocument();
  expect(screen.getByText("approved@example.com")).toBeInTheDocument();
});
