export type WatermarkPosition = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "tiled";
export type QuestionFieldType = "text" | "textarea" | "select" | "boolean" | "image-upload" | "instagram";
export type PaymentStatus = "unpaid" | "paid" | "cash" | "pending-confirmation" | "deposit-paid";
export type DownloadQuality = "2mb" | "5mb" | "original";

export interface QuestionField {
  id: string;
  label: string;
  type: QuestionFieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface AvailabilitySlot {
  day: number; // 0=Sun, 6=Sat
  startTime: string; // "09:00"
  endTime: string; // "17:00"
}

export interface SpecificDateSlot {
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
}

export interface EventTypeAvailability {
  recurring: AvailabilitySlot[];
  specificDates: SpecificDateSlot[];
  blockedDates: string[]; // YYYY-MM-DD
}

export interface EventType {
  id: string;
  title: string;
  description: string;
  durations: number[];
  color: string;
  price: number;
  active: boolean;
  requiresConfirmation?: boolean;
  questions: QuestionField[];
  availability: EventTypeAvailability;
  location?: string;
  depositEnabled?: boolean;
  depositAmount?: number; // fixed amount, or percentage if depositType is "percentage"
  depositType?: "fixed" | "percentage";
  depositMethods?: ("stripe" | "bank")[]; // which payment methods to offer
  prices?: Record<string, number>;
}

export interface Booking {
  id: string;
  clientName: string;
  clientEmail: string;
  date: string;
  time: string;
  eventTypeId: string;
  type: string;
  duration: number;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  notes: string;
  albumId?: string;
  answers?: Record<string, string>;
  createdAt: string;
  paymentStatus?: PaymentStatus;
  paymentAmount?: number;
  instagramHandle?: string;
  modifyToken?: string;
  depositRequired?: boolean;
  depositAmount?: number;
  depositMethod?: "stripe" | "bank";
  depositPaidAt?: string;
  stripeSessionId?: string;
  gcalEventId?: string;
  answerLabels?: Record<string, string>;
  emailLog?: any[];
  tenantSlug?: string;   // set when booking is made via a tenant's public page
}

export interface Photo {
  id: string;
  src: string;
  thumbnail?: string; // small preview for fast loading
  title: string;
  width: number;
  height: number;
  selected?: boolean;
  starred?: boolean;
  hidden?: boolean;
  uploadedAt?: string;  // ISO timestamp — set on upload, used for time sort
  takenAt?: string;     // ISO timestamp from EXIF if available
  proofing?: boolean;
}

export type AlbumDisplaySize = "small" | "medium" | "large" | "list";

export interface AlbumDownloadRecord {
  photoIds: string[];
  method: "free" | "stripe" | "bank-transfer";
  status: "pending" | "approved" | "completed";
  requestedAt: string;
  approvedAt?: string;
  clientNote?: string;
  albumTitle?: string;
  albumId?: string;
  purchaserEmail?: string;
}

export interface DownloadHistoryEntry {
  photoIds: string[];
  downloadedAt: string;
  quality: DownloadQuality;
  sessionKey: string;
  email?: string;
  photoCount?: number;
}

export interface Album {
  id: string;
  slug: string;
  title: string;
  description: string;
  coverImage: string;
  date: string;
  photoCount: number;
  freeDownloads: number;
  pricePerPhoto: number;
  priceFullAlbum: number;
  isPublic: boolean;
  enabled?: boolean; // false = hidden from public gallery listing
  photos: Photo[];
  clientName?: string;
  clientEmail?: string;
  bookingId?: string;
  accessCode?: string;
  mergedFrom?: string[];
  allUnlocked?: boolean;
  paidPhotoIds?: string[]; // individual photo purchases via Stripe or admin approval
  stripePaidAt?: string;
  usedFreeDownloads?: Record<string, number>; // keyed by accessCode or session
  downloadRequests?: AlbumDownloadRecord[];
  downloadHistory?: DownloadHistoryEntry[];
  displaySize?: AlbumDisplaySize;
  proofingEnabled?: boolean;
  proofingStage?: string;
  proofingRounds?: ProofingRound[];
  clientToken?: string;
  /** ISO timestamp of when the proofing window closes. Set automatically when startProofing runs. */
  proofingExpiresAt?: string;
  /** Per-album override for how long the proofing window stays open (hours). Falls back to settings.defaultProofingExpiryHours. */
  proofingExpiryHours?: number;
  expiresAt?: string;         // YYYY-MM-DD — gallery access blocked after this date
  downloadExpiresAt?: string;
  watermarkDisabled?: boolean;
  purchasingDisabled?: boolean;
  sessionPurchases?: Record<string, { fullAlbum?: boolean; photoIds?: string[] }>;
}

export interface BankTransferSettings {
  enabled: boolean;
  accountName: string;
  bsb: string;
  accountNumber: string;
  payId: string;
  payIdType: "email" | "phone" | "abn";
  instructions: string;
}

export interface ProfileSettings {
  name: string;
  bio: string;
  avatar: string;
  timezone: string;
}

export interface AppSettings {
  watermarkPosition: WatermarkPosition;
  watermarkText: string;
  watermarkImage: string;
  watermarkOpacity: number; // 0-100
  defaultFreeDownloads: number;
  defaultPricePerPhoto: number;
  defaultPriceFullAlbum: number;
  bankTransfer: BankTransferSettings;
  stripeEnabled: boolean;
  bookingTimerMinutes: number;
  instagramFieldEnabled: boolean;
  notificationEmailTemplate: string;
  discordWebhookUrl: string;
  discordNotifyBookings: boolean;
  discordNotifyDownloads: boolean;
  discordNotifyProofing: boolean;
  discordNotifyInvoices: boolean;
  watermarkSize: number;
  proofingEnabled: boolean;
  /** Default number of hours a proofing window stays open after being started. Default: 48. */
  defaultProofingExpiryHours?: number;
  invoiceFrom?: InvoiceParty;
  invoiceNotes?: string;
  enquiryEnabled?: boolean;
  enquiryLabel?: string;
}

export interface ProofingRound {
  roundNumber: number;
  sentAt: string;
  selectedPhotoIds: string[];
  adminNote?: string;
  clientNote?: string;
  submittedAt?: string;
}

export interface WaitlistEntry {
  id: string;
  eventTypeId: string;
  eventTypeTitle: string;
  date: string;
  clientName: string;
  clientEmail: string;
  note?: string;
  createdAt: string;
  notifiedAt?: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdAt?: string;
}

export interface AdminCredentials {
  username: string;
  passwordHash: string;
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export interface InvoiceParty {
  name: string;
  email: string;
  address: string;
  abn?: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

export interface InvoiceEmailLogEntry {
  sentAt: string;
  type: "invoice" | "reminder" | "custom";
  to: string;
  subject?: string;
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  email: string;
  address: string;
  abn?: string;
  phone?: string;
  company?: string;
  notes?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  number: string;           // e.g. "INV-0001"
  status: InvoiceStatus;
  from: InvoiceParty;
  to: InvoiceParty;
  items: InvoiceItem[];
  notes: string;
  dueDate: string;          // YYYY-MM-DD
  createdAt: string;
  sentAt?: string;
  paidAt?: string;
  shareToken: string;       // random token for public share link
  emailLog: InvoiceEmailLogEntry[];
  bookingId?: string;       // optional link to a booking
  albumId?: string;         // optional link to an album
  tax?: number;             // tax rate percent (e.g. 10 for 10% GST)
  discount?: number;        // discount amount in dollars
  paymentMethods?: ("stripe" | "bank")[];  // which payment methods are available for this invoice
  stripeSessionId?: string; // Stripe checkout session ID once created
}

// ─── License Keys ─────────────────────────────────────────────────────────────

export interface LicenseKey {
  key: string;             // e.g. "WV-XXXX-XXXX-XXXX-XXXX"
  issuedTo: string;        // name or email of the recipient
  createdAt: string;       // ISO timestamp
  expiresAt?: string;      // ISO timestamp, undefined = never expires
  usedAt?: string;         // ISO timestamp, set when activated
  usedBy?: string;         // username of the admin who activated it
  notes?: string;
  /** If true this is a free-trial key with usage limits */
  isTrial?: boolean;
  /** Max number of event-type slots allowed under a trial key (default 1) */
  trialMaxEvents?: number;
  /** Max number of bookings allowed under a trial key (default 10) */
  trialMaxBookings?: number;
  /** Secure random token used to generate a one-time tenant setup URL */
  setupToken?: string;
}

// ─── Tenants ──────────────────────────────────────────────────────────────────

/**
 * A tenant is a photographer/user who shares a single Watermark Vault deployment.
 * Each tenant gets a public booking page at /book/:slug and their data is
 * namespaced (tenant bookings are tagged with tenantSlug in wv_bookings;
 * tenant-specific event types are stored in t_{slug}_wv_event_types).
 */
export interface Tenant {
  slug: string;          // URL-safe handle, e.g. "johndoe" → /book/johndoe
  displayName: string;   // shown on their public booking page
  email: string;         // contact email
  bio?: string;          // short bio for booking page
  timezone?: string;     // IANA timezone, e.g. "Australia/Sydney"
  licenseKey?: string;   // optional link to a license key
  passwordHash?: string; // SHA-256 hash of tenant's password (for mobile login)
  active: boolean;
  createdAt: string;     // ISO timestamp
}

// ─── Tenant Settings ─────────────────────────────────────────────────────────

/**
 * Per-tenant overrides for integrations. When set these take precedence over
 * the global environment-variable / AppSettings values for that tenant's data.
 */
export interface TenantSettings {
  // ── Stripe ────────────────────────────────────────────────
  stripeEnabled?: boolean;
  stripePublishableKey?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  /** ISO 4217 currency code for Stripe checkout, e.g. "aud", "usd", "gbp". Defaults to "aud". */
  stripeCurrency?: string;
  // ── Bank Transfer ─────────────────────────────────────────
  bankTransferEnabled?: boolean;
  bankAccountName?: string;
  bankBsb?: string;
  bankAccountNumber?: string;
  bankPayId?: string;
  bankPayIdType?: "email" | "phone" | "abn";
  bankInstructions?: string;
  // ── Discord ───────────────────────────────────────────────
  discordWebhookUrl?: string;
  discordNotifyBookings?: boolean;
  discordNotifyDownloads?: boolean;
  discordNotifyProofing?: boolean;
  discordNotifyInvoices?: boolean;
  // ── SMTP ──────────────────────────────────────────────────
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  smtpFrom?: string;
  // ── Watermark ─────────────────────────────────────────────
  /** Watermark text when no image is set. */
  watermarkText?: string;
  /** Base64 data URL of watermark image (overrides text when set). */
  watermarkImage?: string;
  /** Watermark position. Defaults to "tiled". */
  watermarkPosition?: WatermarkPosition;
  /** Opacity 0–100. Defaults to 20. */
  watermarkOpacity?: number;
  /** Size percentage 10–100. Defaults to 40. */
  watermarkSize?: number;
  // ── Google Calendar ───────────────────────────────────────
  /**
   * Google OAuth2 credentials JSON pasted from Google Cloud Console.
   * Shape: { web: { client_id, client_secret, redirect_uris } }
   */
  googleApiCredentials?: string;
  /** Target calendar ID for syncing bookings (defaults to "primary"). */
  googleCalendarId?: string;
  /** Auto-sync new bookings to Google Calendar. */
  googleCalendarAutoSync?: boolean;
}



export type LicensePlanType = "monthly" | "yearly" | "one-time";

export interface LicensePlan {
  id: string;
  name: string;               // e.g. "Starter", "Pro"
  type: LicensePlanType;
  price: number;              // in the plan's currency, e.g. 29.00
  currency: string;           // e.g. "AUD"
  durationDays?: number;      // for "one-time" plans, e.g. 365
  description?: string;
  features: string[];
  active: boolean;
  createdAt: string;
}

export interface LicensePurchase {
  id: string;
  planId: string;
  planName: string;
  buyerEmail: string;
  buyerName: string;
  amount: number;
  currency: string;
  method: "stripe" | "bank";
  status: "pending" | "active" | "expired" | "cancelled";
  licenseKey?: string;        // generated after payment is confirmed
  stripeSessionId?: string;
  createdAt: string;
  activatedAt?: string;
  expiresAt?: string;
}

// ─── Enquiries ────────────────────────────────────────────────────────────────

export type EnquiryStatus = "pending" | "accepted" | "declined";

export interface Enquiry {
  id: string;
  name: string;
  email: string;
  phone?: string;
  eventTypeId?: string;
  eventTypeTitle?: string;
  preferredDate?: string;       // YYYY-MM-DD
  preferredStartTime?: string;  // "HH:MM"
  preferredEndTime?: string;    // "HH:MM"
  message: string;
  status: EnquiryStatus;
  createdAt: string;
  respondedAt?: string;
  adminNote?: string;
  bookingId?: string;           // set when accepted → booking created
}
