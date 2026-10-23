/**
 * The single place a clip's playback time is applied to a <video> (spec §4).
 * "play": native playback, drift-corrected. "seek": exact, and registers a pending promise
 * (per element) that the renderer awaits via pendingVideoSeeks() before each screenshot.
 */
import { HOLD_EPSILON } from "@/engine/deck/clip-clock";

export type ClipMode = "play" | "seek";
export const DRIFT_SEC = 0.1;

const SEEK_EPS = 1e-4;

type Stage = "meta" | "seeking" | "presenting" | "loading";
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
  const s = el.currentSrc || el.src;
  if (!failed.includes(s)) failed.push(s);
}

function onNextFrame(el: HTMLVideoElement, cb: () => void): void {
  if (typeof el.requestVideoFrameCallback === "function") el.requestVideoFrameCallback(() => cb());
  else requestAnimationFrame(() => cb());
}

function seekExact(el: HTMLVideoElement, clipT: (duration: number) => number, existing?: SeekRec): void {
  if (existing) {
    // Re-seek while pending: one record per element, latest target wins.
    existing.clipT = clipT;
    if (existing.stage !== "meta") existing.apply();
    return;
  }
  if (el.error) {
    recordFailure(el);
    return;
  }
  const ready = el.readyState >= 1;
  if (ready) {
    const t = clipT(el.duration);
    if (Math.abs(el.currentTime - t) <= SEEK_EPS && !el.seeking) return; // already there: nothing to wait for
  }

  let settled = false;
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  const rec: SeekRec = {
    clipT,
    stage: "meta",
    gen: 0,
    promise,
    finish: () => {
      if (settled) return;
      settled = true;
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("loadeddata", onLoaded);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("error", onError);
      pending.delete(promise);
      if (records.get(el) === rec) records.delete(el);
      resolve();
    },
    /** Write the latest target if it differs. Returns true when a write happened. */
    apply: () => {
      const t = rec.clipT(el.duration);
      if (Math.abs(el.currentTime - t) > SEEK_EPS) {
        el.currentTime = t;
        rec.gen++;
        rec.stage = "seeking";
        return true;
      }
      return false;
    },
  };
  function onMeta() {
    if (rec.stage !== "meta") return;
    if (rec.apply()) return;
    if (el.seeking) rec.stage = "seeking";
    else if (el.readyState >= 2) rec.finish();
    else rec.stage = "loading"; // no seek needed, but wait for a decoded frame
  }
  function onLoaded() {
    if (rec.stage === "loading") rec.finish();
  }
  function onSeeked() {
    if (rec.stage !== "seeking" || el.seeking) return; // el.seeking: a newer seek is still in flight
    rec.stage = "presenting";
    const g = rec.gen;
    onNextFrame(el, () => {
      if (rec.gen === g && rec.stage === "presenting") rec.finish();
    });
  }
  function onError() {
    recordFailure(el);
    rec.finish();
  }
  el.addEventListener("loadedmetadata", onMeta);
  el.addEventListener("loadeddata", onLoaded);
  el.addEventListener("seeked", onSeeked);
  el.addEventListener("error", onError);
  records.set(el, rec);
  pending.add(promise);
  if (ready) {
    rec.stage = "seeking";
    rec.apply();
  }
}

export function syncVideo(el: HTMLVideoElement, clipT: (duration: number) => number, mode: ClipMode): void {
  if (mode === "seek") {
    el.pause();
    seekExact(el, clipT, records.get(el));
    return;
  }
  // play mode: never registers a pending promise
  if (el.readyState < 1) return; // metadata not here yet; the next paint retries
  const d = el.duration;
  const t = clipT(d);
  if (Number.isFinite(d) && t >= d - 2 * HOLD_EPSILON) {
    // clamped at the end: hold the last frame, don't loop
    if (Math.abs(el.currentTime - t) > SEEK_EPS) el.currentTime = t;
    if (!el.paused) el.pause();
  } else if (el.paused) {
    el.currentTime = t;
    el.play().catch(() => {});
  } else if (Math.abs(el.currentTime - t) > DRIFT_SEC) {
    el.currentTime = t;
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
