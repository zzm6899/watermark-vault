import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, Check, ChevronLeft, ChevronRight, Instagram, Linkedin, Mail, Menu, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { defaultPortfolioSite, fetchPublishedPortfolio, submitPortfolioEnquiry, type PortfolioEnquiry, type PortfolioGalleryImage, type PortfolioSite as PortfolioSiteData } from "@/lib/portfolio";
import "./portfolio-site.css";

function routeFor(preview: boolean, path: string) {
  return preview ? `/portfolio-preview${path === "/" ? "" : path}` : path;
}

function SiteHeader({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const [open, setOpen] = useState(false);
  const links = [["Portfolio", "/portfolio"], ["About", "/about"], ["Testimonials", "/testimonials"], [site.bookingButtonLabel, "/enquire"]];
  return <header className="portfolio-header">
    <nav aria-label="Main navigation">
      <Link to={routeFor(preview, "/portfolio")}>Portfolio</Link>
      <Link to={routeFor(preview, "/about")}>About</Link>
      <Link className="portfolio-brand" to={routeFor(preview, "/")} aria-label={site.brandName}><img src={site.logo} alt={site.brandName} /></Link>
      <Link to={routeFor(preview, "/testimonials")}>Testimonials</Link>
      <Link className="portfolio-book-link" to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}</Link>
      <button className="portfolio-menu" onClick={() => setOpen(value => !value)} aria-label={open ? "Close navigation" : "Open navigation"}>{open ? <X /> : <Menu />}</button>
    </nav>
    {open && <div className="portfolio-mobile-nav">{links.map(([label, path]) => <Link key={path} to={routeFor(preview, path)} onClick={() => setOpen(false)}>{label}</Link>)}</div>}
  </header>;
}

function SiteFooter({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <footer>
    <div><p>{site.locationLabel}</p><h2>{site.footerTitle}</h2><Link className="portfolio-footer-cta" to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}<ArrowRight /></Link></div>
    <div className="portfolio-socials">
      <a href={site.instagramUrl} target="_blank" rel="noreferrer"><Instagram /> {site.instagramHandle}</a>
      <a href={site.linkedinUrl} target="_blank" rel="noreferrer"><Linkedin /> LinkedIn</a>
      <a href={`mailto:${site.contactEmail}`}><Mail /> Email</a>
    </div>
    <small>© {new Date().getFullYear()} {site.brandName}</small>
  </footer>;
}

function ProjectGrid({ site, limit }: { site: PortfolioSiteData; limit?: number }) {
  return <div className="portfolio-projects">{site.projects.slice(0, limit).map((project, index) => <article className="portfolio-project" key={project.id}>
    <img src={project.image} alt={project.title} loading="lazy" />
    <div><span>{String(index + 1).padStart(2, "0")}</span><h3>{project.title}</h3><p>{project.description}</p></div>
  </article>)}</div>;
}

function ImageRibbon({ images }: { images: PortfolioGalleryImage[] }) {
  return <section className="portfolio-image-ribbon" aria-label="Selected photographs">{images.slice(0, 3).map(image => <img key={image.id} src={image.image} alt={image.alt} loading="lazy" />)}</section>;
}

function HomePage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <>
    <section className="portfolio-hero" aria-label={site.heroLabel}>
      <img src={site.heroImage} alt="Live event photographed by Zac Morgan" />
      <div className="portfolio-hero-copy"><p>{site.heroLabel}</p><h1>{site.brandName}</h1><div className="portfolio-hero-actions"><Link to={routeFor(preview, "/portfolio")}>View portfolio</Link><Link to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}</Link></div></div>
      <a href="#introduction" className="portfolio-scroll" aria-label="Continue"><ArrowDown /></a>
    </section>
    <section className="portfolio-about" id="introduction"><div className="portfolio-about-copy"><p className="portfolio-kicker">{site.introEyebrow}</p><h2>{site.introTitle}</h2><p>{site.introBody}</p><Link to={routeFor(preview, "/about")}>More about Zac</Link></div><figure><img src={site.portrait} alt="Zac Morgan photographing an event" /></figure></section>
    <ImageRibbon images={site.galleryImages} />
    <section className="portfolio-work"><div className="portfolio-section-heading"><p>Selected work</p><h2>People, atmosphere, moments.</h2><Link to={routeFor(preview, "/portfolio")}>View every category <ArrowRight /></Link></div><ProjectGrid site={site} limit={2} /></section>
    <section className="portfolio-testimonial"><p className="portfolio-kicker">Kind words</p><blockquote>“{site.testimonial}”</blockquote><cite>{site.testimonialAuthor}</cite><Link to={routeFor(preview, "/testimonials")}>Read client stories</Link></section>
  </>;
}

