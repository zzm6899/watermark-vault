import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check, ChevronLeft, ChevronRight, Instagram, Linkedin, Mail, Menu, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { defaultPortfolioSite, fetchPublishedPortfolio, submitPortfolioEnquiry, type PortfolioEnquiry, type PortfolioGalleryImage, type PortfolioSite as PortfolioSiteData } from "@/lib/portfolio";
import "./portfolio-site.css";

function routeFor(preview: boolean, path: string) {
  return preview ? `/portfolio-preview${path === "/" ? "" : path}` : path;
}

function normalizeSitePath(pathname: string) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return normalized || "/";
}

function SiteHeader({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const currentPath = normalizeSitePath(preview ? location.pathname.replace("/portfolio-preview", "") || "/" : location.pathname);
  const links = [["Portfolio", "/portfolio"], ["Concerts", "/concerts"], ["About", "/about"], ["Testimonials", "/testimonials"], [site.bookingButtonLabel, "/enquire"]];
  const active = (path: string) => currentPath === path || (path === "/enquire" && currentPath === "/contact");
  return <header className="portfolio-header">
    <nav aria-label="Main navigation">
      <Link className={active("/portfolio") ? "active" : ""} aria-current={active("/portfolio") ? "page" : undefined} to={routeFor(preview, "/portfolio")}>Portfolio</Link>
      <Link className={active("/concerts") || active("/concert") ? "active" : ""} aria-current={active("/concerts") || active("/concert") ? "page" : undefined} to={routeFor(preview, "/concerts")}>Concerts</Link>
      <Link className="portfolio-brand" to={routeFor(preview, "/")} aria-label={site.brandName}><img src={site.logo} alt={site.brandName} /></Link>
      <Link className={active("/about") ? "active" : ""} aria-current={active("/about") ? "page" : undefined} to={routeFor(preview, "/about")}>About</Link>
      <Link className={active("/testimonials") ? "active" : ""} aria-current={active("/testimonials") ? "page" : undefined} to={routeFor(preview, "/testimonials")}>Testimonials</Link>
      <Link className={`portfolio-book-link ${active("/enquire") ? "active" : ""}`} aria-current={active("/enquire") ? "page" : undefined} to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}</Link>
      <button className="portfolio-menu" onClick={() => setOpen(value => !value)} aria-label={open ? "Close navigation" : "Open navigation"}>{open ? <X /> : <Menu />}</button>
    </nav>
    {open && <div className="portfolio-mobile-nav">{links.map(([label, path]) => <Link key={path} to={routeFor(preview, path)} onClick={() => setOpen(false)}>{label}</Link>)}</div>}
  </header>;
}

function SiteFooter({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <footer>
    <div className="portfolio-footer-lead"><p>{site.locationLabel}</p><h2>{site.footerTitle}</h2><Link className="portfolio-footer-cta" to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}<ArrowRight /></Link></div>
    <a className="portfolio-footer-email" href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
    <div className="portfolio-footer-bottom">
      <div className="portfolio-socials">
        <a href={site.instagramUrl} target="_blank" rel="noreferrer"><Instagram /> {site.instagramHandle}</a>
        <a href={site.linkedinUrl} target="_blank" rel="noreferrer"><Linkedin /> LinkedIn</a>
        <a href={`mailto:${site.contactEmail}`}><Mail /> Email</a>
      </div>
      <nav aria-label="Footer navigation"><Link to={routeFor(preview, "/portfolio")}>Work</Link><Link to={routeFor(preview, "/concerts")}>Concerts</Link><Link to={routeFor(preview, "/about")}>About</Link><Link to={routeFor(preview, "/testimonials")}>Reviews</Link></nav>
    </div>
    <small>© {new Date().getFullYear()} {site.brandName}</small>
  </footer>;
}

function UrlImageRibbon({ images }: { images: string[] }) {
  return <section className="portfolio-image-ribbon" aria-label="Selected photographs" data-reveal>{images.filter(Boolean).slice(0, 3).map((image, index) => <img key={`${image}-${index}`} src={image} alt="" loading="lazy" />)}</section>;
}

