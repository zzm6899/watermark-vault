import { useEffect, useState } from "react";
import { ArrowDown, Instagram, Linkedin, Mail, Menu, X } from "lucide-react";
import { defaultPortfolioSite, fetchPublishedPortfolio, type PortfolioSite as PortfolioSiteData } from "@/lib/portfolio";
import "./portfolio-site.css";

export default function PortfolioSite() {
  const [site, setSite] = useState<PortfolioSiteData>(defaultPortfolioSite);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetchPublishedPortfolio().then(setSite);
  }, []);

  useEffect(() => {
    document.title = site.brandName;
  }, [site.brandName]);

  return (
    <div className="portfolio-site">
      <header className="portfolio-header">
        <nav aria-label="Main navigation">
          <a href="#work">Portfolio</a>
          <a href="#about">About</a>
          <a className="portfolio-brand" href="#top" aria-label={site.brandName}>
            <img src={site.logo} alt={site.brandName} />
          </a>
          <a href="#testimonials">Testimonials</a>
          <a href="#contact">Contact</a>
          <button className="portfolio-menu" onClick={() => setMenuOpen(v => !v)} aria-label="Open navigation">
            {menuOpen ? <X /> : <Menu />}
          </button>
        </nav>
        {menuOpen && <div className="portfolio-mobile-nav">
          <a href="#work" onClick={() => setMenuOpen(false)}>Portfolio</a>
          <a href="#about" onClick={() => setMenuOpen(false)}>About</a>
          <a href="#testimonials" onClick={() => setMenuOpen(false)}>Testimonials</a>
          <a href="#contact" onClick={() => setMenuOpen(false)}>Contact</a>
        </div>}
      </header>

      <main id="top">
        <section className="portfolio-hero" aria-label={site.heroLabel}>
          <img src="/portfolio/live-action.jpg" alt="Live event photographed by Zac Morgan" />
          <div className="portfolio-hero-copy">
            <p>{site.heroLabel}</p>
            <h1>{site.brandName}</h1>
          </div>
          <a href="#about" className="portfolio-scroll" aria-label="Continue to about"><ArrowDown /></a>
        </section>

        <section className="portfolio-about" id="about">
          <div className="portfolio-about-copy">
            <p className="portfolio-kicker">{site.introEyebrow}</p>
            <h2>{site.introTitle}</h2>
            <p>{site.introBody}</p>
            <a href={`mailto:${site.contactEmail}`}>Get in touch</a>
          </div>
          <figure><img src={site.portrait} alt="Zac Morgan photographing an event" /></figure>
        </section>

        <section className="portfolio-work" id="work">
          <div className="portfolio-section-heading"><p>Selected work</p><h2>Stories worth keeping</h2></div>
          <div className="portfolio-projects">
            {site.projects.map((project, index) => (
              <article className="portfolio-project" key={project.id}>
                <img src={project.image} alt={project.title} />
                <div><span>0{index + 1}</span><h3>{project.title}</h3><p>{project.description}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="portfolio-testimonial" id="testimonials">
          <p className="portfolio-kicker">Kind words</p>
          <blockquote>“{site.testimonial}”</blockquote>
          <cite>{site.testimonialAuthor}</cite>
        </section>
      </main>

      <footer id="contact">
        <div><p>Have something in mind?</p><h2>Let's make it memorable.</h2><a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a></div>
        <div className="portfolio-socials">
          <a href={site.instagramUrl} target="_blank" rel="noreferrer"><Instagram /> {site.instagramHandle}</a>
          <a href={site.linkedinUrl} target="_blank" rel="noreferrer"><Linkedin /> LinkedIn</a>
          <a href={`mailto:${site.contactEmail}`}><Mail /> Email</a>
        </div>
        <small>© {new Date().getFullYear()} {site.brandName}</small>
      </footer>
    </div>
  );
}
