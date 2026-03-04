export type WatermarkPosition = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "tiled";
export type QuestionFieldType = "text" | "textarea" | "select" | "boolean" | "image-upload" | "instagram";
export type PaymentStatus = "unpaid" | "paid" | "cash" | "pending-confirmation";
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
  remindersSent?: Record<string, string>; // keyed by "24h" | "1h" → ISO sent timestamp
  gcalEventId?: string;
}

export interface Photo {
  id: string;
  src: string;
  thumbnail?: string; // small preview for fast loading
  title: string;
  width: number;
  height: number;
  selected?: boolean;
  hidden?: boolean; // hidden after proofing round — not shown to client
}

// ── Proofing ─────────────────────────────────────────────────
export type ProofingStage =
  | "not-started"        // no proofing initiated
  | "proofing"           // client is viewing and starring photos
  | "selections-submitted" // client clicked "Submit picks" — waiting for admin
  | "editing"            // admin acknowledged, now editing
  | "finals-delivered";  // admin delivered finals, album unlocked

export interface ProofingRound {
  roundNumber: number;
  sentAt: string;           // ISO — when admin sent proofing invite
  submittedAt?: string;     // ISO — when client submitted picks
  selectedPhotoIds: string[]; // photo IDs client starred/picked
  adminNote?: string;       // message from admin shown on gallery (e.g. "Please pick your top 30")
  clientNote?: string;      // optional message from client when submitting
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
}

export interface DownloadHistoryEntry {
  photoIds: string[];
  downloadedAt: string;
  quality: DownloadQuality;
  sessionKey: string;
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
  downloadExpiresAt?: string; // ISO date — after this date allUnlocked is treated as false
  paidPhotoIds?: string[]; // individual photo purchases via Stripe or admin approval
  stripePaidAt?: string;
  usedFreeDownloads?: Record<string, number>; // keyed by accessCode or session
  downloadRequests?: AlbumDownloadRecord[];
  downloadHistory?: DownloadHistoryEntry[];
  displaySize?: AlbumDisplaySize;
  // ── Proofing ──────────────────────────────────────────────
  proofingEnabled?: boolean;  // per-album opt-in (only works when global proofingEnabled is on)
  proofingStage?: ProofingStage;  // undefined = not-started
  proofingRounds?: ProofingRound[];
  // ── Client access ─────────────────────────────────────────
  clientToken?: string;  // magic-link token — grants access without PIN, identifies client session
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
  proofingEnabled: boolean; // global toggle — shows proofing controls on albums
}

export interface AdminCredentials {
  username: string;
  passwordHash: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
}

// ── Waitlist ──────────────────────────────────────────────────
export interface WaitlistEntry {
  id: string;
  eventTypeId: string;
  eventTypeTitle: string;
  date: string;         // YYYY-MM-DD — the specific date they wanted
  clientName: string;
  clientEmail: string;
  note?: string;
  createdAt: string;
  notifiedAt?: string;  // ISO — when we sent the "slot opened" email
}
