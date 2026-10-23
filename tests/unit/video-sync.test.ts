import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createClipVideo, DRIFT_SEC, pendingVideoSeeks, releaseVideo, syncVideo } from "@/engine/components/video-sync";
import { HOLD_EPSILON } from "@/engine/deck/clip-clock";

interface Fake {
  el: HTMLVideoElement;
  s: { currentTime: number; paused: boolean; readyState: number; duration: number };
  writes: number[];
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  fireFrame: () => void;
}

function fake(init: Partial<Fake["s"]> = {}, opts: { rvfc?: boolean } = {}): Fake {
  const el = document.createElement("video");
  el.src = "http://localhost/clip.mp4";
  const s = { currentTime: 0, paused: true, readyState: 1, duration: 5, ...init };
  const writes: number[] = [];
  const frames: Array<() => void> = [];
  const play = vi.fn(() => {
    s.paused = false;
    return Promise.resolve();
  });
  const pause = vi.fn(() => {
    s.paused = true;
  });
  Object.defineProperty(el, "currentTime", {
    configurable: true,
    get: () => s.currentTime,
    set: (v: number) => {
      writes.push(v);
      s.currentTime = v;
    },
  });
  for (const k of ["paused", "readyState", "duration"] as const) {
    Object.defineProperty(el, k, { configurable: true, get: () => s[k] });
  }
  Object.defineProperty(el, "play", { configurable: true, value: play });
  Object.defineProperty(el, "pause", { configurable: true, value: pause });
  if (opts.rvfc !== false) {
    Object.defineProperty(el, "requestVideoFrameCallback", {
      configurable: true,
      value: (cb: () => void) => frames.push(cb),
    });
  }
  return { el, s, writes, play, pause, fireFrame: () => frames.splice(0).forEach((f) => f()) };
}

async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => (done = true));
  await new Promise((r) => setTimeout(r, 0));
  return done;
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await pendingVideoSeeks();
});

describe("seek mode", () => {
  test("metadata ready: sets currentTime, pauses, resolves after seeked + rVFC", async () => {
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    expect(f.s.currentTime).toBe(2);
    expect(f.pause).toHaveBeenCalled();
    const p = pendingVideoSeeks();
    expect(await settled(p)).toBe(false);
    f.el.dispatchEvent(new Event("seeked"));
    expect(await settled(p)).toBe(false);
    f.fireFrame();
    expect(await p).toEqual([]);
  });

  test("already within 1e-4: no write, resolves immediately", async () => {
    const f = fake({ currentTime: 2 });
    syncVideo(f.el, () => 2.00005, "seek");
    expect(f.writes).toEqual([]);
    expect(await pendingVideoSeeks()).toEqual([]);
  });

  test("metadata not ready: waits for loadedmetadata, then seeks with the known duration", async () => {
    const f = fake({ readyState: 0, duration: NaN });
    const clipT = vi.fn((d: number) => (d === 5 ? 2 : -1));
    syncVideo(f.el, clipT, "seek");
    expect(f.writes).toEqual([]);
    expect(clipT).not.toHaveBeenCalled();
    const p = pendingVideoSeeks();
    f.s.readyState = 1;
    f.s.duration = 5;
    f.el.dispatchEvent(new Event("loadedmetadata"));
    expect(clipT).toHaveBeenCalledWith(5);
    expect(f.writes).toEqual([2]);
    expect(await settled(p)).toBe(false);
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await p).toEqual([]);
  });

  test("metadata arrives and no seek is needed: waits for loadeddata", async () => {
    const f = fake({ readyState: 0, duration: NaN });
    syncVideo(f.el, () => 0, "seek");
    const p = pendingVideoSeeks();
    f.s.readyState = 1;
    f.s.duration = 5;
    f.el.dispatchEvent(new Event("loadedmetadata"));
    expect(f.writes).toEqual([]);
    expect(await settled(p)).toBe(false);
    f.s.readyState = 2;
    f.el.dispatchEvent(new Event("loadeddata"));
    expect(await p).toEqual([]);
  });

  test("error resolves the pending promise and reports the src once", async () => {
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    f.el.dispatchEvent(new Event("error"));
    expect(await p).toEqual([f.el.src]);
    expect(await pendingVideoSeeks()).toEqual([]);
  });

  test("error before metadata resolves and reports", async () => {
    const f = fake({ readyState: 0, duration: NaN });
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    f.el.dispatchEvent(new Event("error"));
    expect(await p).toEqual([f.el.src]);
  });

  test("re-seek while pending: one record, resolves only on the seeked after the latest target", async () => {
    const f = fake();
    syncVideo(f.el, () => 1, "seek");
    syncVideo(f.el, () => 2, "seek");
    expect(f.writes).toEqual([1, 2]);
    const p = pendingVideoSeeks();
    f.el.dispatchEvent(new Event("seeked"));
    expect(await settled(p)).toBe(false); // frame not yet presented
    f.fireFrame();
    expect(await p).toEqual([]);
    expect(f.s.currentTime).toBe(2);
  });

  test("re-seek after seeked but before the frame: the stale frame does not resolve", async () => {
    const f = fake();
    syncVideo(f.el, () => 1, "seek");
    const p = pendingVideoSeeks();
    f.el.dispatchEvent(new Event("seeked"));
    syncVideo(f.el, () => 3, "seek");
    f.fireFrame(); // frame for target 1
    expect(await settled(p)).toBe(false);
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    await p;
    expect(f.s.currentTime).toBe(3);
  });

  test("falls back to requestAnimationFrame without rVFC", async () => {
    const f = fake({}, { rvfc: false });
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      setTimeout(() => cb(0), 0);
      return 1;
    });
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    f.el.dispatchEvent(new Event("seeked"));
    expect(await p).toEqual([]);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  test("releaseVideo resolves a pending seek on a removed element", async () => {
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    releaseVideo(f.el);
    expect(await p).toEqual([]);
  });
});

