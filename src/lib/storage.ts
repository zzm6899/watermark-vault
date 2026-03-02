import type {
  EventType, Booking, Album, Photo, ProfileSettings,
  AppSettings, AdminCredentials, BankTransferSettings, EmailTemplate,
} from "./types";
import { persistToServer } from "./api";

const KEYS = {
  SETUP_COMPLETE: "wv_setup_complete",
  ADMIN: "wv_admin",
  PROFILE: "wv_profile",
  EVENT_TYPES: "wv_event_types",
  BOOKINGS: "wv_bookings",
  ALBUMS: "wv_albums",
  SETTINGS: "wv_settings",
  SESSION: "wv_session",
} as const;

// ── Helpers ─────────────────────────────────────────
function get<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);

    // Recovery path: handle accidentally double-encoded JSON strings
    if (typeof parsed === "string") {
      const t = parsed.trim();
      if ((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))) {
        try {
          return JSON.parse(parsed) as T;
        } catch {
          return parsed as T;
        }
      }
    }

    return parsed as T;
  } catch {
    return fallback;
  }
}

function set(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    persistToServer(key, value);
    return true;
  } catch (e) {
    console.error("localStorage save failed (quota?):", e);
    return false;
  }
}

// ── Setup ───────────────────────────────────────────
export function isSetupComplete(): boolean {
  return get(KEYS.SETUP_COMPLETE, false);
}

export function completeSetup() {
  set(KEYS.SETUP_COMPLETE, true);
}

// ── Admin Credentials ───────────────────────────────
export function getAdminCredentials(): AdminCredentials | null {
  return get<AdminCredentials | null>(KEYS.ADMIN, null);
}

export function setAdminCredentials(creds: AdminCredentials) {
  set(KEYS.ADMIN, creds);
}

// ── Session ─────────────────────────────────────────
export function isLoggedIn(): boolean {
  return get(KEYS.SESSION, false);
}

export function login() {
  set(KEYS.SESSION, true);
}

export function logout() {
  // Only clear local session — server session key is ignored on sync anyway
  localStorage.removeItem(KEYS.SESSION);
}

// ── Profile ─────────────────────────────────────────
const defaultProfile: ProfileSettings = {
  name: "Zac M Photos",
  bio: "Just your casual photographer",
  avatar: "",
  timezone: "Australia/Sydney",
};

export function getProfile(): ProfileSettings {
  return get(KEYS.PROFILE, defaultProfile);
}

export function setProfile(p: ProfileSettings) {
  set(KEYS.PROFILE, p);
}

// ── Event Types ─────────────────────────────────────
export function getEventTypes(): EventType[] {
  const raw = get<EventType[]>(KEYS.EVENT_TYPES, []);
  // Defensive: ensure every event type has valid questions array and availability
  return raw.map(et => ({
    ...et,
    questions: Array.isArray(et.questions) ? et.questions : [],
    availability: et.availability || { recurring: [], specificDates: [], blockedDates: [] },
    durations: Array.isArray(et.durations) ? et.durations : [30],
  }));
}

export function setEventTypes(ets: EventType[]) {
  set(KEYS.EVENT_TYPES, ets);
}

export function addEventType(et: EventType) {
  const list = getEventTypes();
  list.push(et);
  setEventTypes(list);
}

export function updateEventType(et: EventType) {
  setEventTypes(getEventTypes().map((e) => (e.id === et.id ? et : e)));
}

export function deleteEventType(id: string) {
  setEventTypes(getEventTypes().filter((e) => e.id !== id));
}

// ── Bookings ────────────────────────────────────────
export function getBookings(): Booking[] {
  return get<Booking[]>(KEYS.BOOKINGS, []);
}

export function setBookings(bks: Booking[]) {
  set(KEYS.BOOKINGS, bks);
}

export function addBooking(bk: Booking) {
  const list = getBookings();
  list.push(bk);
  setBookings(list);
}

export function deleteBooking(id: string) {
  setBookings(getBookings().filter((b) => b.id !== id));
}

export function updateBooking(bk: Booking) {
  setBookings(getBookings().map((b) => (b.id === bk.id ? bk : b)));
}