function PortfolioGallery({ images }: { images: PortfolioGalleryImage[] }) {
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState<number | null>(null);
  const categories = useMemo(() => ["All", ...Array.from(new Set(images.map(image => image.category).filter(Boolean)))], [images]);
  const visible = filter === "All" ? images : images.filter(image => image.category === filter);
  const move = (direction: number) => setSelected(current => current === null ? null : (current + direction + visible.length) % visible.length);
  useEffect(() => {
    if (selected === null) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [selected, visible.length]);
  return <section className="portfolio-gallery-section">
    <div className="portfolio-gallery-toolbar"><p>{visible.length} photographs</p><div role="group" aria-label="Filter portfolio">{categories.map(category => <button className={filter === category ? "active" : ""} key={category} onClick={() => { setFilter(category); setSelected(null); }}>{category}</button>)}</div></div>
    <div className="portfolio-gallery-grid">{visible.map((image, index) => <button className={`portfolio-gallery-item portfolio-gallery-item-${index % 6}`} key={image.id} onClick={() => setSelected(index)} aria-label={`Open ${image.alt}`}><img src={image.image} alt={image.alt} loading="lazy" /><span>{image.category}</span></button>)}</div>
    {selected !== null && visible[selected] && <div className="portfolio-lightbox" role="dialog" aria-modal="true" aria-label={visible[selected].alt}>
      <button className="portfolio-lightbox-close" onClick={() => setSelected(null)} aria-label="Close photo"><X /></button>
      <button className="portfolio-lightbox-prev" onClick={() => move(-1)} aria-label="Previous photo"><ChevronLeft /></button>
      <figure><img src={visible[selected].image} alt={visible[selected].alt} /><figcaption><span>{visible[selected].category}</span>{visible[selected].alt}</figcaption></figure>
      <button className="portfolio-lightbox-next" onClick={() => move(1)} aria-label="Next photo"><ChevronRight /></button>
    </div>}
  </section>;
}

function WorkPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <>
    <section className="portfolio-page-intro portfolio-page-intro-work"><p>Portfolio</p><h1>{site.portfolioTitle}</h1><span>{site.portfolioBody}</span><div className="portfolio-client-line"><span>Selected clients and venues</span><strong>Asahi Breweries</strong><strong>Navarra Venues</strong><strong>SMASH!</strong></div></section>
    <section className="portfolio-specialties">{site.projects.map((project, index) => <div key={project.id}><span>{String(index + 1).padStart(2, "0")}</span><h2>{project.title}</h2><p>{project.description}</p></div>)}</section>
    <PortfolioGallery images={site.galleryImages} />
    <section className="portfolio-inline-cta"><div><p className="portfolio-kicker">Your story, photographed honestly</p><h2>Planning something?</h2></div><Link to={routeFor(preview, "/enquire")}>Check availability <ArrowRight /></Link></section>
  </>;
}

function AboutPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const supporting = site.galleryImages[3] || site.galleryImages[0];
  return <>
    <section className="portfolio-about-page"><figure><img src={site.portrait} alt="Zac Morgan" /></figure><div><p className="portfolio-kicker">About Zac</p><h1>{site.introTitle}</h1><p>{site.introBody}</p><p>{site.aboutSecondaryBody}</p><Link to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}<ArrowRight /></Link></div></section>
    <section className="portfolio-about-manifesto"><div><p className="portfolio-kicker">The approach</p><h2>Present enough to guide. Quiet enough to notice.</h2><p>I look for the interactions happening between the scheduled moments: the reaction across the room, the energy building before a performance, and the details your team spent months getting right.</p></div>{supporting && <figure><img src={supporting.image} alt={supporting.alt} loading="lazy" /><figcaption>Working across Sydney weddings, events, venues and live productions.</figcaption></figure>}</section>
    <section className="portfolio-values"><div><span>01</span><h2>Natural over staged</h2><p>Real expressions and useful direction, without turning your event into a production.</p></div><div><span>02</span><h2>Fast and dependable</h2><p>Clear communication, careful backups and delivery that respects your timeline.</p></div><div><span>03</span><h2>Built around people</h2><p>Coverage adapts to your guests, venue, schedule and what matters most to you.</p></div></section>
    <ImageRibbon images={site.galleryImages.slice(5, 8)} />
  </>;
}

function TestimonialsPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const reviews = site.testimonials.length ? site.testimonials : [{ quote: site.testimonial, author: site.testimonialAuthor, context: "Client" }];
  return <>
    <section className="portfolio-page-intro portfolio-page-intro-testimonials"><p>Testimonials</p><h1>{site.testimonialsTitle}</h1><span>Feedback from weddings, celebrations, portrait sessions and business events across Sydney.</span></section>
    <section className="portfolio-quote-page"><p>Featured review</p><blockquote>“{reviews[0].quote}”</blockquote><cite>{reviews[0].author} · {reviews[0].context}</cite></section>
    <section className="portfolio-reviews">{reviews.slice(1).map((review, index) => <blockquote key={`${review.author}-${index}`}><span>{String(index + 2).padStart(2, "0")}</span><p>“{review.quote}”</p><div className="portfolio-review-by">{review.author}<small>{review.context}</small></div></blockquote>)}</section>
    <ImageRibbon images={site.galleryImages.slice(1, 4)} />
    <section className="portfolio-testimonial-image"><img src={site.galleryImages[8]?.image || site.projects[0]?.image || site.heroImage} alt={site.galleryImages[8]?.alt || "Event photographed by Zac Morgan"} /><div><p>From first message to final gallery</p><h2>Clear, calm and ready for the moment.</h2><ul><li><Check />Straightforward planning</li><li><Check />Natural, true-to-life coverage</li><li><Check />Careful backup and timely delivery</li></ul><Link to={routeFor(preview, "/enquire")}>Start an enquiry <ArrowRight /></Link></div></section>
  </>;
}

