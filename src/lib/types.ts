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
}

export interface Photo {
  id: string;
  src: string;
  thumbnail?: string; // small preview for fast loading
  title: string;
  width: number;
  height: number;
  selected?: boolean;
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
  photos: Photo[];
  clientName?: string;
  clientEmail?: string;
  bookingId?: string;
  accessCode?: string;
  mergedFrom?: string[];
  allUnlocked?: boolean;
  usedFreeDownloads?: Record<string, number>; // keyed by accessCode or session
  downloadRequests?: AlbumDownloadRecord[];
  downloadHistory?: DownloadHistoryEntry[];
  displaySize?: AlbumDisplaySize;
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
}

export interface AdminCredentials {
  username: string;
  passwordHash: string;
}
