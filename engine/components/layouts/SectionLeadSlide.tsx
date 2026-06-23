import type { SectionLeadSlots } from "@/engine/deck/types";

export function SectionLeadSlide({ slots }: { slots: SectionLeadSlots }) {
  return (
    <div className="sls">
      {slots.eyebrow && <p className="sls__eyebrow" data-slot="eyebrow">{slots.eyebrow}</p>}
      <h2 className="sls__title" data-slot="title">{slots.title}</h2>
      <p className="sls__lead" data-slot="lead">{slots.lead}</p>
      <style>{`
        .sls { max-width: 60ch; }
        .sls__eyebrow { font-family: var(--font-display); letter-spacing: 0.2em; text-transform: uppercase; color: var(--deck-accent, var(--color-mm-terracotta)); font-size: 0.9rem; margin-bottom: 1rem; }
        .sls__title { font-family: var(--font-display); font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1.08; color: var(--deck-ink, var(--color-mm-mushroom)); margin-bottom: 1.25rem; }
        .sls__lead { font-size: clamp(1.05rem, 2.2vw, 1.4rem); line-height: 1.55; color: var(--deck-ink, var(--color-mm-mushroom)); }
      `}</style>
    </div>
  );
}
