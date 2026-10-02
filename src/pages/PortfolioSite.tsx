import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { defaultPortfolioSite, fetchPublishedPortfolio, submitPortfolioEnquiry, type PortfolioEnquiry, type PortfolioGalleryImage, type PortfolioSite as PortfolioSiteData } from "@/lib/portfolio";
import { normalizePortfolioCategory, portfolioCategoryLabel, portfolioCategoryMatches, resolvePortfolioCategory } from "@/lib/portfolio-category";
import { portfolioCategoryOrder } from "@/lib/portfolio";
import "./portfolio-site.css";
import { selectedPhotoSources } from "../../server/portfolio-sales.mjs";
import { publicPortfolioFocus } from "../../server/portfolio-presentation.mjs";

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
  const links = [["Events", "/events"], ["Cosplay", "/cosplay"], ["About", "/about"], [site.bookingButtonLabel, "/enquire"]];
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); menuRef.current?.focus(); } };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [open]);
  const active = (path: string) => currentPath === path
    || (path === "/concerts" && currentPath === "/concert")
    || (path === "/enquire" && currentPath === "/contact");
  return <header className="portfolio-header">
    <nav aria-label="Main navigation">
      <Link className="portfolio-brand" to={routeFor(preview, "/")} aria-label={site.brandName}><img src={site.logo} alt="" /><span>{site.brandName.replace(/\s+Photography$/i, "")}<small>Photography</small></span></Link>
      <div className="portfolio-desktop-nav">{links.map(([label, path]) => <Link key={path} className={active(path) ? "active" : ""} aria-current={active(path) ? "page" : undefined} to={routeFor(preview, path)}>{label}</Link>)}</div>
      <button ref={menuRef} className="portfolio-menu" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="portfolio-mobile-navigation" aria-label={open ? "Close navigation" : "Open navigation"}>{open ? <X /> : <Menu />}</button>
    </nav>
    {open && <nav id="portfolio-mobile-navigation" aria-label="Mobile navigation" className="portfolio-mobile-nav">{links.map(([label, path]) => <Link key={path} aria-current={active(path) ? "page" : undefined} to={routeFor(preview, path)} onClick={() => setOpen(false)}>{label}</Link>)}</nav>}
  </header>;
}

function SiteFooter({ site, preview, contactPage }: { site: PortfolioSiteData; preview: boolean; contactPage: boolean }) {
  return <footer className="portfolio-footer">
    {!contactPage && <div className="portfolio-footer-contact"><h2>{site.footerTitle}</h2><div><p>{site.bookingBody}</p><div className="portfolio-footer-actions"><Link to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}</Link><a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a></div></div></div>}
    <div className="portfolio-footer-bottom"><span>{site.brandName}<br />{site.locationLabel}</span><nav aria-label="Footer navigation"><Link to={routeFor(preview, "/portfolio")}>All work</Link><Link to={routeFor(preview, "/concerts")}>Live music</Link><Link to={routeFor(preview, "/testimonials")}>Kind words</Link><a href={site.instagramUrl} target="_blank" rel="noreferrer">{site.instagramHandle}</a><a href={site.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a></nav><small>&copy; {new Date().getFullYear()}</small></div>
  </footer>;
}


function categoryRoute(preview: boolean, category?: string) {
  const label = portfolioCategoryLabel(category);
  if (label === "Live Music") return routeFor(preview, "/concerts");
  if (label === "Cosplay & Conventions") return routeFor(preview, "/cosplay");
  return `${routeFor(preview, "/portfolio")}?category=${encodeURIComponent(label || "All")}`;
}

function PortfolioPhoto({ src, alt, hero = false, eager = false, className = "", sizes = "(max-width: 760px) 100vw, 50vw" }: { src: string; alt: string; hero?: boolean; eager?: boolean; className?: string; sizes?: string }) {
  const photo = selectedPhotoSources[src];
  const heroCrop = hero && photo?.hero;
  const displayed = heroCrop ? src.replace(/\.webp$/, "-hero-desktop.webp") : src;
  return <picture className={className}>
    {heroCrop && <source media="(max-width: 760px)" srcSet={src.replace(/\.webp$/, "-hero-mobile.webp")} />}
    {photo && !heroCrop && <source srcSet={`${src.replace(/\.webp$/, "-960.webp")} ${photo.smallWidth}w, ${src} ${photo.width}w`} sizes={sizes} />}
    <img src={displayed} alt={alt} width={heroCrop ? 2400 : photo?.width} height={heroCrop ? 1500 : photo?.height} loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchpriority: "high" } : {})} />
  </picture>;
}

