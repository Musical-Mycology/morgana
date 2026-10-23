/**
 * The single place a clip's playback time is applied to a <video> (spec §4).
 * "play": native playback, drift-corrected. "seek": exact, and registers a pending promise
 * (per element) that the renderer awaits via pendingVideoSeeks() before each screenshot.
 */
import { HOLD_EPSILON } from "@/engine/deck/clip-clock";

export type ClipMode = "play" | "seek";
export const DRIFT_SEC = 0.1;

const SEEK_EPS = 1e-4;
/** Fallback if requestVideoFrameCallback never fires (opacity 0, off-viewport, occluded, hidden tab). */
export const PRESENT_FALLBACK_MS = 250;
/** A pending record that has not settled by now is reported failed so the render continues. */
export const PENDING_WATCHDOG_MS = 10_000;
/** Floor opacity for a deck-time video layer/tile. At opacity 0 Chromium stops drawing the video's
 *  surface, and a frame seeked while it was undrawn can reach the screen stale (seen as the previous
 *  frame in the first visible render frame). 1/1024 keeps it drawn yet rounds to 0 at 8 bits. */
export const MIN_VIDEO_OPACITY = 1 / 1024;

type Stage = "meta" | "loading" | "preroll" | "seeking" | "presenting";
interface SeekRec {
  clipT: (duration: number) => number;
  stage: Stage;
  /** Bumped on every currentTime write; a frame callback only counts if its gen is still current. */
  gen: number;
  promise: Promise<void>;
  finish: () => void;
  apply: () => boolean;
}

const pending = new Set<Promise<void>>();
const records = new WeakMap<HTMLVideoElement, SeekRec>();
/** The src each element has decoded a frame of (loadeddata seen, or readyState >= 2 observed).
 *  readyState can later dip back to 1 (mid-pipeline), so it alone cannot tell a fresh element. */
const loadedSrc = new WeakMap<HTMLVideoElement, string>();
const srcOf = (el: HTMLVideoElement) => el.currentSrc || el.src;
function hasLoaded(el: HTMLVideoElement): boolean {
  if (el.readyState >= 2) loadedSrc.set(el, srcOf(el));
  return loadedSrc.get(el) === srcOf(el);
}
const failed: string[] = [];

export function createClipVideo(src: string): HTMLVideoElement {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  el.autoplay = false;
  el.src = src;
  return el;
}

function recordFailure(el: HTMLVideoElement): void {
  const s = srcOf(el);
  if (!failed.includes(s)) failed.push(s);
}

