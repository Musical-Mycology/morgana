import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat, Scene } from "@/engine/deck/types";
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
