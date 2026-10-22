import { afterEach, expect, test, vi } from "vitest";
import { computePeaks, createSoundtrack, PEAK_BUCKETS } from "@/lib/audio/soundtrack";

function fakeBuffer(samples: number[], sampleRate = 10): AudioBuffer {
  const data = Float32Array.from(samples);
  return { duration: samples.length / sampleRate, length: samples.length, numberOfChannels: 1, sampleRate,
    getChannelData: () => data } as unknown as AudioBuffer;
}
type FakeCtx = AudioContext & {
  currentTime: number; state: AudioContextState; outputLatency?: number; baseLatency?: number;
  getOutputTimestamp?: () => AudioTimestamp;
};
function fakeCtx(extra: Record<string, unknown> = {}) {
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: unknown }[] = [];
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const ctx = {
    currentTime: 100, state: "running", destination: {}, resume: vi.fn(() => Promise.resolve()), ...extra,
    createGain: () => gain,
    createBufferSource: () => {
      const s = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as unknown };
      sources.push(s); return s;
    },
  };
  return { ctx: ctx as unknown as FakeCtx, sources, gain };
}

/** A context whose output timestamp we control: `out.contextTime` is what is audible right now,
 *  stamped at `out.performanceTime`; `perf.now` is the mocked performance.now(). */
function timestampedCtx() {
  const out = { contextTime: 100, performanceTime: 5000 };
  const perf = { now: 5000 };
  vi.spyOn(performance, "now").mockImplementation(() => perf.now);
  const f = fakeCtx({ getOutputTimestamp: () => ({ ...out }) });
  return { ...f, out, perf };
}
afterEach(() => { vi.restoreAllMocks(); });
const tenSeconds = () => fakeBuffer(new Array(100).fill(0));

test("computePeaks takes the max |sample| per bucket across channels, clamped to 1", () => {
  const p = computePeaks(fakeBuffer([0, 0.5, -0.9, 0.1, 2, 0]), 3);
  expect(Array.from(p)).toEqual([0.5, Math.fround(0.9), 1]);
  expect(computePeaks(fakeBuffer([]), 4)).toEqual(new Float32Array(4));
});

test("now() follows the audio clock from the play offset, null when paused or past the end", () => {
  const { ctx, sources } = fakeCtx();
  const st = createSoundtrack(fakeBuffer(new Array(50).fill(0)), ctx); // 5 s
  expect(st.duration).toBe(5);
  expect(st.peaks.length).toBe(PEAK_BUCKETS);
  expect(st.now()).toBeNull();
  st.play(2);
  expect(sources[0].start).toHaveBeenCalledWith(0, 2);
  expect(st.now()).toBeCloseTo(2);
  (ctx as { currentTime: number }).currentTime += 1.5;
  expect(st.now()).toBeCloseTo(3.5);
  (ctx as { currentTime: number }).currentTime += 2;
  expect(st.now()).toBeNull(); // 5.5 ≥ duration
  st.play(1);                  // restart: old source stopped, new one at offset 1
  expect(sources[1].stop).not.toHaveBeenCalled();
  expect(sources[1].start).toHaveBeenCalledWith(0, 1);
  st.pause();
  expect(sources[1].stop).toHaveBeenCalled();
  expect(st.now()).toBeNull();
});

test("play past the duration does nothing; mute sets gain 0", () => {
  const { ctx, sources, gain } = fakeCtx();
  const st = createSoundtrack(fakeBuffer(new Array(20).fill(0)), ctx); // 2 s
  st.play(2);
  expect(sources).toHaveLength(0);
  st.setMuted(true);
  expect(gain.gain.value).toBe(0);
  st.setMuted(false);
  expect(gain.gain.value).toBe(1);
});

test("latency: now() follows the AUDIBLE output time (getOutputTimestamp), not currentTime", () => {
  const { ctx, out } = timestampedCtx();
  const st = createSoundtrack(tenSeconds(), ctx);
  st.play(2);                         // scheduled at currentTime 100
  ctx.currentTime = 101.2;            // the render clock is 0.2 s ahead of what is audible
  out.contextTime = 101.0;
  expect(st.now()).toBeCloseTo(3.0);  // not 3.2
});

