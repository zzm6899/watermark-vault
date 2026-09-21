import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Album, Photo } from "@/lib/types";
import { fetchAlbumPhotos, isServerMode, isSupportedUploadFile, isSupportedPhotoSource, saveAlbumToServer, uploadPhotosToServer, type UploadedPhotoResult } from "@/lib/api";
import { cacheAlbumLocally } from "@/lib/storage";
import { formatSpeed } from "@/lib/image-utils";
import { toast } from "sonner";

export default function ShootDayUploadButton({ resolveAlbum, clientName, onComplete }: { resolveAlbum: () => Album | null | undefined; clientName: string; onComplete: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [savePending, setSavePending] = useState(false);
  const [error, setError] = useState("");
  const pendingPhotos = useRef<Photo[]>([]);
  const targetAlbum = useRef<Album | null>(null);
  useEffect(() => {
    if (progress === null && !failedFiles.length && !savePending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [progress, failedFiles.length, savePending]);

  const upload = async (files: File[]) => {
    if (running.current) return;
    const supported = files.filter(isSupportedUploadFile);
    if (!supported.length && !pendingPhotos.current.length) { if (files.length) toast.error("No supported images selected"); return; }
    if (supported.length < files.length) toast.warning(`${files.length - supported.length} unsupported files skipped`);
    let remaining = files.length ? [...supported] : [...failedFiles];
    running.current = true;
    setProgress("Preparing…");
    setError("");
    setFailedFiles(remaining);
    try {
      if (!isServerMode()) throw new Error("Connect to the server to upload photos");
      const album = targetAlbum.current || resolveAlbum();
      if (!album) throw new Error("Could not create the session album");
      targetAlbum.current = album;
      const base = album._photosStripped ? await fetchAlbumPhotos(album.id) : album.photos;
      if (!base) throw new Error("Could not load existing photos. Please try again.");
      let ready = { ...album, photos: base, _photosStripped: false, _replacePhotos: undefined, _removedPhotoIds: undefined, _basePhotoIds: undefined };
      const savePhotos = async () => {
        const photos = [...new Map([...ready.photos, ...pendingPhotos.current].map(photo => [photo.id, photo])).values()];
        const updated = { ...ready, photos, photoCount: photos.length, coverImage: ready.coverImage || photos[0]?.src };
        setProgress("Saving album…");
        const saved = await saveAlbumToServer(updated.id, updated);
        if (!saved.ok) throw new Error(`Photos uploaded; album save is unconfirmed. ${saved.error || "Retry saving the album."}`);
        ready = updated;
        targetAlbum.current = updated;
        pendingPhotos.current = [];
        setSavePending(false);
        cacheAlbumLocally(updated);
        onComplete();
      };
      // Retry the metadata save before sending any more files.
      if (pendingPhotos.current.length) await savePhotos();
      if (supported.length) {
        const prepared = await saveAlbumToServer(ready.id, ready);
        if (!prepared.ok) throw new Error(prepared.error || "Could not prepare the album");
        const acknowledge = (file: File, result: UploadedPhotoResult) => {
          if (!isSupportedPhotoSource(result.url)) return;
          pendingPhotos.current.push({
            id: result.id, src: result.url, thumbnail: `${result.url}?size=thumb&wm=0`,
            title: result.originalName.replace(/\.[^.]+$/, ""), originalName: result.originalName,
            width: result.width || 800, height: result.height || 600, fileSize: result.size,
            uploadedAt: new Date().toISOString(), takenAt: result.takenAt,
            ...(result.proofId ? { proofId: result.proofId } : {}),
            ...(result.originalFileNumber ? { originalFileNumber: result.originalFileNumber } : {}),
            ...(result.ftpUploaded ? { ftpUploaded: true } : {}),
          });
          remaining = remaining.filter(item => item !== file);
          setFailedFiles(remaining);
          setSavePending(true);
        };
        let uploadError: unknown;
        try {
          await uploadPhotosToServer(supported, (done, total, speed) => setProgress(`${done}/${total}${speed ? ` · ${formatSpeed(speed)}` : ""}`), undefined, 3, album.title, album.id, false, "balanced", undefined, acknowledge);
        } catch (cause) { uploadError = cause; }
        if (pendingPhotos.current.length) await savePhotos();
        if (uploadError) throw uploadError;
        if (remaining.length) throw new Error(`${remaining.length} files could not be uploaded. Retry the files listed below.`);
      }
      if (!remaining.length) targetAlbum.current = null;
      toast.success(`Photos saved to ${clientName}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed. Please retry.");
    } finally { running.current = false; setProgress(null); }
  };
  return <div>
    <input ref={input} aria-label={`Upload photos for ${clientName}`} type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple className="hidden" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void upload(files); }} />
    <Button size="sm" variant="outline" disabled={progress !== null || failedFiles.length > 0 || savePending} onClick={() => input.current?.click()} className="gap-1.5 text-xs"><Upload className="w-3.5 h-3.5" />{progress === null ? "Upload Photos" : "Uploading…"}</Button>
    {error && <p role="alert" className="text-xs text-destructive mt-2">{error}</p>}
    {progress === null && (failedFiles.length > 0 || savePending) && <div className="mt-2 space-y-2">
      {failedFiles.length > 0 && <ul aria-label="Files awaiting upload" className="max-h-32 overflow-auto text-xs text-muted-foreground">{failedFiles.map((file, index) => <li key={index}>{file.name}</li>)}</ul>}
      <p className="text-xs text-muted-foreground">Keep this page open until these photos are saved.</p>
      <Button size="sm" variant="outline" onClick={() => void upload(savePending ? [] : failedFiles)}>{savePending ? "Retry album save" : "Retry failed files"}</Button>
      {!savePending && <Button size="sm" variant="ghost" onClick={() => { setFailedFiles([]); setError(""); targetAlbum.current = null; }}>Clear failed files</Button>}
    </div>}
    {progress !== null && <p role="status" className="text-xs text-muted-foreground mt-1">{progress}</p>}
  </div>;
}
