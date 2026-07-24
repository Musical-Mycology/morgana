# Tier 1.5 Hardening Sweep — Scene Structural Editing, Lint Panel, Empty/Error States — Design Spec

- **Date:** 2026-07-24
- **Status:** Design spec (approved for planning)
- **Author of record:** Chris Oltyan (brainstormed with Claude)
- **Branch point:** `main` at `970ea48` (MCP server, PR #22, merged).
- **Companion docs:**
  - [`../../2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md) — north star. This spec closes the remainder of the **Tier 1.5 — Hardening** row of §16, and draws on §8 (validation), §13 (QoL), §6 (cross-scene move).
  - [`2026-07-23-morgana-mcp-server-design.md`](2026-07-23-morgana-mcp-server-design.md) — the MCP tool surface this spec extends for parity.
  - [`2026-07-02-timeline-action-crud-design.md`](2026-07-02-timeline-action-crud-design.md) — the prior structural-editing slice whose mutation/store/UI style this one follows.

---

## 0. Context — what is left of Tier 1.5

Tier 1.5 was defined in the end-state design §16 as "finish the v1 surface." Verified against `main`, most of it has shipped: timeline action CRUD, the deck switcher, in-app TS export, and e2e determinism + CI. Four items remain, and this spec covers all four in one branch:

| §16 item | State on `main` |
| --- | --- |
| Delete-scene button | `deleteScene` exists in the store ([`store.ts:145`](../../../lib/editor/store.ts)) and as the `delete_scene_at` MCP tool. **No UI.** |
| Scene reorder | **No mutation exists at all.** |
| Cross-scene beat move | `moveBeatBy` no-ops at a scene boundary by explicit v1 design ([`mutations.ts:72`](../../../lib/editor/mutations.ts)). |
| Surface the existing validators | `validateDeckDoc` runs server-side on PUT and in the MCP `mutate` wrapper; `validateDeck` is **dead code** — exported, never called. Neither is visible in the editor. |
| Onboarding / empty states + error handling | Load failure renders the bare string `couldn't load deck`; `Save failed` carries no reason and no retry; empty deck / scene / beat render as blank zones. |

### 0.1 A latent bug this sweep fixes

The filmstrip derives its scene groups from the **flat beat list** ([`Filmstrip.tsx:15`](../../../components/editor/Filmstrip.tsx)), so **a scene with no beats is invisible**. This is already reachable on `main`: `deleteBeat` on a scene's last beat leaves an orphaned scene in the document that cannot be selected, refilled, or deleted from the UI. Cross-scene move would make it reachable a second way.

The sweep resolves this by **allowing empty scenes and rendering them** (§1.2), rather than by pruning or blocking.

### 0.2 Explicitly out of scope

- **Tier-2 action-level lints** — dangling counter refs, missing media ids, gate-less infinite beats (end-state §8). The panel ships the *infrastructure*; those rules drop in later as pure data.
- **Widening `EffectDescriptor` with `validators?`** (end-state §11). Every rule in this sweep is structural or cross-action; none is per-descriptor. Deferred until a rule actually needs it.
- **A first-run tour overlay.** In-place empty-state guidance does the onboarding job for a single-user self-hosted tool.
- **Scene rename**, drag-reorder of beats or scenes, and filmstrip collapse/zoom — all Tier 2.
- **Deck format changes.** `DeckDoc.version` stays `1`; no new persisted fields.

---

## 1. Slice 1 — Scene structural editing

### 1.1 Pure mutations

All in [`lib/editor/mutations.ts`](../../../lib/editor/mutations.ts), following the existing `(doc, …) => DeckDoc` style with the no-op-returns-same-reference convention that `commit()` depends on.

| Function | Behavior |
| --- | --- |
| `moveSceneBy(doc, sceneIdx, dir)` | Swap a scene with its neighbour. No-op at either end. |
| `deleteSceneAtIndex(doc, sceneIdx)` | New primitive: drop `scenes[sceneIdx]`. No-op for an out-of-range index. |
| `appendBeatToScene(doc, sceneIdx)` | Append a fresh beat (via the existing `newBeat`/`uniqueBeatId` helpers) to a scene. **Required** because `insertBeatAfter` is flat-index keyed and therefore cannot address an empty scene. |
| `moveBeatBy(doc, flatIdx, dir)` | **Extended** — see §1.1.1. |

`deleteSceneAt(doc, flatIdx)` is retained unchanged in behavior, reimplemented as a one-line wrapper over `deleteSceneAtIndex` so the published `delete_scene_at` MCP tool keeps working exactly as documented.

#### 1.1.1 Cross-scene `moveBeatBy`

- **Within a scene:** swap with the neighbouring beat, as today.
- **At a scene boundary:** **transfer**, not swap.
  - `dir === -1` off a scene's head → remove from that scene, **append to the previous scene's tail**.
  - `dir === +1` off a scene's tail → remove from that scene, **prepend to the next scene's head**.
- **No-op only** at flat position 0 with `dir === -1`, and at the last flat position with `dir === +1`.
- The adjacent scene may be **empty**; transferring into it is correct and is the intended way to fill one.
- The source scene may be **left empty** by the transfer. That is allowed (§1.2) and is surfaced by the `scene-empty` lint (§2.2).

The resulting flat index of the moved beat is `flatIdx + dir` in every case — swap and transfer alike — because the flat list is the concatenation of scenes in order.

### 1.2 Empty scenes are legal and visible

The invariant "every scene has ≥1 beat" is **not** adopted. Instead:

- A new pure `sceneGroups(doc)` in [`lib/editor/flatten-beats.ts`](../../../lib/editor/flatten-beats.ts) iterates `doc.scenes` directly, so an empty scene yields `items: []`:

  ```ts
  export interface SceneGroup {
    sceneIdx: number;
    sceneId: string;
    items: { flatIdx: number; beatId: string }[];
  }
  export function sceneGroups(doc: DeckDoc): SceneGroup[]
  ```

  This replaces the inline grouping loop in `Filmstrip.tsx` and is unit-testable independently of React.
- The filmstrip renders every scene, empty or not, so nothing is ever unreachable.
- `flattenStory` emits no slide for an empty scene, so **playback and export are unaffected** — no engine change is needed.

### 1.3 Store actions

In [`lib/editor/store.ts`](../../../lib/editor/store.ts):

| Action | Note |
| --- | --- |
| `deleteScene(sceneIdx)` | **Re-keyed** from flat index to scene index. Safe: no UI calls it today, and the MCP path goes through the mutation layer, not the store. |
| `moveScene(sceneIdx, dir)` | New. |
| `addBeatToScene(sceneIdx)` | New. Selects the created beat. |
| `moveBeat(flatIdx, dir)` | Signature unchanged; selection follows the beat to `flatIdx + dir` across a boundary exactly as it does within a scene. |

**Selection policy for scene operations.** Preserve the selected **beat by identity**: capture the selected beat's id before the mutation and, after it, set `selected` to that beat's new flat index. If the beat no longer exists (its scene was deleted), clamp to `[0, beats.length - 1]`. In all cases clear `selectedAction`, `selectedObjectPaths`, and `enteredGroupPath`, matching the existing `deleteBeat`/`deleteScene` behavior.

The identity lookup is a small pure helper (`flatIndexOfBeat(doc, beatId)`) so it is unit-testable and reusable across the three scene actions.

### 1.4 Filmstrip UI

The scene header, today an inert `div.ed__lbl` holding the scene id, becomes a control row. Controls use the existing `ed__icon` button style — no new CSS system.

| Control | Test-id | Action |
| --- | --- | --- |
| ↑ | `scene-up` | `moveScene(sceneIdx, -1)` |
| ↓ | `scene-down` | `moveScene(sceneIdx, 1)` |
| ＋ | `scene-add-beat` | `addBeatToScene(sceneIdx)` |
| ✕ | `scene-delete` | `deleteScene(sceneIdx)` |

An empty scene renders a single muted row (`data-testid="scene-empty-row"`) reading "No beats" alongside the ＋ affordance.

Beat-level controls are unchanged, including their existing "visible only on the selected beat" behavior. Scene controls are always visible on every scene header — scene count is low, and hiding them behind selection would require a scene-selection concept that does not exist and is not worth introducing here.

**Decision — no confirm dialog on scene delete.** This matches the existing beat delete and the editor's general model, where undo (⌘Z, 50-step) is the safety net rather than modal confirmation. The AI path is different by design: end-state §12 gates *destructive AI operations* behind confirmation, and that asymmetry is deliberate — a human clicking ✕ has intent, an agent composing a turn may not.

### 1.5 MCP parity

The positioning invariant is that an agent can do what a user can do **and no more** (end-state principle #5). Since [`lib/mcp/tool-defs.ts`](../../../lib/mcp/tool-defs.ts) is a hand-maintained array, the new capabilities need explicit entries plus handler cases in [`lib/mcp/tool-handlers.ts`](../../../lib/mcp/tool-handlers.ts):

| Tool | Args | Note |
| --- | --- | --- |
| `move_scene_by` | `deck_id`, `scene_index`, `dir` | New. |
| `append_beat_to_scene` | `deck_id`, `scene_index` | New. |
| `delete_scene_at` | `deck_id`, `beat_index?`, `scene_index?` | **Extended.** Exactly one of `beat_index`/`scene_index` is required; supplying both or neither is an invalid-params error. `scene_index` makes empty scenes addressable. |
| `move_beat_by` | unchanged | **Behavior change** — now crosses scene boundaries. |

`move_beat_by`'s changed semantics are a behavior change to an already-published tool. Its tool-definition `description` string is updated, and the user-facing MCP section of [`README.md`](../../../README.md) is updated in the same commit. Every new tool is covered by the existing tool sweep test.

---

## 2. Slice 2 — Lint panel

### 2.1 The lint module

New pure module [`lib/editor/lint.ts`](../../../lib/editor/lint.ts) — no React, no I/O:

```ts
export type LintSeverity = "error" | "warning";
export interface LintLocation { sceneIdx: number; beatIdx?: number; actionIdx?: number }
export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  message: string;
  /** Absent = deck-level issue, not jumpable. */
  at?: LintLocation;
}
export function lintDeck(doc: DeckDoc): LintIssue[]
```

Issues are returned errors-first, then warnings, each group in document order.

### 2.2 The three sources

1. **`validateDeckDoc(doc).errors` → `severity: "error"`, `rule: "structure"`.**
   These are exactly the failures that cause the server to reject a PUT, so "error" means "this deck will not save." A small `parseDocPath(message)` helper reads the leading `scenes[i]`, `scenes[i].beats[j]`, or `scenes[i].beats[j].timeline[k]` prefix that these messages already carry into a `LintLocation`. Object-tree messages (`scenes[i].objects[j].id must match …`) match the `scenes[i]` prefix and therefore resolve to the scene — jumping to the scene is the correct granularity, since object selection is path-keyed rather than index-keyed and the Layers panel is the right place to continue. Messages with no parsable prefix (`version must be 1`, `meta.title required`) become deck-level issues with `at` undefined.

2. **`validateDeck(flattenStory(doc.scenes))` → `severity: "warning"`, `rule: "slide"`.**
   This retires the dead code. Slide ids are `` `${scene.id}.${beat.id}` `` ([`flatten.ts:21`](../../../engine/deck/flatten.ts)), so a message of the form `slide "intro.b2": …` resolves back to a `{ sceneIdx, beatIdx }` by lookup against the doc.
   **Guard:** this source runs **only when source 1 produced no errors**, wrapped in try/catch. `validateDeck` and `flattenStory` both assume a structurally valid document; running them on a malformed one risks a throw that would take the whole panel down. When source 1 is dirty, the panel shows the structural errors alone — which is the correct priority anyway, since nothing will save until they are fixed.

3. **New structural rules.** Exactly one: `scene-empty` → warning at `{ sceneIdx }`, message `scene "<id>" has no beats`. Empty *beats* need no new rule — `validateDeck` already emits `cinematic beat has no art and no timeline`.

### 2.3 The panel

`components/editor/LintPanel.tsx` becomes the fifth value of the existing `panel` enum in [`app/editor/page.tsx`](../../../app/editor/page.tsx) (`inspector | settings | export | mcp | lint`), reusing the established bottom-right panel slot and `togglePanel` pill pattern.

- Toolbar pill `lint-toggle`, labelled **Issues**, with a count badge (`data-testid="lint-count"`). The badge is hidden at zero, styled as an error when any error is present, otherwise muted.
- Panel container `lint-panel`; each row `lint-issue` carries `data-severity` and `data-rule`.
- **Jump-to-fix:** clicking a row with a resolvable location calls `select(flatIdx)` and then, if `actionIdx` is present, `selectAction(actionIdx)`. Rows without `at` are rendered non-interactive.
- **Recompute:** `useMemo(() => lintDeck(doc), [doc])`. The store's `commit()` produces a new doc reference on every real change, so this is exact rather than approximate. Decks are small; if profiling ever shows cost, debouncing is a local change inside the panel — not built now.

### 2.4 Surfacing the save-failure reason

The server already returns a useful body — `{ error: "<joined validation errors>" }` with a 400 ([`app/api/decks/[id]/route.ts:27`](../../../app/api/decks/[id]/route.ts)) — but `req()` in [`lib/api/decks-client.ts:5`](../../../lib/api/decks-client.ts) discards it, throwing only a status string. Three small changes:

1. `req()` attempts to read the JSON body on a non-ok response and throws `new Error(body.error ?? \`${method} ${url} → ${status}\`)`, falling back to the current message if the body is absent or unparsable.
2. `useAutosave` widens its `onStatus` contract to `onStatus(status, error?: string)` so the failure reason reaches the page.
3. The top bar renders `Save failed — <reason>` (truncated, with the full text as a `title`) plus a **Retry** button (`save-retry`) that re-issues the save for the current doc.

This keeps the server as the single source of truth for what blocks a save, while the client-side panel gives the same information live, before the attempt.

---

## 3. Slice 3 — Empty states & error recovery

Non-modal cards rendered in the zone that owns the problem, using existing `--ed-*` tokens. All carry test-ids.

| Condition | Where | Content |
| --- | --- | --- |
| Deck load failed | Canvas zone, replacing the stage | `couldn't-load-deck` — "Couldn't load deck `<id>`", **Retry** (re-runs `loadDeck`) and **Back to library** (`/`). |
| Deck has no scenes | Canvas zone | `empty-deck` — "No scenes yet", with a button wired to `addScene()`. |
| Selection resolves to no beat (selected scene is empty) | Canvas zone | `empty-scene` — "This scene has no beats", pointing at the filmstrip's ＋. |
| Beat has no art, an empty timeline, **and** the scene has no objects | Canvas zone, as a hint overlay | `empty-beat` — "This beat is empty — add an action below." |

The three-part condition on `empty-beat` matters: the object layer (#2a/#3b) renders scene objects on a beat that may legitimately have an empty timeline, so the hint must never cover it.

The top bar's title span sheds its error duty and simply shows `doc?.meta.title ?? "no deck"`; load failure is communicated by the canvas card instead.

---

## 4. Dependency order

The three slices land in this order, each independently reviewable:

1. **Scene structural editing** — mutations, `sceneGroups`, store, filmstrip, MCP parity.
2. **Lint panel** — `lint.ts`, `LintPanel`, save-failure reason. Depends on slice 1 for the `scene-empty` rule to be meaningful.
3. **Empty states & error recovery** — depends on slice 1 (empty scenes exist and are selectable) and slice 2 (the save-failure reason).

---

## 5. Testing

Following the codebase's established split: pure logic in Vitest, component behavior in Vitest + `@testing-library/react` (now a well-established pattern — 10+ specs under `tests/unit/*.tsx`), and cross-zone flows in Playwright.

**Vitest — pure:**
- `moveSceneBy` (swap, both no-op ends, same-reference no-op).
- `deleteSceneAtIndex` (including deleting the only scene) and `deleteSceneAt`'s unchanged wrapper behavior.
- `appendBeatToScene`, including into an empty scene, with unique beat ids.
- `moveBeatBy`: within-scene swap unchanged; both boundary transfer directions; transfer into an empty scene; transfer that empties the source scene; the two true no-op ends.
- `sceneGroups` with empty scenes, and flat-index correctness across them.
- `flatIndexOfBeat` and the selection-preservation behavior of the three scene store actions.
- `lintDeck`: each source in isolation; `parseDocPath` for all three prefix shapes and the unparsable case; slide-id → location resolution; the source-2 gate (dirty source 1 ⇒ no warnings, no throw); the `scene-empty` rule; ordering.

**Vitest — component:**
- `Filmstrip`: scene controls dispatch the right store actions with the right `sceneIdx`; the empty-scene row renders.
- `LintPanel`: renders rows by severity; a row click dispatches `select` and `selectAction`; deck-level rows are non-interactive; the count badge hides at zero.

**Playwright:**
- Extend `e2e/structural.spec.ts` — scene delete and reorder round-trip through autosave and reload; cross-scene beat move in both directions, including emptying a scene and refilling it.
- New `e2e/lint.spec.ts` — the pill shows a count for a deliberately dirty deck; opening the panel and clicking an issue changes the selected beat.
- Empty-deck state and the save-failure retry path.

**MCP:** extend the existing tool sweep so `move_scene_by`, `append_beat_to_scene`, and the extended `delete_scene_at` are all covered, including the "exactly one of `beat_index`/`scene_index`" error case.

---

## 6. Risks and call-outs

- **`move_beat_by` semantics change** on a published MCP tool. Anyone with a connected Claude client sees the boundary behavior change from no-op to transfer. Mitigated by updating the tool description and the MCP docs page in the same commit; not versioned, since the tool surface has no version contract and the change is strictly more capable.
- **Re-keying the `deleteScene` store action** from flat index to scene index is a signature change. Verified safe: nothing calls it today outside the store.
- **Allowing empty scenes** is a loosened invariant. Verified harmless downstream: `flattenStory` skips them, so playback, export, and validation are unaffected; the only visible consequence is the new lint warning.
- **`validateDeck` has never run in production.** It is dead code being woken up, so it may surface warnings on existing sample decks that authors have lived with happily. This is information, not breakage — it is a warning tier and never blocks a save — but the sample decks should be checked during implementation, and any genuine noise addressed by fixing the deck rather than by suppressing the rule.
