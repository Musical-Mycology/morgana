# Timeline Action CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-beat timeline editable — add, delete, reorder, duplicate, and convert-kind for actions — completing the Tier 1.5 "action CRUD" item from the north-star design (§5) and unblocking the §12 AI-assistant tool surface, which needs `add_action`/`delete_action`/`convert_action` mutations that don't exist yet.

**Architecture:** Widen `EffectDescriptor` (registry.ts) with a `defaults()` method so every REGISTRY kind knows how to construct itself; add five pure mutation functions to mutations.ts following the exact style of the existing beat mutations; wrap them in five new zustand store actions (store.ts) that get undo/redo for free via the existing `commit()` helper; wire two small UI additions (icon buttons in Timeline.tsx, a convert-select in Inspector.tsx) using only native `<select>`/`<button>` elements, matching the editor's existing plain-HTML-controls style.

**Tech Stack:** TypeScript, Zustand, Vitest (unit), Playwright (e2e). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-07-02-timeline-action-crud-design.md`](../specs/2026-07-02-timeline-action-crud-design.md)

---

## File Structure

| File | Change |
| --- | --- |
| `lib/editor/registry.ts` | Modify — add `defaults(): Action` to `EffectDescriptor` + all 12 REGISTRY entries + `GENERIC` |
| `lib/editor/mutations.ts` | Modify — add `mapBeat` helper + `insertActionAfter`/`duplicateActionAt`/`deleteActionAt`/`moveActionBy`/`convertActionKind` |
| `lib/editor/store.ts` | Modify — add `addAction`/`duplicateAction`/`deleteAction`/`moveAction`/`convertAction` store actions |
| `components/editor/Timeline.tsx` | Modify — icon buttons on the selected chip + a trailing add-action `<select>` |
| `components/editor/Inspector.tsx` | Modify — a "Convert to" `<select>` next to the action-kind heading |
| `tests/unit/registry-defaults.test.ts` | Create — unit tests for `defaults()` |
| `tests/unit/action-mutations.test.ts` | Create — unit tests for the five new pure mutations |
| `tests/unit/store-action-edit.test.ts` | Create — unit tests for the five new store actions (undo entries + selection tracking) |
| `e2e/timeline-actions.spec.ts` | Create — end-to-end coverage of the new UI |

---

### Task 1: Registry — `defaults()` on every descriptor

**Files:**
- Modify: `lib/editor/registry.ts`
- Test: `tests/unit/registry-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/registry-defaults.test.ts`:

```ts
import { expect, test } from "vitest";
import { descriptorFor, REGISTRY } from "@/lib/editor/registry";

test("every REGISTRY kind has a defaults() producing an action of that kind", () => {
  for (const kind of Object.keys(REGISTRY)) {
    const action = descriptorFor({ kind } as never).defaults();
    expect(action.kind).toBe(kind);
  }
});

test("text defaults match the existing newBeat() default line", () => {
  const a = descriptorFor({ kind: "text" } as never).defaults();
  expect(a).toMatchObject({ kind: "text", value: "New line", in: "fade" });
});

test("wait defaults to a positive duration", () => {
  const a = descriptorFor({ kind: "wait" } as never).defaults() as { kind: "wait"; ms: number };
  expect(a.ms).toBeGreaterThan(0);
});

test("note_emitter defaults satisfy its required fields", () => {
  const a = descriptorFor({ kind: "note_emitter" } as never).defaults() as {
    kind: "note_emitter"; color: string; pos: { x: number; y: number }; dir: number; decay: number; freq: number;
  };
  expect(typeof a.color).toBe("string");
  expect(a.pos).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  expect(typeof a.dir).toBe("number");
  expect(typeof a.decay).toBe("number");
  expect(typeof a.freq).toBe("number");
});

test("media and media_move defaults include required id + point fields", () => {
  const media = descriptorFor({ kind: "media" } as never).defaults() as { kind: "media"; id: string; pos: { x: number; y: number } };
  expect(typeof media.id).toBe("string");
  expect(media.pos).toBeDefined();
  const move = descriptorFor({ kind: "media_move" } as never).defaults() as { kind: "media_move"; id: string; to: { x: number; y: number } };
  expect(typeof move.id).toBe("string");
  expect(move.to).toBeDefined();
});

