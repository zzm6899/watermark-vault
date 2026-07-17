import { useEffect, useState } from "react";
import { ExternalLink, Eye, Globe, Loader2, Plus, Save, Send, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { defaultPortfolioSite, fetchPortfolioDraft, publishPortfolio, savePortfolioDraft, testPortfolioWebhook, uploadPortfolioImage, type PortfolioSite } from "@/lib/portfolio";

function ImageUploadField({ label, value, onChange }: { label: string; value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const id = `portfolio-image-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try { onChange(await uploadPortfolioImage(file)); toast.success(`${label} uploaded`); } catch (error) { toast.error(error instanceof Error ? error.message : "Upload failed"); } finally { setUploading(false); }
  };
  return <div className="space-y-2 md:col-span-2"><p className="text-xs text-muted-foreground">{label}</p><div className="flex flex-col gap-3 sm:flex-row sm:items-center">
    <div className="h-24 w-full overflow-hidden rounded-md border border-border bg-secondary sm:w-40">{value && <img src={value} alt="" className="h-full w-full object-cover" />}</div>
    <div className="min-w-0 flex-1 space-y-2"><Input value={value} onChange={event => onChange(event.target.value)} aria-label={`${label} URL`} /><input id={id} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={event => upload(event.target.files?.[0])} />
      <Button asChild variant="outline" size="sm" disabled={uploading}><label htmlFor={id} className="cursor-pointer">{uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{uploading ? "Uploading…" : "Upload image"}</label></Button>
    </div>
  </div></div>;
}

export default function PortfolioEditor() {
  const [draft, setDraft] = useState<PortfolioSite>(defaultPortfolioSite);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string>();
  const [testingWebhook, setTestingWebhook] = useState(false);

  useEffect(() => {
    fetchPortfolioDraft().then(data => { setDraft(data.draft); setPublishedAt(data.publishedAt); }).catch(err => toast.error(err.message)).finally(() => setLoading(false));
  }, []);

  const change = <K extends keyof PortfolioSite>(key: K, value: PortfolioSite[K]) => setDraft(prev => ({ ...prev, [key]: value }));
  const save = async () => {
    setSaving(true);
    try { await savePortfolioDraft(draft); toast.success("Website draft saved"); } catch (err) { toast.error(err instanceof Error ? err.message : "Save failed"); } finally { setSaving(false); }
  };
  const publish = async () => {
    setSaving(true);
    try { await savePortfolioDraft(draft); const result = await publishPortfolio(); setPublishedAt(result.publishedAt); toast.success("Website published"); } catch (err) { toast.error(err instanceof Error ? err.message : "Publish failed"); } finally { setSaving(false); }
  };
  const testWebhook = async () => {
    if (!draft.webhookUrl) return toast.error("Enter a Discord webhook URL first");
    setTestingWebhook(true);
    try { await testPortfolioWebhook(draft.webhookUrl); toast.success("Test notification sent"); } catch (error) { toast.error(error instanceof Error ? error.message : "Webhook test failed"); } finally { setTestingWebhook(false); }
  };

  if (loading) return <div className="py-24 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />Loading website editor…</div>;

  return <div className="space-y-8">
    <div className="admin-page-header">
      <div><h2 className="font-display text-3xl sm:text-4xl text-foreground">Website</h2><p className="mt-2 text-sm text-muted-foreground">Edit and publish the public Zac Morgan Photography portfolio.</p></div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => window.open("/portfolio-preview", "_blank")}><Eye className="mr-2 h-4 w-4" />Preview</Button>
        <Button variant="outline" size="sm" onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4" />Save draft</Button>
        <Button size="sm" onClick={publish} disabled={saving}><Globe className="mr-2 h-4 w-4" />Publish</Button>
      </div>
    </div>

    <div className="flex items-center justify-between border-y border-border py-3 text-xs text-muted-foreground">
      <span>{publishedAt ? `Published ${new Date(publishedAt).toLocaleString()}` : "Using the original site content"}</span>
      <a className="flex items-center gap-1 text-primary" href="https://zacmclients.photos" target="_blank" rel="noreferrer">Open live site <ExternalLink className="h-3.5 w-3.5" /></a>
    </div>

    <section className="space-y-4"><div><h3 className="font-display text-2xl">Brand and hero</h3><p className="text-xs text-muted-foreground">The first screen clients see.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">Business name<Input value={draft.brandName} onChange={e => change("brandName", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Hero label<Input value={draft.heroLabel} onChange={e => change("heroLabel", e.target.value)} /></label>
        <ImageUploadField label="Logo" value={draft.logo} onChange={value => change("logo", value)} />
        <ImageUploadField label="Hero image" value={draft.heroImage} onChange={value => change("heroImage", value)} />
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-7"><h3 className="font-display text-2xl">About</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">Intro line<Input value={draft.introEyebrow} onChange={e => change("introEyebrow", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Heading<Input value={draft.introTitle} onChange={e => change("introTitle", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">About text<Textarea rows={4} value={draft.introBody} onChange={e => change("introBody", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Detailed about text<Textarea rows={4} value={draft.aboutSecondaryBody} onChange={e => change("aboutSecondaryBody", e.target.value)} /></label>
        <ImageUploadField label="Portrait image" value={draft.portrait} onChange={value => change("portrait", value)} />
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-7"><h3 className="font-display text-2xl">Page copy</h3><div className="grid gap-4 md:grid-cols-2">
      <label className="space-y-1 text-xs text-muted-foreground">Portfolio heading<Input value={draft.portfolioTitle} onChange={e => change("portfolioTitle", e.target.value)} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">Testimonials heading<Input value={draft.testimonialsTitle} onChange={e => change("testimonialsTitle", e.target.value)} /></label>
      <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Portfolio intro<Textarea rows={3} value={draft.portfolioBody} onChange={e => change("portfolioBody", e.target.value)} /></label>
      <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Footer heading<Input value={draft.footerTitle} onChange={e => change("footerTitle", e.target.value)} /></label>
    </div></section>

    <section className="space-y-4 border-t border-border pt-7"><h3 className="font-display text-2xl">Portfolio categories</h3>
      <div className="divide-y divide-border border-y border-border">
        {draft.projects.map((project, index) => <div className="grid gap-3 py-5 md:grid-cols-2" key={project.id}>
          <Input value={project.title} aria-label={`Project ${index + 1} title`} onChange={e => change("projects", draft.projects.map((p, i) => i === index ? { ...p, title: e.target.value } : p))} />
          <div className="md:row-span-2"><ImageUploadField label={`${project.title || `Project ${index + 1}`} image`} value={project.image} onChange={value => change("projects", draft.projects.map((p, i) => i === index ? { ...p, image: value } : p))} /></div>
          <Textarea className="md:col-span-2" rows={2} value={project.description} aria-label={`Project ${index + 1} description`} onChange={e => change("projects", draft.projects.map((p, i) => i === index ? { ...p, description: e.target.value } : p))} />
        </div>)}
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-7"><div className="flex items-end justify-between gap-4"><div><h3 className="font-display text-2xl">Portfolio gallery</h3><p className="text-xs text-muted-foreground">Images can be filtered by category and opened full-screen on the public site.</p></div><Button type="button" variant="outline" size="sm" onClick={() => change("galleryImages", [...draft.galleryImages, { id: `gallery-${Date.now()}`, image: "", alt: "", category: "Events" }])}><Plus className="mr-2 h-4 w-4" />Add photo</Button></div>
      <div className="divide-y divide-border border-y border-border">
        {draft.galleryImages.map((item, index) => <div className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" key={item.id}>
          <Input value={item.alt} aria-label={`Gallery photo ${index + 1} description`} placeholder="Accessible photo description" onChange={e => change("galleryImages", draft.galleryImages.map((photo, i) => i === index ? { ...photo, alt: e.target.value } : photo))} />
          <Input value={item.category} aria-label={`Gallery photo ${index + 1} category`} placeholder="Category" onChange={e => change("galleryImages", draft.galleryImages.map((photo, i) => i === index ? { ...photo, category: e.target.value } : photo))} />
          <Button type="button" variant="ghost" size="icon" title="Remove photo" onClick={() => change("galleryImages", draft.galleryImages.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
          <div className="md:col-span-3"><ImageUploadField label={`Gallery photo ${index + 1}`} value={item.image} onChange={value => change("galleryImages", draft.galleryImages.map((photo, i) => i === index ? { ...photo, image: value } : photo))} /></div>
        </div>)}
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-7"><div><h3 className="font-display text-2xl">Booking enquiry</h3><p className="text-xs text-muted-foreground">Controls the public Book now page and notification delivery.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">Page heading<Input value={draft.bookingTitle} onChange={e => change("bookingTitle", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Button label<Input value={draft.bookingButtonLabel} onChange={e => change("bookingButtonLabel", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Intro text<Textarea rows={3} value={draft.bookingBody} onChange={e => change("bookingBody", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Location label<Input value={draft.locationLabel} onChange={e => change("locationLabel", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Event choices, one per line<Textarea rows={6} value={draft.enquiryEventTypes.join("\n")} onChange={e => change("enquiryEventTypes", e.target.value.split("\n").map(v => v.trim()).filter(Boolean))} /></label>
        <div className="space-y-2 md:col-span-2"><label className="space-y-1 text-xs text-muted-foreground">Discord webhook URL<Input type="password" value={draft.webhookUrl || ""} onChange={e => change("webhookUrl", e.target.value)} placeholder="https://discord.com/api/webhooks/…" /></label><p className="text-[11px] text-muted-foreground">Stored privately and never included in public website data. Website enquiries still appear in Admin → Enquiries when no webhook is configured.</p><Button type="button" variant="outline" size="sm" onClick={testWebhook} disabled={testingWebhook}><Send className="mr-2 h-4 w-4" />{testingWebhook ? "Sending…" : "Send test"}</Button></div>
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-7"><h3 className="font-display text-2xl">Featured testimonial and contact</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Testimonial<Textarea rows={3} value={draft.testimonial} onChange={e => change("testimonial", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Client name<Input value={draft.testimonialAuthor} onChange={e => change("testimonialAuthor", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Contact email<Input type="email" value={draft.contactEmail} onChange={e => change("contactEmail", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Instagram URL<Input value={draft.instagramUrl} onChange={e => change("instagramUrl", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Instagram handle<Input value={draft.instagramHandle} onChange={e => change("instagramHandle", e.target.value)} /></label>
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-7"><div className="flex items-end justify-between gap-4"><div><h3 className="font-display text-2xl">Client reviews</h3><p className="text-xs text-muted-foreground">Shown across the dedicated Testimonials page.</p></div><Button type="button" variant="outline" size="sm" onClick={() => change("testimonials", [...draft.testimonials, { quote: "", author: "", context: "" }])}><Plus className="mr-2 h-4 w-4" />Add review</Button></div>
      <div className="divide-y divide-border border-y border-border">
        {draft.testimonials.map((review, index) => <div className="grid gap-3 py-5 md:grid-cols-[1fr_1fr_auto]" key={`${review.author}-${index}`}>
          <Input value={review.author} aria-label={`Review ${index + 1} client`} placeholder="Client name" onChange={e => change("testimonials", draft.testimonials.map((item, i) => i === index ? { ...item, author: e.target.value } : item))} />
          <Input value={review.context} aria-label={`Review ${index + 1} context`} placeholder="Wedding, event, portrait…" onChange={e => change("testimonials", draft.testimonials.map((item, i) => i === index ? { ...item, context: e.target.value } : item))} />
          <Button type="button" variant="ghost" size="icon" title="Remove review" onClick={() => change("testimonials", draft.testimonials.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
          <Textarea className="md:col-span-3" rows={3} value={review.quote} aria-label={`Review ${index + 1} quote`} placeholder="Client review" onChange={e => change("testimonials", draft.testimonials.map((item, i) => i === index ? { ...item, quote: e.target.value } : item))} />
        </div>)}
      </div>
    </section>
  </div>;
}
