"use client";
import type { PointerEvent } from "react";
import { sceneOverrun, type DeckLayout } from "@/engine/authoring/deck-clock";
import type { DeckMarker } from "@/engine/deck-doc";

export interface TimeBarProps {
  layout: DeckLayout;
  sceneIds: string[];
  value: number;
  targetSec?: number;
  onScrub: (T: number) => void;
  testId: string;
  /** Soundtrack peaks (0..1), evenly spaced over [0, peaksDuration]. */
  peaks?: Float32Array;
  /** Seconds of deck time the peaks cover. */
  peaksDuration?: number;
  markers?: DeckMarker[];
  onMarkerClick?: (t: number) => void;
}

export function timeBarScale(layout: DeckLayout, targetSec?: number): number {
  return Math.max(layout.total, targetSec ?? 0, 1e-6);
}

const pct = (v: number, scale: number) => `${(v / scale) * 100}%`;

/** A symmetric filled envelope: top edge left→right at 1 − p, bottom edge right→left at 1 + p. */
function waveformPath(peaks: Float32Array): string {
  let d = `M0 1`;
  for (let i = 0; i < peaks.length; i++) d += ` L${i} ${1 - peaks[i]}`;
  for (let i = peaks.length - 1; i >= 0; i--) d += ` L${i} ${1 + peaks[i]}`;
  return `${d} Z`;
}

/** Whole-deck scrubber shared by the timed Player HUD and the editor's deck ruler. Scene
 *  segments are drawn to scale; a pinned scene's held tail is shaded and content cut off past
 *  its boundary is flagged red. Purely presentational — the caller owns the clock. */
export function TimeBar({ layout, sceneIds, value, targetSec, onScrub, testId, peaks, peaksDuration, markers, onMarkerClick }: TimeBarProps) {
  const scale = timeBarScale(layout, targetSec);
  const scrubFrom = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    onScrub(Math.max(0, Math.min(layout.total, ((e.clientX - r.left) / r.width) * scale)));
  };
  return (
    <div
      data-testid={testId}
      className="timebar"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={layout.total}
      aria-valuenow={value}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubFrom(e); }}
      onPointerMove={(e) => { if (e.buttons & 1) scrubFrom(e); }}
      style={{ position: "relative", height: 26, borderRadius: 4, background: "rgba(255,255,255,0.06)", cursor: "pointer", touchAction: "none", userSelect: "none" }}
    >
      {peaks && peaks.length > 0 && peaksDuration !== undefined && peaksDuration > 0 && (
        <svg data-testid="timebar-waveform" pointerEvents="none" viewBox={`0 0 ${peaks.length} 2`} preserveAspectRatio="none"
          style={{ position: "absolute", left: 0, top: 0, height: "100%", width: pct(Math.min(peaksDuration, scale), scale), opacity: 0.35 }}>
          <path d={waveformPath(peaks)} fill="currentColor" />
        </svg>
      )}
      {layout.scenes.filter((s) => s.length > 0).map((s) => {
        const over = sceneOverrun(s);
        return (
          <div key={s.sceneIdx} data-testid="timebar-scene" data-scene-idx={s.sceneIdx}
            style={{ position: "absolute", top: 0, bottom: 0, left: pct(s.start, scale), width: pct(s.length, scale), borderRight: "1px solid rgba(255,255,255,0.25)", overflow: "hidden", fontSize: 10, lineHeight: "26px", paddingLeft: 4, whiteSpace: "nowrap", color: "rgba(255,255,255,0.75)" }}>
            {sceneIds[s.sceneIdx]}
            {s.pinned && s.contentLength < s.length && (
              <span data-testid="timebar-hold" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: `${((s.length - s.contentLength) / s.length) * 100}%`, background: "rgba(255,255,255,0.08)" }} />
            )}
            {over > 0 && (
              <span data-testid="timebar-overrun" title={`${over.toFixed(1)}s over`} style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 6, background: "repeating-linear-gradient(45deg, #c0392b 0 3px, transparent 3px 6px)" }} />
            )}
          </div>
        );
      })}
      {targetSec !== undefined && (
        <div data-testid="timebar-target" style={{ position: "absolute", top: -3, bottom: -3, left: pct(targetSec, scale), width: 2, marginLeft: -1, background: "#d4a843" }} />
      )}
      {markers?.map((m) => (
        <div key={m.id} data-testid="timebar-marker" data-marker-id={m.id} title={m.label}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onMarkerClick?.(m.t); }}
          style={{ position: "absolute", top: -6, bottom: -6, left: pct(m.t, scale), width: 2, marginLeft: -1, background: "#7fd1ff", cursor: "pointer" }}>
          <span style={{ position: "absolute", top: -12, left: 3, fontSize: 9, whiteSpace: "nowrap", color: "#7fd1ff" }}>{m.label}</span>
        </div>
      ))}
      <div data-testid="timebar-playhead" style={{ position: "absolute", top: -4, bottom: -4, left: pct(value, scale), width: 2, marginLeft: -1, background: "#fff", pointerEvents: "none" }} />
    </div>
  );
}
