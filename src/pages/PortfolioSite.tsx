import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Instagram, Linkedin, Mail, Menu, Pause, Play, X } from "lucide-react";
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
  const links = [["Home", "/"], ["Portfolio", "/portfolio"], ["Commercial", "/events"], ["Kind words", "/testimonials"], [site.bookingButtonLabel, "/enquire"]];
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); menuRef.current?.focus(); } };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [open]);
  const active = (path: string) => currentPath === path || (path === "/enquire" && currentPath === "/contact");
  return <header className="portfolio-header">
    <nav aria-label="Main navigation">
      <Link className="portfolio-brand" to={routeFor(preview, "/")} aria-label={site.brandName}><img src={site.logo} alt="" /><span>{site.brandName.replace(/\s+Photography$/i, "")}<small>Photography</small></span></Link>
      <div className="portfolio-desktop-nav">{links.map(([label, path]) => <Link key={path} className={`${active(path) ? "active" : ""} ${path === "/enquire" ? "portfolio-book-link" : ""}`} aria-current={active(path) ? "page" : undefined} to={routeFor(preview, path)}>{label}</Link>)}</div>
      <button ref={menuRef} className="portfolio-menu" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="portfolio-mobile-navigation" aria-label={open ? "Close navigation" : "Open navigation"}>{open ? <X /> : <Menu />}</button>
    </nav>
    {open && <nav id="portfolio-mobile-navigation" aria-label="Mobile navigation" className="portfolio-mobile-nav">{links.map(([label, path]) => <Link key={path} aria-current={active(path) ? "page" : undefined} to={routeFor(preview, path)} onClick={() => setOpen(false)}>{label}</Link>)}</nav>}
  </header>;
}

function SiteFooter({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <footer>
    <div className="portfolio-footer-lead"><div><h2>{site.brandName.replace(/\s+Photography$/i, "")}</h2><p>{site.footerTitle}</p></div><Link className="portfolio-footer-cta" to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}<ArrowRight /></Link></div>
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
  const visibleImages = images.filter(Boolean).slice(0, 3);
  if (!visibleImages.length) return null;
  return <section className={`portfolio-image-ribbon portfolio-image-ribbon-${visibleImages.length}`} aria-label="Selected photographs" data-reveal>{visibleImages.map((image, index) => <img key={`${image}-${index}`} src={image} alt="" loading={index ? "lazy" : undefined} />)}</section>;
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

function HomePage({ site, preview, editorPreview }: { site: PortfolioSiteData; preview: boolean; editorPreview: boolean }) {
  const heroFrames = (site.heroImages?.length ? site.heroImages : [site.heroImage]).filter((image, index, all): image is string => !!image && all.indexOf(image) === index);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [hidden, setHidden] = useState(document.hidden);
  const index = active % Math.max(1, heroFrames.length);
  const caption = site.heroCaptions?.[index];
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    return () => { media.removeEventListener("change", motion); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (paused || hovered || focused || reduced || hidden || editorPreview || heroFrames.length < 2) return;
    const timer = window.setInterval(() => setActive(current => (current + 1) % heroFrames.length), 6500);
    return () => window.clearInterval(timer);
  }, [paused, hovered, focused, reduced, hidden, editorPreview, heroFrames.length]);
  const changeSlide = (direction: number) => { setPaused(true); setActive((index + direction + heroFrames.length) % heroFrames.length); };
  return <>
    <section className="portfolio-hero" aria-label="Featured photography" aria-roledescription="carousel" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <div className="portfolio-hero-media" aria-hidden="true">{heroFrames.map((image, frame) => <img key={image} className={frame === index ? "active" : ""} src={image} alt="" {...{ fetchpriority: frame === 0 ? "high" : "auto" }} />)}</div>
      <div className="portfolio-hero-copy" key={index}><p>{site.locationLabel}</p><h1>{caption?.title || site.brandName}</h1><p>{caption?.description || site.heroLabel}</p><div className="portfolio-hero-actions"><Link to={`${routeFor(preview, "/portfolio")}${caption?.category ? `?category=${encodeURIComponent(caption.category)}` : ""}`}>View portfolio <ArrowRight size={16} /></Link></div></div>
      {heroFrames.length > 1 && <div className="portfolio-carousel-controls"><span aria-live={paused ? "polite" : "off"}>{String(index + 1).padStart(2, "0")} / {String(heroFrames.length).padStart(2, "0")}</span><div className="portfolio-carousel-dots">{heroFrames.map((image, frame) => <button key={image} aria-label={`Show slide ${frame + 1}`} aria-pressed={index === frame} onClick={() => { setActive(frame); setPaused(true); }}><span /></button>)}</div><div><button onClick={() => changeSlide(-1)} aria-label="Previous slide" title="Previous slide"><ChevronLeft /></button><button onClick={() => setPaused(value => !value)} disabled={reduced || editorPreview} aria-label={paused || reduced || editorPreview ? "Play slideshow" : "Pause slideshow"} title={reduced ? "Automatic motion disabled" : paused ? "Play slideshow" : "Pause slideshow"}>{paused || reduced || editorPreview ? <Play size={16} /> : <Pause size={16} />}</button><button onClick={() => changeSlide(1)} aria-label="Next slide" title="Next slide"><ChevronRight /></button></div></div>}
    </section>
    <section className="portfolio-home-intro" id="introduction" data-reveal><p className="portfolio-kicker">{site.introEyebrow}</p><h2>{site.introTitle}</h2><p>{site.introBody}</p><Link to={routeFor(preview, "/about")}>Behind the photographs <ArrowRight size={16} /></Link></section>
    <section className="portfolio-home-selections" aria-label="Featured collections">{site.projects.slice(0, 3).map(project => <Link key={project.id} data-reveal to={`${routeFor(preview, "/portfolio")}?category=${encodeURIComponent(project.category)}`}><figure><img src={project.image} alt={project.title} loading="lazy" /></figure><div><h2>{project.title}</h2><ArrowRight size={18} /></div><p>{project.description}</p></Link>)}</section>
    <section className="portfolio-testimonial" data-reveal><p className="portfolio-kicker">Kind words</p><blockquote>“{site.testimonial}”</blockquote><cite>{site.testimonialAuthor}</cite><Link to={routeFor(preview, "/testimonials")}>Read client stories</Link></section>
  </>;
}

