"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import gsap from "gsap";
import type { ArtAsset, ArtMode, ArtTransition, ClipOpts } from "@/engine/deck/types";
import { applyArt } from "@/engine/deck/flatten";
import { isOverlay } from "@/engine/deck/story-assets";
import { isMediaRef, isVideoRef, type MediaRef } from "@/engine/deck/media-ref";
import { clipTimeAt } from "@/engine/deck/clip-clock";
import { useAssetResolver } from "@/engine/asset-resolver-react";
import { ART_DURATION_MS, type ArtLayerState } from "@/engine/authoring/art-clock";
import { createClipVideo, MIN_VIDEO_OPACITY, releaseVideo, syncVideo, type ClipMode } from "@/engine/components/video-sync";

/** Clip options per media ref, as carried by the transition that brings the layers in. */
export type ArtClips = Record<MediaRef, ClipOpts>;

export interface ArtStageHandle {
  /** Cross-fade the visible stack to exactly `layers` (bottom→top) using `mode`. A no-op when
   *  `layers` already equals the live stack (by value): re-showing the same stack must not
   *  restart, or cut short, a crossfade that is still running into it. A NEW video layer plays
   *  from its in-point (`clips`, default 0) unless `clipPlayback` is false. */
  show(layers: ArtAsset[], mode: ArtMode, durationMs?: number, clips?: ArtClips): void;
  /** Fold one transition onto the live stack (mid-timeline art ops). New video layers play from
   *  the in-point in `transition.clips` (unless `clipPlayback` is false). */
  apply(transition: ArtTransition, durationMs?: number): void;
  /** Snap instantly (reduced motion / jump nav / PDF / the editor). Never plays: a new video
   *  layer waits, paused, at its in-point. */
  snap(layers: ArtAsset[], clips?: ArtClips): void;
  /** Stateless paint of exactly `layers` (bottom→top by array order; each layer's `z` drives
   *  stacking) plus the nightlight level `night`. For host-driven / render callers that compute
   *  the state at any deck time: creates no tweens and sets no CSS transition, so the result is
   *  the same whether reached by stepping or jumping. Video layers are synced to their clip time
   *  at deck time `T` (seconds, default 0) in clip `mode` (default "seek"). */
  renderState(layers: ArtLayerState[], night: number, T?: number, mode?: ClipMode): void;
}

interface Props {
  nightlight: number; reduced?: boolean; transparentBg?: boolean;
  /** false = new video layers from show/apply never play: they wait, paused, at their in-point.
   *  The editor canvas and library thumbnails paint through seek.ts, which has no deck clock,
   *  so they show the in-point frame (spec §4 "Editor canvas", §6). Default true. */
  clipPlayback?: boolean;
}

