"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import gsap from "gsap";
import { emitNote, launchNote, makeNote, makeNoteHex, randomGlyph } from "./effects/notes";
import { PANEL_ANCHORS, type NoteColor, type Panel } from "@/engine/deck/story-assets";

/** A placeable directional note emitter. x/y are 0–1 on the stage. */
export interface NoteEmitterOpts {
  color: string;   // HEX
  x: number; y: number;
  dir: number;     // compass degrees (0 = up, clockwise)
  spread: number;  // ± degrees of randomness (0 = laser, 180 = full circle)
  decayMs: number; // note lifetime
  freq: number;    // notes per second
}

/** A placeable orbiting note ring. x/y/width/height are 0–1 on the stage. */
export interface NoteCircleOpts {
  x: number; y: number;    // ellipse center
  width: number; height: number; // ellipse full size (fraction of stage w/h)
  hex: string[];           // palette the notes cycle through
  bounce: number;          // 0 = smooth ellipse … 1 = springy vertical hops
  notes: number;           // notes in the ring
  speed: number;           // milliseconds per orbit
}

export interface NoteFieldHandle {
  emit(panel: Panel, color: NoteColor, intensity: number): void;
  /** Stop ongoing emission (in-flight notes finish their drift + self-remove). */
  stopEmit(): void;
  swirl(action: "start" | "expand" | "stop", color: NoteColor): void;
  /** Start a placeable directional emitter (note_emitter action). */
  startEmitter(opts: NoteEmitterOpts): void;
  /** Start a placeable orbiting note ring (note_circle action). */
  startCircle(opts: NoteCircleOpts): void;
  /** Stop ALL note sources — custom emitters, legacy emit, swirl, and circles (stop_notes action). */
  stopNotes(): void;
  /** Stop only the orbiting note rings, leaving other sources running (stop_circle action). */
  stopCircles(): void;
}
interface Props { reduced?: boolean }

export const NoteField = forwardRef<NoteFieldHandle, Props>(function NoteField({ reduced }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const emitTimer = useRef<gsap.core.Timeline | null>(null);
  const swirlTl = useRef<gsap.core.Timeline | null>(null);
  const swirlRadius = useRef(80);
  const emitters = useRef<gsap.core.Timeline[]>([]); // custom note_emitter timelines
  const circles = useRef<gsap.core.Timeline[]>([]); // note_circle orbit timelines

  // Kill any running timelines when the field unmounts (e.g. leaving /story).
  useEffect(() => () => {
    emitTimer.current?.kill(); swirlTl.current?.kill();
    emitters.current.forEach((t) => t.kill());
    circles.current.forEach((t) => t.kill());
  }, []);

  useImperativeHandle(ref, () => ({
    emit(panel, color, intensity) {
      const host = root.current; if (!host || reduced) return;
      emitTimer.current?.kill();
      const anchors = PANEL_ANCHORS[panel] ?? [{ x: 0.5, y: 0.6 }];
      let i = 0;
      // light emission: one note every ~600ms / intensity
      emitTimer.current = gsap.timeline({ repeat: -1, repeatDelay: 0.6 / Math.max(0.2, intensity) })
        .call(() => {
          const a = anchors[i % anchors.length];
          emitNote(host, color, a.x * host.clientWidth, a.y * host.clientHeight, i++);
        });
    },
    stopEmit() {
      emitTimer.current?.kill();
      emitTimer.current = null;
    },
    swirl(action, color) {
      const host = root.current; if (!host || reduced) return;
      const clearSwirl = () => {
        swirlTl.current?.kill(); swirlTl.current = null;
        host.querySelectorAll(".swirl").forEach((n) => n.remove());
      };
      if (action === "stop") { clearSwirl(); return; }
      if (action === "expand") { swirlRadius.current = 200; return; }
      // start — clear any prior swirl so start/stop/start can't stack tweens or sprites
      clearSwirl();
      swirlRadius.current = 80;
      const cx = host.clientWidth * 0.5, cy = host.clientHeight * 0.5;
      const N = 10;
      const tl = gsap.timeline(); // one timeline owns all orbit tweens, so kill() stops them
      for (let k = 0; k < N; k++) {
        const el = makeNote(color, randomGlyph(k)); el.classList.add("swirl");
        host.appendChild(el);
        const phase = (k / N) * Math.PI * 2;
        tl.add(gsap.to({ a: phase }, {
          a: phase + Math.PI * 2, duration: 8, ease: "none", repeat: -1,
          onUpdate() {
            const r = swirlRadius.current;
            const ang = (this.targets()[0] as { a: number }).a;
            el.style.left = `${cx + Math.cos(ang) * r}px`;
            el.style.top = `${cy + Math.sin(ang) * r * 0.6}px`;
          },
        }), 0);
      }
      swirlTl.current = tl;
    },
    startEmitter(opts) {
      const host = root.current; if (!host || reduced) return;
      let i = 0;
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1 / Math.max(0.1, opts.freq) })
        .call(() => launchNote(
          host, opts.color, opts.x * host.clientWidth, opts.y * host.clientHeight,
          opts.dir, opts.spread, opts.decayMs, i++,
        ));
      emitters.current.push(tl);
    },
    startCircle(opts) {
      const host = root.current; if (!host || reduced) return;
      const { x, y, width, height, hex, bounce, notes, speed } = opts;
      const cx = x * host.clientWidth, cy = y * host.clientHeight;
      const rx = (width * host.clientWidth) / 2;   // ellipse half-axes in px
      const ry = (height * host.clientHeight) / 2;
      const N = Math.max(1, Math.round(notes));
      const colors = hex.length ? hex : ["#FFFFFF"];
      const dur = Math.max(0.1, speed / 1000); // speed is ms/orbit → gsap seconds
      const tl = gsap.timeline(); // one timeline owns all orbits, so kill() stops them
      for (let k = 0; k < N; k++) {
        const el = makeNoteHex(colors[k % colors.length], randomGlyph(k));
        el.classList.add("circle");
        host.appendChild(el);
        const phase = (k / N) * Math.PI * 2; // evenly distribute around the ring
        tl.add(gsap.to({ a: phase }, {
          a: phase + Math.PI * 2, duration: dur, ease: "none", repeat: -1,
          onUpdate() {
            const ang = (this.targets()[0] as { a: number }).a;
            // bounce: superimpose upward hops (|sin| → always up), scaled by `bounce`.
            const hop = bounce * ry * 0.5 * Math.abs(Math.sin(ang * 3));
            el.style.left = `${cx + Math.cos(ang) * rx}px`;
            el.style.top = `${cy + Math.sin(ang) * ry - hop}px`;
          },
        }), 0);
      }
      circles.current.push(tl);
    },
    stopNotes() {
      emitters.current.forEach((t) => t.kill()); emitters.current = [];
      circles.current.forEach((t) => t.kill()); circles.current = [];
      emitTimer.current?.kill(); emitTimer.current = null;
      swirlTl.current?.kill(); swirlTl.current = null;
      root.current?.querySelectorAll(".swirl, .circle").forEach((n) => n.remove());
    },
    stopCircles() {
      circles.current.forEach((t) => t.kill()); circles.current = [];
      root.current?.querySelectorAll(".circle").forEach((n) => n.remove());
    },
  }));

  return (
    <div aria-hidden className="notefield" ref={root}>
      <style>{`.notefield { position: absolute; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }`}</style>
    </div>
  );
});
