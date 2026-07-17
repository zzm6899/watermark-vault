import { FormEvent, useEffect, useState } from "react";
import { ArrowDown, ArrowRight, Check, Instagram, Linkedin, Mail, Menu, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { defaultPortfolioSite, fetchPublishedPortfolio, submitPortfolioEnquiry, type PortfolioEnquiry, type PortfolioSite as PortfolioSiteData } from "@/lib/portfolio";
import "./portfolio-site.css";

function routeFor(preview: boolean, path: string) {
  return preview ? `/portfolio-preview${path === "/" ? "" : path}` : path;
}

function SiteHeader({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  const [open, setOpen] = useState(false);
  const links = [
    ["Portfolio", "/portfolio"], ["About", "/about"], ["Testimonials", "/testimonials"], [site.bookingButtonLabel, "/enquire"],
  ];
  return <header className="portfolio-header">
    <nav aria-label="Main navigation">
      <Link to={routeFor(preview, "/portfolio")}>Portfolio</Link>
      <Link to={routeFor(preview, "/about")}>About</Link>
      <Link className="portfolio-brand" to={routeFor(preview, "/")} aria-label={site.brandName}><img src={site.logo} alt={site.brandName} /></Link>
      <Link to={routeFor(preview, "/testimonials")}>Testimonials</Link>
      <Link className="portfolio-book-link" to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}</Link>
      <button className="portfolio-menu" onClick={() => setOpen(v => !v)} aria-label="Open navigation">{open ? <X /> : <Menu />}</button>
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
    <img src={project.image} alt={project.title} />
    <div><span>{String(index + 1).padStart(2, "0")}</span><h3>{project.title}</h3><p>{project.description}</p></div>
  </article>)}</div>;
}

function HomePage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <>
    <section className="portfolio-hero" aria-label={site.heroLabel}>
      <img src={site.heroImage} alt="Live event photographed by Zac Morgan" />
      <div className="portfolio-hero-copy"><p>{site.heroLabel}</p><h1>{site.brandName}</h1><div className="portfolio-hero-actions"><Link to={routeFor(preview, "/portfolio")}>View portfolio</Link><Link to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}</Link></div></div>
      <a href="#introduction" className="portfolio-scroll" aria-label="Continue"><ArrowDown /></a>
    </section>
    <section className="portfolio-about" id="introduction"><div className="portfolio-about-copy"><p className="portfolio-kicker">{site.introEyebrow}</p><h2>{site.introTitle}</h2><p>{site.introBody}</p><Link to={routeFor(preview, "/about")}>More about Zac</Link></div><figure><img src={site.portrait} alt="Zac Morgan photographing an event" /></figure></section>
    <section className="portfolio-work"><div className="portfolio-section-heading"><p>Selected work</p><h2>People, atmosphere, moments.</h2><Link to={routeFor(preview, "/portfolio")}>View every category <ArrowRight /></Link></div><ProjectGrid site={site} limit={2} /></section>
    <section className="portfolio-testimonial"><p className="portfolio-kicker">Kind words</p><blockquote>“{site.testimonial}”</blockquote><cite>{site.testimonialAuthor}</cite><Link to={routeFor(preview, "/testimonials")}>Read testimonials</Link></section>
  </>;
}

function WorkPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <><section className="portfolio-page-intro"><p>Portfolio</p><h1>{site.portfolioTitle}</h1><span>{site.portfolioBody}</span></section><section className="portfolio-work portfolio-work-page"><ProjectGrid site={site} /></section><section className="portfolio-inline-cta"><h2>Planning something?</h2><Link to={routeFor(preview, "/enquire")}>Check availability <ArrowRight /></Link></section></>;
}

function AboutPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <><section className="portfolio-about-page"><figure><img src={site.portrait} alt="Zac Morgan" /></figure><div><p className="portfolio-kicker">About Zac</p><h1>{site.introTitle}</h1><p>{site.introBody}</p><p>{site.aboutSecondaryBody}</p><Link to={routeFor(preview, "/enquire")}>{site.bookingButtonLabel}<ArrowRight /></Link></div></section><section className="portfolio-values"><div><span>01</span><h2>Natural over staged</h2><p>Real expressions and useful direction, without turning your event into a production.</p></div><div><span>02</span><h2>Fast and dependable</h2><p>Clear communication, careful backups and delivery that respects your timeline.</p></div><div><span>03</span><h2>Built around people</h2><p>Coverage adapts to your guests, venue, schedule and what matters most to you.</p></div></section></>;
}

