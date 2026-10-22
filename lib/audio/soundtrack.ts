/** The deck soundtrack, played through Web Audio. Browser-only — never import from a pure module.
 *  While a track plays, the audio hardware clock IS the deck clock (spec §1): `now()` returns
 *  `startT + (audible − ctxStartedAt)`, where `audible` is the context time currently reaching the
 *  speakers (latency-compensated, smoothed between audio callbacks — see `audibleTime`).
 *  Seeking = stop the source, start a new one. */
import { withBasePath } from "@/lib/base-path";

export interface Soundtrack {
  readonly duration: number;
  readonly peaks: Float32Array;
  play(fromT: number): void;
  pause(): void;
  now(): number | null;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export const PEAK_BUCKETS = 2000;

let shared: AudioContext | null = null;
function sharedContext(): AudioContext {
  return (shared ??= new AudioContext());
}

/** Max |sample| per bucket across all channels, clamped to [0, 1]. Pure; exported for tests. */
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const len = buffer.length;
  if (len === 0) return out;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const per = len / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.max(start + 1, Math.min(len, Math.floor((b + 1) * per)));
    let max = 0;
    for (const ch of channels) {
      for (let i = start; i < end && i < len; i++) {
        const v = Math.abs(ch[i]);
        if (v > max) max = v;
      }
    }
    out[b] = Math.min(1, max);
  }
  return out;
}

/** Max smoothing between audio callbacks. Deliberately far below the Player's 500 ms stall window:
 *  a suspended/dead context must still read as "not advancing" so the timer takes over. */
const MAX_EXTRAPOLATE_MS = 100;

/** The context time audible at the output right now. Prefers getOutputTimestamp() (already
 *  latency-compensated), extrapolated by wall time since it was stamped — capped, and only while
 *  the context is running — so the reading doesn't stair-step per audio callback. Fallback:
 *  currentTime minus the reported output (or base) latency, unsmoothed. */
function audibleTime(ctx: AudioContext): number {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && Number.isFinite(ts.contextTime) && Number.isFinite(ts.performanceTime)) {
    let base = ts.contextTime!;
    if (ctx.state === "running") {
      const ms = Math.min(Math.max(0, performance.now() - ts.performanceTime!), MAX_EXTRAPOLATE_MS);
      base += ms / 1000;
    }
    return base;
  }
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
}

export function createSoundtrack(buffer: AudioBuffer, ctx: AudioContext): Soundtrack {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const peaks = computePeaks(buffer, PEAK_BUCKETS);
  let source: AudioBufferSourceNode | null = null;
  let startT = 0;
  let ctxStartedAt = 0;
  /** Highest value now() has returned since the last play()/pause(): the clock never steps back. */
  let lastReturned = 0;

  const stop = () => {
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
    source = null;
  };

  return {
    duration: buffer.duration,
    peaks,
    play(fromT) {
      stop();
      if (fromT >= buffer.duration) return;
      ctx.resume?.().catch(() => {}); // autoplay-blocked: the Player's stall guard falls back to its timer
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(gain);
      startT = Math.max(0, fromT);
      ctxStartedAt = ctx.currentTime;
      lastReturned = startT;
      s.start(0, startT);
      s.onended = () => { if (source === s) source = null; };
      source = s;
    },
    pause() { stop(); lastReturned = 0; },
    now() {
      if (!source) return null;
      // lastReturned starts at startT, so this also holds at the play offset until the first
      // samples are audible (output latency), and never steps back between callbacks.
      const t = Math.max(lastReturned, startT + (audibleTime(ctx) - ctxStartedAt));
      if (t >= buffer.duration) return null;
      lastReturned = t;
      return t;
    },
    setMuted(muted) { gain.gain.value = muted ? 0 : 1; },
    dispose() { stop(); gain.disconnect(); },
  };
}

/** `url` is an app-absolute path (e.g. `/api/...`); it is prefixed with the configured basePath here. */
export async function loadSoundtrack(url: string, ctx: AudioContext = sharedContext()): Promise<Soundtrack> {
  const res = await fetch(withBasePath(url));
  if (!res.ok) throw new Error(`soundtrack fetch failed (${res.status})`);
  const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  return createSoundtrack(buffer, ctx);
}
