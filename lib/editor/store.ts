import { create } from "zustand";
import type { DeckDoc } from "@/engine/deck-doc";
import { flattenBeats, type FlatBeat } from "./flatten-beats";
interface EditorState {
  doc: DeckDoc | null; beats: FlatBeat[]; selected: number;
  load: (doc: DeckDoc) => void; select: (i: number) => void;
}
export const useEditor = create<EditorState>((set, get) => ({
  doc: null, beats: [], selected: 0,
  load: (doc) => set({ doc, beats: flattenBeats(doc), selected: 0 }),
  select: (i) => { const last = Math.max(0, get().beats.length - 1); set({ selected: Math.min(last, Math.max(0, i)) }); },
}));
