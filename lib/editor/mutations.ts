import type { DeckDoc } from "@/engine/deck-doc";
import type { Action, Beat, Scene } from "@/engine/deck/types";
import { beatLocation } from "./flatten-beats";

export function uniqueBeatId(doc: DeckDoc): string {
  const used = new Set(doc.scenes.flatMap((s) => s.beats.map((b) => b.id)));
  for (let n = 1; ; n++) { const id = `b-${n}`; if (!used.has(id)) return id; }
}

export function uniqueSceneId(doc: DeckDoc): string {
  const used = new Set(doc.scenes.map((s) => s.id));
  // Collision-avoidance over the `s-N` namespace (mirrors uniqueBeatId): the smallest
  // `s-N` not already in use. Always unique, even after a middle scene is deleted.
  for (let n = 1; ; n++) { const id = `s-${n}`; if (!used.has(id)) return id; }
}

export function newBeat(id: string): Beat {
  return { id, timeline: [{ kind: "text", value: "New line", in: "fade" }] };
}

function mapScene(doc: DeckDoc, sceneIdx: number, f: (s: Scene) => Scene): DeckDoc {
  return { ...doc, scenes: doc.scenes.map((s, i) => (i === sceneIdx ? f(s) : s)) };
}

export function insertBeatAfter(doc: DeckDoc, flatIdx: number): DeckDoc {
  const beat = newBeat(uniqueBeatId(doc));
  const loc = beatLocation(doc, flatIdx);
  if (!loc) {
    if (!doc.scenes.length) return { ...doc, scenes: [{ id: uniqueSceneId(doc), beats: [beat] }] };
    const si = doc.scenes.length - 1;
    return mapScene(doc, si, (s) => ({ ...s, beats: [...s.beats, beat] }));
  }
  return mapScene(doc, loc.sceneIdx, (s) => ({
    ...s,
    beats: [...s.beats.slice(0, loc.beatIdx + 1), beat, ...s.beats.slice(loc.beatIdx + 1)],
  }));
}

export function duplicateBeatAt(doc: DeckDoc, flatIdx: number): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const src = doc.scenes[loc.sceneIdx].beats[loc.beatIdx];
  const copy: Beat = { ...(JSON.parse(JSON.stringify(src)) as Beat), id: uniqueBeatId(doc) };
  return mapScene(doc, loc.sceneIdx, (s) => ({
    ...s,
    beats: [...s.beats.slice(0, loc.beatIdx + 1), copy, ...s.beats.slice(loc.beatIdx + 1)],
  }));
}

export function deleteBeatAt(doc: DeckDoc, flatIdx: number): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  return mapScene(doc, loc.sceneIdx, (s) => ({ ...s, beats: s.beats.filter((_, bi) => bi !== loc.beatIdx) }));
}

/** Swap a beat with its neighbour WITHIN its scene. Cross-scene moves are out of scope (v1). */
export function moveBeatBy(doc: DeckDoc, flatIdx: number, dir: -1 | 1): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const beats = doc.scenes[loc.sceneIdx].beats;
  const target = loc.beatIdx + dir;
  if (target < 0 || target >= beats.length) return doc; // scene boundary → no-op
  const next = beats.slice();
  [next[loc.beatIdx], next[target]] = [next[target], next[loc.beatIdx]];
  return mapScene(doc, loc.sceneIdx, (s) => ({ ...s, beats: next }));
}

export function appendScene(doc: DeckDoc): DeckDoc {
  return { ...doc, scenes: [...doc.scenes, { id: uniqueSceneId(doc), beats: [newBeat(uniqueBeatId(doc))] }] };
}

export function deleteSceneAt(doc: DeckDoc, flatIdx: number): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  return { ...doc, scenes: doc.scenes.filter((_, si) => si !== loc.sceneIdx) };
}

/** Map the timeline of the beat at a flat index, returning the same doc on a miss. */
function mapTimeline(doc: DeckDoc, flatIdx: number, f: (tl: Action[]) => Action[]): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  return mapScene(doc, loc.sceneIdx, (s) => ({
    ...s,
    beats: s.beats.map((b, bi) => (bi !== loc.beatIdx ? b : { ...b, timeline: f(b.timeline) })),
  }));
}

/** Insert `action` after `actionIdx` (use -1 to prepend). */
export function insertActionAfter(doc: DeckDoc, flatIdx: number, actionIdx: number, action: Action): DeckDoc {
  return mapTimeline(doc, flatIdx, (tl) => [...tl.slice(0, actionIdx + 1), action, ...tl.slice(actionIdx + 1)]);
}

export function deleteActionAt(doc: DeckDoc, flatIdx: number, actionIdx: number): DeckDoc {
  return mapTimeline(doc, flatIdx, (tl) => (actionIdx < 0 || actionIdx >= tl.length ? tl : tl.filter((_, i) => i !== actionIdx)));
}

/** Swap an action with its neighbour. Returns the same doc at a timeline boundary. */
export function moveActionBy(doc: DeckDoc, flatIdx: number, actionIdx: number, dir: -1 | 1): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const tl = doc.scenes[loc.sceneIdx].beats[loc.beatIdx].timeline;
  const target = actionIdx + dir;
  if (actionIdx < 0 || actionIdx >= tl.length || target < 0 || target >= tl.length) return doc;
  return mapTimeline(doc, flatIdx, (t) => {
    const next = t.slice();
    [next[actionIdx], next[target]] = [next[target], next[actionIdx]];
    return next;
  });
}

export function duplicateActionAt(doc: DeckDoc, flatIdx: number, actionIdx: number): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const tl = doc.scenes[loc.sceneIdx].beats[loc.beatIdx].timeline;
  if (actionIdx < 0 || actionIdx >= tl.length) return doc;
  const copy = JSON.parse(JSON.stringify(tl[actionIdx])) as Action;
  return mapTimeline(doc, flatIdx, (t) => [...t.slice(0, actionIdx + 1), copy, ...t.slice(actionIdx + 1)]);
}