function TestimonialsPage({ site, preview }: { site: PortfolioSiteData; preview: boolean }) {
  return <><section className="portfolio-page-intro"><p>Testimonials</p><h1>{site.testimonialsTitle}</h1></section><section className="portfolio-quote-page"><blockquote>“{site.testimonial}”</blockquote><cite>{site.testimonialAuthor}</cite></section><section className="portfolio-testimonial-image"><img src={site.projects[0]?.image || site.heroImage} alt="Celebration photographed by Zac Morgan" /><div><p>From first message to final gallery</p><h2>Clear, calm and ready for the moment.</h2><Link to={routeFor(preview, "/enquire")}>Start an enquiry <ArrowRight /></Link></div></section></>;
}

const emptyEnquiry: PortfolioEnquiry = { name: "", email: "", phone: "", eventTypeTitle: "", preferredDate: "", venue: "", message: "", website: "" };
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
  return <section className="portfolio-enquiry-page"><div className="portfolio-enquiry-intro"><p className="portfolio-kicker">Availability and pricing</p><h1>{site.bookingTitle}</h1><p>{site.bookingBody}</p><div><span>{site.contactEmail}</span><span>{site.locationLabel}</span></div></div>
    {sent ? <div className="portfolio-enquiry-success"><Check /><h2>Enquiry received.</h2><p>Thanks for getting in touch. Zac will reply with availability and next steps.</p><button onClick={() => setSent(false)}>Send another enquiry</button></div> : <form className="portfolio-enquiry-form" onSubmit={submit}>
      <label>Name<input required value={form.name} onChange={e => update("name", e.target.value)} autoComplete="name" /></label>
      <label>Email<input required type="email" value={form.email} onChange={e => update("email", e.target.value)} autoComplete="email" /></label>
      <label>Phone<input value={form.phone} onChange={e => update("phone", e.target.value)} autoComplete="tel" /></label>
      <label>What are you planning?<select required value={form.eventTypeTitle} onChange={e => update("eventTypeTitle", e.target.value)}><option value="">Choose one</option>{site.enquiryEventTypes.map(type => <option key={type}>{type}</option>)}</select></label>
      <label>Preferred date<input type="date" value={form.preferredDate} onChange={e => update("preferredDate", e.target.value)} /></label>
      <label>Venue / location<input value={form.venue} onChange={e => update("venue", e.target.value)} /></label>
      <label className="portfolio-form-wide">Tell me about it<textarea required rows={6} value={form.message} onChange={e => update("message", e.target.value)} placeholder="Guest count, timings, priorities and anything useful to know." /></label>
      <label className="portfolio-honeypot" aria-hidden="true">Website<input tabIndex={-1} value={form.website} onChange={e => update("website", e.target.value)} autoComplete="off" /></label>
      {error && <p className="portfolio-form-error">{error}</p>}
      <button className="portfolio-submit" disabled={sending}>{sending ? "Sending…" : "Send enquiry"}<ArrowRight /></button>
    </form>}
  </section>;
}

export default function PortfolioSite() {
  const [site, setSite] = useState<PortfolioSiteData>(defaultPortfolioSite);
  const location = useLocation();
  const preview = location.pathname.startsWith("/portfolio-preview");
  const path = preview ? location.pathname.replace("/portfolio-preview", "") || "/" : location.pathname;
  useEffect(() => { fetchPublishedPortfolio().then(setSite); }, []);
  useEffect(() => { document.title = `${path === "/" ? site.brandName : `${path.slice(1).replace(/-/g, " ")} — ${site.brandName}`}`; window.scrollTo(0, 0); }, [path, site.brandName]);
  const page = path === "/portfolio" ? <WorkPage site={site} preview={preview} /> : path === "/about" ? <AboutPage site={site} preview={preview} /> : path === "/testimonials" ? <TestimonialsPage site={site} preview={preview} /> : path === "/enquire" || path === "/contact" ? <EnquiryPage site={site} /> : <HomePage site={site} preview={preview} />;
  return <div className="portfolio-site"><SiteHeader site={site} preview={preview} /><main>{page}</main><SiteFooter site={site} preview={preview} /></div>;
}
