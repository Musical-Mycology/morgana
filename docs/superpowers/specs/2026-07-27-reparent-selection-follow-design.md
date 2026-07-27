# Selection follows a reparented object — design

**Date:** 2026-07-27
**Scope:** `lib/editor/store.ts` `reparentObject`, unit tests.

## Problem

`reparentObject` moves an object to a new parent and index but does not move the
selection with it. The store action is a bare `commit(...)` that never touches
`selectedObjectPaths` (`lib/editor/store.ts:230`):

```ts
reparentObject: (sceneId, from, toParent, toIndex) => set((s) => commit(s, (doc) => mReparentObject(doc, sceneId, from, toParent, toIndex))),
```

`selectedObjectPaths` holds **index** paths, so once the document changes shape
the old path designates whatever now occupies that index — or nothing at all.

This is the same class of bug fixed for `reorderObject` in
`docs/superpowers/specs/2026-07-24-reorder-selection-follow-design.md`, but
broader. A reorder swaps two adjacent slots in one list, so a stale path always
lands on a real sibling. `mReparentObject` (`lib/editor/object-mutations.ts:153`)
removes the node from one list and inserts it into an arbitrary other list at an
arbitrary index, so a stale path can designate a completely unrelated object at
a different depth, or run off the end of a now-shorter sibling list.

`enteredGroupPath` goes stale the same way, and here the stale case is structural
rather than hypothetical: the moved node may *be* the entered group, or may be
extracted from it, or may shift the entered group's own slot.

**Currently latent.** `store.reparentObject` has no caller anywhere in the
codebase — it is wired ahead of a drag-into-group feature. Only the pure
mutation is exercised, by `tests/unit/object-group-mutations.test.ts`. Fixing it
now keeps the store's selection invariants uniform across every object action,
so the future drag feature inherits correct behavior instead of shipping the bug.

## Design

### `reparentObject` in `lib/editor/store.ts`

```ts
reparentObject: (sceneId, from, toParent, toIndex) => set((s) => {
  if (!s.doc) return {};
  const before = s.doc.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  const movedId = getObjectAt(before, from)?.id;
  const part = commit(s, (doc) => mReparentObject(doc, sceneId, from, toParent, toIndex));
  if (!part.doc) return {};
  const scene = part.doc.scenes.find((sc) => sc.id === sceneId);
  const p = movedId && scene ? findObjectPath(scene.objects ?? [], movedId) : null;
  return { ...part, selectedObjectPaths: p ? [p] : [], enteredGroupPath: null, selectedAction: null };
}),
```

The moved object's id is captured **before** the commit. After the move, `from`
no longer designates that node, so the id cannot be recovered from the new
document by path.

Everything else follows the `groupObjects` / `ungroupObject` precedent verbatim:
the `if (!s.doc)` prelude, the `if (!part.doc) return {}` no-op guard, re-resolution
by id through `findObjectPath`, and the `p ? [p] : []` fallback. Object ids are
unique per scene (`uniqueObjectId`), so the re-resolution is unambiguous.

### Why re-resolve instead of computing the landing path

`[...toParent, toIndex]` is wrong. `mReparentObject` clamps the insertion index
to the target list's length, and decrements it when the source removal shifted
the target (same list, `toIndex > fromIdx`). Reproducing that arithmetic in the
store would duplicate the mutation's logic and drift from it as the mutation
evolves. Asking the committed document where the object actually landed cannot
drift. A test pins this (see Testing #3).

### Selection semantics: collapse to the moved object

The new selection is exactly the moved object, discarding any other selected
paths. This matches `addObject` and `groupObjects`, which both collapse to the
single object they produced, and matches the drag-into-group interaction the
action exists for — the dragged object is the interaction target.

The alternative — remapping every surviving selected path across the move —
requires index-shift math over two arbitrary lists at arbitrary depths (paths
after the source slot shift down by one; paths at or after the insertion index
shift up by one; descendants ride along). That is substantially more code and
test surface than the one-node action justifies while it still has no caller.
`reorderObject`'s `swapSelectionSlots` was worth it because a swap has a
two-line remap and a demonstrated multi-select case (shift-selecting both swap
partners); neither holds here.

Note this deliberately does **not** depend on `swapSelectionSlots`, which lives
on the unmerged `claude/strange-dirac-b40df6`. This change is off `main` and the
two branches merge in either order.

### `enteredGroupPath` and `selectedAction`

Both are cleared. Nulling `enteredGroupPath` matches every other action that
ends with a freshly-resolved object selection (`addObject`, `groupObjects`,
`ungroupObject`, `deleteObject`). Nulling `selectedAction` preserves the store's
object/action mutual-exclusion invariant, which would otherwise break whenever a
reparent ran with an action selected.

This differs from `reorderObject`, which left `enteredGroupPath` alone pending a
demonstrated stale case. That reasoning does not carry over: a reorder happens at
a deeper level than the entered group's own slot, whereas a reparent moves nodes
between parents by definition.

### Error and no-op handling

No case below needs its own branch — all of them fall out of the two guards, and
in every one the selection stays exactly where it was:

- no document loaded → `if (!s.doc)`;
- unknown scene, unknown source path, missing target list, or a group moved into
  its own subtree (`isPrefix` refusal) → `mReparentObject` returns the same doc
  reference, so `commit` returns `{}` and `if (!part.doc)` short-circuits.

## Testing

Unit only. The bug is store/selection logic with no UI caller, so there is no
e2e surface to assert against; adding one would mean building the drag feature.

**`tests/unit/store-object-selection.test.ts`** — a new fixture with a
root-level group plus loose siblings, `[grp(a, b), c, d]`:

1. moving `c` into the group selects it at its new nested path, and clears
   `enteredGroupPath` and `selectedAction` (both set beforehand);
2. moving `a` out of the group to a root index selects it at its root path;
3. a forward move within the same sibling list lands on the *adjusted* index —
   this is the test that fails if anyone later replaces the re-resolution with
   `[...toParent, toIndex]`;
4. a refused move (group into its own subtree) leaves `doc`, `revision`, and
   `selectedObjectPaths` untouched;
5. a two-path selection collapses to just the moved object.

Verification: `npm test` (full unit suite). `npm run lint` is unavailable in this repo — no committed ESLint config, and CI has no lint step.

## Out of scope

- `mReparentObject` itself is unchanged.
- No e2e, and no UI caller is added.
- One pre-existing quirk is left alone: a move to a node's current position still
  allocates a new document, so it records a history entry rather than being a
  no-op. The selection outcome is correct either way (re-resolution returns the
  same path), so fixing it belongs with the mutation, not with this change.