function assignmentCaption(image: PortfolioGalleryImage) {
  const source = selectedPhotoSources[image.image];
  const captions: Record<string, { alt: string; title: string; detail: string }> = {
    "/portfolio/selected/navarra-cbhs-live-cooking.webp": { alt: selectedPhotoSources["/portfolio/selected/navarra-cbhs-live-cooking.webp"].alt, title: "Event catering", detail: "Parramatta Town Hall, August 2026" },
    "/portfolio/selected/navarra-gala-dining-room.webp": { alt: selectedPhotoSources["/portfolio/selected/navarra-gala-dining-room.webp"].alt, title: "Gala dinner", detail: "September 2026" },
    "/portfolio/selected/cosplay-sophy-glowing-book.webp": { alt: selectedPhotoSources["/portfolio/selected/cosplay-sophy-glowing-book.webp"].alt, title: "Cosplay portraits", detail: "Costume, props and character" },
    "/portfolio/curated/music-teddyloid-smash-stage.webp": { alt: "TeddyLoid mixes from side stage as dancers face the SMASH audience", title: "TeddyLoid at SMASH!", detail: "Live music" },
  };
  const caption = captions[image.image];
  // A saved, edited caption takes precedence over the known photograph label.
  if (caption && caption.alt === image.alt) return caption;
  return { title: image.alt || source?.alt || image.category, detail: image.category };
}

function HomePage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const heroFrame = (site.heroImages?.length ? site.heroImages : [site.heroImage]).map((image, index) => ({ image, caption: site.heroCaptions?.[index] })).find(frame => !!frame.image);
  const hero = heroFrame?.image;
  const caption = heroFrame?.caption;
  const heroAlt = site.galleryImages.find(image => image.image === hero)?.alt || caption?.title || site.heroLabel;
  const featured = (site.featuredGalleryIds || []).map(id => site.galleryImages.find(image => image.id === id)).filter((image): image is PortfolioGalleryImage => !!image).slice(0, 3);
  return <div className="portfolio-editorial-home">
    <section className="portfolio-editorial-lead" aria-label="Featured photograph">
      <div className="portfolio-editorial-meta"><h1>{site.heroLabel}</h1><p>{site.locationLabel}</p></div>
      {hero && <figure><PortfolioPhoto src={hero} alt={heroAlt} eager sizes="(min-width: 1600px) 1456px, 92vw" /><figcaption><span>{caption?.title || heroAlt}</span>{caption?.description && <span>{caption.description}</span>}</figcaption></figure>}
    </section>
    <section className="portfolio-editorial-intro">
      <div><h2>{site.introTitle}</h2><Link to={routeFor(preview, "/about")}>A little about me</Link></div>
      <p>{site.introBody}</p>
    </section>
    <section className="portfolio-editorial-work" aria-label="Selected assignments">
      {featured.map(image => {
        const label = assignmentCaption(image);
        const supporting = image.image === "/portfolio/selected/cosplay-sophy-glowing-book.webp" ? site.galleryImages.find(item => item.id === "cosplay-teal-green-duo") : undefined;
        const destination = categoryRoute(preview, image.category);
        return <article className={`portfolio-assignment${supporting ? " portfolio-assignment-pair" : ""}`} key={image.id}>
          <div className="portfolio-assignment-images"><Link to={destination} aria-label={`View ${label.title}`}><PortfolioPhoto src={image.image} alt={image.alt} sizes="(max-width: 760px) 92vw, 68vw" /></Link>{supporting && <Link className="portfolio-assignment-companion" to={destination} aria-label={`View ${supporting.alt}`}><PortfolioPhoto src={supporting.image} alt={supporting.alt} sizes="(max-width: 760px) 60vw, 24vw" /></Link>}</div>
          <div className="portfolio-assignment-caption"><div><h2>{label.title}</h2><p>{label.detail}</p></div><Link to={destination}>{portfolioCategoryLabel(image.category)}</Link></div>
        </article>;
      })}
      <Link className="portfolio-editorial-all" to={routeFor(preview, "/portfolio")}>View all photographs</Link>
    </section>
  </div>;
}