function StoryIndex({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const [active, setActive] = useState(0);
  const project = site.projects[active] || site.projects[0];
  const projectRoute = (category: string) => category.trim().toLowerCase() === "live music" ? routeFor(preview, "/concerts") : `${routeFor(preview, "/portfolio")}?category=${encodeURIComponent(category || "All")}`;
  return <section className="portfolio-story-index" data-reveal>
    <div className="portfolio-story-heading"><p>{site.storyEyebrow}</p><h2>{site.storyTitle}</h2></div>
    <div className="portfolio-story-layout">
      <div className="portfolio-story-list">{site.projects.map((item, index) => <Link className={active === index ? "active" : ""} key={item.id} to={projectRoute(item.category)} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)}>
        <span>{String(index + 1).padStart(2, "0")}</span><img className="portfolio-story-thumb" src={item.image} alt="" loading="lazy" /><div><h3>{item.title}</h3><p>{item.description}</p></div><ArrowRight />
      </Link>)}</div>
      <figure key={project?.id}><img src={project?.image} alt={project?.title} /><figcaption>Explore {project?.title}</figcaption></figure>
    </div>
  </section>;
}

function HomePage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const heroFrames = (site.heroImages?.length ? site.heroImages : [site.heroImage]).filter((image, index, all): image is string => !!image && all.indexOf(image) === index);
  return <>
    <section className="portfolio-hero" aria-label={site.heroLabel}>
      <div className="portfolio-hero-media" aria-hidden="true">{heroFrames.map((image, index) => <img key={image} src={image} alt="" style={{ animationDelay: `${index * 6}s` }} />)}</div>
      <div className="portfolio-hero-copy"><p>{site.heroLabel}</p><h1>{site.brandName}</h1><div className="portfolio-hero-actions"><Link to={routeFor(preview, "/portfolio")}>View portfolio</Link><Link to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}</Link></div></div>
      <div className="portfolio-hero-meta"><span>{site.locationLabel}</span><span>{site.heroServicesLabel}</span></div>
      <a href="#introduction" className="portfolio-scroll" aria-label="Continue"><ArrowDown /></a>
    </section>
    <section className="portfolio-about" id="introduction" data-reveal><div className="portfolio-about-copy"><p className="portfolio-kicker">{site.introEyebrow}</p><h2>{site.introTitle}</h2><p>{site.introBody}</p><Link to={routeFor(preview, "/about")}>More about Zac</Link></div><figure><img src={site.portrait} alt="Zac Morgan photographing an event" /></figure></section>
    <UrlImageRibbon images={site.homeRibbonImages} />
    <section className="portfolio-philosophy" data-reveal><figure><img src={site.philosophyImage || site.heroImage} alt="Selected portfolio photograph" loading="lazy" /></figure><div><p className="portfolio-kicker">{site.philosophyEyebrow}</p><h2>{site.philosophyTitle}</h2><p>{site.philosophyBody}</p><Link to={routeFor(preview, "/portfolio")}>See the full portfolio <ArrowRight /></Link></div></section>
    <StoryIndex site={site} preview={preview} />
    <section className="portfolio-testimonial" data-reveal><p className="portfolio-kicker">Kind words</p><blockquote>“{site.testimonial}”</blockquote><cite>{site.testimonialAuthor}</cite><Link to={routeFor(preview, "/testimonials")}>Read client stories</Link></section>
  </>;
}

