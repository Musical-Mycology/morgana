# Selection follows a reordered object — design

**Date:** 2026-07-24
**Scope:** `lib/editor/store.ts` `reorderObject`, `lib/editor/selection.ts`, unit tests.

## Problem

`reorderObject` moves an object in its sibling array but does not move the
selection with it.

`mReorderObject` (`lib/editor/object-mutations.ts:54`) swaps two entries of the
sibling list. The store action is a bare `commit(...)` that never touches
`selectedObjectPaths`:

```ts
reorderObject: (sceneId, path, dir) => set((s) => commit(s, (doc) => mReorderObject(doc, sceneId, path, dir))),
```

Because `selectedObjectPaths` holds **index** paths, the selection stays on the
index. After the swap that index designates the *other* object — the one that
moved into the vacated slot.

Two user-visible consequences:

1. `components/editor/LayersPanel.tsx:38-39` derives `canRaise`/`canLower` from
   the primary path, so immediately after a Raise the toolbar's enabled/disabled
   state describes the wrong object.
2. Clicking Raise twice does not raise the same object twice — the second click
   moves the object that was swapped down.

The correct precedent is `groupObjects` (`lib/editor/store.ts:209-217`), which
re-resolves the path after the mutation and updates `selectedObjectPaths`.

## Design

### 1. `swapSelectionSlots` in `lib/editor/selection.ts`

`selection.ts` already owns the path-set utilities (`pathsEqual`, `pathInList`,
`primaryPath`, `togglePath`, `sameParentSiblings`); the remap belongs there.

```ts
/** Remap selection paths across a sibling swap of slots `a`/`b` under `parent`.
 *  A path under `parent` has its element at depth `parent.length` mapped a→b and
 *  b→a; deeper elements are untouched (descendants ride along with their
 *  ancestor). Paths outside `parent` are returned unchanged. */
export function swapSelectionSlots(
  paths: ObjectPath[], parent: ObjectPath, a: number, b: number,
): ObjectPath[]
```

Semantics, per path `p`:

- `p` shorter than or equal to `parent.length`, or not prefixed by `parent` →
  unchanged.
- `p[parent.length] === a` → that element becomes `b`; the rest of `p` is kept
  verbatim.
- `p[parent.length] === b` → that element becomes `a`; rest kept verbatim.
- otherwise → unchanged.

Descendants ride along because only the element at the swap depth is rewritten:
a child of the moved group at `[1, 0]` becomes `[2, 0]` when slots 1 and 2 swap.

### 2. `reorderObject` in `lib/editor/store.ts`

```ts
reorderObject: (sceneId, path, dir) => set((s) => {
  const part = commit(s, (doc) => mReorderObject(doc, sceneId, path, dir));
  if (!part.doc) return {};
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  return { ...part, selectedObjectPaths: swapSelectionSlots(s.selectedObjectPaths, parent, idx, idx + dir) };
}),
```

`commit` returns `{}` when the producer hands back the same doc reference, so
the boundary no-op (raise at the top of a sibling list, lower at the bottom,
unknown scene, missing list) falls out for free: **if the mutation did not move
the object, the selection does not move either.** This mirrors the guard shape
already used by `deleteObject`, `addObject`, and `groupObjects`.

### Why swap-aware rather than "bump the primary"

The minimum fix — set the moved path's last index to `idx + dir` — is wrong when
the swap partner is itself selected. Shift-select `[0]` then `[1]` (primary is
`[1]`) and click Lower: slots 0 and 1 swap, so the non-primary `[0]` must become
`[1]`. Bumping only the primary leaves that path stale — the same bug one seat
over. The swap-aware helper costs one extra clause and closes both.

### Out of scope

`enteredGroupPath` goes stale across a swap in the same way. It is left alone
here: it is not established that the state is reachable in combination with a
reorder (entering a group scopes selection to that group's children, whose
reorders happen at a deeper level than the group's own slot). Handling it is a
separate change, gated on demonstrating the stale case.

## Testing

Unit only. The bug is store/selection logic; no engine or render surface.

**`tests/unit/selection.test.ts`** — `swapSelectionSlots`:

- the path at slot `a` becomes `b`, and vice versa;
- a descendant of the moved slot rides along (`[1, 0]` → `[2, 0]`);
- a sibling path at neither slot is unchanged;
- a path under a different parent is unchanged.

**Store test (`tests/unit/store-object-selection.test.ts`)**:

- raise twice moves the *same* object two slots (the regression);
- the boundary no-op leaves `selectedObjectPaths` untouched;
- a selected swap partner is remapped.

**`tests/unit/layers-panel.test.tsx`**:

- raising through the toolbar twice walks one object to the top of its sibling
  list (asserted by document order, not by path);
- after that second raise the Raise button is disabled — i.e. the toolbar's
  enabled state follows the moved object.

## Deferred: the e2e assertion

`e2e/layers-panel.spec.ts` "raise reorders the primary in the tree" carries a
comment recording that the disabled-after-raise assertion was deliberately
omitted because selection did not follow the reorder. That comment and the
improved test live on `claude/jovial-bohr-0ed2dd`, which is **not merged into
main**; the copy of the file on this branch predates it.

So this branch does not touch e2e. Once `claude/jovial-bohr-0ed2dd` merges, a
follow-up must:

1. re-add `await expect(page.getByTestId("layer-raise")).toBeDisabled();` after
   the raise that puts the object at the top of its sibling list, and
2. delete the parenthetical comment explaining the omission.

This is called out in the PR description so it is not lost.