describe("play mode", () => {
  test("paused: sets currentTime and plays", () => {
    const f = fake();
    syncVideo(f.el, () => 1.5, "play");
    expect(f.s.currentTime).toBe(1.5);
    expect(f.play).toHaveBeenCalled();
  });

  test("playing with drift 0.05: no seek", () => {
    const f = fake({ paused: false, currentTime: 1 });
    syncVideo(f.el, () => 1.05, "play");
    expect(f.writes).toEqual([]);
  });

  test("playing with drift 0.2: re-seeks", () => {
    expect(DRIFT_SEC).toBe(0.1);
    const f = fake({ paused: false, currentTime: 1 });
    syncVideo(f.el, () => 1.2, "play");
    expect(f.writes).toEqual([1.2]);
  });

  test("held at end: pauses, does not loop", () => {
    const f = fake({ paused: false, currentTime: 4.9 });
    syncVideo(f.el, (d) => d - HOLD_EPSILON, "play");
    expect(f.pause).toHaveBeenCalled();
    expect(f.play).not.toHaveBeenCalled();
    expect(f.s.currentTime).toBeCloseTo(5 - HOLD_EPSILON, 6);
  });

  test("readyState 0: does nothing", () => {
    const f = fake({ readyState: 0 });
    const clipT = vi.fn(() => 1);
    syncVideo(f.el, clipT, "play");
    expect(clipT).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });

  test("never registers a pending promise", async () => {
    const f = fake();
    syncVideo(f.el, () => 1.5, "play");
    const g = fake({ readyState: 0 });
    syncVideo(g.el, () => 1.5, "play");
    expect(await settled(pendingVideoSeeks())).toBe(true);
  });
});

describe("element lifecycle", () => {
  test("createClipVideo flags", () => {
    const el = createClipVideo("/x.mp4");
    expect(el.muted).toBe(true);
    expect(el.playsInline).toBe(true);
    expect(el.preload).toBe("auto");
    expect(el.autoplay).toBe(false);
  });

  test("releaseVideo pauses and clears src", () => {
    const el = createClipVideo("/x.mp4");
    const pause = vi.spyOn(el, "pause");
    releaseVideo(el);
    expect(pause).toHaveBeenCalled();
    expect(el.hasAttribute("src")).toBe(false);
  });
});