function PortfolioGallery({ images, initialFilter, showFilters = true }: { images: PortfolioGalleryImage[]; initialFilter?: string | null; showFilters?: boolean }) {
  const [filter, setFilter] = useState(initialFilter || "All");
  const [selected, setSelected] = useState<number | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const categories = useMemo(() => ["All", ...Array.from(new Set(images.map(image => image.category).filter(Boolean)))], [images]);
  const visible = filter === "All" ? images : images.filter(image => image.category === filter);
  const categoryCount = (category: string) => category === "All" ? images.length : images.filter(image => image.category === category).length;
  const chooseFilter = (category: string) => {
    setFilter(category);
    setSelected(null);
    if (!showFilters) return;
    const params = new URLSearchParams(location.search);
    if (category === "All") params.delete("category"); else params.set("category", category);
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : "" }, { replace: true });
  };
  useEffect(() => { setFilter(initialFilter && categories.includes(initialFilter) ? initialFilter : "All"); setSelected(null); }, [initialFilter, categories]);
  const move = useCallback((direction: number) => setSelected(current => current === null ? null : (current + direction + visible.length) % visible.length), [visible.length]);
  useEffect(() => {
    if (selected === null) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
      if (event.key === "Tab" && lightboxRef.current) {
        const controls = Array.from(lightboxRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (controls.length === 0) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [move, selected]);
  return <section className="portfolio-gallery-section">
    <div className="portfolio-gallery-toolbar"><p>{visible.length} photographs</p>{showFilters && <div role="group" aria-label="Filter portfolio">{categories.map(category => <button className={filter === category ? "active" : ""} key={category} onClick={() => chooseFilter(category)} aria-pressed={filter === category}><span>{category}</span><small>{categoryCount(category)}</small></button>)}</div>}</div>
    <div className="portfolio-gallery-grid">{visible.map((image, index) => <button className={`portfolio-gallery-item portfolio-gallery-item-${index % 8}`} key={image.id} onClick={() => setSelected(index)} aria-label={`Open ${image.alt}`}><img src={image.image} alt={image.alt} loading="lazy" /><span>{image.category}</span></button>)}</div>
    {selected !== null && visible[selected] && <div ref={lightboxRef} className="portfolio-lightbox" role="dialog" aria-modal="true" aria-label={visible[selected].alt}>
      <button ref={closeRef} className="portfolio-lightbox-close" onClick={() => setSelected(null)} aria-label="Close photo"><X /></button>
      <button className="portfolio-lightbox-prev" onClick={() => move(-1)} aria-label="Previous photo"><ChevronLeft /></button>
      <figure><img src={visible[selected].image} alt={visible[selected].alt} /><figcaption><span>{visible[selected].category}</span>{visible[selected].alt}</figcaption></figure>
      <button className="portfolio-lightbox-next" onClick={() => move(1)} aria-label="Next photo"><ChevronRight /></button>
    </div>}
  </section>;
}

function WorkPage({ site, preview, category }: { site: PortfolioSiteData; preview: boolean; category?: string | null }) {
  const categoryRoute = (projectCategory: string) => `${routeFor(preview, "/portfolio")}?category=${encodeURIComponent(projectCategory || "All")}`;
  const activeProject = category ? site.projects.find(project => project.category === category) : undefined;
  const galleryImages = activeProject ? site.galleryImages.filter(image => image.image !== activeProject.image) : site.galleryImages;
  return <>
    {!activeProject && <section className="portfolio-page-intro portfolio-page-intro-work" data-reveal><p>Portfolio</p><h1>{site.portfolioTitle}</h1><span>{site.portfolioBody}</span><div className="portfolio-client-line"><span>{site.portfolioClientsLabel}</span>{site.portfolioClients.map(client => <strong key={client}>{client}</strong>)}</div></section>}
    {!activeProject && <section className="portfolio-category-index" aria-label="Photography categories" data-reveal>
      <div className="portfolio-category-heading"><p className="portfolio-kicker">Selected disciplines</p><h2>Find your kind of energy.</h2></div>
      <div className="portfolio-category-grid">{site.projects.map((project, index) => <Link className="portfolio-category-card" key={project.id} to={categoryRoute(project.category)}>
        <img src={project.image} alt="" loading={index > 1 ? "lazy" : undefined} />
        <div><span>{String(index + 1).padStart(2, "0")} · {site.galleryImages.filter(image => image.category === project.category).length} photographs</span><h3>{project.title}</h3><p>{project.description}</p><ArrowRight /></div>
      </Link>)}</div>
    </section>}
    {activeProject && <section className="portfolio-category-focus" data-reveal><img src={activeProject.image} alt={activeProject.title} /><div><p className="portfolio-kicker">Focused collection</p><h2>{activeProject.title}</h2><span>{activeProject.description}</span><Link to={routeFor(preview, "/portfolio")}>View every category <ArrowRight /></Link></div></section>}
    <section className="portfolio-gallery-lead" data-reveal><p className="portfolio-kicker">{activeProject ? `${activeProject.title} edit` : "The full edit"}</p><h2>{activeProject ? "Movement, atmosphere and the decisive frame." : "People, pressure and the moment between."}</h2><span>{activeProject ? `${site.galleryImages.filter(image => image.category === activeProject.category).length} selected photographs in this collection.` : "Browse the complete collection or narrow the work by discipline."}</span></section>
    <PortfolioGallery images={galleryImages} initialFilter={category} />
    <section className="portfolio-inline-cta"><div><p className="portfolio-kicker">{site.portfolioCtaEyebrow}</p><h2>{site.portfolioCtaTitle}</h2></div><Link to={routeFor(preview, "/enquire")}>{site.portfolioCtaLabel} <ArrowRight /></Link></section>
  </>;
}

function ConcertPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const images = site.galleryImages.filter(image => image.category.trim().toLowerCase() === "live music");
  const hero = site.concertHeroImage || images[0]?.image || site.heroImage;
  return <>
    <section className="portfolio-concert-hero">
      <img src={hero} alt="Concert photographed by Zac Morgan" />
      <div><p>{site.concertEyebrow}</p><h1>{site.concertTitle}</h1><span>{site.locationLabel} · Available for artists, venues and festivals</span></div>
    </section>
    <section className="portfolio-concert-intro" data-reveal>
      <div><p className="portfolio-kicker">Live work</p><strong>{images.length}</strong><span>concert photographs in this collection</span></div>
      <div><p>{site.concertBody}</p><Link to={routeFor(preview, "/enquire")}>Book live coverage <ArrowRight /></Link></div>
    </section>
    <section className="portfolio-concert-highlights" aria-label="Concert photography services">{site.concertHighlights.filter(Boolean).map((highlight, index) => <div key={`${highlight}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{highlight}</p></div>)}</section>
    <PortfolioGallery images={images} showFilters={false} />
    <section className="portfolio-inline-cta"><div><p className="portfolio-kicker">On the bill?</p><h2>Bring the night back with you.</h2></div><Link to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel} <ArrowRight /></Link></section>
  </>;
}

function AboutPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <>
    <section className="portfolio-about-page" data-reveal><figure><img src={site.portrait} alt="Zac Morgan" /></figure><div><p className="portfolio-kicker">About Zac</p><h1>{site.introTitle}</h1><p>{site.introBody}</p><p>{site.aboutSecondaryBody}</p><Link to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}<ArrowRight /></Link></div></section>
    <section className="portfolio-about-manifesto" data-reveal><div><p className="portfolio-kicker">{site.aboutApproachEyebrow}</p><h2>{site.aboutApproachTitle}</h2><p>{site.aboutApproachBody}</p></div>{site.aboutSupportingImage && <figure><img src={site.aboutSupportingImage} alt="Zac Morgan Photography at work" loading="lazy" /><figcaption>{site.aboutSupportingCaption}</figcaption></figure>}</section>
    <section className="portfolio-values">{site.aboutValues.map((value, index) => <div key={`${value.title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><h2>{value.title}</h2><p>{value.body}</p></div>)}</section>
    <UrlImageRibbon images={site.aboutRibbonImages} />
  </>;
}

function TestimonialsPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const reviews = site.testimonials.length ? site.testimonials : [{ quote: site.testimonial, author: site.testimonialAuthor, context: "Client" }];
  return <>
    <section className="portfolio-page-intro portfolio-page-intro-testimonials"><p>Testimonials</p><h1>{site.testimonialsTitle}</h1><span>{site.testimonialsIntro}</span></section>
    <section className="portfolio-quote-page"><p>Featured review</p><blockquote>“{reviews[0].quote}”</blockquote><cite>{reviews[0].author} · {reviews[0].context}</cite></section>
    <section className="portfolio-reviews">{reviews.slice(1).map((review, index) => <blockquote key={`${review.author}-${index}`}><span>{String(index + 2).padStart(2, "0")}</span><p>“{review.quote}”</p><div className="portfolio-review-by">{review.author}<small>{review.context}</small></div></blockquote>)}</section>
    <UrlImageRibbon images={site.testimonialsRibbonImages} />
    <section className="portfolio-testimonial-image"><img src={site.testimonialsImage || site.heroImage} alt="Client event photographed by Zac Morgan" /><div><p>{site.testimonialsFeatureEyebrow}</p><h2>{site.testimonialsFeatureTitle}</h2><ul>{site.testimonialsFeaturePoints.map(point => <li key={point}><Check />{point}</li>)}</ul><Link to={routeFor(preview, "/enquire")}>Start an enquiry <ArrowRight /></Link></div></section>
  </>;
}

const emptyEnquiry: PortfolioEnquiry = { name: "", email: "", phone: "", eventTypeTitle: "", preferredDate: "", venue: "", referralSource: "", message: "", website: "" };
function EnquiryPage({ site }: { site: PortfolioSiteData }) {
  const [form, setForm] = useState(emptyEnquiry);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const update = (key: keyof PortfolioEnquiry, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSending(true); setError("");
    try { await submitPortfolioEnquiry(form); setSent(true); setForm(emptyEnquiry); } catch (err) { setError(err instanceof Error ? err.message : "Could not send enquiry"); } finally { setSending(false); }
  };
  return <>
    {site.enquiryImage && <section className="portfolio-enquiry-visual"><img src={site.enquiryImage} alt="Event photographed by Zac Morgan" /><div><span>Availability · Pricing · Coverage</span></div></section>}
    <section className="portfolio-enquiry-page"><div className="portfolio-enquiry-intro"><p className="portfolio-kicker">Availability and pricing</p><h1>{site.bookingTitle}</h1><p>{site.bookingBody}</p><div><a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a><span>{site.locationLabel}</span></div></div>
      {sent ? <div className="portfolio-enquiry-success"><Check /><h2>Enquiry received.</h2><p>Thanks for getting in touch. Zac will reply with availability and next steps.</p><button onClick={() => setSent(false)}>Send another enquiry</button></div> : <form className="portfolio-enquiry-form" onSubmit={submit}>
        <label>Name<input required value={form.name} onChange={event => update("name", event.target.value)} autoComplete="name" /></label>
        <label>Email<input required type="email" value={form.email} onChange={event => update("email", event.target.value)} autoComplete="email" /></label>
        <label>Phone<input value={form.phone} onChange={event => update("phone", event.target.value)} autoComplete="tel" /></label>
        <label>What are you planning?<select required value={form.eventTypeTitle} onChange={event => update("eventTypeTitle", event.target.value)}><option value="">Choose one</option>{site.enquiryEventTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        <label>Preferred date<input type="date" min={today} value={form.preferredDate} onChange={event => update("preferredDate", event.target.value)} /></label>
        <label>Venue / location<input value={form.venue} onChange={event => update("venue", event.target.value)} /></label>
        <label className="portfolio-form-wide">How did you find me?<select value={form.referralSource} onChange={event => update("referralSource", event.target.value)}><option value="">Choose one</option><option>Recommended by a friend</option><option>Recent event or shoot</option><option>Instagram</option><option>Google</option><option>Bark / Oneflare / Airtasker</option><option>Other</option></select></label>
        <label className="portfolio-form-wide">Tell me about it<textarea required rows={6} value={form.message} onChange={event => update("message", event.target.value)} placeholder="Guest count, timings, priorities and anything useful to know." /></label>
        <label className="portfolio-honeypot" aria-hidden="true">Website<input tabIndex={-1} value={form.website} onChange={event => update("website", event.target.value)} autoComplete="off" /></label>
        {error && <p className="portfolio-form-error">{error}</p>}
        <button className="portfolio-submit" disabled={sending}>{sending ? "Sending…" : "Send enquiry"}<ArrowRight /></button>
      </form>}
    </section>
    <section className="portfolio-enquiry-steps">{site.enquirySteps.map((step, index) => <Fragment key={`${step.title}-${index}`}><div><span>{String(index + 1).padStart(2, "0")}</span><h2>{step.title}</h2><p>{step.body}</p></div>{index < site.enquirySteps.length - 1 && <ArrowRight />}</Fragment>)}</section>
  </>;
}

export default function PortfolioSite() {
  const [site, setSite] = useState<PortfolioSiteData>(defaultPortfolioSite);
  const location = useLocation();
  const preview = location.pathname.startsWith("/portfolio-preview");
  const path = normalizeSitePath(preview ? location.pathname.replace("/portfolio-preview", "") || "/" : location.pathname);
  const category = new URLSearchParams(location.search).get("category");
  const editorPreview = preview && (new URLSearchParams(location.search).get("editor") === "1" || window.self !== window.top);
  useEffect(() => {
    if (!editorPreview) {
      fetchPublishedPortfolio().then(setSite);
      return;
    }
    const receiveDraft = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.type !== "wv:portfolio-preview" || !event.data.site || typeof event.data.site !== "object") return;
      setSite({ ...defaultPortfolioSite, ...event.data.site });
    };
    window.addEventListener("message", receiveDraft);
    window.parent.postMessage({ type: "wv:portfolio-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", receiveDraft);
  }, [editorPreview]);
  useEffect(() => { document.title = path === "/" ? site.brandName : `${path.slice(1).replace(/-/g, " ")} — ${site.brandName}`; window.scrollTo(0, 0); }, [path, location.search, site.brandName]);
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".portfolio-site [data-reveal]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { elements.forEach(element => element.classList.add("revealed")); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { (entry.target as HTMLElement).classList.add("revealed"); observer.unobserve(entry.target); } }), { threshold: 0.12 });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [path, site.updatedAt, site.galleryImages.length]);
  const page = path === "/portfolio" ? <WorkPage site={site} preview={preview} category={category} /> : path === "/concerts" || path === "/concert" ? <ConcertPage site={site} preview={preview} /> : path === "/about" ? <AboutPage site={site} preview={preview} /> : path === "/testimonials" ? <TestimonialsPage site={site} preview={preview} /> : path === "/enquire" || path === "/contact" ? <EnquiryPage site={site} /> : <HomePage site={site} preview={preview} />;
  return <div className="portfolio-site"><SiteHeader site={site} preview={preview} /><main>{page}</main><SiteFooter site={site} preview={preview} /></div>;
}
