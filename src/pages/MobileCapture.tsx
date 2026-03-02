import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { getBookings, getAlbums, getSettings, updateAlbum, addAlbum } from "@/lib/storage";
import { uploadPhotosToServer, isServerMode } from "@/lib/api";
import { generateThumbnail } from "@/lib/image-utils";
import type { Booking, Album, Photo } from "@/lib/types";
import {
  Camera, Upload, CheckCircle, ArrowLeft, FolderOpen,
  Wifi, WifiOff, Zap, Image as ImageIcon, RefreshCw,
} from "lucide-react";

export default function MobileCapture() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [targetAlbum, setTargetAlbum] = useState<Album | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [serverOnline, setServerOnline] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const watchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bks = getBookings().filter(b => b.status !== "cancelled");
    setBookings(bks);
    setAlbums(getAlbums());
    setServerOnline(isServerMode());
  }, []);

  // Find or create album for booking
  const getOrCreateAlbum = useCallback((booking: Booking): Album => {
    const existing = getAlbums().find(a => a.bookingId === booking.id);
    if (existing) return existing;

    const settings = getSettings();
    const newAlbum: Album = {
      id: crypto.randomUUID(),
      slug: `session-${booking.id.slice(0, 8)}`,
      title: `${booking.type} — ${booking.clientName}`,
      description: `Session on ${booking.date}`,
      coverImage: "",
      date: booking.date,
      photoCount: 0,
      freeDownloads: settings.defaultFreeDownloads,
      pricePerPhoto: settings.defaultPricePerPhoto,
      priceFullAlbum: settings.defaultPriceFullAlbum,
      isPublic: false,
      enabled: false,
      photos: [],
      clientName: booking.clientName,
      clientEmail: booking.clientEmail,
      bookingId: booking.id,
    };
    addAlbum(newAlbum);
    setAlbums(prev => [...prev, newAlbum]);
    return newAlbum;
  }, []);

  const selectBooking = (booking: Booking) => {
    setSelectedBooking(booking);
    const album = getOrCreateAlbum(booking);
    setTargetAlbum(album);
    setUploadedCount(0);
  };

  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0 || !targetAlbum) return;

    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast({ title: "No images found", variant: "destructive" });
      return;
    }

    // Save locally first (backup)
    setPendingFiles(prev => [...prev, ...imageFiles]);

    setUploading(true);
    setUploadProgress(0);

    try {
      if (serverOnline) {
        // Upload to server
        const results = await uploadPhotosToServer(imageFiles, (done, total) => {
          setUploadProgress(Math.round((done / total) * 100));
        });

        // Create photo entries with proofing tag
        const newPhotos: Photo[] = [];
        for (const r of results) {
          const thumb = await generateThumbnail(r.url, 300, 0.6).catch(() => r.url);
          newPhotos.push({
            id: r.id,
            src: r.url,
            thumbnail: thumb,
            title: r.originalName,
            width: 0,
            height: 0,
            proofing: true, // mark as unedited
          });
        }

        // Update album
        const freshAlbum = getAlbums().find(a => a.id === targetAlbum.id) || targetAlbum;
        const updated: Album = {
          ...freshAlbum,
          photos: [...freshAlbum.photos, ...newPhotos],
          photoCount: freshAlbum.photos.length + newPhotos.length,
          coverImage: freshAlbum.coverImage || (newPhotos[0]?.src ?? ""),
        };
        updateAlbum(updated);
        setTargetAlbum(updated);
        setUploadedCount(prev => prev + newPhotos.length);
        toast({ title: `${newPhotos.length} photos uploaded`, description: "Tagged as proofing" });
      } else {
        toast({ title: "Offline — saved locally", description: `${imageFiles.length} files queued` });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Upload error", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // Live mode: auto-upload when files are picked
  const handleLiveCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFilePick(e.target.files);
    // Reset so same files can be re-selected
    if (e.target) e.target.value = "";
  };

  // ── Session Picker ──
  if (!selectedBooking) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-display text-foreground">Mobile Capture</h1>
          <Badge variant={serverOnline ? "default" : "destructive"} className="ml-auto gap-1">
            {serverOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {serverOnline ? "Online" : "Offline"}
          </Badge>
        </div>

        <p className="text-muted-foreground text-sm mb-4 font-body">
          Select a session to start uploading photos from your camera.
        </p>

        <ScrollArea className="h-[calc(100vh-140px)]">
          <div className="space-y-3">
            {bookings.length === 0 && (
              <Card className="p-6 text-center text-muted-foreground font-body">
                No active bookings found
              </Card>
            )}
            {bookings.map(bk => {
              const hasAlbum = albums.some(a => a.bookingId === bk.id);
              return (
                <Card
                  key={bk.id}
                  className="p-4 cursor-pointer hover:bg-accent/50 transition-colors active:scale-[0.98]"
                  onClick={() => selectBooking(bk)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-foreground">{bk.clientName}</p>
                      <p className="text-sm text-muted-foreground font-body">{bk.type}</p>
                      <p className="text-xs text-muted-foreground font-body mt-1">
                        {bk.date} · {bk.time}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={bk.status === "confirmed" ? "default" : "secondary"} className="text-xs">
                        {bk.status}
                      </Badge>
                      {hasAlbum && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <ImageIcon className="w-3 h-3" /> Album exists
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // ── Capture / Upload View ──
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => { setSelectedBooking(null); setTargetAlbum(null); }}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-display text-foreground truncate">{selectedBooking.clientName}</h1>
          <p className="text-xs text-muted-foreground font-body">{selectedBooking.type} · {selectedBooking.date}</p>
        </div>
        <Badge variant={serverOnline ? "default" : "destructive"} className="gap-1">
          {serverOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        </Badge>
      </div>

      {/* Stats */}
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-display text-foreground">{targetAlbum?.photoCount || 0}</p>
            <p className="text-xs text-muted-foreground font-body">In Album</p>
          </div>
          <div>
            <p className="text-2xl font-display text-foreground">{uploadedCount}</p>
            <p className="text-xs text-muted-foreground font-body">This Session</p>
          </div>
          <div>
            <p className="text-2xl font-display text-foreground">{pendingFiles.length}</p>
            <p className="text-xs text-muted-foreground font-body">Local Backup</p>
          </div>
        </div>
      </Card>

      {/* Upload Progress */}
      {uploading && (
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-body text-foreground">Uploading…</span>
            <span className="text-sm font-body text-muted-foreground ml-auto">{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
        </Card>
      )}

      {/* Live Mode Toggle */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className={`w-4 h-4 ${liveMode ? "text-primary" : "text-muted-foreground"}`} />
            <div>
              <p className="text-sm font-display text-foreground">Live Upload Mode</p>
              <p className="text-xs text-muted-foreground font-body">Auto-upload as you capture</p>
            </div>
          </div>
          <Switch checked={liveMode} onCheckedChange={setLiveMode} />
        </div>
      </Card>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Button
          size="lg"
          className="h-20 flex-col gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <FolderOpen className="w-6 h-6" />
          <span className="text-xs font-body">Browse Files</span>
        </Button>

        <Button
          size="lg"
          variant={liveMode ? "default" : "secondary"}
          className="h-20 flex-col gap-2"
          onClick={() => watchInputRef.current?.click()}
          disabled={uploading}
        >
          <Camera className="w-6 h-6" />
          <span className="text-xs font-body">{liveMode ? "Capture & Upload" : "Take Photo"}</span>
        </Button>
      </div>

      {/* Recent uploads preview */}
      {targetAlbum && targetAlbum.photos.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-display text-foreground mb-3">Recent Uploads</p>
          <div className="grid grid-cols-4 gap-2">
            {targetAlbum.photos.slice(-8).reverse().map(photo => (
              <div key={photo.id} className="relative aspect-square rounded-md overflow-hidden bg-muted">
                <img
                  src={photo.thumbnail || photo.src}
                  alt={photo.title}
                  className="w-full h-full object-cover"
                />
                {photo.proofing && (
                  <Badge className="absolute top-1 left-1 text-[9px] px-1 py-0 bg-primary/90 text-primary-foreground border-0">
                    PROOF
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFilePick(e.target.files)}
      />
      <input
        ref={watchInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleLiveCapture}
      />
    </div>
  );
}
