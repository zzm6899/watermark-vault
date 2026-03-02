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
import CameraUsb from "@/plugins/camera-usb";
import type { CameraFile } from "@/plugins/camera-usb";
import { Capacitor } from "@capacitor/core";
import type { Booking, Album, Photo } from "@/lib/types";
import {
  Camera, Upload, CheckCircle, ArrowLeft, FolderOpen,
  Wifi, WifiOff, Zap, Image as ImageIcon, RefreshCw,
  Usb, AlertCircle, Download,
} from "lucide-react";

export default function MobileCapture() {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();

  // ── State ──
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

  // USB camera state
  const [cameraConnected, setCameraConnected] = useState(false);
  const [cameraName, setCameraName] = useState("");
  const [cameraFiles, setCameraFiles] = useState<CameraFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    const bks = getBookings().filter(b => b.status !== "cancelled");
    setBookings(bks);
    setAlbums(getAlbums());
    setServerOnline(isServerMode());
  }, []);

  // Check USB camera connection
  const checkCamera = useCallback(async () => {
    if (!isNative) return;
    try {
      const { connected, deviceName } = await CameraUsb.isConnected();
      setCameraConnected(connected);
      setCameraName(deviceName);
      if (connected) {
        const { granted } = await CameraUsb.requestPermission();
        if (granted) {
          const { files } = await CameraUsb.listFiles({ limit: 50 });
          setCameraFiles(files);
        }
      }
    } catch {
      setCameraConnected(false);
    }
  }, [isNative]);

  // Poll camera connection status
  useEffect(() => {
    if (!isNative) return;
    checkCamera();
    const interval = setInterval(checkCamera, 5000);
    return () => clearInterval(interval);
  }, [isNative, checkCamera]);

  // Listen for new files in watch mode
  useEffect(() => {
    if (!isNative || !watching) return;

    const listener = CameraUsb.addListener?.("newFiles" as any, async (event: any) => {
      const newFiles: CameraFile[] = event.files || [];
      if (newFiles.length > 0 && targetAlbum) {
        toast({ title: `${newFiles.length} new photo(s) detected`, description: "Auto-importing…" });
        await importCameraFiles(newFiles.map(f => f.handle));
      }
    });

    return () => {
      listener?.then?.((l: any) => l.remove?.());
    };
  }, [isNative, watching, targetAlbum]);

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
    // Refresh camera files
    if (isNative) checkCamera();
  };

  // ── Import from USB Camera ──
  const importCameraFiles = async (handles: number[]) => {
    if (!targetAlbum || handles.length === 0) return;

    setImporting(true);
    setImportProgress(0);

    try {
      // Import files from camera to local storage
      const { files: imported } = await CameraUsb.importFiles({ handles });
      setImportProgress(50);

      // Now upload to server
      const newPhotos: Photo[] = [];

      if (serverOnline) {
        // Fetch the local files and upload to server
        for (let i = 0; i < imported.length; i++) {
          const f = imported[i];
          try {
            const response = await fetch(f.uri);
            const blob = await response.blob();
            const file = new File([blob], f.localPath.split("/").pop() || `photo_${i}.jpg`, { type: "image/jpeg" });

            const results = await uploadPhotosToServer([file], () => {});
            for (const r of results) {
              const thumb = await generateThumbnail(r.url, 300, 0.6).catch(() => r.url);
              newPhotos.push({
                id: r.id,
                src: r.url,
                thumbnail: thumb,
                title: r.originalName,
                width: 0,
                height: 0,
                proofing: true,
              });
            }
          } catch (e) {
            console.error("Upload error for file:", f.localPath, e);
          }
          setImportProgress(50 + Math.round(((i + 1) / imported.length) * 50));
        }
      } else {
        // Offline — just create local entries
        for (const f of imported) {
          newPhotos.push({
            id: crypto.randomUUID(),
            src: f.uri,
            thumbnail: f.uri,
            title: f.localPath.split("/").pop() || "photo",
            width: 0,
            height: 0,
            proofing: true,
          });
        }
        setImportProgress(100);
      }

      if (newPhotos.length > 0) {
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
        toast({ title: `${newPhotos.length} photos imported`, description: "Tagged as proofing" });
      }

      // Remove imported files from the camera files list
      setCameraFiles(prev => prev.filter(f => !handles.includes(f.handle)));
    } catch (err) {
      console.error(err);
      toast({ title: "Import error", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const importAllCameraFiles = () => {
    importCameraFiles(cameraFiles.map(f => f.handle));
  };

  // Toggle live watching
  const toggleLiveWatch = async () => {
    if (watching) {
      await CameraUsb.stopWatching();
      setWatching(false);
      toast({ title: "Live capture stopped" });
    } else {
      await CameraUsb.startWatching({ intervalMs: 2000 });
      setWatching(true);
      toast({ title: "Live capture started", description: "New photos will auto-import" });
    }
  };

  // ── File picker fallback (web or manual) ──
  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0 || !targetAlbum) return;

    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast({ title: "No images found", variant: "destructive" });
      return;
    }

    setPendingFiles(prev => [...prev, ...imageFiles]);
    setUploading(true);
    setUploadProgress(0);

    try {
      if (serverOnline) {
        const results = await uploadPhotosToServer(imageFiles, (done, total) => {
          setUploadProgress(Math.round((done / total) * 100));
        });

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
            proofing: true,
          });
        }

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

  const handleLiveCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFilePick(e.target.files);
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
          <div className="ml-auto flex items-center gap-2">
            {isNative && (
              <Badge variant={cameraConnected ? "default" : "outline"} className="gap-1">
                <Usb className="w-3 h-3" />
                {cameraConnected ? cameraName || "Camera" : "No Camera"}
              </Badge>
            )}
            <Badge variant={serverOnline ? "default" : "destructive"} className="gap-1">
              {serverOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {serverOnline ? "Online" : "Offline"}
            </Badge>
          </div>
        </div>

        <p className="text-muted-foreground text-sm mb-4 font-body">
          Select a session to start {isNative && cameraConnected ? "importing from your camera" : "uploading photos"}.
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
        <Button variant="ghost" size="icon" onClick={() => { setSelectedBooking(null); setTargetAlbum(null); setWatching(false); CameraUsb.stopWatching().catch(() => {}); }}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-display text-foreground truncate">{selectedBooking.clientName}</h1>
          <p className="text-xs text-muted-foreground font-body">{selectedBooking.type} · {selectedBooking.date}</p>
        </div>
        <div className="flex items-center gap-2">
          {isNative && (
            <Badge variant={cameraConnected ? "default" : "outline"} className="gap-1">
              <Usb className="w-3 h-3" />
            </Badge>
          )}
          <Badge variant={serverOnline ? "default" : "destructive"} className="gap-1">
            {serverOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </Badge>
        </div>
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
            <p className="text-2xl font-display text-foreground">{isNative ? cameraFiles.length : pendingFiles.length}</p>
            <p className="text-xs text-muted-foreground font-body">{isNative ? "On Camera" : "Local Backup"}</p>
          </div>
        </div>
      </Card>

      {/* Import / Upload Progress */}
      {(uploading || importing) && (
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-body text-foreground">{importing ? "Importing from camera…" : "Uploading…"}</span>
            <span className="text-sm font-body text-muted-foreground ml-auto">{importing ? importProgress : uploadProgress}%</span>
          </div>
          <Progress value={importing ? importProgress : uploadProgress} className="h-2" />
        </Card>
      )}

      {/* USB Camera Section (Native only) */}
      {isNative && (
        <Card className="p-4 mb-4">
          {cameraConnected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Usb className="w-4 h-4 text-primary" />
                  <div>
                    <p className="text-sm font-display text-foreground">{cameraName || "Camera Connected"}</p>
                    <p className="text-xs text-muted-foreground font-body">{cameraFiles.length} photos available</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={checkCamera}>
                  <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                </Button>
              </div>

              {/* Live Watch Toggle */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <Zap className={`w-4 h-4 ${watching ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-display text-foreground">Live Capture</p>
                    <p className="text-xs text-muted-foreground font-body">Auto-import new shots</p>
                  </div>
                </div>
                <Switch checked={watching} onCheckedChange={toggleLiveWatch} />
              </div>

              {/* Import buttons */}
              {cameraFiles.length > 0 && !watching && (
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1"
                    onClick={importAllCameraFiles}
                    disabled={importing}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Import All ({cameraFiles.length})
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-muted-foreground">
              <AlertCircle className="w-5 h-5" />
              <div>
                <p className="text-sm font-display text-foreground">No camera detected</p>
                <p className="text-xs font-body">Connect your Nikon Z6III via USB-C</p>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Manual file picker (always available as fallback) */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Button
          size="lg"
          variant="secondary"
          className="h-16 flex-col gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || importing}
        >
          <FolderOpen className="w-5 h-5" />
          <span className="text-xs font-body">Browse Files</span>
        </Button>

        <Button
          size="lg"
          variant="secondary"
          className="h-16 flex-col gap-2"
          onClick={() => watchInputRef.current?.click()}
          disabled={uploading || importing}
        >
          <Camera className="w-5 h-5" />
          <span className="text-xs font-body">Phone Camera</span>
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
