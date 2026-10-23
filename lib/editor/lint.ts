import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import { validateDeck } from "@/engine/deck/validate";
import { flattenStory } from "@/engine/deck/flatten";
import { deckLayout, sceneOverrun } from "@/engine/authoring/deck-clock";
import { formatClock } from "@/lib/timing/clock-format";
import { parseInlineLinks } from "@/engine/deck/inline-links";
import type { Action } from "@/engine/deck/types";
import { isMediaRef, mediaKind, mediaRefId } from "@/engine/deck/media-ref";
import { cameraAt, cameraEvents, type CameraEvent } from "@/engine/authoring/camera-clock";
import { artAt, artEvents } from "@/engine/authoring/art-clock";
import { beatTimeline } from "@/engine/authoring/beat-clock";
import { findMediaRefs } from "@/lib/editor/media-refs";
import type { MediaInfo } from "@/lib/store/media-store";

export type LintSeverity = "error" | "warning";
export interface LintLocation { sceneIdx: number; beatIdx?: number; actionIdx?: number }
export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  message: string;
  /** Absent = a deck-level issue with nowhere to jump to. */
  at?: LintLocation;
}

const DOC_PATH_RE = /^scenes\[(\d+)\](?:\.beats\[(\d+)\](?:\.timeline\[(\d+)\])?)?/;

/** Read the leading `scenes[i][.beats[j][.timeline[k]]]` path that validateDeckDoc messages
 *  already carry. Object-tree messages (`scenes[i].objects[j]…`) match only the `scenes[i]`
 *  prefix and so resolve to the scene — the right granularity, since object selection is
 *  path-keyed rather than index-keyed. */
export function parseDocPath(message: string): LintLocation | undefined {
  const m = DOC_PATH_RE.exec(message);
  if (!m) return undefined;
  const at: LintLocation = { sceneIdx: Number(m[1]) };
  if (m[2] !== undefined) at.beatIdx = Number(m[2]);
  if (m[3] !== undefined) at.actionIdx = Number(m[3]);
  return at;
}

// Matches both message shapes validateDeck emits for a slide id: the common `slide "<id>": …`
// prefix, and the differently-worded `duplicate slide id "<id>"` (no colon, no leading
// "slide" token before "id"). Anchored at the start so it doesn't match unrelated messages
// that merely contain a quoted string elsewhere.
const SLIDE_ID_RE = /^(?:slide "([^"]+)":|duplicate slide id "([^"]+)")/;

/** flattenStory builds slide ids as `${scene.id}.${beat.id}`, so a validateDeck message
 *  resolves back to a beat by scanning for that pair. */
function locateSlide(doc: DeckDoc, message: string): LintLocation | undefined {
  const m = SLIDE_ID_RE.exec(message);
  if (!m) return undefined;
  const id = m[1] ?? m[2];
  for (let sceneIdx = 0; sceneIdx < doc.scenes.length; sceneIdx++) {
    const scene = doc.scenes[sceneIdx];
    for (let beatIdx = 0; beatIdx < scene.beats.length; beatIdx++) {
      if (`${scene.id}.${scene.beats[beatIdx].id}` === id) return { sceneIdx, beatIdx };
    }
  }
  return undefined;
}

// validateDeck's exact wording for a cinematic beat with no art and no timeline. Matched
// precisely so this suppression can't accidentally swallow some other message.
const NO_ART_NO_TIMELINE_RE = /^slide "[^"]+": cinematic beat has no art and no timeline$/;

const LAST = Number.MAX_SAFE_INTEGER;

