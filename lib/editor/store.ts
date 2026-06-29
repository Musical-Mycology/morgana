import { create } from "zustand";
import type { DeckDoc } from "@/engine/deck-doc";
import { flattenBeats, beatLocation, type FlatBeat } from "./flatten-beats";
import { setPath } from "./paths";
import { insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy, appendScene, deleteSceneAt, insertActionAfter, deleteActionAt, moveActionBy, duplicateActionAt } from "./mutations";

const HISTORY_CAP = 50;

interface EditorState {
  doc: DeckDoc | null;
  beats: FlatBeat[];
  selected: number;
  selectedAction: number | null;
  past: DeckDoc[];
  future: DeckDoc[];
  revision: number;
  load: (doc: DeckDoc) => void;
  select: (i: number) => void;
  selectAction: (i: number | null) => void;
  updateAction: (beatIdx: number, actionIdx: number, path: string, value: unknown) => void;
  updateMeta: (path: string, value: unknown) => void;
  undo: () => void;
  redo: () => void;
  addBeat: (flatIdx: number) => void;
  duplicateBeat: (flatIdx: number) => void;
  deleteBeat: (flatIdx: number) => void;
  moveBeat: (flatIdx: number, dir: -1 | 1) => void;
  addScene: () => void;
  deleteScene: (flatIdx: number) => void;
  addAction: (flatIdx: number, afterIdx: number, action: import("@/engine/deck/types").Action) => void;
  deleteAction: (flatIdx: number, actionIdx: number) => void;
  moveAction: (flatIdx: number, actionIdx: number, dir: -1 | 1) => void;
  duplicateAction: (flatIdx: number, actionIdx: number) => void;
}

/** Record the current doc into history, swap in the produced doc, re-derive beats, bump revision.
 *  A producer that returns the SAME doc reference is a no-op: nothing is recorded. */
function commit(s: EditorState, produce: (doc: DeckDoc) => DeckDoc): Partial<EditorState> {
  if (!s.doc) return {};
  const doc = produce(s.doc);
  if (doc === s.doc) return {};
  return {
    doc,
    beats: flattenBeats(doc),
    past: [...s.past, s.doc].slice(-HISTORY_CAP),
    future: [],
    revision: s.revision + 1,
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  beats: [],
  selected: 0,
  selectedAction: null,
  past: [],
  future: [],
  revision: 0,
  load: (doc) => set({ doc, beats: flattenBeats(doc), selected: 0, selectedAction: null, past: [], future: [], revision: 0 }),
  select: (i) => {
    const last = Math.max(0, get().beats.length - 1);
    set({ selected: Math.min(last, Math.max(0, i)), selectedAction: null });
  },
  selectAction: (i) => set({ selectedAction: i }),
  updateAction: (beatIdx, actionIdx, path, value) => set((s) => {
    if (!s.doc) return {};
    const loc = beatLocation(s.doc, beatIdx);
    if (!loc) return {};
    return commit(s, (doc) => ({
      ...doc,
      scenes: doc.scenes.map((sc, si) => si !== loc.sceneIdx ? sc : {
        ...sc,
        beats: sc.beats.map((b, bi) => bi !== loc.beatIdx ? b : {
          ...b,
          timeline: b.timeline.map((a, ai) => ai !== actionIdx ? a : setPath(a, path, value)),
        }),
      }),
    }));
  }),
  updateMeta: (path, value) => set((s) => s.doc ? commit(s, (doc) => ({ ...doc, meta: setPath(doc.meta, path, value) })) : {}),
  undo: () => set((s) => {
    if (!s.past.length || !s.doc) return {};
    const doc = s.past[s.past.length - 1];
    const beats = flattenBeats(doc);
    return { doc, beats, past: s.past.slice(0, -1), future: [s.doc, ...s.future].slice(0, HISTORY_CAP), revision: s.revision + 1, selected: Math.min(s.selected, Math.max(0, beats.length - 1)), selectedAction: null };
  }),
  redo: () => set((s) => {
    if (!s.future.length || !s.doc) return {};
    const doc = s.future[0];
    const beats = flattenBeats(doc);
    return { doc, beats, future: s.future.slice(1), past: [...s.past, s.doc].slice(-HISTORY_CAP), revision: s.revision + 1, selected: Math.min(s.selected, Math.max(0, beats.length - 1)), selectedAction: null };
  }),
  addBeat: (flatIdx) => set((s) => commit(s, (doc) => insertBeatAfter(doc, flatIdx))),
  duplicateBeat: (flatIdx) => set((s) => commit(s, (doc) => duplicateBeatAt(doc, flatIdx))),
  deleteBeat: (flatIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => deleteBeatAt(doc, flatIdx));
    if (!part.beats) return {};
    return { ...part, selected: Math.min(s.selected, Math.max(0, part.beats.length - 1)), selectedAction: null };
  }),
  moveBeat: (flatIdx, dir) => set((s) => {
    if (!s.doc) return {};
    const next = moveBeatBy(s.doc, flatIdx, dir);
    if (next === s.doc) return {};
    return { ...commit(s, () => next), selected: flatIdx + dir };
  }),
  addScene: () => set((s) => commit(s, (doc) => appendScene(doc))),
  deleteScene: (flatIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => deleteSceneAt(doc, flatIdx));
    if (!part.beats) return {};
    return { ...part, selected: Math.min(s.selected, Math.max(0, part.beats.length - 1)), selectedAction: null };
  }),
  addAction: (flatIdx, afterIdx, action) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => insertActionAfter(doc, flatIdx, afterIdx, action));
    if (!part.doc) return {};
    return { ...part, selectedAction: afterIdx + 1 };
  }),
  deleteAction: (flatIdx, actionIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => deleteActionAt(doc, flatIdx, actionIdx));
    if (!part.doc) return {};
    return { ...part, selectedAction: null };
  }),
  moveAction: (flatIdx, actionIdx, dir) => set((s) => {
    if (!s.doc) return {};
    const next = moveActionBy(s.doc, flatIdx, actionIdx, dir);
    if (next === s.doc) return {};
    return { ...commit(s, () => next), selectedAction: actionIdx + dir };
  }),
  duplicateAction: (flatIdx, actionIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => duplicateActionAt(doc, flatIdx, actionIdx));
    if (!part.doc) return {};
    return { ...part, selectedAction: actionIdx + 1 };
  }),
}));
