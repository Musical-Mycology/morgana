import type { Action, Scene, SceneObject, SlideTreatment } from "@/engine/deck/types";
import { AT_MS_KINDS, actionDuration } from "@/engine/authoring/beat-clock";
import { MEDIA_ID_PATTERN } from "@/engine/deck/media-ref";
import { isHexColor } from "@/engine/deck/story-assets";

/** Optional host-app chrome, defaulted to none so decks render generic. */
export interface DeckChrome {
  /** Splash on the scene whose id is "intro". */
  splash?: { logo?: string; tagline?: string };
  /** CTAs on the beat whose id is "fin". */
  ending?: { ctas?: { label: string; href: string }[] };
  /** Footer wordmark text. */
  wordmark?: string;
}

/** Same pattern as lib/store/media-store.ts MEDIA_ID_RE; defined in the pure media-ref module (the
 *  format must not import fs code). */
export { MEDIA_ID_PATTERN };

/** A deck-time cue point shown on the ruler and Player scrubber. */
export interface DeckMarker { id: string; label: string; t: number }

export interface DeckMeta {
  id: string;
  title: string;
  treatment?: SlideTreatment;
  noindex?: boolean;
  chrome?: DeckChrome;
  /** Present = a timed deck (video). `targetSec` is the intended total length, e.g. 120. */
  timing?: { targetSec: number };
  /** The pre-mixed soundtrack: a media id in this deck's media store, played from deck T = 0. */
  soundtrack?: { media: string };
  /** Deck-time cue points (e.g. "drop" @ 40.2). */
  markers?: DeckMarker[];
}