function seekExact(el: HTMLVideoElement, clipT: (duration: number) => number, existing?: SeekRec): void {
  if (existing) {
    // Re-seek while pending: one record per element, latest target wins.
    existing.clipT = clipT;
    // Before the first frame has landed (meta/loading/preroll) the latest target is applied later.
    if (existing.stage === "seeking" || existing.stage === "presenting") existing.apply();
    return;
  }
  if (el.error) {
    recordFailure(el);
    return;
  }
  const ready = el.readyState >= 1;
  hasLoaded(el); // remember a decoded frame seen now, for later syncs
  if (ready) {
    const t = clipT(el.duration);
    // already there AND a frame is decoded: nothing to wait for
    if (Math.abs(el.currentTime - t) <= SEEK_EPS && !el.seeking && el.readyState >= 2) return;
  }

  let settled = false;
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let presentTimer: ReturnType<typeof setTimeout> | undefined;
  let rafId: number | undefined;

  const clearPresent = () => {
    if (presentTimer !== undefined) clearTimeout(presentTimer);
    if (rafId !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
    presentTimer = rafId = undefined;
  };
  const armWatchdog = () => {
    if (watchdog !== undefined) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      recordFailure(el);
      rec.finish();
    }, PENDING_WATCHDOG_MS);
  };
  const rec: SeekRec = {
    clipT,
    stage: "meta",
    gen: 0,
    promise,
    finish: () => {
      if (settled) return;
      settled = true;
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = undefined;
      clearPresent();
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("loadeddata", onLoaded);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("error", onError);
      el.removeEventListener("emptied", onError);
      pending.delete(promise);
      if (records.get(el) === rec) records.delete(el);
      resolve();
    },
    /** Write the latest target if it differs. Returns true when a write happened. */
    apply: () => {
      if (settled) return false; // a finished record never seeks or arms a watchdog again
      const t = rec.clipT(el.duration);
      if (Math.abs(el.currentTime - t) <= SEEK_EPS) return false;
      // state first: the write may dispatch `seeked` synchronously
      rec.gen++;
      rec.stage = "seeking";
      clearPresent();
      armWatchdog();
      el.currentTime = t;
      return true;
    },
  };
  function onMeta() {
    if (rec.stage !== "meta") return;
    // A fresh element (no decoded frame yet) is not seeked until its first frame has been decoded
    // and presented: a seek issued now races that preroll frame, and Chromium can then leave the
    // preroll frame on screen even though rVFC reports the seeked one (a one-frame stale render).
    if (!hasLoaded(el) && !el.seeking) { rec.stage = "loading"; return; }
    if (rec.apply()) return;
    if (el.seeking) rec.stage = "seeking";
    else rec.finish();
  }
  function onLoaded() {
    loadedSrc.set(el, srcOf(el));
    if (rec.stage !== "loading") return;
    if (Math.abs(el.currentTime - rec.clipT(el.duration)) <= SEEK_EPS) { rec.finish(); return; } // the first frame is the target
    rec.stage = "preroll";
    const g = rec.gen;
    const landed = () => {
      if (settled || rec.gen !== g || rec.stage !== "preroll") return;
      clearPresent();
      if (!rec.apply()) rec.finish();
    };
    presentTimer = setTimeout(landed, PRESENT_FALLBACK_MS);
    if (typeof el.requestVideoFrameCallback === "function") el.requestVideoFrameCallback(landed);
    else rafId = requestAnimationFrame(landed);
  }
  function onSeeked() {
    if (rec.stage !== "seeking" || el.seeking) return; // el.seeking: a newer seek is still in flight
    rec.stage = "presenting";
    const g = rec.gen;
    const done = () => {
      if (rec.gen === g && rec.stage === "presenting") rec.finish();
    };
    // A video that is never presented (opacity 0, off-viewport, occluded) never fires rVFC: race a timer.
    presentTimer = setTimeout(done, PRESENT_FALLBACK_MS);
    if (typeof el.requestVideoFrameCallback === "function") el.requestVideoFrameCallback(done);
    else rafId = requestAnimationFrame(done);
  }
  function onError() {
    recordFailure(el); // error, or emptied (src reassigned mid-seek)
    rec.finish();
  }
  el.addEventListener("loadedmetadata", onMeta);
  el.addEventListener("loadeddata", onLoaded);
  el.addEventListener("seeked", onSeeked);
  el.addEventListener("error", onError);
  el.addEventListener("emptied", onError);
  records.set(el, rec);
  pending.add(promise);
  armWatchdog();
  if (ready) onMeta();
}

export function syncVideo(
  el: HTMLVideoElement,
  clipT: (duration: number) => number,
  mode: ClipMode,
  opts?: { loop?: boolean },
): void {
  if (mode === "seek") {
    el.pause();
    seekExact(el, clipT, records.get(el));
    return;
  }
  // play mode: never registers a pending promise
  if (el.readyState < 1) return; // metadata not here yet; the next paint retries
  // A seek is in flight: currentTime reports its target, so re-targeting would abort it every paint.
  if (el.seeking) return;
  const d = el.duration;
  const t = clipT(d);
  // A non-looping clip that reached its end stays on its last frame while the deck is also at the end.
  // `ended` only clears on a seek, so if the deck moved back (scrub / restart) fall through and re-seek.
  if (!opts?.loop && el.ended && t >= d - DRIFT_SEC) {
    if (!el.paused) el.pause();
    return;
  }
  if (!opts?.loop && Number.isFinite(d) && t >= d - 2 * HOLD_EPSILON) {
    // clamped at the end: hold the last frame, don't loop
    if (Math.abs(el.currentTime - t) > SEEK_EPS) el.currentTime = t;
    if (!el.paused) el.pause();
  } else if (el.paused) {
    el.currentTime = t;
    el.play().catch(() => {});
  } else if (Math.abs(el.currentTime - t) > DRIFT_SEC) {
    el.currentTime = t; // for a looping clip the wrap shows up here as drift
  }
}

/** Resolves when every issued seek has presented; returns srcs that errored since the last call. */
export async function pendingVideoSeeks(): Promise<string[]> {
  while (pending.size) await Promise.all([...pending]);
  return failed.splice(0);
}

export function releaseVideo(el: HTMLVideoElement): void {
  records.get(el)?.finish();
  el.pause();
  el.removeAttribute("src");
  el.load();
}