test("GENERIC fallback still resolves (defaults() is unreachable from the UI but must not throw)", () => {
  expect(() => descriptorFor({ kind: "stop_notes" } as never).defaults()).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/registry-defaults.test.ts`
Expected: FAIL — `defaults is not a function` (the field doesn't exist on `EffectDescriptor` yet).

- [ ] **Step 3: Widen the interface and implement `defaults()` for every entry**

In `lib/editor/registry.ts`, change the interface (line 5):

```ts
export interface EffectDescriptor { kind: string; label: string; icon: string; schema: Field[]; seekable: boolean; defaults(): Action; }
```

Add a `defaults` field to every `REGISTRY` entry. Full replacement of the `REGISTRY` object (lines 12–77):

```ts
export const REGISTRY: Record<string, EffectDescriptor> = {
  text: { kind: "text", label: "Text", icon: "ti-text-caption", seekable: true, schema: [
    { key: "value", label: "Value", type: "textarea" },
    { key: "in", label: "Effect", type: "select", options: TEXT_INS.map((v) => ({ value: v, label: v })) },
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
    { key: "align", label: "Align", type: "select", options: opts("left", "center", "right") },
    { key: "speed", label: "Speed", type: "range", min: 0.2, max: 3, step: 0.1 },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
  ], defaults: () => ({ kind: "text", value: "New line", in: "fade" }) },
  wait: { kind: "wait", label: "Wait", icon: "ti-clock", seekable: true, schema: [{ key: "ms", label: "Milliseconds", type: "number", min: 0, step: 50 }],
    defaults: () => ({ kind: "wait", ms: 500 }) },
  art: { kind: "art", label: "Art", icon: "ti-photo", seekable: true, schema: [
    { key: "art.to", label: "Panel(s)", type: "text" },
    { key: "art.mode", label: "Transition", type: "select", options: ART_MODES.map((v) => ({ value: v, label: v })) },
    { key: "art.durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ], defaults: () => ({ kind: "art", art: { to: "1.01", mode: "fade" } }) },
  nightlight: { kind: "nightlight", label: "Nightlight", icon: "ti-moon", seekable: true, schema: [
    { key: "to", label: "Level (0-1)", type: "range", min: 0, max: 1, step: 0.05 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ], defaults: () => ({ kind: "nightlight", to: 0.5 }) },
  click_gate: { kind: "click_gate", label: "Click gate", icon: "ti-hand-click", seekable: true, schema: [],
    defaults: () => ({ kind: "click_gate" }) },
  clear: { kind: "clear", label: "Clear", icon: "ti-eraser", seekable: true, schema: [],
    defaults: () => ({ kind: "clear" }) },
  fade_out: { kind: "fade_out", label: "Fade out", icon: "ti-square-rounded-x", seekable: true, schema: [{ key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 }],
    defaults: () => ({ kind: "fade_out", durationMs: 500 }) },
  note_emitter: { kind: "note_emitter", label: "Note emitter", icon: "ti-music", seekable: false, schema: [
    { key: "color", label: "Color", type: "text" },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "freq", label: "Notes/sec", type: "number", min: 0, step: 0.5 },
  ], defaults: () => ({ kind: "note_emitter", color: "#ffffff", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1, freq: 2 }) },
  rotateList: { kind: "rotateList", label: "Rotating list", icon: "ti-list", seekable: true, schema: [
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
  ], defaults: () => ({ kind: "rotateList", items: ["Item 1", "Item 2"] }) },
  counter_show: { kind: "counter_show", label: "Counter (show)", icon: "ti-number", seekable: true, schema: [
    { key: "prefix", label: "Prefix", type: "text" },
    { key: "label", label: "Label", type: "text" },
    { key: "value", label: "Start value", type: "number", step: 1 },
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
  ], defaults: () => ({ kind: "counter_show", pos: { x: 0.5, y: 0.5 }, value: 0 }) },
  counter_to: { kind: "counter_to", label: "Counter → value", icon: "ti-number", seekable: true, schema: [
    { key: "value", label: "Target value", type: "number", step: 1 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ], defaults: () => ({ kind: "counter_to", value: 100, durationMs: 800 }) },
  counter_add: { kind: "counter_add", label: "Counter +/−", icon: "ti-number", seekable: true, schema: [
    { key: "delta", label: "Delta", type: "number", step: 1 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ], defaults: () => ({ kind: "counter_add", delta: 1, durationMs: 800 }) },
  media: { kind: "media", label: "Media tile", icon: "ti-photo", seekable: true, schema: [
    { key: "id", label: "Tile id", type: "text" },
    { key: "src", label: "Source", type: "text" },
    { key: "label", label: "Placeholder label", type: "text" },
    { key: "width", label: "Width (0–1)", type: "range", min: 0.05, max: 0.6, step: 0.01 },
    { key: "in", label: "Reveal", type: "select", options: MEDIA_INS.map((v) => ({ value: v, label: v })) },
    { key: "round", label: "Round (headshot)", type: "checkbox" },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
  ], defaults: () => ({ kind: "media", id: "m-1", pos: { x: 0.5, y: 0.5 } }) },
  media_move: { kind: "media_move", label: "Media move", icon: "ti-arrows-move", seekable: true, schema: [
    { key: "id", label: "Tile id", type: "text" },
    { key: "scale", label: "Scale", type: "range", min: 0.2, max: 3, step: 0.1 },
    { key: "to.x", label: "To X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "to.y", label: "To Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ], defaults: () => ({ kind: "media_move", id: "m-1", to: { x: 0.5, y: 0.5 } }) },
};
```

And update `GENERIC` (line 79) to add a stub `defaults()` — unreachable from the kind-picker UI (which only lists `REGISTRY` kinds) but must exist to satisfy the widened interface:

```ts
const GENERIC = (kind: string): EffectDescriptor => ({
  kind, label: kind, icon: "ti-square", seekable: kind !== "note_circle" && kind !== "cue", schema: [],
  defaults: () => ({ kind }) as Action,
});
```

Add `Action` to the existing type import at the top of the file (line 1 currently reads
`import type { Action, TextIn } from "@/engine/deck/types";` — `Action` is already imported, no change needed there).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/registry-defaults.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full existing unit suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS — `registry.test.ts` and `registry-richer.test.ts` still pass unchanged (they don't reference `defaults`).

- [ ] **Step 6: Commit**

```bash
git add lib/editor/registry.ts tests/unit/registry-defaults.test.ts
git commit -m "feat(editor): add defaults() to every effect descriptor"
```

---

### Task 2: Mutations — pure action-CRUD functions

**Files:**
- Modify: `lib/editor/mutations.ts`
- Test: `tests/unit/action-mutations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/action-mutations.test.ts`:

```ts
import { expect, test } from "vitest";
import { insertActionAfter, duplicateActionAt, deleteActionAt, moveActionBy, convertActionKind } from "@/lib/editor/mutations";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [
    { id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }, { kind: "wait", ms: 100 }, { kind: "clear" }] },
    { id: "b", timeline: [] },
  ] },
] });

test("insertActionAfter inserts after the given action index", () => {
  const d = insertActionAfter(base(), 0, 0, "wait");         // beat "a", after action 0
  expect(d.scenes[0].beats[0].timeline.map((a) => a.kind)).toEqual(["text", "wait", "wait", "clear"]);
});

test("insertActionAfter with actionIdx null appends to the end", () => {
  const d = insertActionAfter(base(), 0, null, "clear");
  expect(d.scenes[0].beats[0].timeline.map((a) => a.kind)).toEqual(["text", "wait", "clear", "clear"]);
});

test("insertActionAfter into an empty beat's timeline (append-only case)", () => {
  const d = insertActionAfter(base(), 1, null, "text");      // beat "b", empty timeline
  expect(d.scenes[0].beats[1].timeline.map((a) => a.kind)).toEqual(["text"]);
});

test("duplicateActionAt deep-clones with independence from the original", () => {
  const d = duplicateActionAt(base(), 0, 0);                 // dup the text action
  expect(d.scenes[0].beats[0].timeline.map((a) => a.kind)).toEqual(["text", "text", "wait", "clear"]);
  const copy = d.scenes[0].beats[0].timeline[1] as { kind: "text"; value: string };
  copy.value = "mutated";
  expect((d.scenes[0].beats[0].timeline[0] as { value: string }).value).toBe("A"); // original untouched
});

test("deleteActionAt removes the targeted action; empty timeline is valid", () => {
  const d = deleteActionAt(base(), 0, 1);                    // remove "wait"
  expect(d.scenes[0].beats[0].timeline.map((a) => a.kind)).toEqual(["text", "clear"]);
  const emptied = deleteActionAt(deleteActionAt(deleteActionAt(base(), 0, 0), 0, 0), 0, 0);
  expect(emptied.scenes[0].beats[0].timeline).toEqual([]);
});

test("moveActionBy swaps with a neighbor; no-ops at either boundary (same doc reference)", () => {
  const d = moveActionBy(base(), 0, 0, 1);                   // "text" swaps with "wait"
  expect(d.scenes[0].beats[0].timeline.map((a) => a.kind)).toEqual(["wait", "text", "clear"]);

  const start = base();
  expect(moveActionBy(start, 0, 0, -1)).toBe(start);         // first action, dir -1 → no-op
  const end = base();
  expect(moveActionBy(end, 0, 2, 1)).toBe(end);              // last action, dir +1 → no-op
});

test("convertActionKind fully replaces the action with the new kind's defaults", () => {
  const d = convertActionKind(base(), 0, 0, "wait");         // text → wait
  expect(d.scenes[0].beats[0].timeline[0]).toMatchObject({ kind: "wait", ms: 500 });
  expect(d.scenes[0].beats[0].timeline.length).toBe(3);      // no other actions touched
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/action-mutations.test.ts`
Expected: FAIL — the five functions don't exist yet (`insertActionAfter is not a function`, etc).

- [ ] **Step 3: Implement the mutations**

In `lib/editor/mutations.ts`, add the `descriptorFor` import to the top (line 1 area):

```ts
import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat, Scene, Action } from "@/engine/deck/types";
import { beatLocation } from "./flatten-beats";
import { descriptorFor } from "./registry";
```

Add a `mapBeat` helper right after the existing `mapScene` helper (after line 23), and the five new mutations at the end of the file (after `deleteSceneAt`):

```ts
/** Resolve `flatIdx` to a beat and apply `f`. If `f` returns the SAME beat reference
 *  (a mutation's own no-op case), the whole doc is returned unchanged (same reference) —
 *  mirrors moveBeatBy's boundary no-op contract so commit() records no history entry. */
function mapBeat(doc: DeckDoc, flatIdx: number, f: (b: Beat) => Beat): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const beat = doc.scenes[loc.sceneIdx].beats[loc.beatIdx];
  const next = f(beat);
  if (next === beat) return doc;
  return mapScene(doc, loc.sceneIdx, (s) => ({
    ...s,
    beats: s.beats.map((b, bi) => (bi === loc.beatIdx ? next : b)),
  }));
}

/** Insert a new action of `kind` after `actionIdx` (append to the end when `null`). */
export function insertActionAfter(doc: DeckDoc, flatIdx: number, actionIdx: number | null, kind: string): DeckDoc {
  return mapBeat(doc, flatIdx, (b) => {
    const action = descriptorFor({ kind } as Pick<Action, "kind">).defaults();
    const at = actionIdx == null ? b.timeline.length : actionIdx + 1;
    return { ...b, timeline: [...b.timeline.slice(0, at), action, ...b.timeline.slice(at)] };
  });
}

export function duplicateActionAt(doc: DeckDoc, flatIdx: number, actionIdx: number): DeckDoc {
  return mapBeat(doc, flatIdx, (b) => {
    if (actionIdx < 0 || actionIdx >= b.timeline.length) return b;
    const copy = JSON.parse(JSON.stringify(b.timeline[actionIdx])) as Action;
    return { ...b, timeline: [...b.timeline.slice(0, actionIdx + 1), copy, ...b.timeline.slice(actionIdx + 1)] };
  });
}

export function deleteActionAt(doc: DeckDoc, flatIdx: number, actionIdx: number): DeckDoc {
  return mapBeat(doc, flatIdx, (b) => {
    if (actionIdx < 0 || actionIdx >= b.timeline.length) return b;
    return { ...b, timeline: b.timeline.filter((_, i) => i !== actionIdx) };
  });
}

/** Swap an action with its neighbour WITHIN its beat's timeline. Boundary → no-op. */
export function moveActionBy(doc: DeckDoc, flatIdx: number, actionIdx: number, dir: -1 | 1): DeckDoc {
  return mapBeat(doc, flatIdx, (b) => {
    const target = actionIdx + dir;
    if (target < 0 || target >= b.timeline.length) return b;
    const next = b.timeline.slice();
    [next[actionIdx], next[target]] = [next[target], next[actionIdx]];
    return { ...b, timeline: next };
  });
}

/** Fully replace an action with `newKind`'s defaults (no field-preservation). */
export function convertActionKind(doc: DeckDoc, flatIdx: number, actionIdx: number, newKind: string): DeckDoc {
  return mapBeat(doc, flatIdx, (b) => {
    if (actionIdx < 0 || actionIdx >= b.timeline.length) return b;
    const action = descriptorFor({ kind: newKind } as Pick<Action, "kind">).defaults();
    return { ...b, timeline: b.timeline.map((a, i) => (i === actionIdx ? action : a)) };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/action-mutations.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — `mutations.test.ts` (existing beat mutations) unaffected since `mapBeat`/new exports don't change any existing function.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/mutations.ts tests/unit/action-mutations.test.ts
git commit -m "feat(editor): add pure mutations for action add/delete/move/dupe/convert"
```

---

### Task 3: Store — wire the five new editor actions

**Files:**
- Modify: `lib/editor/store.ts`
- Test: `tests/unit/store-action-edit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-action-edit.test.ts`:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "A", in: "fade" }, { kind: "wait", ms: 100 }] }] },
] });

beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null, past: [], future: [], revision: 0 }));

test("addAction inserts after selectedAction, selects the new one, and records one undo entry", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(0);
  s.addAction(0, 0, "wait");
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "wait", "wait"]);
  expect(st.selectedAction).toBe(1);
  expect(st.past.length).toBe(1);
});

test("addAction with no action selected appends to the end", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(null);
  s.addAction(0, null, "clear");
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "wait", "clear"]);
  expect(st.selectedAction).toBe(2);
});

test("duplicateAction keeps selectedAction pointed at the original index", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(0);
  s.duplicateAction(0, 0);
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "text", "wait"]);
  expect(st.selectedAction).toBe(0);
});

test("deleteAction clamps selectedAction to the new length, or null if the beat is now empty", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(1);
  s.deleteAction(0, 1);                                      // delete "wait" (the last action)
  expect(useEditor.getState().selectedAction).toBe(0);        // clamped to the new last index

  s.deleteAction(0, 0);                                       // delete the remaining "text" → empty
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("moveAction moves selectedAction along with the action", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(0);
  s.moveAction(0, 0, 1);                                       // "text" swaps down
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline.map((a) => a.kind)).toEqual(["wait", "text"]);
  expect(st.selectedAction).toBe(1);
});

test("convertAction replaces the kind and keeps the same index selected", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(0);
  s.convertAction(0, 0, "wait");
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline[0]).toMatchObject({ kind: "wait" });
  expect(st.selectedAction).toBe(0);
});

test("each op is one undo entry and undo restores the prior timeline exactly", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.addAction(0, 0, "clear");
  expect(useEditor.getState().past.length).toBe(1);
  useEditor.getState().undo();
  expect(useEditor.getState().beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "wait"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/store-action-edit.test.ts`
Expected: FAIL — `s.addAction is not a function` (and the other four).

- [ ] **Step 3: Implement the store actions**

In `lib/editor/store.ts`, update the import (line 5) to pull in the new mutations:

```ts
import { insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy, appendScene, deleteSceneAt, insertActionAfter, duplicateActionAt, deleteActionAt, moveActionBy, convertActionKind } from "./mutations";
```

Add the five new method signatures to the `EditorState` interface (after `deleteScene: (flatIdx: number) => void;` at line 29):

```ts
  addAction: (flatIdx: number, actionIdx: number | null, kind: string) => void;
  duplicateAction: (flatIdx: number, actionIdx: number) => void;
  deleteAction: (flatIdx: number, actionIdx: number) => void;
  moveAction: (flatIdx: number, actionIdx: number, dir: -1 | 1) => void;
  convertAction: (flatIdx: number, actionIdx: number, newKind: string) => void;
```

Add the five implementations to the store body (after `deleteScene` at line 109, before the closing `}));`):

```ts
  addAction: (flatIdx, actionIdx, kind) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => insertActionAfter(doc, flatIdx, actionIdx, kind));
    if (!part.doc) return {};
    return { ...part, selectedAction: actionIdx == null ? part.doc.scenes.flatMap((sc) => sc.beats)[0] ? undefined : undefined : actionIdx + 1 };
  }),
```

**Note before continuing:** the line above is intentionally *not* the final implementation — computing "new action's index" needs the beat's timeline length, not scene-flattening gymnastics. Replace it with the corrected version below (this is what should actually be written to the file):

```ts
  addAction: (flatIdx, actionIdx, kind) => set((s) => {
    if (!s.doc) return {};
    const loc = beatLocation(s.doc, flatIdx);
    if (!loc) return {};
    const currentLen = s.doc.scenes[loc.sceneIdx].beats[loc.beatIdx].timeline.length;
    const newIdx = actionIdx == null ? currentLen : actionIdx + 1;
    const part = commit(s, (doc) => insertActionAfter(doc, flatIdx, actionIdx, kind));
    if (!part.doc) return {};
    return { ...part, selectedAction: newIdx };
  }),
  duplicateAction: (flatIdx, actionIdx) => set((s) => commit(s, (doc) => duplicateActionAt(doc, flatIdx, actionIdx))),
  deleteAction: (flatIdx, actionIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => deleteActionAt(doc, flatIdx, actionIdx));
    if (!part.doc) return {};
    const loc = beatLocation(part.doc, flatIdx);
    const newLen = loc ? part.doc.scenes[loc.sceneIdx].beats[loc.beatIdx].timeline.length : 0;
    return { ...part, selectedAction: newLen === 0 ? null : Math.min(actionIdx, newLen - 1) };
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
```

Discard the first (placeholder) `addAction` snippet above — only the corrected version and the four functions after it should end up in the file. The final `addAction` must clamp using the beat's timeline length *before* the mutation runs (since `insertActionAfter`'s insertion point is `actionIdx == null ? length : actionIdx + 1`, which is exactly `newIdx`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/store-action-edit.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — all existing store tests (`store.test.ts`, `store-edit.test.ts`, `store-history.test.ts`, `store-meta.test.ts`, `deck-store.test.ts`) still pass; `beatLocation` is already imported in store.ts (line 3) so no new import needed for it.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/store.ts tests/unit/store-action-edit.test.ts
git commit -m "feat(editor): wire action add/delete/move/dupe/convert into the store"
```

---

### Task 4: Timeline UI — reorder/delete/dupe buttons + add-action picker

**Files:**
- Modify: `components/editor/Timeline.tsx`

- [ ] **Step 1: Implement the UI**

Replace the full contents of `components/editor/Timeline.tsx`:

```tsx
"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { CanvasHandle } from "./DeckCanvas";
import { actionDuration } from "@/engine/authoring/seek";
import { REGISTRY } from "@/lib/editor/registry";

const ADD_KIND_OPTIONS = Object.values(REGISTRY).map((d) => ({ value: d.kind, label: d.label }));

export function Timeline({ canvasRef, time }: { canvasRef: RefObject<CanvasHandle | null>; time: { t: number; duration: number } }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const selectAction = useEditor((s) => s.selectAction);
  const addAction = useEditor((s) => s.addAction);
  const duplicateAction = useEditor((s) => s.duplicateAction);
  const deleteAction = useEditor((s) => s.deleteAction);
  const moveAction = useEditor((s) => s.moveAction);
  const timeline = beats[selected]?.beat.timeline ?? [];
  return (
    <div className="ed__timeline" data-testid="timeline">
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <button className="ed__pill ed__pill--ghost" onClick={() => canvasRef.current?.play()}>&#9654; Play</button>
        <button className="ed__pill ed__pill--ghost" onClick={() => canvasRef.current?.pause()}>&#9646;&#9646; Pause</button>
        <span style={{ fontFamily: "var(--ed-mono)", fontSize: 12, color: "var(--ed-fg-muted)", alignSelf: "center" }}>
          {time.t.toFixed(2)}s / {time.duration.toFixed(2)}s
        </span>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {timeline.map((a, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center" }}>
            <button className="ed__chip" onClick={() => selectAction(i)} aria-current={i === selectedAction ? "true" : undefined}>
              {a.kind}{a.kind === "text" ? `:${a.in}` : ""}{a.kind === "wait" ? ` ${a.ms}ms` : ""}{" "}
              <span style={{ color: "var(--ed-fg-muted)" }}>({actionDuration(a).toFixed(1)}s)</span>
            </button>
            {i === selectedAction && (
              <span style={{ display: "flex", gap: 2, paddingLeft: 2 }}>
                <button className="ed__icon" title="Move up" data-testid="action-up" onClick={() => moveAction(selected, i, -1)}>↑</button>
                <button className="ed__icon" title="Move down" data-testid="action-down" onClick={() => moveAction(selected, i, 1)}>↓</button>
                <button className="ed__icon" title="Duplicate" data-testid="action-dupe" onClick={() => duplicateAction(selected, i)}>⧉</button>
                <button className="ed__icon" title="Delete" data-testid="action-delete" onClick={() => deleteAction(selected, i)}>✕</button>
              </span>
            )}
          </span>
        ))}
        {!timeline.length && <span style={{ color: "var(--ed-fg-muted)" }}>empty beat</span>}
        <select
          data-testid="action-add"
          value=""
          onChange={(e) => { if (e.target.value) addAction(selected, selectedAction, e.target.value); }}
          style={{ fontSize: 12 }}
        >
          <option value="">＋ Add action…</option>
          {ADD_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <input type="range" min={0} max={time.duration || 0} step={0.01} value={time.t}
        onChange={(e) => canvasRef.current?.seek(parseFloat(e.target.value))} style={{ width: "100%" }} data-testid="scrub" />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors reported for `Timeline.tsx`.

- [ ] **Step 3: Run the full unit suite (regression check — no unit tests target this file directly)**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add components/editor/Timeline.tsx
git commit -m "feat(editor): add reorder/delete/dupe buttons and an add-action picker to Timeline"
```

---

### Task 5: Inspector UI — convert-kind picker

**Files:**
- Modify: `components/editor/Inspector.tsx`

- [ ] **Step 1: Implement the UI**

Replace the full contents of `components/editor/Inspector.tsx`:

```tsx
"use client";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor, REGISTRY } from "@/lib/editor/registry";
import { getPath } from "@/lib/editor/paths";
import { Field } from "./Field";

const CONVERT_KIND_OPTIONS = Object.values(REGISTRY).map((d) => ({ value: d.kind, label: d.label }));

export function Inspector() {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const updateAction = useEditor((s) => s.updateAction);
  const convertAction = useEditor((s) => s.convertAction);
  const action = selectedAction != null ? beats[selected]?.beat.timeline[selectedAction] : undefined;
  if (!action) return <div className="ed__inspector" data-testid="inspector"><p style={{ opacity: 0.6 }}>Select an action to edit.</p></div>;
  const d = descriptorFor(action);
  return (
    <div className="ed__inspector" data-testid="inspector">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
        <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14 }}>{d.label} action</div>
        <select
          data-testid="action-convert"
          value={action.kind}
          onChange={(e) => { if (e.target.value !== action.kind) convertAction(selected, selectedAction!, e.target.value); }}
          style={{ fontSize: 12 }}
        >
          {CONVERT_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {d.schema.length === 0 && <p style={{ opacity: 0.6, fontSize: 12 }}>No editable fields.</p>}
      {d.schema.map((f) => (
        <Field key={f.key} spec={f} value={getPath(action, f.key)} onChange={(v) => updateAction(selected, selectedAction!, f.key, v)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors reported for `Inspector.tsx`.

- [ ] **Step 3: Run the full unit suite (regression check)**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add components/editor/Inspector.tsx
git commit -m "feat(editor): add a convert-kind picker to the Inspector"
```

---

### Task 6: End-to-end coverage

**Files:**
- Create: `e2e/timeline-actions.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `e2e/timeline-actions.spec.ts`, following the seeding/navigation pattern in `e2e/structural.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("add / reorder / duplicate / convert / delete actions on the timeline, and undo restores", async ({ page, request }) => {
  const id = "e2e-timeline-actions";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Timeline Actions" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }, { kind: "wait", ms: 100 }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Timeline Actions" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const timeline = page.getByTestId("timeline");
  await expect(timeline.locator(".ed__chip")).toHaveCount(2);

  // Add: select the "wait" chip, add a "Clear" action after it.
  await timeline.locator(".ed__chip").nth(1).click();
  await page.getByTestId("action-add").selectOption("clear");
  await expect(timeline.locator(".ed__chip")).toHaveCount(3);
  await expect(timeline.locator(".ed__chip").nth(2)).toContainText("clear");

  // Reorder: move the new "clear" chip up one slot (now at index 2, moves to index 1).
  await timeline.locator(".ed__chip").nth(2).click();
  await page.getByTestId("action-up").click();
  await expect(timeline.locator(".ed__chip").nth(1)).toContainText("clear");

  // Duplicate: duplicate the (now-selected) "clear" chip at index 1.
  await page.getByTestId("action-dupe").click();
  await expect(timeline.locator(".ed__chip")).toHaveCount(4);

  // Convert: convert the first chip ("text") to "wait" via the Inspector.
  await timeline.locator(".ed__chip").nth(0).click();
  await page.getByTestId("action-convert").selectOption("wait");
  await expect(timeline.locator(".ed__chip").nth(0)).toContainText("wait");

  // Delete: delete the now-selected (converted) chip.
  await timeline.locator(".ed__chip").nth(0).click();
  await page.getByTestId("action-delete").click();
  await expect(timeline.locator(".ed__chip")).toHaveCount(3);

  // Undo restores the prior state.
  await page.getByTestId("undo").click();
  await expect(timeline.locator(".ed__chip")).toHaveCount(4);

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 2: Run the e2e test in isolation**

Run: `CI=1 npx playwright test e2e/timeline-actions.spec.ts --workers=1`
Expected: PASS. (Per the north-star doc §15, the reliable e2e invocation today is `--workers=1` due to shared-data-dir contention between the two dev servers — unrelated to this change, just the existing house convention for running the suite.)

- [ ] **Step 3: Run the full e2e suite to confirm no regressions**

Run: `CI=1 npm run test:e2e -- --workers=1`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add e2e/timeline-actions.spec.ts
git commit -m "test(e2e): cover timeline action add/reorder/dupe/convert/delete"
```

---

## Plan Self-Review

**Spec coverage:**
- Add action (kind picker) → Task 4 (`action-add` select) + Task 2/3 (`insertActionAfter`/`addAction`). ✅
- Delete action → Task 4 (`action-delete`) + Task 2/3 (`deleteActionAt`/`deleteAction`, selection clamping). ✅
- Reorder (↑/↓) → Task 4 (`action-up`/`action-down`) + Task 2/3 (`moveActionBy`/`moveAction`). ✅
- Duplicate → Task 4 (`action-dupe`) + Task 2/3 (`duplicateActionAt`/`duplicateAction`). ✅
- Convert-kind → Task 5 (`action-convert`) + Task 2/3 (`convertActionKind`/`convertAction`). ✅
- `defaults()` on `EffectDescriptor` per north-star §11 shape → Task 1. ✅
- REGISTRY-only kind scope → `ADD_KIND_OPTIONS`/`CONVERT_KIND_OPTIONS` both derive from `REGISTRY`, never the full `Action` union. ✅
- One undo entry per op → all five store actions route through `commit()`. ✅ (verified in Task 3's test file)
- e2e coverage → Task 6. ✅

**Placeholder scan:** none — every step has literal code, exact commands, and expected output. (Task 3 Step 3 includes a deliberate "wrong then corrected" pair because the naive first draft is genuinely broken; the final file only contains the corrected block, which is spelled out in full.)

**Type consistency:** `flatIdx`/`actionIdx` naming and signatures are identical across mutations.ts (Task 2), store.ts (Task 3), and both UI files (Tasks 4–5). `descriptorFor`/`REGISTRY` imports match registry.ts's actual exports (verified against the current file). `selectedAction`/`selected` field names match the existing `EditorState` interface in store.ts.
