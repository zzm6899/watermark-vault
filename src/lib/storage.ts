import type {
  EventType, Booking, Album, ProfileSettings,
  AppSettings, AdminCredentials, BankTransferSettings,
} from "./types";

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
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function set(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
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
  return get<EventType[]>(KEYS.EVENT_TYPES, []);
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

// ── Albums ──────────────────────────────────────────
export function getAlbums(): Album[] {
  return get<Album[]>(KEYS.ALBUMS, []);
}

export function setAlbums(albs: Album[]) {
  set(KEYS.ALBUMS, albs);
}

// ── Settings ────────────────────────────────────────
const defaultSettings: AppSettings = {
  watermarkPosition: "center",
  watermarkText: "ZACMPHOTOS",
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
};

export function getSettings(): AppSettings {
  return get(KEYS.SETTINGS, defaultSettings);
}

export function setSettings(s: AppSettings) {
  set(KEYS.SETTINGS, s);
}

// ── Password Hashing (simple SHA-256) ───────────────
export async function hashPassword(pw: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pw);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
