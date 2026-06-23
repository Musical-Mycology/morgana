"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import gsap from "gsap";
import type { ArtMode, ArtTransition } from "@/engine/deck/types";
import { applyArt } from "@/engine/deck/flatten";
import { isOverlay, storyAssetUrl, type StoryAsset } from "@/engine/deck/story-assets";

export interface ArtStageHandle {
  /** Cross-fade the visible stack to exactly `layers` (bottom→top) using `mode`. */
  show(layers: StoryAsset[], mode: ArtMode, durationMs?: number): void;
  /** Fold one transition onto the live stack (mid-timeline art ops). */
  apply(transition: ArtTransition, durationMs?: number): void;
  /** Snap instantly (reduced motion / jump nav / PDF). */
  snap(layers: StoryAsset[]): void;
}

const DUR: Record<ArtMode, number> = {
  cut: 0, fade: 700, crossfade: 900, morph: 800, dissolve: 1100,
};

interface Props { nightlight: number; reduced?: boolean; transparentBg?: boolean }

export const ArtStage = forwardRef<ArtStageHandle, Props>(function ArtStage(
  { nightlight, reduced, transparentBg }, ref
) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef<StoryAsset[]>([]);

  /** Reconcile the DOM layer stack to exactly `targets`; reuse matching layers (no flicker). */
  function render(targets: StoryAsset[], mode: ArtMode, durationMs?: number) {
    const host = root.current;
    if (!host) return;
    const d = (durationMs ?? DUR[mode]) / 1000;
    const existing = Array.from(host.querySelectorAll<HTMLImageElement>(".artstage__layer"));
    const kept: HTMLImageElement[] = [];
    const added: HTMLImageElement[] = [];

    targets.forEach((asset, i) => {
      const reuse = existing.find((e) => e.dataset.asset === asset && !kept.includes(e));
      if (reuse) {
        gsap.killTweensOf(reuse); // cancel any in-flight fade so a stale onComplete can't remove a reused layer
        reuse.style.zIndex = String(i + 1);
        reuse.style.opacity = "1";
        reuse.style.transform = "none";
        kept.push(reuse);
        return;
      }
      const img = document.createElement("img");
      img.src = storyAssetUrl(asset);
      img.className = "artstage__layer";
      img.dataset.asset = asset;
      img.style.zIndex = String(i + 1);
      img.style.opacity = reduced || mode === "cut" ? "1" : "0";
      if (isOverlay(asset)) {
        img.dataset.overlay = "1";
        img.style.mixBlendMode = "screen"; // glow over the scene; transparent areas untouched
        if (!reduced && mode !== "cut") img.style.transform = "scale(0.9)"; // bounce start
      } else if (mode === "morph") {
        img.style.transform = "scale(1.04)";
      }
      host.appendChild(img);
      added.push(img);
    });

    const outgoing = existing.filter((el) => !kept.includes(el));
    if (reduced || mode === "cut") {
      added.forEach((el) => { el.style.opacity = "1"; el.style.transform = "none"; });
      outgoing.forEach((el) => el.remove());
    } else {
      const overlayEls = added.filter((el) => el.dataset.overlay === "1");
      const plainEls = added.filter((el) => el.dataset.overlay !== "1");
      if (plainEls.length) gsap.to(plainEls, { opacity: 1, scale: 1, duration: d, ease: "power2.inOut" });
      if (overlayEls.length) gsap.fromTo(overlayEls, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: d, ease: "back.out(2)" });
      // Per-element fade tweens so each layer's removal is independent: if a fading
      // layer is later reused, killTweensOf(it) (in the reuse branch) cancels its own
      // tween + onComplete — a shared multi-target onComplete would still remove it.
      outgoing.forEach((el) =>
        gsap.to(el, { opacity: 0, duration: d, ease: "power2.inOut", onComplete: () => el.remove() })
      );
    }
    current.current = [...targets];
  }

  useImperativeHandle(ref, () => ({
    show: (layers, mode, durationMs) => render(layers, mode, durationMs),
    apply: (transition, durationMs) => render(applyArt(current.current, transition), transition.mode, durationMs ?? transition.durationMs),
    snap: (layers) => render(layers, "cut"),
  }));

  // nightlight: warm glow rises with night; subtle saturation lift on the art.
  const glow = Math.min(1, nightlight);
  return (
    <div aria-hidden className="artstage" ref={root}
         style={{ filter: `saturate(${0.85 + 0.3 * glow}) brightness(${0.9 + 0.15 * glow})`,
                  ...(transparentBg ? { background: "transparent" } : null) }}>
      <div className="artstage__glow" style={{ opacity: 0.15 + 0.45 * glow }} />
      <style>{`
        .artstage { position: absolute; inset: 0; overflow: hidden; background: #1a1410; }
        .artstage__layer {
          position: absolute; inset: 0; margin: auto;
          max-width: 100%; max-height: 100%; width: 100%; height: 100%;
          object-fit: contain; will-change: opacity, transform;
        }
        .artstage__glow {
          position: absolute; inset: 0; pointer-events: none; z-index: 50;
          background: radial-gradient(60% 45% at 50% 55%, rgba(232,189,90,0.5), transparent 70%);
          transition: opacity 200ms linear;
        }
      `}</style>
    </div>
  );
});
