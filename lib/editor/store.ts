import { create } from "zustand";
import type { DeckDoc } from "@/engine/deck-doc";
import type { ObjectTransform, SceneObject } from "@/engine/deck/types";
import { flattenBeats, beatLocation, type FlatBeat } from "./flatten-beats";
import { setPath } from "./paths";
import { insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy, appendScene, deleteSceneAt, insertActionAfter, duplicateActionAt, deleteActionAt, moveActionBy, convertActionKind } from "./mutations";
import { addObject as mAddObject, updateObject as mUpdateObject, updateObjectTransform as mUpdateObjectTransform, deleteObject as mDeleteObject, reorderObject as mReorderObject, groupObjects as mGroupObjects, ungroupObject as mUngroupObject, reparentObject as mReparentObject, translateObjectBy as mTranslateObjectBy } from "./object-mutations";
import { uniqueObjectId, findObjectPath, getObjectAt, type ObjectPath } from "./object-tree";
import { descriptorForObject } from "./object-registry";
import { togglePath, sameParentSiblings } from "./selection";
import { buildObjectAnimation, insertActionAt, type ObjectVerbKind } from "./object-actions";

const HISTORY_CAP = 50;

interface EditorState {
  doc: DeckDoc | null;
  beats: FlatBeat[];
  selected: number;
  selectedAction: number | null;
  selectedObjectPaths: ObjectPath[];
  enteredGroupPath: ObjectPath | null;
  past: DeckDoc[];
  future: DeckDoc[];
  revision: number;
  load: (doc: DeckDoc) => void;
  select: (i: number) => void;
  selectAction: (i: number | null) => void;
  selectObject: (path: ObjectPath | null) => void;
  toggleObjectSelection: (path: ObjectPath) => void;
  setObjectSelection: (paths: ObjectPath[]) => void;
  enterGroup: (path: ObjectPath) => void;
  exitGroup: () => void;
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
  addAction: (flatIdx: number, actionIdx: number | null, kind: string) => void;
  addObjectAnimation: (flatIdx: number, objectId: string, kind: ObjectVerbKind) => void;
  duplicateAction: (flatIdx: number, actionIdx: number) => void;
  deleteAction: (flatIdx: number, actionIdx: number) => void;
  moveAction: (flatIdx: number, actionIdx: number, dir: -1 | 1) => void;
  convertAction: (flatIdx: number, actionIdx: number, newKind: string) => void;
  addObject: (sceneId: string, kind: SceneObject["kind"], parentPath?: ObjectPath, index?: number) => void;
  updateObject: (sceneId: string, path: ObjectPath, fieldKey: string, value: unknown) => void;
  updateObjectTransform: (sceneId: string, path: ObjectPath, patch: Partial<ObjectTransform>) => void;
  translateObjectBy: (sceneId: string, path: ObjectPath, dx: number, dy: number) => void;
  deleteObject: (sceneId: string, path: ObjectPath) => void;
  reorderObject: (sceneId: string, path: ObjectPath, dir: -1 | 1) => void;
  groupObjects: (sceneId: string, paths: ObjectPath[]) => void;
  ungroupObject: (sceneId: string, path: ObjectPath) => void;
  reparentObject: (sceneId: string, from: ObjectPath, toParent: ObjectPath, toIndex: number) => void;
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
  selectedObjectPaths: [],
  enteredGroupPath: null,
  past: [],
  future: [],
  revision: 0,
  load: (doc) => set({ doc, beats: flattenBeats(doc), selected: 0, selectedAction: null, selectedObjectPaths: [], enteredGroupPath: null, past: [], future: [], revision: 0 }),
  select: (i) => {
    const last = Math.max(0, get().beats.length - 1);
    set({ selected: Math.min(last, Math.max(0, i)), selectedAction: null, selectedObjectPaths: [], enteredGroupPath: null });
  },
  selectAction: (i) => set({ selectedAction: i, selectedObjectPaths: [], enteredGroupPath: null }),
  selectObject: (path) => set({ selectedObjectPaths: path ? [path] : [], enteredGroupPath: null, selectedAction: null }),
  toggleObjectSelection: (path) => set((s) => ({ selectedObjectPaths: togglePath(s.selectedObjectPaths, path), selectedAction: null })),
  setObjectSelection: (paths) => set({ selectedObjectPaths: paths, selectedAction: null }),
  enterGroup: (path) => set({ enteredGroupPath: path }),
  exitGroup: () => set((s) => {
    if (s.enteredGroupPath && s.enteredGroupPath.length > 0) {
      const up = s.enteredGroupPath.slice(0, -1);
      return { enteredGroupPath: up.length ? up : null };
    }
    return { selectedObjectPaths: [], enteredGroupPath: null };
  }),
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
    return { doc, beats, past: s.past.slice(0, -1), future: [s.doc, ...s.future].slice(0, HISTORY_CAP), revision: s.revision + 1, selected: Math.min(s.selected, Math.max(0, beats.length - 1)), selectedAction: null, selectedObjectPaths: [], enteredGroupPath: null };
  }),
  redo: () => set((s) => {
    if (!s.future.length || !s.doc) return {};
    const doc = s.future[0];
    const beats = flattenBeats(doc);
    return { doc, beats, future: s.future.slice(1), past: [...s.past, s.doc].slice(-HISTORY_CAP), revision: s.revision + 1, selected: Math.min(s.selected, Math.max(0, beats.length - 1)), selectedAction: null, selectedObjectPaths: [], enteredGroupPath: null };
  }),
  addBeat: (flatIdx) => set((s) => commit(s, (doc) => insertBeatAfter(doc, flatIdx))),
  duplicateBeat: (flatIdx) => set((s) => commit(s, (doc) => duplicateBeatAt(doc, flatIdx))),
  deleteBeat: (flatIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => deleteBeatAt(doc, flatIdx));
    if (!part.beats) return {};
    return { ...part, selected: Math.min(s.selected, Math.max(0, part.beats.length - 1)), selectedAction: null, selectedObjectPaths: [], enteredGroupPath: null };
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
    return { ...part, selected: Math.min(s.selected, Math.max(0, part.beats.length - 1)), selectedAction: null, selectedObjectPaths: [], enteredGroupPath: null };
  }),
  addAction: (flatIdx, actionIdx, kind) => set((s) => {
    if (!s.doc) return {};
    const loc = beatLocation(s.doc, flatIdx);
    if (!loc) return {};
    const currentLen = s.doc.scenes[loc.sceneIdx].beats[loc.beatIdx].timeline.length;
    const newIdx = actionIdx == null ? currentLen : actionIdx + 1;
    const part = commit(s, (doc) => insertActionAfter(doc, flatIdx, actionIdx, kind));
    if (!part.doc) return {};
    return { ...part, selectedAction: newIdx, selectedObjectPaths: [], enteredGroupPath: null };
  }),
  addObjectAnimation: (flatIdx, objectId, kind) => set((s) => {
    if (!s.doc) return {};
    const loc = beatLocation(s.doc, flatIdx);
    if (!loc) return {};
    const scene = s.doc.scenes[loc.sceneIdx];
    const action = buildObjectAnimation(scene, objectId, kind);
    const index = scene.beats[loc.beatIdx].timeline.length;
    const part = commit(s, (doc) => insertActionAt(doc, flatIdx, index, action));
    return { ...part, selectedAction: index, selectedObjectPaths: [], enteredGroupPath: null };
  }),
  duplicateAction: (flatIdx, actionIdx) => set((s) => commit(s, (doc) => duplicateActionAt(doc, flatIdx, actionIdx))),
  deleteAction: (flatIdx, actionIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => deleteActionAt(doc, flatIdx, actionIdx));
    if (!part.doc) return {};
    const loc = beatLocation(part.doc, flatIdx);
    const newLen = loc ? part.doc.scenes[loc.sceneIdx].beats[loc.beatIdx].timeline.length : 0;
    const sel = s.selectedAction ?? actionIdx;
    return { ...part, selectedAction: newLen === 0 ? null : Math.min(sel, Math.max(0, newLen - 1)) };
  }),
  moveAction: (flatIdx, actionIdx, dir) => set((s) => {
    if (!s.doc) return {};
    const next = moveActionBy(s.doc, flatIdx, actionIdx, dir);
    if (next === s.doc) return {};
    return { ...commit(s, () => next), selectedAction: actionIdx + dir };
  }),
  convertAction: (flatIdx, actionIdx, newKind) => set((s) => ({
    ...commit(s, (doc) => convertActionKind(doc, flatIdx, actionIdx, newKind)),
    selectedAction: actionIdx,
  })),
  addObject: (sceneId, kind, parentPath, index) => set((s) => {
    if (!s.doc) return {};
    const object: SceneObject = { ...descriptorForObject({ kind }).defaults(), id: uniqueObjectId(s.doc, sceneId) };
    const part = commit(s, (doc) => mAddObject(doc, sceneId, object, parentPath, index));
    if (!part.doc) return {};
    const scene = part.doc.scenes.find((sc) => sc.id === sceneId);
    const p = scene ? findObjectPath(scene.objects ?? [], object.id) : null;
    return { ...part, selectedObjectPaths: p ? [p] : [], enteredGroupPath: null, selectedAction: null };
  }),
  updateObject: (sceneId, path, fieldKey, value) => set((s) => commit(s, (doc) => mUpdateObject(doc, sceneId, path, fieldKey, value))),
  updateObjectTransform: (sceneId, path, patch) => set((s) => commit(s, (doc) => mUpdateObjectTransform(doc, sceneId, path, patch))),
  translateObjectBy: (sceneId, path, dx, dy) => set((s) => commit(s, (doc) => mTranslateObjectBy(doc, sceneId, path, dx, dy))),
  deleteObject: (sceneId, path) => set((s) => {
    const part = commit(s, (doc) => mDeleteObject(doc, sceneId, path));
    if (!part.doc) return {};
    return { ...part, selectedObjectPaths: [], enteredGroupPath: null };
  }),
  reorderObject: (sceneId, path, dir) => set((s) => commit(s, (doc) => mReorderObject(doc, sceneId, path, dir))),
  groupObjects: (sceneId, paths) => set((s) => {
    if (!s.doc || !sameParentSiblings(paths)) return {};
    const groupId = uniqueObjectId(s.doc, sceneId);
    const part = commit(s, (doc) => mGroupObjects(doc, sceneId, paths, groupId));
    if (!part.doc) return {};
    const scene = part.doc.scenes.find((sc) => sc.id === sceneId);
    const p = scene ? findObjectPath(scene.objects ?? [], groupId) : null;
    return { ...part, selectedObjectPaths: p ? [p] : [], enteredGroupPath: null, selectedAction: null };
  }),
  ungroupObject: (sceneId, path) => set((s) => {
    if (!s.doc) return {};
    const before = s.doc.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
    const target = getObjectAt(before, path);
    const n = target && target.kind === "group" ? target.children.length : 0;
    const part = commit(s, (doc) => mUngroupObject(doc, sceneId, path));
    if (!part.doc) return {};
    const slot = path[path.length - 1];
    const parent = path.slice(0, -1);
    const kids: ObjectPath[] = Array.from({ length: n }, (_, i) => [...parent, slot + i]);
    return { ...part, selectedObjectPaths: kids, enteredGroupPath: null, selectedAction: null };
  }),
  reparentObject: (sceneId, from, toParent, toIndex) => set((s) => commit(s, (doc) => mReparentObject(doc, sceneId, from, toParent, toIndex))),
}));