const emptyEnquiry: PortfolioEnquiry = { name: "", email: "", phone: "", eventTypeTitle: "", preferredDate: "", venue: "", referralSource: "", message: "", website: "" };
function EnquiryPage({ site }: { site: PortfolioSiteData }) {
  const [form, setForm] = useState(emptyEnquiry);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof PortfolioEnquiry, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSending(true); setError("");
    try { await submitPortfolioEnquiry(form); setSent(true); setForm(emptyEnquiry); } catch (err) { setError(err instanceof Error ? err.message : "Could not send enquiry"); } finally { setSending(false); }
  };
  const enquiryImage = site.galleryImages[5] || site.galleryImages[0];
  return <>
    {enquiryImage && <section className="portfolio-enquiry-visual"><img src={enquiryImage.image} alt={enquiryImage.alt} /><div><span>Availability · Pricing · Coverage</span></div></section>}
    <section className="portfolio-enquiry-page"><div className="portfolio-enquiry-intro"><p className="portfolio-kicker">Availability and pricing</p><h1>{site.bookingTitle}</h1><p>{site.bookingBody}</p><div><a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a><span>{site.locationLabel}</span></div></div>
      {sent ? <div className="portfolio-enquiry-success"><Check /><h2>Enquiry received.</h2><p>Thanks for getting in touch. Zac will reply with availability and next steps.</p><button onClick={() => setSent(false)}>Send another enquiry</button></div> : <form className="portfolio-enquiry-form" onSubmit={submit}>
        <label>Name<input required value={form.name} onChange={event => update("name", event.target.value)} autoComplete="name" /></label>
        <label>Email<input required type="email" value={form.email} onChange={event => update("email", event.target.value)} autoComplete="email" /></label>
        <label>Phone<input value={form.phone} onChange={event => update("phone", event.target.value)} autoComplete="tel" /></label>
        <label>What are you planning?<select required value={form.eventTypeTitle} onChange={event => update("eventTypeTitle", event.target.value)}><option value="">Choose one</option>{site.enquiryEventTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        <label>Preferred date<input type="date" value={form.preferredDate} onChange={event => update("preferredDate", event.target.value)} /></label>
        <label>Venue / location<input value={form.venue} onChange={event => update("venue", event.target.value)} /></label>
        <label className="portfolio-form-wide">How did you find me?<select value={form.referralSource} onChange={event => update("referralSource", event.target.value)}><option value="">Choose one</option><option>Recommended by a friend</option><option>Recent event or shoot</option><option>Instagram</option><option>Google</option><option>Bark / Oneflare / Airtasker</option><option>Other</option></select></label>
        <label className="portfolio-form-wide">Tell me about it<textarea required rows={6} value={form.message} onChange={event => update("message", event.target.value)} placeholder="Guest count, timings, priorities and anything useful to know." /></label>
        <label className="portfolio-honeypot" aria-hidden="true">Website<input tabIndex={-1} value={form.website} onChange={event => update("website", event.target.value)} autoComplete="off" /></label>
        {error && <p className="portfolio-form-error">{error}</p>}
        <button className="portfolio-submit" disabled={sending}>{sending ? "Sending…" : "Send enquiry"}<ArrowRight /></button>
      </form>}
    </section>
    <section className="portfolio-enquiry-steps"><div><span>01</span><h2>Send the details</h2><p>Share the date, venue and kind of coverage you have in mind.</p></div><ArrowRight /><div><span>02</span><h2>Confirm the fit</h2><p>You’ll receive availability, options and a clear recommendation.</p></div><ArrowRight /><div><span>03</span><h2>Lock it in</h2><p>Approve the booking, sign online and your date is secured.</p></div></section>
  </>;
}

export default function PortfolioSite() {
  const [site, setSite] = useState<PortfolioSiteData>(defaultPortfolioSite);
  const location = useLocation();
  const preview = location.pathname.startsWith("/portfolio-preview");
  const path = preview ? location.pathname.replace("/portfolio-preview", "") || "/" : location.pathname;
  useEffect(() => { fetchPublishedPortfolio().then(setSite); }, []);
  useEffect(() => { document.title = path === "/" ? site.brandName : `${path.slice(1).replace(/-/g, " ")} — ${site.brandName}`; window.scrollTo(0, 0); }, [path, site.brandName]);
  const page = path === "/portfolio" ? <WorkPage site={site} preview={preview} /> : path === "/about" ? <AboutPage site={site} preview={preview} /> : path === "/testimonials" ? <TestimonialsPage site={site} preview={preview} /> : path === "/enquire" || path === "/contact" ? <EnquiryPage site={site} /> : <HomePage site={site} preview={preview} />;
  return <div className="portfolio-site"><SiteHeader site={site} preview={preview} /><main>{page}</main><SiteFooter site={site} preview={preview} /></div>;
}