// Check if a time slot is already booked
export function isSlotBooked(date: string, time: string, duration: number, excludeBookingId?: string): boolean {
  const bookings = getBookings().filter(
    (b) => b.date === date && b.status !== "cancelled" && b.id !== excludeBookingId
  );
  const [h, m] = time.split(":").map(Number);
  const slotStart = h * 60 + m;
  const slotEnd = slotStart + duration;
  
  for (const bk of bookings) {
    const [bh, bm] = bk.time.split(":").map(Number);
    const bookingStart = bh * 60 + bm;
    const bookingEnd = bookingStart + bk.duration;
    if (slotStart < bookingEnd && slotEnd > bookingStart) return true;
  }
  return false;
}

// ── Albums ──────────────────────────────────────────
export function getAlbums(): Album[] {
  return get<Album[]>(KEYS.ALBUMS, []);
}

export function setAlbums(albs: Album[]) {
  set(KEYS.ALBUMS, albs);
}

export function addAlbum(alb: Album) {
  const list = getAlbums();
  list.push(alb);
  setAlbums(list);
}

export function updateAlbum(alb: Album) {
  setAlbums(getAlbums().map((a) => (a.id === alb.id ? alb : a)));
}

export function deleteAlbum(id: string) {
  setAlbums(getAlbums().filter((a) => a.id !== id));
}

export function getAlbumBySlug(slug: string): Album | undefined {
  return getAlbums().find((a) => a.slug === slug || a.id === slug);
}

// ── Settings ────────────────────────────────────────
const defaultSettings: AppSettings = {
  watermarkPosition: "center",
  watermarkText: "ZACMPHOTOS",
  watermarkImage: "",
  watermarkOpacity: 15,
  watermarkSize: 40,
  defaultFreeDownloads: 5,
  defaultPricePerPhoto: 12,
  defaultPriceFullAlbum: 299,
  bankTransfer: {
    enabled: false,
    accountName: "",
    bsb: "",
    accountNumber: "",
    payId: "",
    payIdType: "email",
    instructions: "Please include your booking reference in the transfer description.",
  } satisfies BankTransferSettings,
  stripeEnabled: false,
  bookingTimerMinutes: 15,
  instagramFieldEnabled: true,
  notificationEmailTemplate: "Hey {name}, your photos are ready! Check them out here: {link}",
  discordWebhookUrl: "",
};

export function getSettings(): AppSettings {
  const stored = get(KEYS.SETTINGS, defaultSettings);
  // Merge with defaults to handle new fields
  return { ...defaultSettings, ...stored, bankTransfer: { ...defaultSettings.bankTransfer, ...stored.bankTransfer } };
}

export function setSettings(s: AppSettings) {
  set(KEYS.SETTINGS, s);
}

// ── Password Hashing (simple SHA-256 with fallback) ─
export async function hashPassword(pw: string): Promise<string> {
  try {
    if (crypto?.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(pw);
      const hash = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // fallback below
  }
  // Simple fallback hash for non-secure contexts (e.g. HTTP Docker)
  let h = 0;
  for (let i = 0; i < pw.length; i++) {
    h = ((h << 5) - h + pw.charCodeAt(i)) | 0;
  }
  return "fb_" + Math.abs(h).toString(16).padStart(8, "0");
}

// ── Photo Library ──────────────────────────────────
export function getPhotoLibrary(): Photo[] {
  return get<Photo[]>("wv_photo_library", []);
}

export function setPhotoLibrary(photos: Photo[]) {
  set("wv_photo_library", photos);
}

// ── Email Templates ────────────────────────────────
export function getEmailTemplates(): EmailTemplate[] {
  return get<EmailTemplate[]>("wv_email_templates", []);
}

export function setEmailTemplates(templates: EmailTemplate[]) {
  set("wv_email_templates", templates);
}

export function addEmailTemplate(t: EmailTemplate) {
  const list = getEmailTemplates();
  list.push(t);
  setEmailTemplates(list);
}

export function updateEmailTemplate(t: EmailTemplate) {
  setEmailTemplates(getEmailTemplates().map(e => e.id === t.id ? t : e));
}

export function deleteEmailTemplate(id: string) {
  setEmailTemplates(getEmailTemplates().filter(e => e.id !== id));
}
