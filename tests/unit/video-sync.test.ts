import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createClipVideo,
  DRIFT_SEC,
  PENDING_WATCHDOG_MS,
  pendingVideoSeeks,
  PRESENT_FALLBACK_MS,
  releaseVideo,
  syncVideo,
} from "@/engine/components/video-sync";
import { HOLD_EPSILON } from "@/engine/deck/clip-clock";

interface Fake {
  el: HTMLVideoElement;
  s: {
    currentTime: number;
    paused: boolean;
    readyState: number;
    duration: number;
    seeking: boolean;
    ended: boolean;
    error: unknown;
  };
  writes: number[];
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  fireFrame: (meta?: Partial<VideoFrameCallbackMetadata>) => void;
}

const made: HTMLVideoElement[] = [];

function fake(init: Partial<Fake["s"]> = {}, opts: { rvfc?: boolean } = {}): Fake {
  const el = document.createElement("video");
  el.src = "http://localhost/clip.mp4";
  const s = { currentTime: 0, paused: true, readyState: 2, duration: 5, seeking: false, ended: false, error: null as unknown, ...init };
  made.push(el);
  const writes: number[] = [];
  const frames: Array<(now: number, meta?: Partial<VideoFrameCallbackMetadata>) => void> = [];
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
  for (const k of ["paused", "readyState", "duration", "seeking", "ended", "error"] as const) {
    Object.defineProperty(el, k, { configurable: true, get: () => s[k] });
  }
  Object.defineProperty(el, "play", { configurable: true, value: play });
  Object.defineProperty(el, "pause", { configurable: true, value: pause });
  if (opts.rvfc !== false) {
    Object.defineProperty(el, "requestVideoFrameCallback", {
      configurable: true,
      value: (cb: (now: number, meta?: Partial<VideoFrameCallbackMetadata>) => void) => frames.push(cb),
    });
  }
  return { el, s, writes, play, pause, fireFrame: (meta) => frames.splice(0).forEach((f) => f(0, meta)) };
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
  for (const el of made.splice(0)) releaseVideo(el); // one leaked record must not hang later hooks
  vi.useRealTimers();
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

  test("already within 1e-4 with a decoded frame: no write, resolves immediately", async () => {
    const f = fake({ currentTime: 2, readyState: 2 });
    syncVideo(f.el, () => 2.00005, "seek");
    expect(f.writes).toEqual([]);
    expect(await pendingVideoSeeks()).toEqual([]);
  });

  test("metadata not ready: waits for loadedmetadata, then the first frame, then seeks with the known duration", async () => {
    const f = fake({ readyState: 0, duration: NaN });
    const clipT = vi.fn((d: number) => (d === 5 ? 2 : -1));
    syncVideo(f.el, clipT, "seek");
    expect(f.writes).toEqual([]);
    expect(clipT).not.toHaveBeenCalled();
    const p = pendingVideoSeeks();
    f.s.readyState = 1;
    f.s.duration = 5;
    f.el.dispatchEvent(new Event("loadedmetadata"));
    expect(f.writes).toEqual([]); // fresh: no seek may race the preroll frame
    f.s.readyState = 2;
    f.el.dispatchEvent(new Event("loadeddata"));
    expect(f.writes).toEqual([]);
    f.fireFrame(); // the preroll frame presented
    expect(clipT).toHaveBeenCalledWith(5);
    expect(f.writes).toEqual([2]);
    expect(await settled(p)).toBe(false);
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await p).toEqual([]);
  });

  test("fresh element (metadata only, readyState 1): the seek waits for loadeddata + the preroll frame", async () => {
    const f = fake({ readyState: 1 });
    syncVideo(f.el, () => 2, "seek");
    expect(f.writes).toEqual([]);
    const p = pendingVideoSeeks();
    f.s.readyState = 2;
    f.el.dispatchEvent(new Event("loadeddata"));
    expect(f.writes).toEqual([]);
    f.fireFrame();
    expect(f.writes).toEqual([2]);
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await p).toEqual([]);
  });

  test("fresh element: a re-target before the first frame lands is applied once, with the latest target", async () => {
    const f = fake({ readyState: 1 });
    syncVideo(f.el, () => 2, "seek");
    syncVideo(f.el, () => 3, "seek");
    expect(f.writes).toEqual([]);
    const p = pendingVideoSeeks();
    f.s.readyState = 2;
    f.el.dispatchEvent(new Event("loadeddata"));
    syncVideo(f.el, () => 4, "seek"); // during preroll
    expect(f.writes).toEqual([]);
    f.fireFrame();
    expect(f.writes).toEqual([4]);
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await p).toEqual([]);
  });

  test("fresh element whose preroll frame never reports (no rVFC): seeks after the presentation fallback", async () => {
    vi.useFakeTimers();
    const f = fake({ readyState: 1 });
    syncVideo(f.el, () => 2, "seek");
    f.s.readyState = 2;
    f.el.dispatchEvent(new Event("loadeddata"));
    vi.advanceTimersByTime(PRESENT_FALLBACK_MS - 1);
    expect(f.writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(f.writes).toEqual([2]);
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    vi.useRealTimers();
    expect(await pendingVideoSeeks()).toEqual([]);
  });

  test("releaseVideo during preroll: the orphaned frame callback neither seeks nor arms a timer", async () => {
    vi.useFakeTimers();
    const f = fake({ readyState: 1 });
    syncVideo(f.el, () => 2, "seek");
    f.s.readyState = 2;
    f.el.dispatchEvent(new Event("loadeddata")); // preroll: an rVFC is registered
    releaseVideo(f.el);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    f.fireFrame(); // the orphaned preroll callback
    expect(f.writes).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an element that has loaded data is not fresh again when readyState later drops to 1: seeks at once", async () => {
    const f = fake({ readyState: 2 });
    syncVideo(f.el, () => 2, "seek");
    const p1 = pendingVideoSeeks();
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await p1).toEqual([]);
    f.s.readyState = 1; // e.g. mid-pipeline after a far seek; no loadeddata will come
    syncVideo(f.el, () => 3, "seek");
    expect(f.writes).toEqual([2, 3]);
    const p2 = pendingVideoSeeks();
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await p2).toEqual([]);
  });

  test("a fresh element that fired loadeddata is remembered as loaded for later seeks", async () => {
    const f = fake({ readyState: 1 });
    syncVideo(f.el, () => 0, "seek"); // target = first frame: resolves on loadeddata
    f.s.readyState = 2;
    f.el.dispatchEvent(new Event("loadeddata"));
    expect(await pendingVideoSeeks()).toEqual([]);
    f.s.readyState = 1;
    syncVideo(f.el, () => 1, "seek");
    expect(f.writes).toEqual([1]);
  });

  test("already at target but only metadata (readyState 1): waits for loadeddata", async () => {
    const f = fake({ currentTime: 2, readyState: 1 });
    syncVideo(f.el, () => 2, "seek");
    expect(f.writes).toEqual([]);
    const p = pendingVideoSeeks();
    expect(await settled(p)).toBe(false);
    f.s.readyState = 2;
    f.el.dispatchEvent(new Event("loadeddata"));
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

  test("frame callback before seeked does not resolve", async () => {
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    f.fireFrame();
    expect(await settled(p)).toBe(false);
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await p).toEqual([]);
  });

  test("seeked while el.seeking (newer seek in flight) is ignored", async () => {
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    f.s.seeking = true;
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await settled(p)).toBe(false);
    f.s.seeking = false;
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await p).toEqual([]);
  });

  test("at target but el.seeking: waits for seeked instead of resolving", async () => {
    const f = fake({ currentTime: 2, readyState: 2, seeking: true });
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    expect(await settled(p)).toBe(false);
    f.s.seeking = false;
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    expect(await p).toEqual([]);
  });

  test("element already in error: reports the src, registers nothing", async () => {
    const f = fake({ readyState: 0, error: { code: 4 } });
    syncVideo(f.el, () => 2, "seek");
    expect(await pendingVideoSeeks()).toEqual([f.el.src]);
    expect(f.writes).toEqual([]);
  });

  test("same src failing on two elements is reported once per drain", async () => {
    const a = fake();
    const b = fake();
    syncVideo(a.el, () => 2, "seek");
    syncVideo(b.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    a.el.dispatchEvent(new Event("error"));
    b.el.dispatchEvent(new Event("error"));
    expect(await p).toEqual([a.el.src]);
  });

  test("emptied mid-seek finishes the record as a failure", async () => {
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    f.el.dispatchEvent(new Event("emptied"));
    expect(await p).toEqual([f.el.src]);
  });

  test("a synchronously dispatched seeked during the write is not dropped", async () => {
    const f = fake();
    // dispatch seeked from inside the currentTime setter
    const desc = Object.getOwnPropertyDescriptor(f.el, "currentTime")!;
    Object.defineProperty(f.el, "currentTime", {
      configurable: true,
      get: desc.get,
      set: (v: number) => {
        desc.set!.call(f.el, v);
        f.el.dispatchEvent(new Event("seeked"));
      },
    });
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    f.fireFrame(); // after syncVideo's seeked listener ran: resolves without any timer
    expect(await settled(p)).toBe(true);
    expect(await p).toEqual([]);
  });

  test("releaseVideo resolves a pending seek on a removed element", async () => {
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    const p = pendingVideoSeeks();
    releaseVideo(f.el);
    expect(await p).toEqual([]);
  });
});

