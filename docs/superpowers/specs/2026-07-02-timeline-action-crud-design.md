# Timeline Action CRUD — Design Spec

- **Date:** 2026-07-02
- **Status:** Approved (brainstormed with Claude)
- **Tier:** 1.5 — Hardening
- **Parent doc:** [`2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md), §5 (Timeline UX), §16 (roadmap)

## 1. Purpose

The per-beat timeline today ([`components/editor/Timeline.tsx`](../../../components/editor/Timeline.tsx))
renders actions as read-only chips. This slice makes the timeline an **editable track**: add,
delete, reorder, duplicate, and convert-kind for actions within a beat — "completes the v1
timeline promised in design §6.5" (north-star §5).

This also matters beyond finishing v1: §12 of the north-star doc states the AI assistant's tool
surface is *generated from the mutation API*, and explicitly calls out that `add_action`/
`delete_action`/`convert_action` "map onto mutations that don't exist yet" — i.e. this slice is a
hard prerequisite for the Tier 3 AI assistant, not just editor polish.

## 2. Scope

**In scope:**
- Add an action (via a kind picker) into a beat's timeline.
- Delete an action.
- Reorder an action up/down within its beat (swap with neighbor).
- Duplicate an action.
- Convert an action's kind (full replace with the new kind's defaults).

Restricted to the 12 kinds currently defined in `REGISTRY` ([`lib/editor/registry.ts`](../../../lib/editor/registry.ts)):
`text`, `wait`, `art`, `nightlight`, `click_gate`, `clear`, `fade_out`, `note_emitter`,
`rotateList`, `counter_show`, `counter_to`, `counter_add`, `media`, `media_move`.

**Explicitly out of scope** (Tier 2 per north-star §5):
- Click-gate divider visualization, segment grouping.
- Drag-and-drop reorder (this slice uses ↑/↓ buttons).
- Drag-resize `wait` durations.
- Keyframe/curve editing.
- Adding schemas for the currently-unregistered Action kinds (`note_circle`, `cue`, `stop_notes`,
  `stop_circle`, `reveal_arrows`, `pulse_arrow`, `counter_hide`, `media_out`, `reveal_again`) —
  these remain reachable only via pre-existing data, not via the new picker.
- Field-preserving convert (this slice fully replaces the action with the target kind's defaults).

## 3. Design decisions

These were resolved during brainstorming; recorded here so the plan doesn't re-litigate them.

| Decision | Resolution | Why |
| --- | --- | --- |
| Convert-kind in this slice? | **Yes**, despite north-star §3/§5 tabling it as Tier 2 | §12 lists `convert_action` as a required AI tool alongside `add_action`/`delete_action`; building it alongside the rest now avoids revisiting this exact code later. |
| Reorder mechanism | **↑/↓ buttons**, not drag-and-drop | Matches Filmstrip's existing beat-reorder pattern exactly; keeps this a "no new architecture" hardening slice. Drag can be layered on in Tier 2 without changing the underlying mutation. |
| Kind-picker scope | **REGISTRY kinds only** (12 kinds) | Every kind offered is immediately editable in the Inspector. Unregistered kinds have no schema and would land with zero editable fields — a confusing first-run experience. |
| Per-kind defaults location | **`defaults(): Action` added to `EffectDescriptor`** in registry.ts | Matches the exact end-state descriptor shape in north-star §11 (which adds `defaults`, `duration`, `validators`, `aiHints` over time). Tier 2 widens the same interface further instead of reconciling a second defaults table. |
| Convert semantics | **Full replace** with `descriptorFor(newKind).defaults()` | Simple, predictable, no field-mapping/merge logic. The action is already selected/editable in the Inspector to re-set values. |
| Kind-picker UI | **Native `<select>`** | Matches Field.tsx's existing enum-field pattern and the editor's plain-HTML-controls style; no new UI primitive (no modal/popover exists anywhere in the editor today). |
| Add position | **After the selected action; append if none selected** | Mirrors `insertBeatAfter`'s semantics — natural "build the sequence where I'm looking" behavior. |

## 4. Architecture

### 4.1 Registry ([`lib/editor/registry.ts`](../../../lib/editor/registry.ts))

Widen `EffectDescriptor`:

```ts
export interface EffectDescriptor {
  kind: string; label: string; icon: string; schema: Field[]; seekable: boolean;
  defaults(): Action;   // NEW
}
```

Add one `defaults()` implementation per REGISTRY entry, returning a minimal valid `Action` of
that kind (e.g. `text: () => ({ kind: "text", value: "New line", in: "fade" })`,
`wait: () => ({ kind: "wait", ms: 500 })`). `GENERIC(kind)` (the fallback for unregistered kinds)
does not need a meaningful `defaults()` since the kind picker never offers those kinds — a
`throw`-free stub (e.g. returning `{ kind } as Action`) is sufficient since it's unreachable from
the new UI.

### 4.2 Mutations ([`lib/editor/mutations.ts`](../../../lib/editor/mutations.ts))

Pure functions, same shape and conventions as the existing beat mutations (`insertBeatAfter`,
`duplicateBeatAt`, `deleteBeatAt`, `moveBeatBy`) — take `(doc, ...)`, return a new `DeckDoc`, use
`beatLocation` to resolve the flat beat index, no-op (return `doc` unchanged) on invalid input:

- `insertActionAfter(doc: DeckDoc, beatIdx: number, actionIdx: number | null, kind: string): DeckDoc`
  — inserts `descriptorFor(kind).defaults()` into the beat's timeline after `actionIdx`;
  `actionIdx === null` appends at the end.
- `duplicateActionAt(doc: DeckDoc, beatIdx: number, actionIdx: number): DeckDoc` — deep-clones
  (`JSON.parse(JSON.stringify(...))`, matching `duplicateBeatAt`'s approach) and inserts after itself.
- `deleteActionAt(doc: DeckDoc, beatIdx: number, actionIdx: number): DeckDoc` — removes it; an
  empty resulting timeline is valid (Timeline.tsx already renders "empty beat" for `[]`).
- `moveActionBy(doc: DeckDoc, beatIdx: number, actionIdx: number, dir: -1 | 1): DeckDoc` — swaps
  with the neighbor at `actionIdx + dir` within the same beat's timeline; out-of-bounds → no-op.
- `convertActionKind(doc: DeckDoc, beatIdx: number, actionIdx: number, newKind: string): DeckDoc`
  — replaces the action at `actionIdx` with `descriptorFor(newKind).defaults()`.

### 4.3 Store ([`lib/editor/store.ts`](../../../lib/editor/store.ts))

New store actions, each a thin wrapper calling the mutation through `commit()` (so each op is
exactly one undo/redo entry, for free — no new history logic needed):

- `addAction(beatIdx, actionIdx, kind)`
- `duplicateAction(beatIdx, actionIdx)`
- `deleteAction(beatIdx, actionIdx)`
- `moveAction(beatIdx, actionIdx, dir)`
- `convertAction(beatIdx, actionIdx, newKind)`

Selection bookkeeping (mirrors existing beat-selection patterns):
- `deleteAction`: after delete, clamp `selectedAction` to the new timeline length (`null` if the
  beat is now empty), same pattern as `deleteBeat` clamping `selected`.
- `moveAction`: `selectedAction` follows the moved action to its new index, same pattern as
  `moveBeat` setting `selected: flatIdx + dir`.
- `duplicateAction` / `convertAction`: `selectedAction` stays pointed at the same index (the
  duplicate is inserted *after* the original, so the original's index is unchanged; convert
  replaces in place).
- `addAction`: selects the newly inserted action (consistent with wanting to immediately edit it
  in the Inspector).

### 4.4 UI

**Timeline.tsx** — extend the existing chip row:
- The selected chip grows a row of icon buttons, matching Filmstrip's "icons appear only on the
  selected item" pattern and its exact button styling (`ed__icon` class): `↑` `↓` `⧉` `✕`, wired
  to `moveAction(-1)`, `moveAction(1)`, `duplicateAction`, `deleteAction`. `data-testid`s follow
  the existing `beat-*` naming convention: `action-up`, `action-down`, `action-dupe`,
  `action-delete`.
- A trailing native `<select>` appended after the chip row lists the 12 REGISTRY kinds by
  `label`; its `onChange` calls `addAction(selected, selectedAction, kind)` then resets to a
  placeholder option. `data-testid="action-add"`.

**Inspector.tsx** — add a "Convert to" native `<select>` next to the existing "`{label}` action"
heading, pre-selected to the action's current kind, listing the same 12 REGISTRY kinds.
`onChange` calls `convertAction(selected, selectedAction, newKind)`. `data-testid="action-convert"`.

No changes to `DeckCanvas.tsx`, `seek.ts`, or `Field.tsx` — this slice only adds/wires new
mutations and their UI triggers; it doesn't touch rendering/seeking.

## 5. Testing

Following existing conventions (no new test infrastructure):

- **`tests/unit/mutations.test.ts`** — pure-function tests for the five new mutations: normal
  case, boundary/no-op cases (delete last action → empty timeline; move at either boundary;
  convert to the same kind; insert with `actionIdx: null`).
- **`tests/unit/store-edit.test.ts`** — store-level tests: each op produces exactly one undo
  entry (`past.length` grows by 1, `future` clears); selection-tracking behavior for delete/move/
  add as specified in §4.3; undo restores the prior timeline exactly.
- **`e2e/editor.spec.ts`** — add coverage for the new `data-testid`s (`action-up`, `action-down`,
  `action-dupe`, `action-delete`, `action-add`, `action-convert`) exercising one full add →
  reorder → duplicate → convert → delete flow through the real UI.

## 6. Non-goals / deferred

Everything in north-star §5's Tier 2 list (gate viz, segment grouping, drag-resize waits,
keyframe/curve editing) and drag-and-drop reorder specifically. Also deferred: extending
`REGISTRY` to cover the remaining ~9 unregistered Action kinds — that's a separate, orthogonal
follow-up, not blocking this slice.
