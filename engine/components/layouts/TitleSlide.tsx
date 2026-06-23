import type { TitleSlots } from "@/engine/deck/types";

export function TitleSlide({ slots }: { slots: TitleSlots }) {
  const lines = slots.title.split("\n");
  return (
    <div className="ts">
      {slots.eyebrow && <p className="ts__eyebrow" data-slot="eyebrow">{slots.eyebrow}</p>}
      <h1 className="ts__title" data-slot="title">
        {lines.map((l, i) => (
          <span key={i}>{l}{i < lines.length - 1 && <br />}</span>
        ))}
      </h1>
      {slots.note && <p className="ts__note" data-slot="note">{slots.note}</p>}
      {slots.subtitle && (
        <div className="ts__bar" data-slot="subtitle"><span>{slots.subtitle}</span></div>
      )}
      <style>{`
        .ts { text-align: center; max-width: 60ch; }
        .ts__eyebrow { font-family: var(--font-display); letter-spacing: 0.2em; text-transform: uppercase; color: var(--deck-accent, var(--color-mm-terracotta)); font-size: 0.9rem; margin-bottom: 1rem; }
        .ts__title { font-family: var(--font-display); font-size: clamp(3rem, 8cqw, 6rem); line-height: 1.02; color: var(--deck-ink, var(--color-mm-mushroom)); }
        .ts__note { font-family: var(--font-display); letter-spacing: 0.2em; text-transform: uppercase; color: var(--deck-accent, var(--color-mm-terracotta)); font-size: 1.1rem; margin-top: 1.25rem; }
        .ts__bar { display: inline-block; margin-top: 1.5rem; background: var(--color-mm-mushroom); padding: 0.5em 2em; border-radius: var(--radius-bar, 999px); }
        .ts__bar span { font-family: var(--font-display); letter-spacing: 0.04em; color: var(--color-mm-cream-pale); }
      `}</style>
    </div>
  );
}