test("extrapolation: between audio callbacks now() advances with performance.now(), capped at +0.1 s", () => {
  const { ctx, out, perf } = timestampedCtx();
  const st = createSoundtrack(tenSeconds(), ctx);
  st.play(2);
  ctx.currentTime = 101.01;
  out.contextTime = 101.0; out.performanceTime = 5000;
  perf.now = 5000; expect(st.now()).toBeCloseTo(3.0);
  perf.now = 5040; expect(st.now()).toBeCloseTo(3.04);
  perf.now = 5100; expect(st.now()).toBeCloseTo(3.1);
  perf.now = 5400; expect(st.now()).toBeCloseTo(3.1); // stops: a dead callback stream must read as stalled
  perf.now = 6000; expect(st.now()).toBeCloseTo(3.1);
});

test("suspended context: no extrapolation", () => {
  const { ctx, out, perf } = timestampedCtx();
  const st = createSoundtrack(tenSeconds(), ctx);
  st.play(2);
  out.contextTime = 101.0; out.performanceTime = 5000;
  ctx.state = "suspended";
  perf.now = 5080;
  expect(st.now()).toBeCloseTo(3.0);
  perf.now = 5600;
  expect(st.now()).toBeCloseTo(3.0);
});

test("clamp: never below startT before the sound is audible, never decreasing within one play()", () => {
  const { ctx, out, perf } = timestampedCtx();
  const st = createSoundtrack(tenSeconds(), ctx);
  out.contextTime = 99.8;             // what is audible still predates the start
  st.play(2);
  expect(st.now()).toBe(2);           // hold at startT, not 1.8
  out.contextTime = 101.0; out.performanceTime = 5000; perf.now = 5100;
  expect(st.now()).toBeCloseTo(3.1);  // extrapolated
  out.contextTime = 101.05; out.performanceTime = 5100; // next callback: raw reading 3.05 < 3.1
  expect(st.now()).toBeCloseTo(3.1);  // held, not stepped back
  perf.now = 5160;
  expect(st.now()).toBeCloseTo(3.11);
  ctx.currentTime = 101.2; out.contextTime = 101.2; out.performanceTime = perf.now;
  st.play(1);                         // a restart may go backwards: the clamp resets
  out.contextTime = 101.5;
  expect(st.now()).toBeCloseTo(1.3);
  st.pause();
  expect(st.now()).toBeNull();
});

test("still null past the end with the output-timestamp clock", () => {
  const { ctx, out } = timestampedCtx();
  const st = createSoundtrack(fakeBuffer(new Array(30).fill(0)), ctx); // 3 s
  st.play(2);
  out.contextTime = 101.0;
  expect(st.now()).toBeNull();        // 3.0 ≥ duration
});

test("fallback without getOutputTimestamp: currentTime minus outputLatency (or baseLatency), no extrapolation", () => {
  vi.spyOn(performance, "now").mockReturnValue(5000);
  const { ctx } = fakeCtx({ outputLatency: 0.15, baseLatency: 0.01 });
  const st = createSoundtrack(tenSeconds(), ctx);
  st.play(2);
  ctx.currentTime = 101.5;
  expect(st.now()).toBeCloseTo(3.35);
  vi.spyOn(performance, "now").mockReturnValue(5090);
  expect(st.now()).toBeCloseTo(3.35);

  const b = fakeCtx({ outputLatency: 0, baseLatency: 0.01 });
  const st2 = createSoundtrack(tenSeconds(), b.ctx);
  st2.play(0);
  b.ctx.currentTime = 101;
  expect(st2.now()).toBeCloseTo(0.99);
});

test("a rejected resume() (autoplay blocked) is swallowed, not an unhandled rejection", async () => {
  // A plain function, not vi.fn: vi.fn subscribes to returned promises (settledResults), which
  // would mark the rejection handled and hide the bug.
  let resumed = 0;
  const { ctx } = fakeCtx({ resume: () => { resumed++; return Promise.reject(new Error("blocked")); } });
  const st = createSoundtrack(tenSeconds(), ctx);
  const seen: unknown[] = [];
  const onUnhandled = (r: unknown) => { seen.push(r); };
  process.on("unhandledRejection", onUnhandled);
  try {
    st.play(0);
    await new Promise((r) => setTimeout(r, 10));
  } finally { process.off("unhandledRejection", onUnhandled); }
  expect(resumed).toBe(1);
  expect(seen).toEqual([]);
});
