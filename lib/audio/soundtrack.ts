/** The deck soundtrack, played through Web Audio. Browser-only — never import from a pure module.
 *  While a track plays, the audio hardware clock IS the deck clock (spec §1): `now()` returns
 *  `startT + (ctx.currentTime − ctxStartedAt)`. Seeking = stop the source, start a new one. */
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

export function createSoundtrack(buffer: AudioBuffer, ctx: AudioContext): Soundtrack {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const peaks = computePeaks(buffer, PEAK_BUCKETS);
  let source: AudioBufferSourceNode | null = null;
  let startT = 0;
  let ctxStartedAt = 0;

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
      void ctx.resume?.();
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(gain);
      startT = Math.max(0, fromT);
      ctxStartedAt = ctx.currentTime;
      s.start(0, startT);
      s.onended = () => { if (source === s) source = null; };
      source = s;
    },
    pause() { stop(); },
    now() {
      if (!source) return null;
      const t = startT + (ctx.currentTime - ctxStartedAt);
      return t >= buffer.duration ? null : t;
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