function PortfolioGallery({ images, initialFilter, showFilters = true }: { images: PortfolioGalleryImage[]; initialFilter?: string | null; showFilters?: boolean }) {
  const [filter, setFilter] = useState(initialFilter || (showFilters ? "Selected" : "All"));
  const [selected, setSelected] = useState<number | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const categories = useMemo(() => ["Selected", ...Array.from(new Set(images.map(image => image.category).filter(Boolean))), "All"], [images]);
  const selectedImages = useMemo(() => {
    const counts = new Map<string, number>();
    const originals = images.filter(image => !image.image.startsWith("/portfolio/gallery/"));
    return (originals.length ? originals : images).filter(image => { const count = counts.get(image.category) || 0; counts.set(image.category, count + 1); return count < 2; });
  }, [images]);
  const visible = filter === "All" ? images : filter === "Selected" ? selectedImages : images.filter(image => image.category === filter);
  const chooseFilter = (category: string) => {
    setFilter(category);
    setSelected(null);
    if (!showFilters) return;
    const params = new URLSearchParams(location.search);
    if (category === "Selected") params.delete("category"); else params.set("category", category);
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : "" }, { replace: true });
  };
  useEffect(() => { setFilter(initialFilter && categories.includes(initialFilter) ? initialFilter : showFilters ? "Selected" : "All"); setSelected(null); }, [initialFilter, categories, showFilters]);
  const move = useCallback((direction: number) => setSelected(current => current === null ? null : (current + direction + visible.length) % visible.length), [visible.length]);
  const isOpen = selected !== null;
  useEffect(() => {
    if (!isOpen) return;
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
  }, [move, isOpen]);
  return <section className="portfolio-gallery-section">
    <div className="portfolio-gallery-toolbar">{showFilters && <div role="group" aria-label="Filter portfolio">{categories.map(category => <button className={filter === category ? "active" : ""} key={category} onClick={() => chooseFilter(category)} aria-pressed={filter === category}>{category === "All" ? "All work" : category}</button>)}</div>}<p aria-live="polite">{visible.length} photographs</p></div>
    <div className="portfolio-gallery-grid">{visible.map((image, index) => {
      return <button className="portfolio-gallery-item" key={image.id} onClick={() => setSelected(index)} aria-label={`Open ${image.alt}`}>
        <img src={image.image} alt={image.alt} loading="lazy" decoding="async" />
        <span>{image.category}</span>
      </button>;
    })}</div>
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
  const covers = (site.featuredGalleryIds || defaultPortfolioSite.featuredGalleryIds || []).map(id => site.galleryImages.find(image => image.id === id)).filter((image): image is PortfolioGalleryImage => !!image).slice(0, 3);
  const requestedCategory = category?.trim().toLowerCase();
  const activeCategory = requestedCategory && requestedCategory !== "all"
    ? site.galleryImages.find(image => image.category.trim().toLowerCase() === requestedCategory)?.category
    : undefined;
  const activeProject = activeCategory ? site.projects.find(project => project.category.trim().toLowerCase() === activeCategory.toLowerCase()) : undefined;
  const categoryDescriptions: Record<string, string> = {
    "food & hospitality": "Food, service and hospitality photographed with texture, colour and a sense of place.",
    "venues & details": "Architecture, atmosphere and the considered details that shape an event.",
    portraits: "Character-led portraits with natural expression and a clear sense of place.",
  };
  const activeTitle = activeProject?.title || activeCategory;
  const activeDescription = activeProject?.description || (activeCategory ? categoryDescriptions[activeCategory.toLowerCase()] : undefined) || "A focused selection from the portfolio.";
  const activeCount = activeCategory ? site.galleryImages.filter(image => image.category === activeCategory).length : 0;
  return <>
    {!activeCategory && <section className="portfolio-page-intro portfolio-page-intro-work"><div><p className="portfolio-kicker">Zac Morgan Photography</p><h1>{site.portfolioTitle}</h1></div><p>{site.portfolioBody}</p></section>}
    {!activeCategory && covers.length > 0 && <section className="portfolio-cover" aria-label="Featured photographs">{covers.map((image, index) => <figure key={image.id}><Link to={categoryRoute(image.category)}><img src={image.image} alt={image.alt} {...{ fetchpriority: index === 0 ? "high" : "auto" }} /></Link><figcaption><span>{image.category}</span><span>{String(index + 1).padStart(2, "0")}</span></figcaption></figure>)}</section>}
    {activeCategory && <section className="portfolio-category-compact" data-reveal>
      <div><p className="portfolio-kicker">Focused collection · {activeCount} photographs</p><h1>{activeTitle}</h1></div>
      <div><p>{activeDescription}</p><Link to={routeFor(preview, "/portfolio")}>View every category <ArrowRight /></Link></div>
    </section>}
    <PortfolioGallery images={site.galleryImages} initialFilter={requestedCategory === "all" ? "All" : activeCategory} />
    <section className="portfolio-inline-cta"><div><p className="portfolio-kicker">{site.portfolioCtaEyebrow}</p><h2>{site.portfolioCtaTitle}</h2></div><Link to={routeFor(preview, "/enquire")}>{site.portfolioCtaLabel} <ArrowRight /></Link></section>
  </>;
}

function CommercialPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const project = site.projects.find(item => item.category === "Brand & Corporate");
  const images = site.galleryImages.filter(image => ["Brand & Corporate", "Food & Hospitality", "Venues & Details", "Events"].includes(image.category));
  return <>
    <section className="portfolio-concert-hero"><img src={project?.image || site.heroImage} alt="Commercial photography by Zac Morgan" /><div><p>{site.locationLabel}</p><h1>{project?.title || "Brands & events"}</h1></div></section>
    <section className="portfolio-commercial-intro" data-reveal><h2>People. Places. A sense of occasion.</h2><div><p>{project?.description || site.portfolioBody}</p><Link to={routeFor(preview, "/enquire")}>Discuss your brief <ArrowRight size={18} /></Link></div></section>
    <div className="portfolio-client-line"><span>{site.portfolioClientsLabel}</span>{site.portfolioClients.map(client => <strong key={client}>{client}</strong>)}</div>
    <PortfolioGallery images={images} />
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
    <UrlImageRibbon images={site.aboutRibbonImages} />
    <section className="portfolio-about-manifesto" data-reveal><div><p className="portfolio-kicker">{site.aboutApproachEyebrow}</p><h2>{site.aboutApproachTitle}</h2><p>{site.aboutApproachBody}</p></div>{site.aboutSupportingImage && <figure><img src={site.aboutSupportingImage} alt="Zac Morgan Photography at work" loading="lazy" /><figcaption>{site.aboutSupportingCaption}</figcaption></figure>}</section>
    <section className="portfolio-values">{site.aboutValues.map((value, index) => <div key={`${value.title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><h2>{value.title}</h2><p>{value.body}</p></div>)}</section>
    <StoryIndex site={site} preview={preview} />
  </>;
}

function TestimonialsPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const reviews = site.testimonials.length ? site.testimonials : [{ quote: site.testimonial, author: site.testimonialAuthor, context: "Client" }];
  return <>
    <section className="portfolio-page-intro portfolio-page-intro-testimonials"><p>Testimonials</p><h1>{site.testimonialsTitle}</h1><span>{site.testimonialsIntro}</span></section>
    <UrlImageRibbon images={site.testimonialsRibbonImages} />
    <section className="portfolio-quote-page"><p>Featured review</p><blockquote>“{reviews[0].quote}”</blockquote><cite>{reviews[0].author} · {reviews[0].context}</cite></section>
    <section className="portfolio-reviews">{reviews.slice(1).map((review, index) => <blockquote key={`${review.author}-${index}`}><span>{String(index + 2).padStart(2, "0")}</span><p>“{review.quote}”</p><div className="portfolio-review-by">{review.author}<small>{review.context}</small></div></blockquote>)}</section>
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
    <section className="portfolio-enquiry-page"><div className="portfolio-enquiry-intro"><p className="portfolio-kicker">Availability and pricing</p><h1>{site.bookingTitle}</h1><p>{site.bookingBody}</p><div><a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a><span>{site.locationLabel}</span></div>{site.enquiryImage && <img className="portfolio-enquiry-portrait" src={site.enquiryImage} alt="Event photographed by Zac Morgan" />}</div>
      {sent ? <div className="portfolio-enquiry-success" role="status"><Check /><h2>Enquiry received.</h2><p>Thanks for getting in touch. Zac will reply with availability and next steps.</p><button onClick={() => setSent(false)}>Send another enquiry</button></div> : <form className="portfolio-enquiry-form" onSubmit={submit}>
        <label>Name<input required value={form.name} onChange={event => update("name", event.target.value)} autoComplete="name" /></label>
        <label>Email<input required type="email" value={form.email} onChange={event => update("email", event.target.value)} autoComplete="email" /></label>
        <label>Phone<input value={form.phone} onChange={event => update("phone", event.target.value)} autoComplete="tel" /></label>
        <label>What are you planning?<select required value={form.eventTypeTitle} onChange={event => update("eventTypeTitle", event.target.value)}><option value="">Choose one</option>{site.enquiryEventTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        <label>Preferred date<input type="date" min={today} value={form.preferredDate} onChange={event => update("preferredDate", event.target.value)} /></label>
        <label>Venue / location<input value={form.venue} onChange={event => update("venue", event.target.value)} /></label>
        <label className="portfolio-form-wide">How did you find me?<select value={form.referralSource} onChange={event => update("referralSource", event.target.value)}><option value="">Choose one</option><option>Recommended by a friend</option><option>Recent event or shoot</option><option>Instagram</option><option>Google</option><option>Bark / Oneflare / Airtasker</option><option>Other</option></select></label>
        <label className="portfolio-form-wide">Tell me about it<textarea required rows={6} value={form.message} onChange={event => update("message", event.target.value)} placeholder="Guest count, timings, priorities and anything useful to know." /></label>
        <label className="portfolio-honeypot" aria-hidden="true">Website<input tabIndex={-1} value={form.website} onChange={event => update("website", event.target.value)} autoComplete="off" /></label>
        {error && <p className="portfolio-form-error" role="alert">{error}</p>}
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
  useEffect(() => { document.title = path === "/" ? site.brandName : `${path.slice(1).replace(/-/g, " ")} | ${site.brandName}`; window.scrollTo(0, 0); }, [path, site.brandName]);
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".portfolio-site [data-reveal]"));
    if (editorPreview || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { elements.forEach(element => element.classList.add("revealed")); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { (entry.target as HTMLElement).classList.add("revealed"); observer.unobserve(entry.target); } }), { threshold: 0.12 });
    elements.forEach(element => { element.classList.add("reveal-pending"); observer.observe(element); });
    return () => observer.disconnect();
  }, [path, category, site, editorPreview]);
  const page = path === "/portfolio" ? <WorkPage site={site} preview={preview} category={category} /> : path === "/events" ? <CommercialPage site={site} preview={preview} /> : path === "/concerts" || path === "/concert" ? <ConcertPage site={site} preview={preview} /> : path === "/about" ? <AboutPage site={site} preview={preview} /> : path === "/testimonials" ? <TestimonialsPage site={site} preview={preview} /> : path === "/enquire" || path === "/contact" ? <EnquiryPage site={site} /> : <HomePage site={site} preview={preview} editorPreview={editorPreview} />;
  return <div className={`portfolio-site${editorPreview ? " is-editor-preview" : ""}`}><a className="portfolio-skip" href="#portfolio-main">Skip to content</a><SiteHeader site={site} preview={preview} /><main id="portfolio-main">{page}</main><SiteFooter site={site} preview={preview} /></div>;
}