describe("bounded waits (fake timers)", () => {
  test("rVFC never fires: resolves after the fallback, no failure", async () => {
    vi.useFakeTimers();
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    f.el.dispatchEvent(new Event("seeked"));
    let out: string[] | undefined;
    void pendingVideoSeeks().then((r) => (out = r));
    await vi.advanceTimersByTimeAsync(PRESENT_FALLBACK_MS - 1);
    expect(out).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(out).toEqual([]);
  });

  test("seeked never fires: the watchdog resolves it and reports the src", async () => {
    vi.useFakeTimers();
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    let out: string[] | undefined;
    void pendingVideoSeeks().then((r) => (out = r));
    await vi.advanceTimersByTimeAsync(PENDING_WATCHDOG_MS - 1);
    expect(out).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(out).toEqual([f.el.src]);
  });

  test("a stalled metadata load is also bounded by the watchdog", async () => {
    vi.useFakeTimers();
    const f = fake({ readyState: 0, duration: NaN });
    syncVideo(f.el, () => 2, "seek");
    let out: string[] | undefined;
    void pendingVideoSeeks().then((r) => (out = r));
    await vi.advanceTimersByTimeAsync(PENDING_WATCHDOG_MS + 1);
    expect(out).toEqual([f.el.src]);
  });

  test("no timers remain after finish", async () => {
    vi.useFakeTimers();
    const f = fake();
    syncVideo(f.el, () => 2, "seek");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    f.el.dispatchEvent(new Event("seeked"));
    f.fireFrame();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("no timers remain after releaseVideo or an error", async () => {
    vi.useFakeTimers();
    const a = fake();
    const b = fake();
    syncVideo(a.el, () => 2, "seek");
    syncVideo(b.el, () => 2, "seek");
    releaseVideo(a.el);
    b.el.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("rAF fallback path leaves no timers after finish", async () => {
    vi.useFakeTimers();
    const f = fake({}, { rvfc: false });
    syncVideo(f.el, () => 2, "seek");
    f.el.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(40); // a rAF tick
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
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

  test("a seek in flight: leaves the element alone (no seek storm)", () => {
    const paused = fake({ seeking: true });
    syncVideo(paused.el, () => 3, "play");
    expect(paused.writes).toEqual([]);
    expect(paused.play).not.toHaveBeenCalled();
    const playing = fake({ seeking: true, paused: false, currentTime: 1 });
    syncVideo(playing.el, () => 3, "play");
    expect(playing.writes).toEqual([]);
  });

  test("loop clip near its end keeps playing", () => {
    const f = fake({ paused: false, currentTime: 4.9995 });
    syncVideo(f.el, () => 5 - HOLD_EPSILON / 2, "play", { loop: true });
    expect(f.pause).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });

  test("loop clip wrap shows up as drift and re-seeks", () => {
    const f = fake({ paused: false, currentTime: 4.9 });
    syncVideo(f.el, () => 0.1, "play", { loop: true });
    expect(f.writes).toEqual([0.1]);
  });

  test("non-loop clip that ended while the deck is near the end is held, not replayed", () => {
    const f = fake({ paused: false, ended: true, currentTime: 5 });
    syncVideo(f.el, () => 4.95, "play");
    expect(f.pause).toHaveBeenCalled();
    expect(f.play).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
    const g = fake({ paused: true, ended: true, currentTime: 5 });
    syncVideo(g.el, () => 4.95, "play");
    expect(g.play).not.toHaveBeenCalled();
    expect(g.writes).toEqual([]);
  });

  test("non-loop clip that ended but the deck rewound: re-seeks and plays", () => {
    const f = fake({ paused: true, ended: true, currentTime: 5 });
    syncVideo(f.el, () => 1, "play");
    expect(f.writes).toEqual([1]);
    expect(f.play).toHaveBeenCalled();
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

// Final review I2: on long-GOP footage a play-mode seek takes long enough that the deck has moved
// on by the time it lands, so drift correction re-seeked forever. The write is skipped when a paused
// element is already close, and later seeks lead the deck clock by the measured seek latency.
describe("play mode — seek latency convergence", () => {
  test("paused and within DRIFT_SEC: no currentTime write, just play()", () => {
    const f = fake({ paused: true, currentTime: 2 });
    syncVideo(f.el, () => 2 + DRIFT_SEC / 2, "play");
    expect(f.writes).toEqual([]);
    expect(f.play).toHaveBeenCalled();
  });

  /** Drive syncVideo once per 1/60 s frame against a deck clock that starts at `start`; every
   *  currentTime write takes `latency` s of wall time to land (`seeking` until then, then `seeked`).
   *  While not seeking, a playing element advances in real time. */
  function simulate(latency: number | ((n: number) => number), seconds: number, start = 2) {
    let now = 1000; // ms
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = fake({ paused: true, currentTime: 0, duration: 10 });
    let deck = start;
    let seekDoneAt: number | null = null;
    let seen = 0;
    const dt = 1 / 60;
    for (let i = 0; i < seconds * 60; i++) {
      syncVideo(f.el, () => deck, "play");
      if (f.writes.length > seen) {
        const L = typeof latency === "number" ? latency : latency(seen);
        seen = f.writes.length;
        f.s.seeking = true;
        seekDoneAt = now + L * 1000;
      }
      now += dt * 1000;
      deck += dt;
      if (seekDoneAt !== null && now >= seekDoneAt) {
        f.s.seeking = false;
        seekDoneAt = null;
        f.el.dispatchEvent(new Event("seeked"));
      } else if (!f.s.seeking && !f.s.paused) {
        f.s.currentTime += dt;
      }
    }
    return { f, drift: deck - f.s.currentTime };
  }

  test("a 0.35 s seek latency converges after the second seek instead of re-seeking forever", () => {
    const { f, drift } = simulate(0.35, 3);
    expect(f.writes.length).toBeLessThanOrEqual(2);
    expect(Math.abs(drift)).toBeLessThanOrEqual(DRIFT_SEC);
  });

  test("the lead is bounded at 0.5 s however slow a seek was", () => {
    const { f } = simulate((n) => (n === 0 ? 5 : 0.05), 6.5);
    // first seek lands at 2, ~5 s behind; the next one leads by at most 0.5 s (not 5 s)
    expect(f.writes[1] - (2 + 5)).toBeLessThanOrEqual(0.5 + 0.05);
    expect(f.writes[1] - (2 + 5)).toBeGreaterThan(0.4);
  });

  test("the lead never pushes a non-looping clip past its last frame", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = fake({ paused: false, currentTime: 1, duration: 5 });
    syncVideo(f.el, () => 2, "play"); // first seek: no latency known yet
    expect(f.writes).toEqual([2]);
    now += 400;
    f.el.dispatchEvent(new Event("seeked"));
    syncVideo(f.el, () => 4.8, "play"); // 4.8 + 0.4 would pass the 5 s end
    expect(f.writes[1]).toBeLessThanOrEqual(5 - HOLD_EPSILON);
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
