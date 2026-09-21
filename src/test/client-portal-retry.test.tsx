import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ClientPortal from "@/pages/ClientPortal";
import RecoveryEmailFailures from "@/components/admin/RecoveryEmailFailures";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

it("allows a resend after cooldown without exposing whether galleries exist", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => json({ ok: true }, 202));
  vi.stubGlobal("fetch", fetchMock);
  render(<ClientPortal />);
  fireEvent.change(screen.getByLabelText("Your Email"), { target: { value: "Alex@example.test" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send My Gallery Links" })));
  expect(screen.getByText(/If we have any galleries/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled();
  await act(async () => vi.advanceTimersByTime(60_000));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resend gallery links" })));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).email).toBe("alex@example.test");
});

it("shows network failures inline and keeps the email for retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection lost")));
  render(<ClientPortal />);
  fireEvent.change(screen.getByLabelText("Your Email"), { target: { value: "alex@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Send My Gallery Links" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByLabelText("Your Email")).toHaveValue("alex@example.test");
  expect(screen.getByRole("button", { name: "Send My Gallery Links" })).toBeEnabled();
});

it("keeps failed admin deliveries visible and refreshes after successful retry", async () => {
  const failure = { id: "failure", email: "alex@example.test", tenantSlug: null, albumIds: ["a"], errorCode: "EMAIL_NOT_CONFIGURED", attempts: 1, lastAttemptAt: "2026-09-22T00:00:00Z" };
  const fetchMock = vi.fn().mockResolvedValueOnce(json({ failures: [failure] })).mockResolvedValueOnce(json({ error: "Check email settings" }, 502)).mockResolvedValueOnce(json({ ok: true })).mockResolvedValueOnce(json({ failures: [] }));
  vi.stubGlobal("fetch", fetchMock);
  render(<RecoveryEmailFailures />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry email" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check email settings");
  fireEvent.click(screen.getByRole("button", { name: "Retry email" }));
  expect(await screen.findByText("No recorded delivery failures.")).toBeVisible();
  expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/client-portal/failures/failure/retry");
});
