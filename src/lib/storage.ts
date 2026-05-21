import type {
  EventType, Booking, Album, Photo, ProfileSettings,
  AppSettings, AdminCredentials, BankTransferSettings, WaitlistEntry, EmailTemplate, Invoice, Contact, Enquiry,
} from "./types";
import { persistToServer, persistAlbumToServer, deleteAlbumFromServer } from "./api";

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

/**
 * Store the sha256 password hash in localStorage after a successful admin login.
 * This is used by adminAuthHeaders() in api.ts to construct the Basic Auth header
 * for protected endpoints. localStorage is used so the hash survives page refreshes —
 * the admin is already logged in (SESSION key is set), so persisting the hash is safe.
 * It is cleared on logout along with the session.
 */
export function setAdminSessionHash(hash: string) {
  try { localStorage.setItem("wv_admin_session_hash", hash); } catch { /* noop */ }
}

export function getAdminSessionHash(): string | null {
  try { return localStorage.getItem("wv_admin_session_hash"); } catch { return null; }
}

export function logout() {
  // Only clear local session — server session key is ignored on sync anyway
  localStorage.removeItem(KEYS.SESSION);
  localStorage.removeItem("wv_admin_session_hash");
  // Also clear super admin + mobile tenant sessions
  try {
    sessionStorage.removeItem("wv_super_admin");
    localStorage.removeItem("wv_mobile_tenant");
  } catch { /* session storage may be unavailable */ }
}

// ── Super Admin Session ──────────────────────────────
// Stored in sessionStorage so it is cleared when the browser tab/window closes.
export function isSuperAdmin(): boolean {
  try { return sessionStorage.getItem("wv_super_admin") === "1"; } catch { return false; }
}

export function setSuperAdmin(value: boolean) {
  try {
    if (value) sessionStorage.setItem("wv_super_admin", "1");
    else sessionStorage.removeItem("wv_super_admin");
  } catch { /* session storage may be unavailable */ }
}

// ── Mobile Tenant Session ────────────────────────────
export interface MobileTenantSession {
  slug: string;
  displayName: string;
  email: string;
  timezone?: string;
  loggedAt: string;
}

export function getMobileTenantSession(): MobileTenantSession | null {
  try {
    const raw = localStorage.getItem("wv_mobile_tenant");
    if (!raw) return null;
    const session: MobileTenantSession = JSON.parse(raw);
    // Expire after 30 days
    if (Date.now() - new Date(session.loggedAt).getTime() > 30 * 86400 * 1000) {
      localStorage.removeItem("wv_mobile_tenant");
      return null;
    }
    return session;
  } catch { return null; }
}

