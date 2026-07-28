import { useState } from "react";
import { ChevronLeft, ChevronRight, CheckCircle2, Star } from "lucide-react";

const DEMO_PHOTOS = [
  "/portfolio/curated/cosplay-smash-auditorium.jpg",
  "/portfolio/curated/cosplay-pax-valkyries.jpg",
  "/portfolio/curated/cosplay-pax-spiderman.jpg",
  "/portfolio/curated/cosplay-pax-portrait.jpg",
  "/portfolio/curated/cosplay-pax-duo.jpg",
  "/portfolio/curated/cosplay-animaga-sunlight.jpg",
];

/** A no-login visual preview of the client proofing experience. */
export default function ProofingDemo() {
  const [picks, setPicks] = useState<Set<number>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const toggle = (index: number) => setPicks(previous => {
    const next = new Set(previous);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  });
  const submit = () => {
    if (picks.size > 0) setSubmitted(true);
  };
  const photo = active === null ? null : DEMO_PHOTOS[active];

  return (
    <main className="min-h-screen bg-[#121110] text-stone-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 sm:py-16 pb-32">
        <p className="text-[10px] uppercase tracking-[0.3em] text-amber-300/70 mb-5">Photo selection</p>
        <div className="max-w-2xl mb-10">
          <h1 className="font-display text-4xl sm:text-6xl leading-[0.92]">Cosplay portraits</h1>
          <p className="mt-4 text-stone-400 text-sm leading-6">Review the gallery, star the photos you want, then submit your selection.</p>
        </div>

        <section className="rounded-3xl border border-amber-300/20 bg-gradient-to-br from-amber-300/15 via-stone-900 to-stone-950 p-5 sm:p-7 mb-8 shadow-2xl shadow-black/30">
          <div className="flex gap-4 items-start">
            <div className="w-11 h-11 shrink-0 rounded-full bg-amber-300 text-stone-950 grid place-items-center"><Star className="w-5 h-5 fill-current" /></div>
            <div>
              <h2 className="font-display text-2xl">Choose your photos</h2>
              <p className="mt-1 text-sm text-stone-400">Tap the star on any photo to add or remove it from your selection.</p>
              <p className="mt-3 text-sm font-medium text-amber-200">Selected: {picks.size}</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-5">
          {DEMO_PHOTOS.map((src, index) => (
            <article key={src} className={`group relative aspect-[4/5] overflow-hidden rounded-2xl bg-stone-900 ${picks.has(index) ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-[#121110]" : ""}`}>
              <button onClick={() => setActive(index)} className="absolute inset-0 w-full" aria-label={`Open photo ${index + 1}`}>
                <img src={src} alt={`Cosplay proof ${index + 1}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              </button>
              <button onClick={() => { setSubmitted(false); toggle(index); }} className={`absolute top-3 right-3 w-11 h-11 rounded-full grid place-items-center shadow-lg transition-transform active:scale-90 ${picks.has(index) ? "bg-amber-300 text-stone-950" : "bg-black/55 text-white backdrop-blur"}`} aria-label={picks.has(index) ? `Remove photo ${index + 1} from picks` : `Add photo ${index + 1} to picks`} aria-pressed={picks.has(index)}>
                <Star className={`w-5 h-5 ${picks.has(index) ? "fill-current" : ""}`} />
              </button>
              <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-2 py-1 text-[10px] tracking-wider text-white/85">PHOTO {String(index + 1).padStart(2, "0")}</span>
            </article>
          ))}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-amber-300/15 bg-stone-950/90 backdrop-blur-xl p-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div aria-live="polite"><p className="font-display text-lg">{submitted ? "Selection sent" : picks.size ? `${picks.size} selected` : "No photos selected"}</p><p className="text-xs text-stone-500">{submitted ? "This is a demo — a real gallery sends these picks to the photographer." : "You can change your selection before submitting."}</p></div>
          <button onClick={submit} disabled={!picks.size || submitted} className="inline-flex items-center gap-2 rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold text-stone-950 disabled:cursor-not-allowed disabled:opacity-45"><CheckCircle2 className="w-4 h-4" /> {submitted ? "Selection sent" : "Submit selection"}</button>
        </div>
      </div>

      {photo && active !== null && <div className="fixed inset-0 z-50 bg-black/95 p-3 sm:p-8 flex items-center justify-center" onClick={() => setActive(null)}>
        <button onClick={e => { e.stopPropagation(); setActive((active + DEMO_PHOTOS.length - 1) % DEMO_PHOTOS.length); }} className="absolute left-3 sm:left-8 rounded-full p-3 bg-white/10" aria-label="Previous photo"><ChevronLeft /></button>
        <img src={photo} alt="Selected cosplay proof" className="max-w-full max-h-[78vh] object-contain rounded-xl" onClick={e => e.stopPropagation()} />
        <button onClick={e => { e.stopPropagation(); setActive((active + 1) % DEMO_PHOTOS.length); }} className="absolute right-3 sm:right-8 rounded-full p-3 bg-white/10" aria-label="Next photo"><ChevronRight /></button>
        <div className="absolute bottom-7 flex items-center gap-3"><span className="text-sm text-white/60">Photo {active + 1} of {DEMO_PHOTOS.length}</span><button onClick={e => { e.stopPropagation(); setSubmitted(false); toggle(active); }} className={`rounded-full px-5 py-3 inline-flex gap-2 items-center font-semibold ${picks.has(active) ? "bg-amber-300 text-stone-950" : "bg-white text-stone-950"}`} aria-pressed={picks.has(active)}><Star className={`w-4 h-4 ${picks.has(active) ? "fill-current" : ""}`} />{picks.has(active) ? "Selected" : "Select photo"}</button></div>
      </div>}
    </main>
  );
}
