"use client";

import { memo, useRef } from "react";
import { useGSAP } from "@gsap/react";
import type { Slide as SlideType } from "@/engine/deck/types";
import { TitleSlide } from "./layouts/TitleSlide";
import { SectionLeadSlide } from "./layouts/SectionLeadSlide";
import { ClosingSlide } from "./layouts/ClosingSlide";
import { CinematicSlide, type CinematicRuntime } from "./layouts/CinematicSlide";
import { staggerReveal } from "./effects/anim";
import type { DeckChrome } from "@/engine/deck-doc";

interface Props {
  slide: SlideType;
  index: number;
  count: number;
  /** For the closing slide, the live download-button opacity. */
  downloadOpacity?: number;
  /** Run the staged build animation on entry (off for PDF / reduced motion). */
  animate?: boolean;
  /** Engine callbacks for cinematic beats (unused by the other layouts). */
  runtime?: CinematicRuntime;
  /** True when rendering for PDF print — suppresses screen-only elements. */
  print?: boolean;
  /** Optional host-app chrome (splash, fin CTAs, wordmark). Generic by default (no chrome). */
  chrome?: DeckChrome;
}

interface LayoutBodyProps {
  slide: SlideType;
  downloadOpacity?: number;
  animate?: boolean;
  runtime?: CinematicRuntime;
  print?: boolean;
  chrome?: DeckChrome;
}

function LayoutBody({ slide, downloadOpacity, animate, runtime, print, chrome }: LayoutBodyProps) {
  switch (slide.layout) {
    case "title":
      return <TitleSlide slots={slide.slots} />;
    case "sectionLead":
      return <SectionLeadSlide slots={slide.slots} />;
    case "closing":
      return <ClosingSlide slots={slide.slots} downloadOpacity={downloadOpacity} />;
    case "cinematic":
      // Treated slides (the investor deck) render narration text instantly — no text-in
      // transitions. /story slides carry no treatment, so they keep their cinematic reveals.
      return <CinematicSlide slots={slide.slots} animate={animate ?? false} runtime={runtime!} print={print} instantText={!!slide.treatment} chrome={chrome} />;
  }
}

function SlideInner({ slide, index, count, downloadOpacity, animate = false, runtime, print, chrome }: Props) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!animate) return;
      const order = slide.build ?? [];
      const els = order
        .map((k) => scope.current?.querySelector<HTMLElement>(`[data-slot="${k}"]`))
        .filter((e): e is HTMLElement => !!e);
      if (!els.length) return;
      const tl = staggerReveal(els);
      // A background/unfocused tab pauses requestAnimationFrame, so the gsap.from
      // tween never runs and the elements stay stuck at opacity 0. If we can't
      // animate, snap straight to the visible end state so content never vanishes.
      if (document.visibilityState !== "visible") tl.progress(1);
    },
    { scope, dependencies: [slide.id, animate] }
  );

  return (
    <div className="slide" data-slide-id={slide.id} ref={scope}>
      <div className="slide__body">
        <LayoutBody slide={slide} downloadOpacity={downloadOpacity} animate={animate} runtime={runtime} print={print} chrome={chrome} />
      </div>
      <span className="slide__page">{index + 1} / {count}</span>
      {chrome?.wordmark && <span className="slide__wordmark">{chrome.wordmark}</span>}
      <style>{`
        .slide { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 6cqh 8cqw; }
        .slide__body { position: relative; z-index: 1; }
        .slide__page { position: absolute; right: 1.5rem; bottom: 1.25rem; font-family: ui-monospace, monospace; font-size: 0.8rem; opacity: 0.6; color: var(--color-mm-mushroom); }
        .slide__wordmark { position: absolute; left: 1.5rem; bottom: 1.25rem; font-family: var(--font-display); font-size: 0.8rem; letter-spacing: 0.1em; opacity: 0.5; color: var(--color-mm-mushroom); }
      `}</style>
    </div>
  );
}

export const Slide = memo(SlideInner);