export function setMobileTenantSession(session: MobileTenantSession | null) {
  try {
    if (session) localStorage.setItem("wv_mobile_tenant", JSON.stringify(session));
    else localStorage.removeItem("wv_mobile_tenant");
  } catch { /* localStorage may be unavailable */ }
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

/**
 * Checks whether an identical booking has already been submitted in the last
 * 2 minutes by the same client for the same event, date, and time.
 * Used to guard against accidental double-submissions (e.g. double-click or
 * browser back + resubmit).
 *
 * @returns true if a likely-duplicate booking exists, false otherwise.
 */
export function isDuplicateBooking(bk: {
  clientEmail: string;
  date: string;
  time: string;
  eventTypeId: string;
}): boolean {
  const TWO_MINUTES_MS = 2 * 60 * 1000;
  const now = Date.now();
  return getBookings().some(existing =>
    existing.clientEmail?.toLowerCase() === bk.clientEmail?.toLowerCase() &&
    existing.date === bk.date &&
    existing.time === bk.time &&
    existing.eventTypeId === bk.eventTypeId &&
    existing.status !== "cancelled" &&
    now - new Date(existing.createdAt).getTime() < TWO_MINUTES_MS
  );
}

export function deleteBooking(id: string) {
  setBookings(getBookings().filter((b) => b.id !== id));
}

export function updateBooking(bk: Booking) {
  setBookings(getBookings().map((b) => (b.id === bk.id ? bk : b)));
}

// Check if a time slot is already booked
export function isSlotBooked(date: string, time: string, duration: number, excludeBookingId?: string): boolean {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return false;
  const bookings = getBookings().filter(
    (b) => b.date === date && b.status !== "cancelled" && b.id !== excludeBookingId
  );
  const [h, m] = time.split(":").map(Number);
  const slotStart = h * 60 + m;
  const slotEnd = slotStart + duration;
  
  for (const bk of bookings) {
    if (!bk.time || !/^\d{2}:\d{2}$/.test(bk.time)) continue; // skip malformed booking times
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
  // Write the full list to localStorage so subsequent getAlbums() reads are consistent.
  // Persist only the new album to the server via the per-album endpoint to avoid
  // overwriting other albums' photos with stale stub (empty) data.
  try { localStorage.setItem(KEYS.ALBUMS, JSON.stringify(list)); } catch (e) {
    console.error("localStorage save failed:", e);
  }
  persistAlbumToServer(alb.id, alb);
}

export function updateAlbum(alb: Album) {
  // Update localStorage with the full array (read-modify-write).
  // If the album doesn't exist yet, add it to the list.
  const existing = getAlbums();
  const found = existing.some(a => a.id === alb.id);
  const all = found ? existing.map((a) => (a.id === alb.id ? alb : a)) : [...existing, alb];
  try { localStorage.setItem(KEYS.ALBUMS, JSON.stringify(all)); } catch (e) {
    console.error("localStorage save failed:", e);
  }
  // Persist only this album to the server via the per-album endpoint.
  // This avoids the full-array write that would overwrite other albums'
  // photos with stale stub (empty) data when those albums haven't been
  // loaded into localStorage yet.
  persistAlbumToServer(alb.id, alb);
}

export function deleteAlbum(id: string) {
  // Write the filtered list to localStorage so subsequent getAlbums() reads are consistent.
  // Use the per-album DELETE endpoint so other albums' photos are never clobbered by a
  // full-array write that contains stale stub data for albums not yet fully loaded.
  const filtered = getAlbums().filter((a) => a.id !== id);
  try { localStorage.setItem(KEYS.ALBUMS, JSON.stringify(filtered)); } catch (e) {
    console.error("localStorage save failed:", e);
  }
  deleteAlbumFromServer(id);
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
  discordNotifyBookings: true,
  discordNotifyDownloads: true,
  discordNotifyProofing: true,
  discordNotifyInvoices: true,
  proofingEnabled: false,
  defaultProofingExpiryHours: 48,
  invoiceFrom: { name: "", email: "", address: "", abn: "" },
  invoiceNotes: "",
  enquiryEnabled: false,
  enquiryLabel: "Make an Enquiry",
};

export function getSettings(): AppSettings {
  const stored = get(KEYS.SETTINGS, defaultSettings);
  // Merge with defaults to handle new fields
  return {
    ...defaultSettings,
    ...stored,
    bankTransfer: { ...defaultSettings.bankTransfer, ...(stored.bankTransfer || {}) },
    invoiceFrom: { ...defaultSettings.invoiceFrom, ...(stored.invoiceFrom || {}) },
  };
}

export function setSettings(s: AppSettings) {
  set(KEYS.SETTINGS, s);
}

function sha256Fallback(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h).map(n => n.toString(16).padStart(8, "0")).join("");
}

// ── Password Hashing (SHA-256) ─
export async function hashPassword(pw: string): Promise<string> {
  try {
    if (globalThis.crypto?.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(pw);
      const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // fallback below
  }
  return sha256Fallback(pw);
}

// ── Photo Library ──────────────────────────────────
export function getPhotoLibrary(): Photo[] {
  return get<Photo[]>("wv_photo_library", []);
}

export function setPhotoLibrary(photos: Photo[]) {
  set("wv_photo_library", photos);
}

// ── Email Templates ─────────────────────────────────
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

// ── Waitlist ────────────────────────────────────────
export function getWaitlist(): WaitlistEntry[] {
  return get<WaitlistEntry[]>("wv_waitlist", []);
}

export function setWaitlist(entries: WaitlistEntry[]) {
  set("wv_waitlist", entries);
}

export function addWaitlistEntry(entry: WaitlistEntry) {
  const list = getWaitlist();
  list.push(entry);
  setWaitlist(list);
}

export function removeWaitlistEntry(id: string) {
  setWaitlist(getWaitlist().filter(e => e.id !== id));
}

export function clearWaitlistForEventDate(eventTypeId: string, date: string) {
  setWaitlist(getWaitlist().filter(e => !(e.eventTypeId === eventTypeId && e.date === date)));
}

// ── Invoices ────────────────────────────────────────
export function getInvoices(): Invoice[] {
  return get<Invoice[]>("wv_invoices", []);
}

export function setInvoices(invoices: Invoice[]) {
  set("wv_invoices", invoices);
}

export function addInvoice(invoice: Invoice) {
  const list = getInvoices();
  list.push(invoice);
  setInvoices(list);
}

export function updateInvoice(invoice: Invoice) {
  setInvoices(getInvoices().map(i => (i.id === invoice.id ? invoice : i)));
}

export function deleteInvoice(id: string) {
  setInvoices(getInvoices().filter(i => i.id !== id));
}

export function getNextInvoiceNumber(): string {
  const invoices = getInvoices();
  const nums = invoices
    .map(inv => parseInt(inv.number.replace(/\D/g, ""), 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `INV-${String(next).padStart(4, "0")}`;
}

// ── Contacts ────────────────────────────────────────
export function getContacts(): Contact[] {
  return get<Contact[]>("wv_contacts", []);
}

export function setContacts(contacts: Contact[]) {
  set("wv_contacts", contacts);
}

export function addContact(contact: Contact) {
  const list = getContacts();
  list.push(contact);
  setContacts(list);
}

export function updateContact(contact: Contact) {
  setContacts(getContacts().map(c => (c.id === contact.id ? contact : c)));
}

export function deleteContact(id: string) {
  setContacts(getContacts().filter(c => c.id !== id));
}

// ── Enquiries ────────────────────────────────────────
export function getEnquiries(): Enquiry[] {
  return get<Enquiry[]>("wv_enquiries", []);
}

export function setEnquiries(enquiries: Enquiry[]) {
  set("wv_enquiries", enquiries);
}

export function addEnquiry(enquiry: Enquiry) {
  const list = getEnquiries();
  list.push(enquiry);
  setEnquiries(list);
}

export function updateEnquiry(enquiry: Enquiry) {
  setEnquiries(getEnquiries().map(e => (e.id === enquiry.id ? enquiry : e)));
}

export function deleteEnquiry(id: string) {
  setEnquiries(getEnquiries().filter(e => e.id !== id));
}
