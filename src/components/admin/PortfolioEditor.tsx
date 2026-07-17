import { useEffect, useState } from "react";
import { ExternalLink, Eye, Globe, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { defaultPortfolioSite, fetchPortfolioDraft, publishPortfolio, savePortfolioDraft, type PortfolioSite } from "@/lib/portfolio";

export default function PortfolioEditor() {
  const [draft, setDraft] = useState<PortfolioSite>(defaultPortfolioSite);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string>();

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
        <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Logo image URL<Input value={draft.logo} onChange={e => change("logo", e.target.value)} /></label>
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-7"><h3 className="font-display text-2xl">About</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">Intro line<Input value={draft.introEyebrow} onChange={e => change("introEyebrow", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Heading<Input value={draft.introTitle} onChange={e => change("introTitle", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">About text<Textarea rows={4} value={draft.introBody} onChange={e => change("introBody", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Portrait image URL<Input value={draft.portrait} onChange={e => change("portrait", e.target.value)} /></label>
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-7"><h3 className="font-display text-2xl">Portfolio categories</h3>
      <div className="divide-y divide-border border-y border-border">
        {draft.projects.map((project, index) => <div className="grid gap-3 py-5 md:grid-cols-2" key={project.id}>
          <Input value={project.title} aria-label={`Project ${index + 1} title`} onChange={e => change("projects", draft.projects.map((p, i) => i === index ? { ...p, title: e.target.value } : p))} />
          <Input value={project.image} aria-label={`Project ${index + 1} image`} onChange={e => change("projects", draft.projects.map((p, i) => i === index ? { ...p, image: e.target.value } : p))} />
          <Textarea className="md:col-span-2" rows={2} value={project.description} aria-label={`Project ${index + 1} description`} onChange={e => change("projects", draft.projects.map((p, i) => i === index ? { ...p, description: e.target.value } : p))} />
        </div>)}
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-7"><h3 className="font-display text-2xl">Testimonial and contact</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">Testimonial<Textarea rows={3} value={draft.testimonial} onChange={e => change("testimonial", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Client name<Input value={draft.testimonialAuthor} onChange={e => change("testimonialAuthor", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Contact email<Input type="email" value={draft.contactEmail} onChange={e => change("contactEmail", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Instagram URL<Input value={draft.instagramUrl} onChange={e => change("instagramUrl", e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Instagram handle<Input value={draft.instagramHandle} onChange={e => change("instagramHandle", e.target.value)} /></label>
      </div>
    </section>
  </div>;
}
