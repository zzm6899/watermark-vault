import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ExternalLink, Eye, Globe, GripVertical, ImagePlus, LayoutPanelLeft, Loader2, Monitor, Plus, Save, Send, Smartphone, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { defaultPortfolioSite, fetchPortfolioDraft, publishPortfolio, savePortfolioDraft, testPortfolioWebhook, uploadPortfolioImage, type PortfolioSite } from "@/lib/portfolio";

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function imageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}

function ImageUploadField({ label, value, onChange, recommendedWidth = 2400, recommendedHeight = 0 }: { label: string; value: string; onChange: (url: string) => void; recommendedWidth?: number; recommendedHeight?: number }) {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
  const inputId = useId();

  useEffect(() => {
    let active = true;
    if (!value) { setDimensions(undefined); return; }
    imageDimensions(value).then(result => { if (active) setDimensions(result); }).catch(() => { if (active) setDimensions(undefined); });
    return () => { active = false; };
  }, [value]);

  const upload = async (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      const size = await imageDimensions(preview).catch(() => undefined);
      URL.revokeObjectURL(preview);
      if (size) setDimensions(size);
      onChange(await uploadPortfolioImage(file));
      toast.success(`${label} uploaded at original quality`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally { setUploading(false); setDragging(false); }
  };

  const tooSmall = !!dimensions && ((recommendedWidth > 0 && dimensions.width < recommendedWidth) || (recommendedHeight > 0 && dimensions.height < recommendedHeight));
  return <div className="space-y-2 md:col-span-2">
    <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{label}</p>{dimensions && <span className={`text-[11px] ${tooSmall ? "text-amber-500" : "text-emerald-500"}`}>{dimensions.width} × {dimensions.height}{tooSmall ? " · low for large screens" : " · large-screen ready"}</span>}</div>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <label htmlFor={inputId} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); upload(event.dataTransfer.files?.[0]); }} className={`group relative flex h-28 w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed bg-secondary transition-colors sm:w-48 ${dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/60"}`}>
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-muted-foreground" />}
        <span className="absolute inset-x-0 bottom-0 bg-background/85 px-2 py-1 text-center text-[10px] opacity-0 transition-opacity group-hover:opacity-100">Drop or choose original</span>
      </label>
      <div className="min-w-0 flex-1 space-y-2">
        <Input value={value} onChange={event => onChange(event.target.value)} aria-label={`${label} URL`} placeholder="Image URL" />
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={event => upload(event.target.files?.[0])} />
        <div className="flex flex-wrap items-center gap-2"><Button asChild variant="outline" size="sm" disabled={uploading}><label htmlFor={inputId} className="cursor-pointer">{uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{uploading ? "Uploading…" : "Choose original"}</label></Button><span className="text-[10px] text-muted-foreground">Recommended {recommendedWidth ? `${recommendedWidth}px wide` : `${recommendedHeight}px tall`} or larger</span></div>
      </div>
    </div>
  </div>;
}

