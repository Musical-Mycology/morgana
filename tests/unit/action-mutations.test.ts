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