function PortfolioGallery({ images, initialFilter, showFilters = true }: { images: PortfolioGalleryImage[]; initialFilter?: string | null; showFilters?: boolean }) {
  const [filter, setFilter] = useState(initialFilter || (showFilters ? "Selected" : "All"));
  const [selected, setSelected] = useState<number | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const categoryLabels = useMemo(() => {
    const labels = new Map<string, string>();
    images.forEach(image => {
      const label = portfolioCategoryLabel(image.category);
      if (label) labels.set(normalizePortfolioCategory(label), label);
    });
    return Array.from(labels.values()).sort((left, right) => {
      const leftIndex = portfolioCategoryOrder.indexOf(left);
      const rightIndex = portfolioCategoryOrder.indexOf(right);
      if (leftIndex < 0 && rightIndex < 0) return left.localeCompare(right);
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    });
  }, [images]);
  const categories = useMemo(() => ["Selected", ...categoryLabels, "All"], [categoryLabels]);
  const queryCategory = new URLSearchParams(location.search).get("category");
  const requestedFilter = queryCategory === null
    ? initialFilter
    : normalizePortfolioCategory(queryCategory) === "all"
      ? "All"
      : normalizePortfolioCategory(queryCategory) === "selected"
        ? "Selected"
        : resolvePortfolioCategory(queryCategory, categoryLabels);
  const nextFilter = requestedFilter && categories.includes(requestedFilter)
    ? requestedFilter
    : showFilters ? "Selected" : "All";
  const selectedImages = useMemo(() => {
    const counts = new Map<string, number>();
    const originals = images.filter(image => !image.image.startsWith("/portfolio/gallery/"));
    return (originals.length ? originals : images).filter(image => {
      const key = normalizePortfolioCategory(image.category);
      const count = counts.get(key) || 0;
      counts.set(key, count + 1);
      return count < 2;
    });
  }, [images]);
  const visible = filter === "All" ? images : filter === "Selected" ? selectedImages : images.filter(image => portfolioCategoryMatches(image.category, filter));
  const chooseFilter = (category: string) => {
    const canonicalFilter = category === "All" || category === "Selected" ? category : portfolioCategoryLabel(category);
    setFilter(canonicalFilter);
    setSelected(null);
    if (!showFilters) return;
    const params = new URLSearchParams(location.search);
    if (canonicalFilter === "Selected") params.delete("category"); else params.set("category", canonicalFilter);
    if (canonicalFilter !== filter) navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : "" });
  };
  useEffect(() => {
    setFilter(nextFilter);
    setSelected(null);
  }, [nextFilter, location.pathname, location.search]);
  useEffect(() => {
    if (!showFilters || queryCategory === null) return;
    const normalized = normalizePortfolioCategory(queryCategory);
    if (normalized === "all" || normalized === "selected") return;
    const canonical = resolvePortfolioCategory(queryCategory, categoryLabels);
    const params = new URLSearchParams(location.search);
    if (canonical) {
      if (queryCategory !== canonical) {
        params.set("category", canonical);
        navigate({ pathname: location.pathname, search: `?${params}` }, { replace: true });
      }
      return;
    }
    params.delete("category");
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : "" }, { replace: true });
  }, [categoryLabels, location.pathname, location.search, navigate, queryCategory, showFilters]);
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
    <div className="portfolio-gallery-toolbar">{showFilters && <div role="group" aria-label="Filter portfolio">{categories.map(category => <button className={filter === category ? "active" : ""} key={category} onClick={() => chooseFilter(category)} aria-pressed={filter === category}>{category === "All" ? "All work" : category}</button>)}</div>}<p aria-live="polite">{visible.length} {visible.length === 1 ? "photograph" : "photographs"}</p></div>
    <div className="portfolio-gallery-grid">{visible.map((image, index) => {
      return <button className="portfolio-gallery-item" data-category={image.category} key={image.id} onClick={() => setSelected(index)} aria-label={`Open ${image.alt}`}>
        <PortfolioPhoto src={image.image} alt={image.alt} sizes="(max-width: 760px) 92vw, 44vw" />
        <span>{image.alt}</span>
      </button>;
    })}</div>
    {visible.length === 0 && <p className="portfolio-gallery-empty">More work is on its way. Get in touch to discuss your brief.</p>}
    {selected !== null && visible[selected] && <div ref={lightboxRef} className="portfolio-lightbox" role="dialog" aria-modal="true" aria-label={visible[selected].alt}>
      <button ref={closeRef} className="portfolio-lightbox-close" onClick={() => setSelected(null)} aria-label="Close photo"><X /></button>
      <button className="portfolio-lightbox-prev" onClick={() => move(-1)} aria-label="Previous photo"><ChevronLeft /></button>
      <figure><img src={visible[selected].image} alt={visible[selected].alt} /><figcaption><span>{visible[selected].category}</span>{visible[selected].alt}</figcaption></figure>
      <button className="portfolio-lightbox-next" onClick={() => move(1)} aria-label="Next photo"><ChevronRight /></button>
    </div>}
  </section>;
}

