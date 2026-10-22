import { expect, test, vi } from "vitest";
import { computePeaks, createSoundtrack, PEAK_BUCKETS } from "@/lib/audio/soundtrack";

function fakeBuffer(samples: number[], sampleRate = 10): AudioBuffer {
  const data = Float32Array.from(samples);
  return { duration: samples.length / sampleRate, length: samples.length, numberOfChannels: 1, sampleRate,
    getChannelData: () => data } as unknown as AudioBuffer;
}
function fakeCtx() {
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: unknown }[] = [];
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const ctx = {
    currentTime: 100, destination: {}, resume: vi.fn(() => Promise.resolve()),
    createGain: () => gain,
    createBufferSource: () => {
      const s = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as unknown };
      sources.push(s); return s;
    },
  };
  return { ctx: ctx as unknown as AudioContext & { currentTime: number }, sources, gain };
}

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
