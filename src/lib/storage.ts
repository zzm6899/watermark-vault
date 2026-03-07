import type {
  EventType, Booking, Album, Photo, ProfileSettings,
  AppSettings, AdminCredentials, BankTransferSettings, WaitlistEntry, EmailTemplate, Invoice, Contact, Enquiry,
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

export function logout() {
  // Only clear local session — server session key is ignored on sync anyway
  localStorage.removeItem(KEYS.SESSION);
  // Also clear super admin + mobile tenant sessions
  try {
    sessionStorage.removeItem("wv_super_admin");
    localStorage.removeItem("wv_mobile_tenant");
  } catch {}
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
  } catch {}
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
  } catch {}
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
    bankTransfer: { ...defaultSettings.bankTransfer, ...stored.bankTransfer },
    invoiceFrom: { ...defaultSettings.invoiceFrom, ...(stored.invoiceFrom || {}) },
  };
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
