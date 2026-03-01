import sampleWedding from "@/assets/sample-wedding.jpg";
import samplePortrait from "@/assets/sample-portrait.jpg";
import sampleLandscape from "@/assets/sample-landscape.jpg";
import sampleEvent from "@/assets/sample-event.jpg";
import sampleFood from "@/assets/sample-food.jpg";

export type WatermarkPosition = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "tiled";

export interface Photo {
  id: string;
  src: string;
  title: string;
  width: number;
  height: number;
  selected?: boolean;
}

export interface Album {
  id: string;
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
  bookingId?: string;
  accessCode?: string;
}

export type QuestionFieldType = "text" | "textarea" | "select" | "boolean" | "image-upload";

export interface QuestionField {
  id: string;
  label: string;
  type: QuestionFieldType;
  required: boolean;
  placeholder?: string;
  options?: string[]; // for select type
}

export interface EventType {
  id: string;
  title: string;
  description: string;
  durations: number[]; // multiple duration options in minutes
  color: string;
  price: number;
  active: boolean;
  requiresConfirmation?: boolean;
  questions: QuestionField[];
}

export interface AvailabilitySlot {
  day: number; // 0=Sun, 6=Sat
  startTime: string; // "09:00"
  endTime: string; // "17:00"
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
}

export const samplePhotos: Photo[] = [
  { id: "1", src: sampleWedding, title: "Golden Hour", width: 800, height: 1024 },
  { id: "2", src: samplePortrait, title: "Studio Light", width: 800, height: 1024 },
  { id: "3", src: sampleLandscape, title: "Mountain Sunset", width: 1024, height: 768 },
  { id: "4", src: sampleEvent, title: "Gala Evening", width: 1024, height: 768 },
  { id: "5", src: sampleFood, title: "Culinary Art", width: 800, height: 800 },
  { id: "6", src: sampleWedding, title: "First Dance", width: 800, height: 1024 },
  { id: "7", src: samplePortrait, title: "Natural Beauty", width: 800, height: 1024 },
  { id: "8", src: sampleLandscape, title: "Dawn Break", width: 1024, height: 768 },
  { id: "9", src: sampleEvent, title: "Celebration", width: 1024, height: 768 },
  { id: "10", src: sampleFood, title: "Plated Perfection", width: 800, height: 800 },
  { id: "11", src: sampleWedding, title: "Vow Exchange", width: 800, height: 1024 },
  { id: "12", src: samplePortrait, title: "Editorial", width: 800, height: 1024 },
];

export const sampleEventTypes: EventType[] = [
  {
    id: "et-1",
    title: "Animaga",
    description: "Cosplay Photoshoot in the heart of Sydney! There's NO PHOTO LIMIT – while I value quality over quantity, how you make the most of this session is entirely up to you!",
    durations: [25, 40],
    color: "primary",
    price: 75,
    active: true,
    requiresConfirmation: true,
    questions: [
      { id: "q1", label: "Name", type: "text", required: true, placeholder: "Your full name" },
      { id: "q2", label: "Email", type: "text", required: true, placeholder: "you@example.com" },
      { id: "q3", label: "Instagram Username", type: "text", required: false, placeholder: "@yourusername" },
      { id: "q4", label: "What character(s) will you be cosplaying?", type: "textarea", required: true, placeholder: "Describe your cosplay..." },
      { id: "q5", label: "Do you have reference images?", type: "boolean", required: true },
      { id: "q6", label: "Reference Images", type: "image-upload", required: false },
      { id: "q7", label: "Experience Level", type: "select", required: false, options: ["First time", "Some experience", "Experienced", "Professional"] },
      { id: "q8", label: "Additional Notes", type: "textarea", required: false, placeholder: "Anything else you'd like us to know..." },
    ],
  },
  {
    id: "et-2",
    title: "Portrait Session",
    description: "Full portrait session with outfit changes and multiple locations.",
    durations: [30, 60],
    color: "primary",
    price: 200,
    active: true,
    questions: [
      { id: "q1", label: "Name", type: "text", required: true, placeholder: "Your full name" },
      { id: "q2", label: "Email", type: "text", required: true, placeholder: "you@example.com" },
      { id: "q3", label: "Instagram Username", type: "text", required: false, placeholder: "@yourusername" },
      { id: "q4", label: "What style are you looking for?", type: "select", required: true, options: ["Natural / Candid", "Editorial", "Studio", "Outdoor"] },
      { id: "q5", label: "Additional Notes", type: "textarea", required: false, placeholder: "Tell us about your vision..." },
    ],
  },
  {
    id: "et-3",
    title: "Event Coverage",
    description: "Corporate events, parties, and gatherings. Full event documentation.",
    durations: [120, 240],
    color: "primary",
    price: 500,
    active: true,
    questions: [
      { id: "q1", label: "Name", type: "text", required: true, placeholder: "Your full name" },
      { id: "q2", label: "Email", type: "text", required: true, placeholder: "you@example.com" },
      { id: "q3", label: "Event Type", type: "select", required: true, options: ["Corporate", "Birthday", "Wedding", "Other"] },
      { id: "q4", label: "Expected Number of Guests", type: "text", required: false, placeholder: "e.g. 50-100" },
      { id: "q5", label: "Venue Details", type: "textarea", required: true, placeholder: "Address and any access details..." },
    ],
  },
  {
    id: "et-4",
    title: "Secret Meeting",
    description: "",
    durations: [15],
    color: "primary",
    price: 0,
    active: true,
    questions: [
      { id: "q1", label: "Name", type: "text", required: true, placeholder: "Your full name" },
      { id: "q2", label: "Email", type: "text", required: true, placeholder: "you@example.com" },
    ],
  },
];

