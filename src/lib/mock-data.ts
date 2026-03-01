import sampleWedding from "@/assets/sample-wedding.jpg";
import samplePortrait from "@/assets/sample-portrait.jpg";
import sampleLandscape from "@/assets/sample-landscape.jpg";
import sampleEvent from "@/assets/sample-event.jpg";
import sampleFood from "@/assets/sample-food.jpg";

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
}

export interface Booking {
  id: string;
  clientName: string;
  clientEmail: string;
  date: string;
  time: string;
  type: string;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  notes: string;
  albumId?: string;
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
    isPublic: true,
    clientName: "Emma Thompson",
    bookingId: "bk-1",
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
    isPublic: true,
    clientName: "Sarah Mitchell",
    bookingId: "bk-2",
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
    isPublic: true,
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
    isPublic: true,
    clientName: "TechCorp Inc.",
    bookingId: "bk-3",
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
    type: "Wedding",
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
    type: "Portrait",
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
    type: "Event",
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
    type: "Wedding",
    status: "confirmed",
    notes: "Beach ceremony, engagement + wedding",
  },
  {
    id: "bk-5",
    clientName: "Mark Davis",
    clientEmail: "mark@example.com",
    date: "2026-03-22",
    time: "15:00",
    type: "Portrait",
    status: "pending",
    notes: "Family portrait session",
  },
];
