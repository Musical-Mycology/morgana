import { create } from "zustand";
import type { DeckDoc } from "@/engine/deck-doc";
import { flattenBeats, type FlatBeat } from "./flatten-beats";
import { setPath } from "./paths";

interface EditorState {
  doc: DeckDoc | null;
  beats: FlatBeat[];
  selected: number;
  selectedAction: number | null;
  load: (doc: DeckDoc) => void;
  select: (i: number) => void;
  selectAction: (i: number | null) => void;
  updateAction: (beatIdx: number, actionIdx: number, path: string, value: unknown) => void;
  updateMeta: (path: string, value: unknown) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  beats: [],
  selected: 0,
  selectedAction: null,
  load: (doc) => set({ doc, beats: flattenBeats(doc), selected: 0, selectedAction: null }),
  select: (i) => {
    const last = Math.max(0, get().beats.length - 1);
    set({ selected: Math.min(last, Math.max(0, i)), selectedAction: null });
  },
  selectAction: (i) => set({ selectedAction: i }),
  updateAction: (beatIdx, actionIdx, path, value) => set((s) => {
    if (!s.doc) return s;
    let sceneIdx = -1, beatInScene = -1, n = 0;
    outer: for (let si = 0; si < s.doc.scenes.length; si++) {
      for (let bi = 0; bi < s.doc.scenes[si].beats.length; bi++) {
        if (n === beatIdx) { sceneIdx = si; beatInScene = bi; break outer; }
        n++;
      }
    }
    if (sceneIdx < 0) return s;
    const scenes = s.doc.scenes.map((sc, si) => si !== sceneIdx ? sc : {
      ...sc,
      beats: sc.beats.map((b, bi) => bi !== beatInScene ? b : {
        ...b,
        timeline: b.timeline.map((a, ai) => ai !== actionIdx ? a : setPath(a, path, value)),
      }),
    });
    const doc = { ...s.doc, scenes };
    return { doc, beats: flattenBeats(doc) };
  }),
  updateMeta: (path, value) => set((s) => s.doc ? { doc: { ...s.doc, meta: setPath(s.doc.meta, path, value) } } : s),
}));