function SortableRow({ id, index, count, onMove, onRemove, removeLabel, children }: { id: string; index: number; count: number; onMove: (from: number, to: number) => void; onRemove?: () => void; removeLabel?: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`grid gap-3 border-b border-border py-5 last:border-b-0 ${isDragging ? "relative z-10 bg-secondary/90 opacity-90" : ""}`}>
    <div className="flex items-center gap-1">
      <button type="button" className="inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing" aria-label={`Drag item ${index + 1}`} {...attributes} {...listeners}><GripVertical className="h-4 w-4" /></button>
      <span className="mr-auto text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
      <Button type="button" variant="ghost" size="icon" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)}><ArrowUp className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="icon" aria-label={`Move item ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}><ArrowDown className="h-4 w-4" /></Button>
      {onRemove && <Button type="button" variant="ghost" size="icon" aria-label={removeLabel || `Remove item ${index + 1}`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>}
    </div>
    {children}
  </li>;
}

function SortableList<T extends { id: string }>({ items, onChange, render, removeLabel }: { items: T[]; onChange: (items: T[]) => void; render: (item: T, index: number) => ReactNode; removeLabel?: (item: T) => string }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const move = (from: number, to: number) => onChange(arrayMove(items, from, to));
  const finish = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex(item => item.id === active.id);
    const to = items.findIndex(item => item.id === over.id);
    if (from >= 0 && to >= 0) move(from, to);
  };
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finish}><SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}><ol className="border-y border-border">{items.map((item, index) => <SortableRow key={item.id} id={item.id} index={index} count={items.length} onMove={move} onRemove={() => onChange(items.filter(current => current.id !== item.id))} removeLabel={removeLabel?.(item)}>{render(item, index)}</SortableRow>)}</ol></SortableContext></DndContext>;
}

function ImageCollectionEditor({ label, images, onChange, recommendedWidth = 2400 }: { label: string; images: string[]; onChange: (images: string[]) => void; recommendedWidth?: number }) {
  const items = images.map((url, index) => ({ id: `${label}-${index}-${url}`, url }));
  return <div className="space-y-3"><div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-medium text-foreground">{label}</h4><p className="text-[11px] text-muted-foreground">Drag to choose the display order.</p></div><Button type="button" variant="outline" size="sm" onClick={() => onChange([...images, ""])}><Plus className="mr-2 h-4 w-4" />Add image</Button></div>
    <SortableList items={items} onChange={next => onChange(next.map(item => item.url))} removeLabel={() => `Remove image from ${label}`} render={(item, index) => <ImageUploadField label={`${label} ${index + 1}`} value={item.url} recommendedWidth={recommendedWidth} onChange={url => onChange(images.map((current, currentIndex) => currentIndex === index ? url : current))} />} />
  </div>;
}

function GalleryGridCard({ item, index, onUpdate, onRemove }: { item: PortfolioSite["galleryImages"][number]; index: number; onUpdate: (patch: Partial<PortfolioSite["galleryImages"][number]>) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`group overflow-hidden rounded-md border border-border bg-card ${isDragging ? "relative z-20 opacity-75 shadow-xl" : ""}`}>
    <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
      {item.image ? <img src={item.image} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-muted-foreground">No image</div>}
      <button type="button" className="absolute left-2 top-2 inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-md bg-background/90 text-foreground shadow active:cursor-grabbing" aria-label={`Drag gallery photo ${index + 1}`} {...attributes} {...listeners}><GripVertical className="h-4 w-4" /></button>
      <Button type="button" variant="secondary" size="icon" className="absolute right-2 top-2 h-9 w-9 opacity-0 shadow group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${item.alt || `gallery photo ${index + 1}`}`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
      <span className="absolute bottom-2 left-2 rounded bg-background/85 px-2 py-1 text-[10px] tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
    </div>
    <div className="grid gap-2 p-3">
      <Input value={item.alt} aria-label={`Gallery photo ${index + 1} description`} placeholder="Photo description" onChange={event => onUpdate({ alt: event.target.value })} />
      <Input value={item.category} aria-label={`Gallery photo ${index + 1} category`} placeholder="Category" onChange={event => onUpdate({ category: event.target.value })} />
    </div>
  </div>;
}

function GalleryGridEditor({ items, onChange }: { items: PortfolioSite["galleryImages"]; onChange: (items: PortfolioSite["galleryImages"]) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const finish = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex(item => item.id === active.id);
    const to = items.findIndex(item => item.id === over.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(items, from, to));
  };
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finish}>
    <SortableContext items={items.map(item => item.id)} strategy={rectSortingStrategy}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {items.map((item, index) => <GalleryGridCard key={item.id} item={item} index={index} onUpdate={patch => onChange(items.map(photo => photo.id === item.id ? { ...photo, ...patch } : photo))} onRemove={() => onChange(items.filter(photo => photo.id !== item.id))} />)}
      </div>
    </SortableContext>
  </DndContext>;
}

