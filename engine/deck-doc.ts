import type { Scene, SceneObject, SlideTreatment } from "@/engine/deck/types";

/** Optional host-app chrome, defaulted to none so decks render generic. */
export interface DeckChrome {
  /** Splash on the scene whose id is "intro". */
  splash?: { logo?: string; tagline?: string };
  /** CTAs on the beat whose id is "fin". */
  ending?: { ctas?: { label: string; href: string }[] };
  /** Footer wordmark text. */
  wordmark?: string;
}

export interface DeckMeta {
  id: string;
  title: string;
  treatment?: SlideTreatment;
  noindex?: boolean;
  chrome?: DeckChrome;
}

export interface DeckDoc {
  version: 1;
  meta: DeckMeta;
  scenes: Scene[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

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

export function validateDeckDoc(obj: unknown): { ok: boolean; errors: string[] } {
  const e: string[] = [];
  const d = obj as Partial<DeckDoc>;
  if (!d || typeof d !== "object") return { ok: false, errors: ["not an object"] };
  if (d.version !== 1) e.push("version must be 1");
  if (!d.meta || typeof d.meta !== "object") e.push("meta missing");
  else {
    if (typeof d.meta.id !== "string" || !ID_RE.test(d.meta.id)) e.push("meta.id must match /^[a-z0-9][a-z0-9-]*$/");
    if (typeof d.meta.title !== "string" || !d.meta.title) e.push("meta.title required");
  }
  if (!Array.isArray(d.scenes)) e.push("scenes must be an array");
  else d.scenes.forEach((s: Scene, i) => {
    if (!s || typeof s.id !== "string") e.push(`scenes[${i}].id required`);
    if (!Array.isArray(s?.beats)) e.push(`scenes[${i}].beats must be an array`);
    validateSceneObjects(s?.objects, `scenes[${i}]`, new Set<string>(), 1, e);
    validateSceneActionTargets(s, i, e);
  });
  return { ok: e.length === 0, errors: e };
}

export const DECK_ID_RE = ID_RE;
