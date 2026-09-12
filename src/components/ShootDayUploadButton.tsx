import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Album, Photo } from "@/lib/types";
import { fetchAlbumPhotos, isServerMode, isSupportedUploadFile, isSupportedPhotoSource, saveAlbumToServer, uploadPhotosToServer } from "@/lib/api";
import { cacheAlbumLocally } from "@/lib/storage";
import { formatSpeed } from "@/lib/image-utils";
import { toast } from "sonner";

export default function ShootDayUploadButton({ resolveAlbum, clientName, onComplete }: { resolveAlbum: () => Album | null | undefined; clientName: string; onComplete: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [progress, setProgress] = useState<string | null>(null);
  const upload = async (files: File[]) => {
    const supported = files.filter(isSupportedUploadFile);
    if (!supported.length) { if (files.length) toast.error("No supported images selected"); return; }
    if (running.current) return;
    running.current = true; setProgress("Preparing…");
    try {
      if (!isServerMode()) throw new Error("Connect to the server to upload photos");
      const album = resolveAlbum();
      if (!album) throw new Error("Could not create the session album");
      const base = album._photosStripped ? await fetchAlbumPhotos(album.id) : album.photos;
      if (!base) throw new Error("Could not load existing photos. Please try again.");
      const ready = { ...album, photos: base, _photosStripped: false, _replacePhotos: undefined, _removedPhotoIds: undefined, _basePhotoIds: undefined };
      const prepared = await saveAlbumToServer(ready.id, ready);
      if (!prepared.ok) throw new Error(prepared.error || "Could not prepare the album");
      const results = await uploadPhotosToServer(supported, (done, total, speed) => setProgress(`${done}/${total}${speed ? ` · ${formatSpeed(speed)}` : ""}`), undefined, 3, album.title, album.id);
      const added: Photo[] = results.filter(result => isSupportedPhotoSource(result.url)).map(result => ({
        id: result.id, src: result.url, thumbnail: `${result.url}?size=thumb&wm=0`,
        title: result.originalName.replace(/\.[^.]+$/, ""), originalName: result.originalName,
        width: result.width || 800, height: result.height || 600, fileSize: result.size,
        uploadedAt: new Date().toISOString(), takenAt: result.takenAt,
        ...(result.proofId ? { proofId: result.proofId } : {}),
        ...(result.originalFileNumber ? { originalFileNumber: result.originalFileNumber } : {}),
        ...(result.ftpUploaded ? { ftpUploaded: true } : {}),
      }));
      if (added.length) {
        const photos = [...new Map([...base, ...added].map(photo => [photo.id, photo])).values()];
        const updated = { ...ready, photos, photoCount: photos.length, coverImage: ready.coverImage || added[0].src };
        setProgress("Saving album…");
        const saved = await saveAlbumToServer(updated.id, updated);
        if (!saved.ok) throw new Error(saved.error || "Files uploaded, but album save is unconfirmed. Check the album before retrying.");
        cacheAlbumLocally(updated);
        onComplete();
      }
      if (added.length < supported.length) toast.warning(`Uploaded ${added.length}/${supported.length} photos to ${clientName}. Some files failed.`);
      else toast.success(`Uploaded ${added.length} photos to ${clientName}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Upload failed"); }
    finally { running.current = false; setProgress(null); }
  };
  return <div>
    <input ref={input} aria-label={`Upload photos for ${clientName}`} type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple className="hidden" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void upload(files); }} />
    <Button size="sm" variant="outline" disabled={progress !== null} onClick={() => input.current?.click()} className="gap-1.5 text-xs"><Upload className="w-3.5 h-3.5" />{progress === null ? "Upload Photos" : "Uploading…"}</Button>
    {progress !== null && <p role="status" className="text-xs text-muted-foreground mt-1">{progress}</p>}
  </div>;
}
