import type { ClosingSlots } from "@/engine/deck/types";

/** `downloadOpacity` is supplied by Deck so the CTA matches the chrome ramp. */
export function ClosingSlide({ slots, downloadOpacity = 1 }: { slots: ClosingSlots; downloadOpacity?: number }) {
  return (
    <div className="cls">
      {slots.eyebrow && <p className="cls__eyebrow" data-slot="eyebrow">{slots.eyebrow}</p>}
      <h2 className="cls__title" data-slot="title">{slots.title}</h2>
      {slots.subtitle && <p className="cls__sub" data-slot="subtitle">{slots.subtitle}</p>}
      <a className="cls__dl btn btn--gold" href={slots.downloadHref} download style={{ opacity: downloadOpacity }}>
        {slots.downloadLabel}
      </a>
      <style>{`
        .cls { text-align: center; max-width: 56ch; }
        .cls__eyebrow { font-family: var(--font-display); letter-spacing: 0.2em; text-transform: uppercase; color: var(--deck-accent, var(--color-mm-gold)); font-size: 0.9rem; margin-bottom: 1rem; }
        .cls__title { font-family: var(--font-display); font-size: clamp(2.5rem, 6vw, 4.5rem); line-height: 1.04; color: var(--deck-ink, var(--color-mm-cream)); }
        .cls__sub { margin-top: 1rem; color: var(--deck-ink, var(--color-mm-cream)); opacity: 0.85; font-size: 1.1rem; }
        .cls__dl { display: inline-block; margin-top: 2rem; transition: opacity 300ms ease; }
        @media (prefers-reduced-motion: reduce) { .cls__dl { transition: none; } }
      `}</style>
    </div>
  );
}