function sameStack(a: ArtAsset[], b: ArtAsset[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** A clip's in-point (seconds) without a known duration: clipTimeAt at the moment it appears. */
const clipIn = (opts: ClipOpts | undefined) => clipTimeAt(0, 0, opts);

const asVideo = (el: Element): HTMLVideoElement | null => (el instanceof HTMLVideoElement ? el : null);

/** Autoplay looping (no deck clock): each looping clip's `ended` listener, so whoever takes the
 *  element over (renderState's syncVideo, a non-playing re-seek, dispose) can switch it off. */
const autoLoops = new WeakMap<HTMLVideoElement, () => void>();

function startAutoLoop(v: HTMLVideoElement, inPt: number): void {
  stopAutoLoop(v);
  const onEnded = () => { v.currentTime = inPt; v.play().catch(() => {}); };
  autoLoops.set(v, onEnded);
  v.addEventListener("ended", onEnded);
}

function stopAutoLoop(v: HTMLVideoElement): void {
  const onEnded = autoLoops.get(v);
  if (!onEnded) return;
  v.removeEventListener("ended", onEnded);
  autoLoops.delete(v);
}

/** Non-playing paths (snap, the editor): park a clip on its in-point, paused. Writes only on a
 *  change, so redrawing the same frame issues no seek. */
function holdAtIn(v: HTMLVideoElement, inPt: number): void {
  stopAutoLoop(v);
  if (Math.abs(v.currentTime - inPt) > 1e-4) v.currentTime = inPt;
  if (!v.paused) v.pause();
}

/** Take a layer off the stage for good: cancel its tweens, release a video's decoder, detach. */
function dispose(el: HTMLElement): void {
  gsap.killTweensOf(el);
  const v = asVideo(el);
  if (v) { stopAutoLoop(v); releaseVideo(v); }
  el.remove();
}

export const ArtStage = forwardRef<ArtStageHandle, Props>(function ArtStage(
  { nightlight, reduced, transparentBg, clipPlayback = true }, ref
) {
  const assets = useAssetResolver();
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const root = useRef<HTMLDivElement>(null);
  const current = useRef<ArtAsset[]>([]);

  /** One layer element for `asset`: a clip <video> for a video ref, an <img> for an uploaded
   *  image (assets.media) or a story panel (assets.story). */
  function makeLayerEl(asset: ArtAsset): HTMLElement {
    const a = assetsRef.current;
    let el: HTMLElement;
    if (isVideoRef(asset)) {
      el = createClipVideo(a.media(asset));
      el.dataset.video = "1";
    } else {
      const img = document.createElement("img");
      img.src = isMediaRef(asset) ? a.media(asset) : a.story(asset);
      el = img;
    }
    el.className = "artstage__layer";
    el.dataset.asset = asset;
    return el;
  }

  /** Reconcile the DOM layer stack to exactly `targets`; reuse matching layers (no flicker).
   *  `play`: whether a newly added video layer starts playing from its in-point in `clips` (a
   *  `loop` clip restarts there on `ended`). Autoplay leaves kept video layers as they are: their
   *  options came with the transition that brought them in. A non-playing call (snap, or
   *  `clipPlayback` off) parks every video layer, kept ones included, paused on its in-point, so
   *  the editor shows an edited in-point at once. */
  function render(targets: ArtAsset[], mode: ArtMode, durationMs?: number, clips?: ArtClips, play = true) {
    const host = root.current;
    if (!host) return;
    const playing = play && clipPlayback;
    const d = (durationMs ?? ART_DURATION_MS[mode]) / 1000;
    const existing = Array.from(host.querySelectorAll<HTMLElement>(".artstage__layer"));
    const kept: HTMLElement[] = [];
    const added: HTMLElement[] = [];

    targets.forEach((asset, i) => {
      const reuse = existing.find((e) => e.dataset.asset === asset && !kept.includes(e));
      if (reuse) {
        gsap.killTweensOf(reuse); // cancel any in-flight fade so a stale onComplete can't remove (or release) a reused layer
        reuse.style.zIndex = String(i + 1);
        reuse.style.opacity = "1";
        reuse.style.transform = "none";
        kept.push(reuse);
        const kv = asVideo(reuse);
        if (kv && !playing) holdAtIn(kv, clipIn(clips?.[asset as MediaRef]));
        return;
      }
      const el = makeLayerEl(asset);
      el.style.zIndex = String(i + 1);
      el.style.opacity = reduced || mode === "cut" ? "1" : "0";
      if (isOverlay(asset)) {
        el.dataset.overlay = "1";
        el.style.mixBlendMode = "screen"; // glow over the scene; transparent areas untouched
        if (!reduced && mode !== "cut") el.style.transform = "scale(0.9)"; // bounce start
      } else if (mode === "morph") {
        el.style.transform = "scale(1.04)";
      }
      host.appendChild(el);
      added.push(el);
      const v = asVideo(el); // a <video> only ever comes from a video ref
      if (v) {
        // No deck clock here: start at the in-point (applied once metadata loads if it isn't yet).
        const opts = clips?.[asset as MediaRef];
        const inPt = clipIn(opts);
        v.currentTime = inPt;
        if (playing) {
          v.play().catch(() => {});
          if (opts?.loop) startAutoLoop(v, inPt);
        }
      }
    });

    const outgoing = existing.filter((el) => !kept.includes(el));
    if (reduced || mode === "cut") {
      added.forEach((el) => { el.style.opacity = "1"; el.style.transform = "none"; });
      outgoing.forEach(dispose);
    } else {
      const overlayEls = added.filter((el) => el.dataset.overlay === "1");
      const plainEls = added.filter((el) => el.dataset.overlay !== "1");
      if (plainEls.length) gsap.to(plainEls, { opacity: 1, scale: 1, duration: d, ease: "power2.inOut" });
      if (overlayEls.length) gsap.fromTo(overlayEls, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: d, ease: "back.out(2)" });
      // Per-element fade tweens so each layer's removal is independent: if a fading
      // layer is later reused, killTweensOf(it) (in the reuse branch) cancels its own
      // tween + onComplete — a shared multi-target onComplete would still remove it.
      // A cancelled fade's layer is either reused (kept on stage) or removed by the path that
      // cancelled it (renderState / a cut), which releases it there — so nothing leaks.
      outgoing.forEach((el) =>
        gsap.to(el, { opacity: 0, duration: d, ease: "power2.inOut", onComplete: () => dispose(el) })
      );
    }
    current.current = [...targets];
  }

  // Leaving the stage: release every clip still on it (spec §4) — React drops the imperatively
  // appended layers with the root, but a detached <video> would keep its decoder. Only when the
  // root really left the document: StrictMode's simulated unmount keeps the DOM (and the layers
  // a host painted imperatively), so disposing there would strand an emptied stage in dev.
  useEffect(() => {
    const host = root.current;
    return () => {
      if (!host || host.isConnected) return;
      host.querySelectorAll<HTMLElement>(".artstage__layer").forEach(dispose);
    };
  }, []);

  /** Park the on-stage video layers of `layers` on their in-points (clips), paused. */
  function holdStack(layers: ArtAsset[], clips?: ArtClips) {
    const host = root.current;
    if (!host) return;
    host.querySelectorAll<HTMLVideoElement>("video.artstage__layer").forEach((v) => {
      const asset = v.dataset.asset as ArtAsset;
      if (layers.includes(asset)) holdAtIn(v, clipIn(clips?.[asset as MediaRef]));
    });
  }

  useImperativeHandle(ref, () => ({
    show: (layers, mode, durationMs, clips) => {
      // Re-showing the stack already on screen (an entry art that folds to the stack the beat
      // inherits) must leave the in-flight stack (and any crossfade into it) alone. art-clock's
      // artEvents mirrors this by dropping such no-op entry events. With clip playback off (the
      // editor) nothing is in flight to protect, and an edited in-point must still land.
      if (sameStack(layers, current.current)) {
        if (!clipPlayback) holdStack(layers, clips);
        return;
      }
      render(layers, mode, durationMs, clips);
    },
    apply: (transition, durationMs) => render(applyArt(current.current, transition), transition.mode, durationMs ?? transition.durationMs, transition.clips),
    snap: (layers, clips) => render(layers, "cut", undefined, clips, false),
    renderState: (layers, night, T = 0, mode = "seek") => {
      const host = root.current;
      if (!host) return;
      const existing = Array.from(host.querySelectorAll<HTMLElement>(".artstage__layer"));
      const used = new Set<HTMLElement>();
      const els = layers.map((l) => {
        let el = existing.find((e) => e.dataset.asset === l.asset && !used.has(e));
        if (el) {
          gsap.killTweensOf(el); // a stale in-flight fade must not remove or re-fade it
          const rv = asVideo(el);
          if (rv) stopAutoLoop(rv); // deck time owns it now: an autoplay loop would fight syncVideo
        } else el = makeLayerEl(l.asset);
        used.add(el);
        if (l.overlay) { el.dataset.overlay = "1"; el.style.mixBlendMode = "screen"; }
        // A video layer never drops to 0: it must stay composited so its seeked frame is what shows.
        el.style.opacity = String(asVideo(el) ? Math.max(l.opacity, MIN_VIDEO_OPACITY) : l.opacity);
        el.style.transform = l.scale === 1 ? "none" : `scale(${l.scale})`;
        el.style.zIndex = String(l.z);
        return el;
      });
      existing.filter((e) => !used.has(e)).forEach(dispose);
      els.forEach((el) => host.appendChild(el)); // appendChild moves: DOM order = array order (z breaks nothing)
      // Clip time is a pure function of deck time: the layer's entry (`since`) and clip options.
      layers.forEach((l, i) => {
        const v = asVideo(els[i]);
        if (v) syncVideo(v, (d) => clipTimeAt(l.since, T, l.clip, d), mode, { loop: l.clip?.loop });
      });
      current.current = layers.filter((l) => l.opacity > 0).map((l) => l.asset);
      const g = Math.min(1, night);
      host.style.filter = `saturate(${0.85 + 0.3 * g}) brightness(${0.9 + 0.15 * g})`;
      const glow = host.querySelector<HTMLElement>(".artstage__glow");
      if (glow) { glow.style.transition = "none"; glow.style.opacity = String(0.15 + 0.45 * g); }
    },
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