export interface DeckDoc {
  version: 1;
  meta: DeckMeta;
  scenes: Scene[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const isPositiveFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export const MAX_OBJECT_DEPTH = 8;
const OBJECT_KINDS = new Set(["text", "image", "shape", "group"]);

/** Structural validation of a scene's object tree. Scene-scoped id uniqueness via `seen`. */
function validateSceneObjects(objects: unknown, label: string, seen: Set<string>, depth: number, e: string[]): void {
  if (objects === undefined) return;
  if (!Array.isArray(objects)) { e.push(`${label}.objects must be an array`); return; }
  if (depth > MAX_OBJECT_DEPTH) { e.push(`${label} nested deeper than ${MAX_OBJECT_DEPTH}`); return; }
  objects.forEach((o: Record<string, unknown>, i) => {
    const at = `${label}.objects[${i}]`;
    if (!o || typeof o !== "object") { e.push(`${at} must be an object`); return; }
    if (typeof o.id !== "string" || !ID_RE.test(o.id)) e.push(`${at}.id must match ${String(ID_RE)}`);
    else if (seen.has(o.id)) e.push(`${at}.id "${o.id}" duplicated in scene`);
    else seen.add(o.id);
    if (typeof o.kind !== "string" || !OBJECT_KINDS.has(o.kind)) e.push(`${at}.kind invalid`);
    const t = o.transform as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object") e.push(`${at}.transform missing`);
    else {
      for (const k of ["x", "y", "w", "h"] as const) {
        if (typeof t[k] !== "number" || !Number.isFinite(t[k])) e.push(`${at}.transform.${k} must be a finite number`);
      }
      if (typeof t.w === "number" && t.w <= 0) e.push(`${at}.transform.w must be > 0`);
      if (typeof t.h === "number" && t.h <= 0) e.push(`${at}.transform.h must be > 0`);
    }
    if (o.opacity !== undefined && (typeof o.opacity !== "number" || o.opacity < 0 || o.opacity > 1)) e.push(`${at}.opacity must be 0–1`);
    if (o.kind === "group") validateSceneObjects(o.children, at, seen, depth + 1, e);
  });
}

const OBJ_TARGET_KINDS = new Set(["obj_reveal", "obj_move", "obj_out"]);

/** All object ids in a scene, including nested group children. */
function sceneObjectIds(objects: SceneObject[] | undefined): Set<string> {
  const ids = new Set<string>();
  const walk = (list: SceneObject[]) => list.forEach((o) => { ids.add(o.id); if (o.kind === "group") walk(o.children); });
  if (objects) walk(objects);
  return ids;
}

/** Validate obj_* action targets against the scene's object-id set, plus obj_move.to ranges. */
function validateSceneActionTargets(scene: Scene, si: number, e: string[]): void {
  const ids = sceneObjectIds(scene?.objects);
  scene?.beats?.forEach((b, bi) => {
    b?.timeline?.forEach((a: Record<string, unknown>, ai) => {
      if (typeof a?.kind !== "string" || !OBJ_TARGET_KINDS.has(a.kind)) return;
      const at = `scenes[${si}].beats[${bi}].timeline[${ai}]`;
      if (typeof a.target !== "string" || !a.target || !ids.has(a.target)) {
        e.push(`${at}: ${a.kind} target ${JSON.stringify(a.target)} is not an object in this scene`);
      }
      if (a.durationMs !== undefined && (typeof a.durationMs !== "number" || !Number.isFinite(a.durationMs) || a.durationMs < 0)) {
        e.push(`${at}.durationMs must be a finite number ≥ 0`);
      }
      if (a.kind === "obj_move") {
        const to = a.to as Record<string, unknown> | undefined;
        if (to && typeof to === "object") {
          for (const k of ["x", "y", "w", "h"] as const) {
            if (to[k] !== undefined && (typeof to[k] !== "number" || !Number.isFinite(to[k]) || (to[k] as number) < 0 || (to[k] as number) > 1)) e.push(`${at}.to.${k} must be 0–1`);
          }
          if (to.w !== undefined && (to.w as number) <= 0) e.push(`${at}.to.w must be > 0`);
          if (to.h !== undefined && (to.h as number) <= 0) e.push(`${at}.to.h must be > 0`);
          if (to.rot !== undefined && (typeof to.rot !== "number" || !Number.isFinite(to.rot))) e.push(`${at}.to.rot must be a finite number`);
        }
      }
    });
  });
}

const CAMERA_EASES = ["inOut", "in", "out", "linear"];

/** Validate camera actions: `to` has ≥1 of x/y/zoom in range, durationMs ≥ 0, ease one of the four. */
function validateCameraActions(scene: Scene, si: number, e: string[]): void {
  scene?.beats?.forEach((b, bi) => {
    b?.timeline?.forEach((a: Record<string, unknown>, ai) => {
      if (a?.kind !== "camera") return;
      const at = `scenes[${si}].beats[${bi}].timeline[${ai}]`;
      const to = a.to as Record<string, unknown> | undefined;
      if (!to || typeof to !== "object" || Array.isArray(to)) { e.push(`${at}.to missing`); }
      else {
        if (to.x === undefined && to.y === undefined && to.zoom === undefined) e.push(`${at}: camera needs at least one of x, y, zoom`);
        for (const k of ["x", "y"] as const) {
          if (to[k] !== undefined && (typeof to[k] !== "number" || !Number.isFinite(to[k]) || (to[k] as number) < 0 || (to[k] as number) > 1)) e.push(`${at}.to.${k} must be 0–1`);
        }
        if (to.zoom !== undefined && (typeof to.zoom !== "number" || !Number.isFinite(to.zoom) || to.zoom < 1 || to.zoom > 8)) e.push(`${at}.to.zoom must be 1–8`);
      }
      if (a.durationMs !== undefined && (typeof a.durationMs !== "number" || !Number.isFinite(a.durationMs) || a.durationMs < 0)) {
        e.push(`${at}.durationMs must be a finite number ≥ 0`);
      }
      if (a.ease !== undefined && (typeof a.ease !== "string" || !CAMERA_EASES.includes(a.ease))) {
        e.push(`${at}.ease must be one of ${CAMERA_EASES.join(", ")}`);
      }
    });
  });
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate credits, screen_fade, note_emitter numbers, and text/credits particles (sub-project 6). */
function validateCreditsAndFades(scene: Scene, si: number, e: string[]): void {
  scene?.beats?.forEach((b, bi) => {
    b?.timeline?.forEach((a: Record<string, unknown>, ai) => {
      const at = `scenes[${si}].beats[${bi}].timeline[${ai}]`;
      if (a?.kind === "credits") {
        const items = a.items;
        if (!Array.isArray(items) || items.length === 0) e.push(`${at}.items must be a non-empty array`);
        else items.forEach((it: Record<string, unknown>, k) => {
          if (!it || typeof it !== "object") { e.push(`${at}.items[${k}] must be an object`); return; }
          if (it.role !== undefined && typeof it.role !== "string") e.push(`${at}.items[${k}].role must be a string`);
          if (!Array.isArray(it.names) || !it.names.every((n) => typeof n === "string")) e.push(`${at}.items[${k}].names must be an array of strings`);
        });
        if (!finite(a.durationMs) || a.durationMs <= 0) e.push(`${at}.durationMs must be a finite number > 0`);
        if (a.area !== undefined) {
          const r = (a.area ?? {}) as Record<string, unknown>;
          const [x, y, w, h] = [r.x, r.y, r.w, r.h];
          const ok = finite(x) && finite(y) && finite(w) && finite(h)
            && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9;
          if (!ok) e.push(`${at}.area must lie within 0–1 with positive size`);
        }
      }
      if (a?.kind === "note_emitter") {
        if (!finite(a.freq) || a.freq < 0) e.push(`${at}.freq must be a finite number ≥ 0`);
        if (!finite(a.decay) || a.decay < 0) e.push(`${at}.decay must be a finite number ≥ 0`);
      }
      if (a?.kind === "screen_fade") {
        if (!finite(a.to) || a.to < 0 || a.to > 1) e.push(`${at}.to must be 0–1`);
        if (a.durationMs !== undefined && (!finite(a.durationMs) || a.durationMs < 0)) e.push(`${at}.durationMs must be a finite number ≥ 0`);
        if (a.color !== undefined && typeof a.color !== "string") e.push(`${at}.color must be a string`);
        else if (a.color !== undefined && !isHexColor(a.color)) e.push(`${at}.color must be a hex colour (#rgb, #rgba, #rrggbb or #rrggbbaa)`);
      }
      if (a?.kind === "text" && a.flash !== undefined && typeof a.flash !== "boolean") e.push(`${at}.flash must be a boolean`);
      if ((a?.kind === "text" || a?.kind === "credits") && a.particles !== undefined) {
        const p = a.particles;
        if (!p || typeof p !== "object" || Array.isArray(p)) e.push(`${at}.particles must be an object`);
        else {
          const rate = (p as Record<string, unknown>).rate;
          if (rate !== undefined && (!finite(rate) || rate < 1 || rate > 30)) e.push(`${at}.particles.rate must be 1–30`);
        }
      }
    });
  });
}

/** actionDuration for an unvalidated action: a malformed one (e.g. text with no value) counts as NaN. */
function safeDuration(a: unknown): number {
  try { return actionDuration(a as Action); } catch { return NaN; }
}
const msText = (s: number) => String(Math.round(s * 1e6) / 1e3);
const AT_MS_EPS = 1e-9; // seconds: absorbs float error in the summed cursor

/** Validate `atMs` (a zero-time cue anchored during the timed action before it). Mirrors beatTimeline:
 *  the anchor must lie in [previous window's start, the cursor the cue would otherwise take] so window
 *  starts stay non-decreasing in list order. */
function validateAtMs(scene: Scene, si: number, e: string[]): void {
  scene?.beats?.forEach((b, bi) => {
    if (!Array.isArray(b?.timeline)) return;
    let cursor = 0;
    let prevStart = 0;
    b.timeline.forEach((a: Record<string, unknown>, ai) => {
      const at = `scenes[${si}].beats[${bi}].timeline[${ai}]`;
      const dur = safeDuration(a);
      if (a?.atMs === undefined) { prevStart = cursor; cursor += dur; return; }
      const kind = String(a.kind);
      if (!AT_MS_KINDS.has(a.kind as Action["kind"])) {
        e.push(`${at}.atMs: ${kind} cannot take atMs (only screen_fade, camera and art)`);
        prevStart = cursor; cursor += dur; return;
      }
      if (!finite(a.atMs) || a.atMs < 0) { e.push(`${at}.atMs: ${kind} atMs must be a finite number ≥ 0`); prevStart = cursor; return; }
      const t = a.atMs / 1000;
      if (Number.isFinite(cursor) && (t < prevStart - AT_MS_EPS || t > cursor + AT_MS_EPS)) {
        e.push(`${at}.atMs: ${kind} atMs must be ${msText(prevStart)}–${msText(cursor)} ms`);
      }
      prevStart = Math.min(Math.max(t, prevStart), cursor); // beatTimeline's start for this cue
    });
  });
}

export function validateDeckDoc(obj: unknown): { ok: boolean; errors: string[] } {
  const e: string[] = [];
  const d = obj as Partial<DeckDoc>;
  if (!d || typeof d !== "object") return { ok: false, errors: ["not an object"] };
  if (d.version !== 1) e.push("version must be 1");
  if (!d.meta || typeof d.meta !== "object") e.push("meta missing");
  else {
    if (typeof d.meta.id !== "string" || !ID_RE.test(d.meta.id)) e.push("meta.id must match /^[a-z0-9][a-z0-9-]*$/");
    if (typeof d.meta.title !== "string" || !d.meta.title) e.push("meta.title required");
    const timing = (d.meta as { timing?: unknown }).timing;
    if (timing !== undefined && (timing === null || typeof timing !== "object" || !isPositiveFinite((timing as { targetSec?: unknown }).targetSec))) {
      e.push("meta.timing.targetSec must be a finite number > 0");
    }
    const meta = d.meta as { soundtrack?: unknown; markers?: unknown };
    if (meta.soundtrack !== undefined) {
      const media = (meta.soundtrack as { media?: unknown } | null)?.media;
      if (typeof media !== "string" || !MEDIA_ID_PATTERN.test(media)) e.push("meta.soundtrack.media must be a media id");
    }
    if (meta.markers !== undefined) {
      if (!Array.isArray(meta.markers)) e.push("meta.markers must be an array");
      else {
        const seen = new Set<string>();
        meta.markers.forEach((m: Record<string, unknown>, i) => {
          if (typeof m?.id !== "string" || !m.id) e.push(`meta.markers[${i}].id must be a non-empty string`);
          else if (seen.has(m.id)) e.push(`meta.markers[${i}].id "${m.id}" duplicated`);
          else seen.add(m.id);
          if (typeof m?.label !== "string" || m.label.length < 1 || m.label.length > 40) e.push(`meta.markers[${i}].label must be 1–40 characters`);
          if (typeof m?.t !== "number" || !Number.isFinite(m.t) || m.t < 0) e.push(`meta.markers[${i}].t must be a finite number ≥ 0`);
        });
      }
    }
  }
  if (!Array.isArray(d.scenes)) e.push("scenes must be an array");
  else d.scenes.forEach((s: Scene, i) => {
    if (!s || typeof s.id !== "string") e.push(`scenes[${i}].id required`);
    if (!Array.isArray(s?.beats)) e.push(`scenes[${i}].beats must be an array`);
    if (s?.durationSec !== undefined && !isPositiveFinite(s.durationSec)) e.push(`scenes[${i}].durationSec must be a finite number > 0`);
    validateSceneObjects(s?.objects, `scenes[${i}]`, new Set<string>(), 1, e);
    validateSceneActionTargets(s, i, e);
    validateCameraActions(s, i, e);
    validateCreditsAndFades(s, i, e);
    validateAtMs(s, i, e);
  });
  return { ok: e.length === 0, errors: e };
}

export const DECK_ID_RE = ID_RE;