function PageIntro({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return <section className="portfolio-page-intro"><h1>{title}</h1><div>{body && <p>{body}</p>}{children}</div></section>;
}

function CollectionPhoto({ src, site, fallback }: { src: string; site: PortfolioSiteData; fallback: string }) {
  const photo = site.galleryImages.find(image => image.image === src);
  return <figure className="portfolio-collection-photo"><PortfolioPhoto src={src} alt={photo?.alt || fallback} eager sizes="(min-width: 1600px) 1456px, 92vw" />{photo && <figcaption>{photo.alt}</figcaption>}</figure>;
}

function WorkPage({ site, preview, category }: { site: PortfolioSiteData; preview: boolean; category?: string | null }) {
  const dedicatedCosplay = normalizeSitePath(useLocation().pathname).endsWith("/cosplay");
  const availableCategories = site.galleryImages.map(image => image.category);
  const requestedKey = normalizePortfolioCategory(category);
  const routeFilter = requestedKey === "all" ? "All" : requestedKey === "selected" ? "Selected" : undefined;
  const activeCategory = dedicatedCosplay ? resolvePortfolioCategory("cosplay", availableCategories) : resolvePortfolioCategory(category, availableCategories);
  const project = site.projects.find(item => portfolioCategoryMatches(item.category, activeCategory));
  const cosplayImages = site.galleryImages.filter(image => portfolioCategoryMatches(image.category, "Cosplay"));
  const hero = project?.image || cosplayImages[0]?.image;
  return <>
    <PageIntro title={dedicatedCosplay ? project?.title || "Cosplay portraits" : activeCategory || (routeFilter === "All" ? "All photographs" : site.portfolioTitle)} body={project?.description || site.portfolioBody}>
      {dedicatedCosplay && <Link to={routeFor(preview, "/enquire")}>Plan a cosplay shoot</Link>}
    </PageIntro>
    {dedicatedCosplay && hero && <CollectionPhoto src={hero} site={site} fallback={project?.title || "Cosplay portrait"} />}
    <PortfolioGallery images={dedicatedCosplay ? cosplayImages : site.galleryImages} initialFilter={routeFilter || activeCategory} showFilters={!dedicatedCosplay} />
  </>;
}

function CommercialPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const project = site.projects.find(item => portfolioCategoryMatches(item.category, "Brand & Corporate"));
  const images = site.galleryImages.filter(image => ["Brand & Corporate", "Food & Hospitality", "Venues & Details", "Events"].some(category => portfolioCategoryMatches(image.category, category)));
  return <>
    <PageIntro title={project?.title || "Corporate events"} body={project?.description || site.portfolioBody}><Link to={routeFor(preview, "/enquire")}>Discuss event coverage</Link></PageIntro>
    <CollectionPhoto src={project?.image || site.heroImage} site={site} fallback="Corporate event photography" />
    {site.portfolioClients.length > 0 && <p className="portfolio-client-note"><span>{site.portfolioClientsLabel}:</span> {site.portfolioClients.join(" / ")}</p>}
    <PortfolioGallery images={images} />
  </>;
}

function ConcertPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const images = site.galleryImages.filter(image => portfolioCategoryMatches(image.category, "Live Music"));
  return <>
    <PageIntro title={site.concertTitle} body={site.concertBody}><Link to={routeFor(preview, "/enquire")}>Enquire about live music coverage</Link></PageIntro>
    <CollectionPhoto src={site.concertHeroImage || images[0]?.image || site.heroImage} site={site} fallback="Live music photograph" />
    {site.concertHighlights.some(Boolean) && <ul className="portfolio-coverage-notes" aria-label="Live music coverage">{site.concertHighlights.filter(Boolean).map((highlight, index) => <li key={`${highlight}-${index}`}>{highlight}</li>)}</ul>}
    <PortfolioGallery images={images} showFilters={false} />
  </>;
}

function AboutPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <>
    <section className="portfolio-about"><div><h1>{site.introTitle}</h1><p>{site.introBody}</p><p>{site.aboutSecondaryBody}</p><Link to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}</Link></div><figure><PortfolioPhoto src={site.portrait} alt={site.brandName.replace(/\s+Photography$/i, "")} eager sizes="(max-width: 760px) 92vw, 35vw" /></figure></section>
    <section className="portfolio-about-approach"><h2>{site.aboutApproachTitle}</h2><div><p>{site.aboutApproachBody}</p><dl>{site.aboutValues.map((value, index) => <div key={value.id || index}><dt>{value.title}</dt><dd>{value.body}</dd></div>)}</dl></div></section>
    {site.aboutSupportingImage && <figure className="portfolio-about-work"><PortfolioPhoto src={site.aboutSupportingImage} alt={site.galleryImages.find(image => image.image === site.aboutSupportingImage)?.alt || "Selected work"} sizes="(max-width: 760px) 92vw, 65vw" /><figcaption>{site.aboutSupportingCaption}</figcaption></figure>}
  </>;
}

function TestimonialsPage({ site }: { site: PortfolioSiteData; preview: boolean }) {
  const reviews = site.testimonials.length ? site.testimonials : [{ quote: site.testimonial, author: site.testimonialAuthor, context: "Client" }];
  return <>
    <PageIntro title={site.testimonialsTitle} body={site.testimonialsIntro} />
    <section className="portfolio-review-list" aria-label="Client reviews">{reviews.map((review, index) => <figure key={`${review.author}-${index}`}><blockquote>{review.quote}</blockquote><figcaption><strong>{review.author}</strong><span>{review.context}</span></figcaption></figure>)}</section>
    {site.testimonialsImage && <figure className="portfolio-review-photo"><PortfolioPhoto src={site.testimonialsImage} alt={site.galleryImages.find(image => image.image === site.testimonialsImage)?.alt || "Selected work"} sizes="(max-width: 760px) 92vw, 65vw" /><figcaption>From the portfolio</figcaption></figure>}
  </>;
}