function EditorSection({ title, description, children, open = false }: { title: string; description?: string; children: ReactNode; open?: boolean }) {
  const sectionId = `website-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return <details id={sectionId} open={open} className="group scroll-mt-32 border-t border-border py-6"><summary className="flex cursor-pointer list-none items-center justify-between gap-4"><div><h3 className="font-display text-2xl">{title}</h3>{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div><span className="text-xs text-muted-foreground group-open:hidden">Open</span><span className="hidden text-xs text-muted-foreground group-open:inline">Close</span></summary><div className="mt-6 space-y-5">{children}</div></details>;
}

function LivePortfolioPreview({ draft }: { draft: PortfolioSite }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [path, setPath] = useState("/");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const publicDraft = useMemo(() => ({ ...draft, webhookUrl: undefined }), [draft]);
  const sendDraft = useCallback(() => iframeRef.current?.contentWindow?.postMessage({ type: "wv:portfolio-preview", site: publicDraft }, window.location.origin), [publicDraft]);

  useEffect(() => { sendDraft(); }, [sendDraft]);
  useEffect(() => {
    const receiveReady = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === iframeRef.current?.contentWindow && event.data?.type === "wv:portfolio-preview-ready") sendDraft();
    };
    window.addEventListener("message", receiveReady);
    return () => window.removeEventListener("message", receiveReady);
  }, [sendDraft]);

  const pages = [["Home", "/"], ["Portfolio", "/portfolio"], ["Concerts", "/concerts"], ["About", "/about"], ["Enquire", "/enquire"]] as const;
  return <section className="overflow-hidden rounded-md border border-border bg-card" aria-label="Live website preview">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
      <div className="flex flex-wrap gap-1">{pages.map(([label, value]) => <Button key={value} type="button" size="sm" variant={path === value ? "secondary" : "ghost"} onClick={() => setPath(value)}>{label}</Button>)}</div>
      <div className="flex rounded-md border border-border p-1" aria-label="Preview device"><Button type="button" size="icon" variant={device === "desktop" ? "secondary" : "ghost"} onClick={() => setDevice("desktop")} aria-label="Desktop preview"><Monitor className="h-4 w-4" /></Button><Button type="button" size="icon" variant={device === "mobile" ? "secondary" : "ghost"} onClick={() => setDevice("mobile")} aria-label="Mobile preview"><Smartphone className="h-4 w-4" /></Button></div>
    </div>
    <div className="overflow-auto bg-[#111] p-2">
      <iframe ref={iframeRef} title="Unsaved portfolio preview" src={`/portfolio-preview${path === "/" ? "" : path}?editor=1`} onLoad={sendDraft} className={`mx-auto block h-[72vh] min-h-[560px] bg-white transition-[width] ${device === "mobile" ? "w-[390px] max-w-full" : "w-full"}`} />
    </div>
  </section>;
}

export default function PortfolioEditor() {
  const [draft, setDraft] = useState<PortfolioSite>(defaultPortfolioSite);
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify(defaultPortfolioSite));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [concertUploading, setConcertUploading] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string>();
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const bulkInputId = useId();
  const concertInputId = useId();

  useEffect(() => { fetchPortfolioDraft().then(data => { setDraft(data.draft); setSavedSnapshot(JSON.stringify(data.draft)); setPublishedAt(data.publishedAt); }).catch(err => toast.error(err.message)).finally(() => setLoading(false)); }, []);
  const dirty = useMemo(() => JSON.stringify(draft) !== savedSnapshot, [draft, savedSnapshot]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = <K extends keyof PortfolioSite>(key: K, value: PortfolioSite[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const save = async () => { setSaving(true); try { await savePortfolioDraft(draft); setSavedSnapshot(JSON.stringify(draft)); toast.success("Website draft saved"); } catch (error) { toast.error(error instanceof Error ? error.message : "Save failed"); } finally { setSaving(false); } };
  const publish = async () => { setSaving(true); try { await savePortfolioDraft(draft); const result = await publishPortfolio(); setSavedSnapshot(JSON.stringify(draft)); setPublishedAt(result.publishedAt); toast.success("Website published"); } catch (error) { toast.error(error instanceof Error ? error.message : "Publish failed"); } finally { setSaving(false); } };
  const testWebhook = async () => { if (!draft.webhookUrl) return toast.error("Enter a Discord webhook URL first"); setTestingWebhook(true); try { await testPortfolioWebhook(draft.webhookUrl); toast.success("Test notification sent"); } catch (error) { toast.error(error instanceof Error ? error.message : "Webhook test failed"); } finally { setTestingWebhook(false); } };
  const uploadGalleryFiles = async (files: FileList | File[], category = "Events", concertUpload = false) => {
    const images = Array.from(files).filter(file => file.type.startsWith("image/"));
    if (!images.length) return;
    const setUploading = concertUpload ? setConcertUploading : setBulkUploading;
    setUploading(true);
    try {
      const uploaded = await Promise.all(images.map(async file => ({ id: makeId("gallery"), image: await uploadPortfolioImage(file), alt: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), category })));
      change("galleryImages", [...draft.galleryImages, ...uploaded]);
      toast.success(`${uploaded.length} original photo${uploaded.length === 1 ? "" : "s"} added`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Upload failed"); } finally { setUploading(false); }
  };

  if (loading) return <div className="py-24 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />Loading website editor…</div>;
  const editorSections = ["Brand and hero", "Homepage", "Portfolio page", "Concert page", "About page", "Testimonials", "Booking enquiry", "Contact and footer"];
  const jumpToSection = (title: string) => {
    const section = document.getElementById(`website-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`) as HTMLDetailsElement | null;
    if (!section) return;
    section.open = true;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <div className="space-y-2 pb-24">
    <div className="admin-page-header"><div><h2 className="font-display text-3xl text-foreground sm:text-4xl">Website studio</h2><p className="mt-2 text-sm text-muted-foreground">Edit, reorder and preview the public portfolio without publishing first.</p></div><Button variant={previewOpen ? "secondary" : "outline"} size="sm" onClick={() => setPreviewOpen(value => !value)}>{previewOpen ? <LayoutPanelLeft className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}{previewOpen ? "Hide preview" : "Show preview"}</Button></div>
    <div className="sticky top-0 z-30 -mx-2 flex flex-wrap items-center justify-between gap-3 border-y border-border bg-background/95 px-2 py-3 backdrop-blur"><div className="text-xs text-muted-foreground"><span className={dirty ? "text-amber-500" : "text-emerald-500"}>{dirty ? "Unsaved changes · preview is current" : "All changes saved"}</span>{publishedAt && <span> · Published {new Date(publishedAt).toLocaleString()}</span>}</div><div className="flex gap-2"><a className="inline-flex items-center gap-1 px-2 text-xs text-primary" href="https://zacmorganphotography.com" target="_blank" rel="noreferrer">Live site <ExternalLink className="h-3.5 w-3.5" /></a><Button variant="outline" size="sm" onClick={save} disabled={saving || !dirty}><Save className="mr-2 h-4 w-4" />Save draft</Button><Button size="sm" onClick={publish} disabled={saving}><Globe className="mr-2 h-4 w-4" />Publish</Button></div></div>
    <div className={`grid items-start gap-5 ${previewOpen ? "xl:grid-cols-[minmax(420px,0.9fr)_minmax(520px,1.1fr)]" : "grid-cols-1"}`}>
      <div className="min-w-0">
        <nav className="sticky top-[57px] z-20 -mx-2 flex gap-1 overflow-x-auto border-b border-border bg-background/95 px-2 py-2 backdrop-blur" aria-label="Website editor sections">
          {editorSections.map(section => <Button key={section} type="button" variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => jumpToSection(section)}>{section.replace(" page", "")}</Button>)}
        </nav>

    <EditorSection title="Brand and hero" description="Upload 3200px-wide originals for full-screen display." open><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground">Business name<Input value={draft.brandName} onChange={event => change("brandName", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Hero label<Input value={draft.heroLabel} onChange={event => change("heroLabel", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Hero services line<Input value={draft.heroServicesLabel} onChange={event => change("heroServicesLabel", event.target.value)} /></label><ImageUploadField label="Logo" value={draft.logo} recommendedWidth={1000} onChange={value => change("logo", value)} /></div><ImageCollectionEditor label="Hero slideshow" images={draft.heroImages} recommendedWidth={3200} onChange={images => { change("heroImages", images); if (images[0]) change("heroImage", images[0]); }} /></EditorSection>

    <EditorSection title="Homepage" description="Edit the homepage story, image ribbon and philosophy section."><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground">Intro line<Input value={draft.introEyebrow} onChange={event => change("introEyebrow", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Intro heading<Input value={draft.introTitle} onChange={event => change("introTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Intro text<Textarea rows={4} value={draft.introBody} onChange={event => change("introBody", event.target.value)} /></label><ImageUploadField label="Portrait image" value={draft.portrait} recommendedWidth={0} recommendedHeight={2400} onChange={value => change("portrait", value)} /><label className="space-y-1 text-xs text-muted-foreground">Story eyebrow<Input value={draft.storyEyebrow} onChange={event => change("storyEyebrow", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Story heading<Input value={draft.storyTitle} onChange={event => change("storyTitle", event.target.value)} /></label></div><ImageCollectionEditor label="Homepage ribbon" images={draft.homeRibbonImages} onChange={images => change("homeRibbonImages", images)} /><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground">Philosophy eyebrow<Input value={draft.philosophyEyebrow} onChange={event => change("philosophyEyebrow", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Philosophy heading<Input value={draft.philosophyTitle} onChange={event => change("philosophyTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Philosophy text<Textarea rows={3} value={draft.philosophyBody} onChange={event => change("philosophyBody", event.target.value)} /></label><ImageUploadField label="Philosophy image" value={draft.philosophyImage} onChange={value => change("philosophyImage", value)} /></div></EditorSection>

    <EditorSection title="Portfolio page" description="Categories and gallery order are draggable and control the public display."><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground">Portfolio heading<Input value={draft.portfolioTitle} onChange={event => change("portfolioTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Client list label<Input value={draft.portfolioClientsLabel} onChange={event => change("portfolioClientsLabel", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Portfolio intro<Textarea rows={3} value={draft.portfolioBody} onChange={event => change("portfolioBody", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Clients, one per line<Textarea rows={4} value={draft.portfolioClients.join("\n")} onChange={event => change("portfolioClients", event.target.value.split("\n").map(value => value.trim()).filter(Boolean))} /></label><label className="space-y-1 text-xs text-muted-foreground">Closing eyebrow<Input value={draft.portfolioCtaEyebrow} onChange={event => change("portfolioCtaEyebrow", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Closing heading<Input value={draft.portfolioCtaTitle} onChange={event => change("portfolioCtaTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Closing button<Input value={draft.portfolioCtaLabel} onChange={event => change("portfolioCtaLabel", event.target.value)} /></label></div><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-medium">Portfolio categories</h4><Button type="button" variant="outline" size="sm" onClick={() => change("projects", [...draft.projects, { id: makeId("project"), title: "New category", image: "", description: "", category: "Events" }])}><Plus className="mr-2 h-4 w-4" />Add category</Button></div><SortableList items={draft.projects} onChange={items => change("projects", items)} removeLabel={item => `Remove ${item.title}`} render={(project, index) => <div className="grid gap-3 md:grid-cols-2"><Input value={project.title} aria-label={`Category ${index + 1} title`} placeholder="Display title" onChange={event => change("projects", draft.projects.map(item => item.id === project.id ? { ...item, title: event.target.value } : item))} /><Input value={project.category} aria-label={`Category ${index + 1} gallery filter`} placeholder="Gallery filter" onChange={event => change("projects", draft.projects.map(item => item.id === project.id ? { ...item, category: event.target.value } : item))} /><Textarea className="md:col-span-2" rows={2} value={project.description} aria-label={`Category ${index + 1} description`} onChange={event => change("projects", draft.projects.map(item => item.id === project.id ? { ...item, description: event.target.value } : item))} /><ImageUploadField label={`${project.title} cover`} value={project.image} onChange={value => change("projects", draft.projects.map(item => item.id === project.id ? { ...item, image: value } : item))} /></div>} />
      <div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); uploadGalleryFiles(event.dataTransfer.files); }} className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-dashed border-border p-4"><div><h4 className="text-sm font-medium">Portfolio gallery</h4><p className="text-[11px] text-muted-foreground">Drop multiple original photos here, then drag rows into order.</p></div><input id={bulkInputId} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={event => event.target.files && uploadGalleryFiles(event.target.files)} /><Button asChild type="button" variant="outline" size="sm" disabled={bulkUploading}><label htmlFor={bulkInputId} className="cursor-pointer">{bulkUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}Upload photos</label></Button></div>
      <GalleryGridEditor items={draft.galleryImages} onChange={items => change("galleryImages", items)} />
    </EditorSection>

    <EditorSection title="Concert page" description="Edit the dedicated live-music page and add concert photos directly to it."><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground">Eyebrow<Input value={draft.concertEyebrow} onChange={event => change("concertEyebrow", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Page heading<Input value={draft.concertTitle} onChange={event => change("concertTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Introduction<Textarea rows={4} value={draft.concertBody} onChange={event => change("concertBody", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Highlights, one per line<Textarea rows={5} value={draft.concertHighlights.join("\n")} onChange={event => change("concertHighlights", event.target.value.split("\n").map(value => value.trim()).filter(Boolean))} /></label><ImageUploadField label="Concert hero" value={draft.concertHeroImage} recommendedWidth={3200} onChange={value => change("concertHeroImage", value)} /></div>
      <div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); uploadGalleryFiles(event.dataTransfer.files, "Live Music", true); }} className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-dashed border-border p-4"><div><h4 className="text-sm font-medium">Concert photographs</h4><p className="text-[11px] text-muted-foreground">{draft.galleryImages.filter(image => image.category.trim().toLowerCase() === "live music").length} live-music photos · new uploads are added to this page automatically.</p></div><input id={concertInputId} type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={event => event.target.files && uploadGalleryFiles(event.target.files, "Live Music", true)} /><div className="flex gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => window.open("/portfolio-preview/concerts", "_blank")}><Eye className="mr-2 h-4 w-4" />Preview page</Button><Button asChild type="button" variant="outline" size="sm" disabled={concertUploading}><label htmlFor={concertInputId} className="cursor-pointer">{concertUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}Add concert photos</label></Button></div></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{draft.galleryImages.filter(image => image.category.trim().toLowerCase() === "live music").map(image => <div key={image.id} className="group relative aspect-square overflow-hidden rounded border border-border bg-muted"><img src={image.image} alt={image.alt} className="h-full w-full object-cover" /><button type="button" className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded bg-background/90 text-muted-foreground opacity-0 shadow group-hover:opacity-100 focus:opacity-100" onClick={() => change("galleryImages", draft.galleryImages.filter(item => item.id !== image.id))} aria-label={`Remove ${image.alt}`}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>
    </EditorSection>

    <EditorSection title="About page"><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Detailed about text<Textarea rows={4} value={draft.aboutSecondaryBody} onChange={event => change("aboutSecondaryBody", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Approach eyebrow<Input value={draft.aboutApproachEyebrow} onChange={event => change("aboutApproachEyebrow", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Approach heading<Input value={draft.aboutApproachTitle} onChange={event => change("aboutApproachTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Approach text<Textarea rows={3} value={draft.aboutApproachBody} onChange={event => change("aboutApproachBody", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Image caption<Input value={draft.aboutSupportingCaption} onChange={event => change("aboutSupportingCaption", event.target.value)} /></label><ImageUploadField label="Approach image" value={draft.aboutSupportingImage} onChange={value => change("aboutSupportingImage", value)} /></div><div className="flex items-center justify-between"><h4 className="text-sm font-medium">Values</h4><Button type="button" variant="outline" size="sm" onClick={() => change("aboutValues", [...draft.aboutValues, { id: makeId("value"), title: "New value", body: "" }])}><Plus className="mr-2 h-4 w-4" />Add value</Button></div><SortableList items={draft.aboutValues} onChange={items => change("aboutValues", items)} removeLabel={item => `Remove ${item.title}`} render={value => <div className="grid gap-3 md:grid-cols-2"><Input value={value.title} placeholder="Value title" onChange={event => change("aboutValues", draft.aboutValues.map(item => item.id === value.id ? { ...item, title: event.target.value } : item))} /><Textarea rows={2} value={value.body} placeholder="Value description" onChange={event => change("aboutValues", draft.aboutValues.map(item => item.id === value.id ? { ...item, body: event.target.value } : item))} /></div>} /><ImageCollectionEditor label="About page ribbon" images={draft.aboutRibbonImages} onChange={images => change("aboutRibbonImages", images)} /></EditorSection>

    <EditorSection title="Testimonials"><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground">Page heading<Input value={draft.testimonialsTitle} onChange={event => change("testimonialsTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Page intro<Textarea rows={3} value={draft.testimonialsIntro} onChange={event => change("testimonialsIntro", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Feature eyebrow<Input value={draft.testimonialsFeatureEyebrow} onChange={event => change("testimonialsFeatureEyebrow", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Feature heading<Input value={draft.testimonialsFeatureTitle} onChange={event => change("testimonialsFeatureTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Feature points, one per line<Textarea rows={4} value={draft.testimonialsFeaturePoints.join("\n")} onChange={event => change("testimonialsFeaturePoints", event.target.value.split("\n").map(value => value.trim()).filter(Boolean))} /></label><ImageUploadField label="Testimonials feature image" value={draft.testimonialsImage} onChange={value => change("testimonialsImage", value)} /></div><ImageCollectionEditor label="Testimonials ribbon" images={draft.testimonialsRibbonImages} onChange={images => change("testimonialsRibbonImages", images)} /><div className="flex items-center justify-between"><h4 className="text-sm font-medium">Client reviews</h4><Button type="button" variant="outline" size="sm" onClick={() => change("testimonials", [...draft.testimonials, { id: makeId("review"), quote: "", author: "", context: "" }])}><Plus className="mr-2 h-4 w-4" />Add review</Button></div><SortableList items={draft.testimonials} onChange={items => change("testimonials", items)} removeLabel={item => `Remove review by ${item.author || "client"}`} render={(review, index) => <div className="grid gap-3 md:grid-cols-2"><Input value={review.author} aria-label={`Review ${index + 1} client`} placeholder="Client name" onChange={event => change("testimonials", draft.testimonials.map(item => item.id === review.id ? { ...item, author: event.target.value } : item))} /><Input value={review.context} aria-label={`Review ${index + 1} context`} placeholder="Wedding, event, portrait…" onChange={event => change("testimonials", draft.testimonials.map(item => item.id === review.id ? { ...item, context: event.target.value } : item))} /><Textarea className="md:col-span-2" rows={3} value={review.quote} aria-label={`Review ${index + 1} quote`} placeholder="Client review" onChange={event => change("testimonials", draft.testimonials.map(item => item.id === review.id ? { ...item, quote: event.target.value } : item))} /></div>} /></EditorSection>

    <EditorSection title="Booking enquiry" description="Controls the enquiry page, workflow steps and notifications."><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground">Page heading<Input value={draft.bookingTitle} onChange={event => change("bookingTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Button label<Input value={draft.bookingButtonLabel} onChange={event => change("bookingButtonLabel", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Intro text<Textarea rows={3} value={draft.bookingBody} onChange={event => change("bookingBody", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Event choices, one per line<Textarea rows={6} value={draft.enquiryEventTypes.join("\n")} onChange={event => change("enquiryEventTypes", event.target.value.split("\n").map(value => value.trim()).filter(Boolean))} /></label><ImageUploadField label="Enquiry page image" value={draft.enquiryImage} recommendedWidth={3200} onChange={value => change("enquiryImage", value)} /></div><div className="flex items-center justify-between"><h4 className="text-sm font-medium">Enquiry steps</h4><Button type="button" variant="outline" size="sm" onClick={() => change("enquirySteps", [...draft.enquirySteps, { id: makeId("step"), title: "New step", body: "" }])}><Plus className="mr-2 h-4 w-4" />Add step</Button></div><SortableList items={draft.enquirySteps} onChange={items => change("enquirySteps", items)} removeLabel={item => `Remove ${item.title}`} render={step => <div className="grid gap-3 md:grid-cols-2"><Input value={step.title} placeholder="Step title" onChange={event => change("enquirySteps", draft.enquirySteps.map(item => item.id === step.id ? { ...item, title: event.target.value } : item))} /><Textarea rows={2} value={step.body} placeholder="Step description" onChange={event => change("enquirySteps", draft.enquirySteps.map(item => item.id === step.id ? { ...item, body: event.target.value } : item))} /></div>} /><div className="space-y-2"><label className="space-y-1 text-xs text-muted-foreground">Discord webhook URL<Input type="password" value={draft.webhookUrl || ""} onChange={event => change("webhookUrl", event.target.value)} placeholder="https://discord.com/api/webhooks/…" /></label><p className="text-[11px] text-muted-foreground">Stored privately. Enquiries still appear under Admin → Enquiries without a webhook.</p><Button type="button" variant="outline" size="sm" onClick={testWebhook} disabled={testingWebhook}><Send className="mr-2 h-4 w-4" />{testingWebhook ? "Sending…" : "Send test"}</Button></div></EditorSection>

    <EditorSection title="Contact and footer"><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-xs text-muted-foreground">Location label<Input value={draft.locationLabel} onChange={event => change("locationLabel", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Footer heading<Input value={draft.footerTitle} onChange={event => change("footerTitle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Contact email<Input type="email" value={draft.contactEmail} onChange={event => change("contactEmail", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Instagram URL<Input value={draft.instagramUrl} onChange={event => change("instagramUrl", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Instagram handle<Input value={draft.instagramHandle} onChange={event => change("instagramHandle", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">LinkedIn URL<Input value={draft.linkedinUrl} onChange={event => change("linkedinUrl", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Featured testimonial<Textarea rows={3} value={draft.testimonial} onChange={event => change("testimonial", event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Featured client<Input value={draft.testimonialAuthor} onChange={event => change("testimonialAuthor", event.target.value)} /></label></div></EditorSection>
      </div>
      {previewOpen && <div className="sticky top-[68px] hidden min-w-0 xl:block"><LivePortfolioPreview draft={draft} /></div>}
      {previewOpen && <div className="xl:hidden"><LivePortfolioPreview draft={draft} /></div>}
    </div>
  </div>;
}
