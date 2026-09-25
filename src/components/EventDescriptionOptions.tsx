import { useState, type Dispatch, type SetStateAction } from "react";
import { Capacitor } from "@capacitor/core";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { NATIVE_API_ORIGIN, uploadEventDescriptionImage } from "@/lib/api";
import type { EventType } from "@/lib/types";

type Font = NonNullable<EventType["descriptionFont"]>;
const imageSrc = (url: string) => Capacitor.isNativePlatform() ? `${NATIVE_API_ORIGIN}${url}` : url;

export function EventDescriptionImages({ event }: { event: EventType }) {
  const images = (event.descriptionImages || []).filter(url => /^\/event-media\/[a-z0-9-]+\/[a-zA-Z0-9._-]+$/.test(url));
  if (!images.length) return null;
  return <div className={`grid gap-2 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
    {images.map((url, index) => <img key={url} src={imageSrc(url)} alt={`${event.title} example ${index + 1}`} loading="lazy" className="aspect-[4/3] w-full rounded-md object-cover" />)}
  </div>;
}

export default function EventDescriptionOptions({ font, images, tenantSlug, uploading, onFontChange, onImagesChange, onUploadingChange }: {
  font: Font;
  images: string[];
  tenantSlug?: string;
  uploading: boolean;
  onFontChange: (font: Font) => void;
  onImagesChange: Dispatch<SetStateAction<string[]>>;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const [inputKey, setInputKey] = useState(0);
  const addImage = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      toast.error("Choose a JPEG, PNG or WebP image up to 10 MB");
      return;
    }
    onUploadingChange(true);
    try {
      const url = await uploadEventDescriptionImage(file, tenantSlug);
      onImagesChange(previous => [...previous, url]);
      toast.success("Image added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      onUploadingChange(false);
      setInputKey(key => key + 1);
    }
  };

  return <div className="space-y-3">
    <label className="block max-w-xs text-xs text-muted-foreground">Description font
      <select aria-label="Description font" value={font} onChange={event => onFontChange(event.target.value as Font)} className="mt-1 block h-9 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground">
        <option value="sans">Studio sans</option>
        <option value="serif">Editorial serif</option>
        <option value="display">Condensed</option>
      </select>
    </label>
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Description images <span className="text-muted-foreground/70">({images.length}/3)</span></p>
      {images.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {images.map((url, index) => <div key={url} className="relative overflow-hidden rounded-md border border-border">
          <img src={imageSrc(url)} alt={`Description image ${index + 1}`} className="aspect-[4/3] w-full object-cover" />
          <button type="button" aria-label={`Remove description image ${index + 1}`} onClick={() => onImagesChange(previous => previous.filter(image => image !== url))} className="absolute right-1 top-1 rounded bg-background/90 p-1.5 text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X className="size-4" /></button>
        </div>)}
      </div>}
      {images.length < 3 && <label className={`inline-flex min-h-9 items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-foreground ${uploading ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-secondary"}`}>
        <ImagePlus className="size-4" />{uploading ? "Uploading…" : "Add image"}
        <input key={inputKey} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} className="sr-only" onChange={event => void addImage(event.target.files?.[0])} />
      </label>}
    </div>
  </div>;
}