const emptyEnquiry: PortfolioEnquiry = { name: "", email: "", phone: "", eventTypeTitle: "", preferredDate: "", venue: "", referralSource: "", message: "", website: "" };
function EnquiryPage({ site }: { site: PortfolioSiteData }) {
  const [form, setForm] = useState(emptyEnquiry);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const sendingRef = useRef(false);
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const update = (key: keyof PortfolioEnquiry, value: string) => {
    setError("");
    setWarning("");
    setForm(current => ({ ...current, [key]: value }));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity() || sendingRef.current) return;
    if (!form.name.trim() || !form.message.trim()) {
      setError("Please add your name and a short brief before sending.");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError("");
    setWarning("");
    try {
      const delivery = await submitPortfolioEnquiry(form);
      setWarning(delivery.emailDelivered === false ? "Your enquiry is saved, but the studio notification email did not send. For a prompt follow-up, email Zac directly." : "");
      setSent(true);
      setForm(emptyEnquiry);
    }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to send your enquiry. Check your connection and try again."); }
    finally { sendingRef.current = false; setSending(false); }
  };
  return <>
    <section className="portfolio-enquiry-page"><div className="portfolio-enquiry-intro"><h1>{site.bookingTitle}</h1><p>{site.bookingBody}</p><div><a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a><span>{site.locationLabel}</span></div>{site.enquiryImage && <PortfolioPhoto className="portfolio-enquiry-portrait" src={site.enquiryImage} alt={site.galleryImages.find(image => image.image === site.enquiryImage)?.alt || "Event photographed by Zac Morgan"} />}</div>
      {sent ? <div className="portfolio-enquiry-success" role="status"><Check /><h2>Enquiry received.</h2><p>{warning ? "Your message has been saved." : "Thanks for getting in touch. Zac will reply with availability and next steps."}</p>{warning && <p className="portfolio-enquiry-warning" role="alert">{warning} <a href={`mailto:${site.contactEmail}`}>Email Zac</a>.</p>}<button type="button" onClick={() => { setSent(false); setWarning(""); }}>Send another enquiry</button></div> : <form className="portfolio-enquiry-form" onSubmit={submit} aria-busy={sending}><p className="portfolio-form-note">Start with the essentials. Name, email, shoot type and a short brief are required.</p>
        <span className="portfolio-form-status" role="status" aria-live="polite">{sending ? "Sending your enquiry." : ""}</span>
        <label>Name<input required maxLength={120} value={form.name} onChange={event => update("name", event.target.value)} autoComplete="name" /></label>
        <label>Email<input required type="email" maxLength={200} value={form.email} onChange={event => update("email", event.target.value)} autoComplete="email" /></label>
        <label>Phone<input type="tel" value={form.phone} onChange={event => update("phone", event.target.value)} autoComplete="tel" /></label>
        <label>What are you planning?<select required value={form.eventTypeTitle} onChange={event => update("eventTypeTitle", event.target.value)}><option value="">Choose one</option>{site.enquiryEventTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        <label>Preferred date<input type="date" min={today} value={form.preferredDate} onChange={event => update("preferredDate", event.target.value)} /></label>
        <label>Venue / location<input value={form.venue} onChange={event => update("venue", event.target.value)} /></label>
        <label className="portfolio-form-wide">How did you find me?<select value={form.referralSource} onChange={event => update("referralSource", event.target.value)}><option value="">Choose one</option><option>Recommended by a friend</option><option>Recent event or shoot</option><option>Instagram</option><option>Google</option><option>Bark / Oneflare / Airtasker</option><option>Other</option></select></label>
        <label className="portfolio-form-wide">Tell me about it<textarea required maxLength={3000} rows={6} value={form.message} onChange={event => update("message", event.target.value)} placeholder="Guest count, timings, priorities and anything useful to know." /></label>
        <label className="portfolio-honeypot" aria-hidden="true">Website<input tabIndex={-1} value={form.website} onChange={event => update("website", event.target.value)} autoComplete="off" /></label>
        {error && <p id="portfolio-enquiry-error" className="portfolio-form-error" role="alert">{error}</p>}
        <button className="portfolio-submit" disabled={sending}>{sending ? "Sending…" : "Send enquiry"}</button>
      </form>}
    </section>
  </>;
}

export default function PortfolioSite() {
  const [storedSite, setSite] = useState<PortfolioSiteData>(defaultPortfolioSite);
  const site: PortfolioSiteData = useMemo(() => publicPortfolioFocus(storedSite), [storedSite]);
  const location = useLocation();
  const preview = location.pathname.startsWith("/portfolio-preview");
  const path = normalizeSitePath(preview ? location.pathname.replace("/portfolio-preview", "") || "/" : location.pathname);
  const category = path === "/cosplay" ? "Cosplay & Conventions" : new URLSearchParams(location.search).get("category");
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
  const page = path === "/portfolio" || path === "/cosplay" ? <WorkPage site={site} preview={preview} category={category} /> : path === "/events" ? <CommercialPage site={site} preview={preview} /> : path === "/concerts" || path === "/concert" ? <ConcertPage site={site} preview={preview} /> : path === "/about" ? <AboutPage site={site} preview={preview} /> : path === "/testimonials" ? <TestimonialsPage site={site} preview={preview} /> : path === "/enquire" || path === "/contact" ? <EnquiryPage site={site} /> : <HomePage site={site} preview={preview} />;
  return <div className={`portfolio-site${editorPreview ? " is-editor-preview" : ""}`}><a className="portfolio-skip" href="#portfolio-main">Skip to content</a><SiteHeader site={site} preview={preview} /><main id="portfolio-main">{page}</main><SiteFooter site={site} preview={preview} contactPage={path === "/enquire" || path === "/contact"} /></div>;
}