export const defaultAvailability: AvailabilitySlot[] = [
  { day: 1, startTime: "09:00", endTime: "17:00" },
  { day: 2, startTime: "09:00", endTime: "17:00" },
  { day: 3, startTime: "09:00", endTime: "17:00" },
  { day: 4, startTime: "09:00", endTime: "17:00" },
  { day: 5, startTime: "09:00", endTime: "17:00" },
  { day: 6, startTime: "10:00", endTime: "14:00" },
];

export const defaultBankTransfer: BankTransferSettings = {
  enabled: false,
  accountName: "",
  bsb: "",
  accountNumber: "",
  payId: "",
  payIdType: "email",
  instructions: "Please include your booking reference in the transfer description.",
};

export const sampleAlbums: Album[] = [
  {
    id: "wedding-emma-james",
    title: "Emma & James",
    description: "A beautiful autumn wedding at the estate gardens",
    coverImage: sampleWedding,
    date: "2025-10-15",
    photoCount: 248,
    freeDownloads: 5,
    pricePerPhoto: 12,
    priceFullAlbum: 299,
    isPublic: false,
    clientName: "Emma Thompson",
    bookingId: "bk-1",
    accessCode: "emma2025",
    photos: samplePhotos,
  },
  {
    id: "portrait-session-sarah",
    title: "Sarah — Editorial",
    description: "Studio portrait session with natural light",
    coverImage: samplePortrait,
    date: "2025-11-02",
    photoCount: 64,
    freeDownloads: 3,
    pricePerPhoto: 15,
    priceFullAlbum: 149,
    isPublic: false,
    clientName: "Sarah Mitchell",
    bookingId: "bk-2",
    accessCode: "sarah2025",
    photos: samplePhotos.slice(0, 8),
  },
  {
    id: "landscape-series",
    title: "Horizons",
    description: "Mountain landscape series — Pacific Northwest",
    coverImage: sampleLandscape,
    date: "2025-09-20",
    photoCount: 42,
    freeDownloads: 2,
    pricePerPhoto: 20,
    priceFullAlbum: 199,
    isPublic: false,
    accessCode: "horizons2025",
    photos: samplePhotos.slice(2, 10),
  },
  {
    id: "corporate-gala",
    title: "Annual Gala 2025",
    description: "Corporate event photography",
    coverImage: sampleEvent,
    date: "2025-12-01",
    photoCount: 186,
    freeDownloads: 10,
    pricePerPhoto: 8,
    priceFullAlbum: 249,
    isPublic: false,
    clientName: "TechCorp Inc.",
    bookingId: "bk-3",
    accessCode: "gala2025",
    photos: samplePhotos,
  },
];

export const sampleBookings: Booking[] = [
  {
    id: "bk-1",
    clientName: "Emma Thompson",
    clientEmail: "emma@example.com",
    date: "2025-10-15",
    time: "14:00",
    eventTypeId: "et-4",
    type: "Wedding Package",
    duration: 480,
    status: "completed",
    notes: "Estate gardens, 248 photos delivered",
    albumId: "wedding-emma-james",
  },
  {
    id: "bk-2",
    clientName: "Sarah Mitchell",
    clientEmail: "sarah@example.com",
    date: "2025-11-02",
    time: "10:00",
    eventTypeId: "et-2",
    type: "Portrait Session",
    duration: 60,
    status: "completed",
    notes: "Studio session, editorial style",
    albumId: "portrait-session-sarah",
  },
  {
    id: "bk-3",
    clientName: "TechCorp Inc.",
    clientEmail: "events@techcorp.com",
    date: "2025-12-01",
    time: "18:00",
    eventTypeId: "et-3",
    type: "Event Coverage",
    duration: 240,
    status: "completed",
    notes: "Annual gala, full coverage",
    albumId: "corporate-gala",
  },
  {
    id: "bk-4",
    clientName: "Lisa Chen",
    clientEmail: "lisa@example.com",
    date: "2026-03-15",
    time: "09:00",
    eventTypeId: "et-3",
    type: "Event Coverage",
    duration: 120,
    status: "confirmed",
    notes: "Beach ceremony, engagement + wedding",
  },
  {
    id: "bk-5",
    clientName: "Mark Davis",
    clientEmail: "mark@example.com",
    date: "2026-03-22",
    time: "15:00",
    eventTypeId: "et-2",
    type: "Portrait Session",
    duration: 30,
    status: "pending",
    notes: "Family portrait session",
  },
];