/** Document order, with unlocated issues last. */
function byLocation(a: LintIssue, b: LintIssue): number {
  const key = (i: LintIssue) => i.at
    ? [i.at.sceneIdx, i.at.beatIdx ?? -1, i.at.actionIdx ?? -1]
    : [LAST, LAST, LAST];
  const ka = key(a), kb = key(b);
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

const INTERACTIVE_KINDS = new Set<Action["kind"]>(["click_gate", "reveal_arrows", "pulse_arrow", "reveal_again"]);

function isInteractive(a: Action): boolean {
  if (INTERACTIVE_KINDS.has(a.kind)) return true;
  return a.kind === "text" && parseInlineLinks(a.value).some((seg) => seg.kind === "link" && seg.link === "jump");
}

/** Timing warnings (timed-video decks). Runs only on a structurally valid deck. */
function timingWarnings(doc: DeckDoc): LintIssue[] {
  const out: LintIssue[] = [];
  const layout = deckLayout(doc);
  for (const s of layout.scenes) {
    const over = sceneOverrun(s);
    if (over > 0) {
      out.push({ rule: "scene-overrun", severity: "warning", at: { sceneIdx: s.sceneIdx },
        message: `scene "${doc.scenes[s.sceneIdx].id}" runs ${over.toFixed(over < 0.1 ? 2 : 1)}s over its ${s.length}s` });
    }
  }
  const target = doc.meta.timing?.targetSec;
  if (target === undefined) return out;
  const diff = layout.total - target;
  if (Math.abs(diff) >= 0.05) {
    out.push({ rule: "deck-length-mismatch", severity: "warning",
      message: `deck is ${formatClock(layout.total, { tenths: false })} of ${formatClock(target, { tenths: false })} — ${Math.abs(diff).toFixed(1)}s ${diff < 0 ? "short" : "over"}` });
  }
  doc.scenes.forEach((s, sceneIdx) => s.beats.forEach((b, beatIdx) => b.timeline.forEach((a, actionIdx) => {
    if (isInteractive(a)) {
      out.push({ rule: "timed-interactive", severity: "warning", at: { sceneIdx, beatIdx, actionIdx },
        message: `${a.kind} is interactive and is ignored in timed playback` });
    }
  })));
  return out;
}

/** Merged camera events (as `cameraEvents` folds them) paired with the location of the action that
 *  decides each one — the last camera action at that start. Walks the doc in parallel with
 *  cameraEvents' own reach rule; null if the two walks ever disagree. */
function cameraLocated(doc: DeckDoc): { ev: CameraEvent; at: LintLocation }[] | null {
  const events = cameraEvents(doc);
  const out: { ev: CameraEvent; at: LintLocation }[] = [];
  let k = 0;
  for (const s of deckLayout(doc).scenes) {
    const scene = doc.scenes[s.sceneIdx];
    const reached = (localStart: number) => !s.pinned || localStart < s.length;
    for (const b of s.beats) {
      if (!reached(b.start)) continue;
      const tl = scene.beats[b.beatIdx].timeline;
      beatTimeline(tl).forEach((w, actionIdx) => {
        if (w.action.kind !== "camera" || !reached(b.start + w.start)) return;
        const start = s.start + b.start + w.start;
        const at: LintLocation = { sceneIdx: s.sceneIdx, beatIdx: b.beatIdx, actionIdx };
        const prev = out[out.length - 1];
        if (prev && prev.ev.start === start) prev.at = at;
        else if (k < events.length) out.push({ ev: events[k++], at });
      });
    }
  }
  return k === events.length ? out : null;
}

/** Camera warnings. Runs only on a structurally valid deck. */
function cameraWarnings(doc: DeckDoc): LintIssue[] {
  const located = cameraLocated(doc);
  if (!located || located.length === 0) return [];
  const events = located.map((l) => l.ev);
  const art = artEvents(doc);
  const out: LintIssue[] = [];
  located.forEach(({ ev, at }, i) => {
    const prev = i > 0 ? events[i - 1] : undefined;
    // Same-start actions were merged into one event, so only a strictly earlier finish counts.
    if (prev && ev.start < prev.start + prev.duration - 1e-9) {
      out.push({ rule: "camera-overlap", severity: "warning", at, message: "camera move starts before the previous one finishes (interrupts it)" });
    }
    const end = ev.start + ev.duration;
    const z = Math.round(cameraAt(events.slice(0, i + 1), end).zoom * 1e6) / 1e6;
    if (z > 2 && artAt(art, end).some((l) => !isMediaRef(l.asset))) {
      out.push({ rule: "camera-zoom-soft", severity: "warning", at,
        message: `zoom ${z.toFixed(1)}× on built-in panel art will look soft — use higher-resolution art` });
    }
  });
  return out;
}

/** Facts the editor knows that the document does not: the deck's media ids and the decoded
 *  soundtrack duration. Each soundtrack rule is skipped when its fact is absent. */
export interface LintContext { mediaIds?: string[]; soundtrackSec?: number; media?: MediaInfo[] }

/** Media-ref warnings (art layers, media tiles, clip options). Skipped without `ctx.media`. */
function mediaWarnings(doc: DeckDoc, ctx: LintContext): LintIssue[] {
  const media = ctx.media;
  if (!media) return [];
  const byId = new Map(media.map((m) => [m.id, m]));
  const out: LintIssue[] = [];
  const seen = new Set<string>();
  const loc = (u: { sceneIdx: number; beatIdx: number; actionIdx?: number }): LintLocation =>
    u.actionIdx === undefined ? { sceneIdx: u.sceneIdx, beatIdx: u.beatIdx } : { sceneIdx: u.sceneIdx, beatIdx: u.beatIdx, actionIdx: u.actionIdx };
  for (const u of findMediaRefs(doc)) {
    const id = mediaRefId(u.ref);
    const at = loc(u);
    const key = `${u.sceneIdx}.${u.beatIdx}.${u.actionIdx ?? ""}.${u.ref}`;
    const m = byId.get(id);
    if (!seen.has(key)) {
      if (!m) {
        seen.add(key);
        out.push({ rule: "media-missing", severity: "warning", at, message: `media "${id}" is not in this deck's media — upload it again` });
        continue;
      }
      const kind = mediaKind(m.mime);
      if (kind !== "image" && kind !== "video") {
        seen.add(key);
        out.push({ rule: "media-kind", severity: "warning", at, message: `media "${id}" is ${kind ?? m.mime} — art and tiles take images or video` });
        continue;
      }
    } else continue;
    // Clip in-point past the end of a known-duration video.
    const beat = doc.scenes[u.sceneIdx].beats[u.beatIdx];
    const a = u.actionIdx === undefined ? undefined : beat.timeline[u.actionIdx];
    const art = u.actionIdx === undefined ? beat.art : a?.kind === "art" ? a.art : undefined;
    const inSec = u.where === "clip-opts" ? art?.clips?.[u.ref]?.in : u.where === "tile" && a?.kind === "media" ? a.clip?.in : undefined;
    if (typeof inSec === "number" && m.durationSec !== undefined && inSec >= m.durationSec) {
      out.push({ rule: "clip-in-past-end", severity: "warning", at,
        message: `clip in-point ${inSec}s is at or past the clip's end (${m.durationSec}s)` });
    }
  }
  // A non-media key in clip options does nothing — flag it.
  doc.scenes.forEach((s, sceneIdx) => s.beats.forEach((b, beatIdx) => {
    const check = (t: { clips?: Record<string, unknown> } | undefined, actionIdx?: number) => {
      for (const k of Object.keys(t?.clips ?? {})) {
        if (!isMediaRef(k)) out.push({ rule: "media-kind", severity: "warning", at: loc({ sceneIdx, beatIdx, actionIdx }),
          message: `clip options key "${k}" is not a media: ref` });
      }
    };
    check(b.art);
    b.timeline.forEach((a, actionIdx) => { if (a.kind === "art") check(a.art, actionIdx); });
  }));
  return out;
}

/** Soundtrack and marker warnings. Runs only on a structurally valid deck. */
function soundtrackWarnings(doc: DeckDoc, ctx: LintContext): LintIssue[] {
  const out: LintIssue[] = [];
  const total = deckLayout(doc).total;
  const media = doc.meta.soundtrack?.media;
  if (media && ctx.mediaIds && !ctx.mediaIds.includes(media)) {
    out.push({ rule: "soundtrack-missing", severity: "warning", message: "the soundtrack file is missing from this deck's media — upload it again" });
  }
  if (media && ctx.soundtrackSec !== undefined) {
    const diff = ctx.soundtrackSec - total;
    if (Math.abs(diff) > 0.5) {
      const head = `track is ${formatClock(ctx.soundtrackSec, { tenths: false })}, deck is ${formatClock(total, { tenths: false })}`;
      out.push({ rule: "soundtrack-length", severity: "warning",
        message: diff > 0 ? `${head} — ${diff.toFixed(1)}s of music would play past the last frame`
                          : `${head} — the video would end ${(-diff).toFixed(1)}s in silence` });
    }
  }
  for (const m of doc.meta.markers ?? []) {
    if (m.t > total) {
      out.push({ rule: "marker-out-of-range", severity: "warning",
        message: `marker "${m.label}" at ${formatClock(m.t, { tenths: false })} is past the end of the deck (${formatClock(total, { tenths: false })})` });
    }
  }
  return out;
}

/** Every problem in a deck, errors first. An "error" is exactly what makes the server reject
 *  a PUT, so it means "this deck will not save"; a "warning" is advisory only. */
export function lintDeck(doc: DeckDoc, ctx: LintContext = {}): LintIssue[] {
  // validateDeckDoc emits deck-meta problems before per-scene ones, which is the right
  // priority already — so errors keep their emission order rather than being sorted.
  const errors: LintIssue[] = validateDeckDoc(doc).errors.map((message) => ({
    rule: "structure",
    severity: "error" as const,
    message,
    at: parseDocPath(message),
  }));

  const warnings: LintIssue[] = doc.scenes.flatMap((s, sceneIdx) =>
    s.beats.length === 0
      ? [{ rule: "scene-empty", severity: "warning" as const, message: `scene "${s.id}" has no beats`, at: { sceneIdx } }]
      : []);

  // validateDeck and flattenStory both assume a structurally valid document, so they only
  // run on a clean one. The try/catch means a validator crash can never blank the panel.
  if (errors.length === 0) {
    warnings.push(...timingWarnings(doc));
    warnings.push(...cameraWarnings(doc));
    warnings.push(...soundtrackWarnings(doc, ctx));
    warnings.push(...mediaWarnings(doc, ctx));
    try {
      for (const message of validateDeck(flattenStory(doc.scenes))) {
        const at = locateSlide(doc, message);
        // engine/deck/validate.ts flags a cinematic beat with no art and no timeline, but it
        // knows nothing about scene-level objects — this branch's own isBeatEmpty (in
        // empty-state.ts) treats such a beat as non-empty once its scene has objects, because
        // the object layer genuinely renders them. Without this suppression, any beat that
        // relies on scene objects for its visual content gets a permanent, unresolvable
        // warning here. The engine is read-only for this branch (validateDeck is shared code
        // with its own consumers), so the fix lives in the editor's lint layer instead: the
        // deeper fix — teaching validateDeck about scene objects — is a deliberate follow-up,
        // not an oversight.
        if (NO_ART_NO_TIMELINE_RE.test(message) && at !== undefined && (doc.scenes[at.sceneIdx].objects?.length ?? 0) > 0) {
          continue;
        }
        warnings.push({ rule: "slide", severity: "warning", message, at });
      }
    } catch { /* ignore — an unlintable deck is still an editable deck */ }
  }

  return [...errors, ...warnings.sort(byLocation)];
}

export function lintCounts(issues: LintIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}
