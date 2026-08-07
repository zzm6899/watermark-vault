import type { AppSettings, Booking, Enquiry, EventType, ProfileSettings } from "@/lib/types";

export interface PublicBookingConfig {
  /** Legacy deployments returned this at the top level. */
  setupComplete?: boolean;
  profile: Partial<ProfileSettings>;
  settings: Partial<AppSettings> & {
    /** Current /api/public/config response location. */
    setupComplete?: boolean;
  };
  eventTypes: EventType[];
}

export interface PublicAvailability {
  ok?: boolean;
  date?: string;
  eventTypeId?: string;
  timezone?: string;
  slots?: string[];
  availableSlots?: string[];
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json().catch(() => ({}));
  const body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as Record<string, unknown>;
}

export async function fetchPublicBookingConfig(signal?: AbortSignal): Promise<PublicBookingConfig> {
  const response = await fetch("/api/public/config", { signal, headers: { Accept: "application/json" } });
  return await readJson(response) as unknown as PublicBookingConfig;
}

export async function fetchPublicAvailability(options: {
  eventTypeId: string;
  date: string;
  duration?: number;
  tenantSlug?: string;
  signal?: AbortSignal;
}): Promise<PublicAvailability> {
  const query = new URLSearchParams({ eventTypeId: options.eventTypeId, date: options.date });
  if (Number.isFinite(options.duration) && (options.duration ?? 0) > 0) query.set("duration", String(options.duration));
  const prefix = options.tenantSlug ? `/api/tenant/${encodeURIComponent(options.tenantSlug)}` : "/api";
  const response = await fetch(`${prefix}/availability?${query.toString()}`, {
    signal: options.signal,
    headers: { Accept: "application/json" },
  });
  return await readJson(response) as unknown as PublicAvailability;
}

export async function patchPublicBooking(
  modifyToken: string,
  body: { action: "cancel" } | { date: string; time: string },
): Promise<Booking> {
  const response = await fetch(`/api/booking/${encodeURIComponent(modifyToken)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!payload.booking || typeof payload.booking !== "object") throw new Error("The booking server returned an invalid response");
  return payload.booking as unknown as Booking;
}

export async function submitPublicEnquiry(input: Omit<Enquiry, "id" | "status" | "createdAt">): Promise<Enquiry> {
  const response = await fetch("/api/enquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await readJson(response);
  if (!payload.enquiry || typeof payload.enquiry !== "object") throw new Error("The enquiry server returned an invalid response");
  return payload.enquiry as unknown as Enquiry;
}
