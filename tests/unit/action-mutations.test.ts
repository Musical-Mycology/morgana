import { expect, test } from "vitest";
import { insertActionAfter, deleteActionAt, moveActionBy, duplicateActionAt } from "@/lib/editor/mutations";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [
    { id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }, { kind: "wait", ms: 100 }] },
  ] },
  { id: "s2", beats: [{ id: "c", timeline: [{ kind: "clear" }] }] },
] });

const tl = (d: DeckDoc, flat: number) => {
  // flat 0 → s1/a, flat 1 → s2/c
  return flat === 0 ? d.scenes[0].beats[0].timeline : d.scenes[1].beats[0].timeline;
};

test("insertActionAfter splices a new action after the index", () => {
  const d = insertActionAfter(base(), 0, 0, { kind: "clear" });
  expect(tl(d, 0).map((a) => a.kind)).toEqual(["text", "clear", "wait"]);
});

test("insertActionAfter with actionIdx -1 prepends", () => {
  const d = insertActionAfter(base(), 0, -1, { kind: "clear" });
  expect(tl(d, 0).map((a) => a.kind)).toEqual(["clear", "text", "wait"]);
});

test("deleteActionAt removes the targeted action", () => {
  const d = deleteActionAt(base(), 0, 0);
  expect(tl(d, 0).map((a) => a.kind)).toEqual(["wait"]);
});

test("moveActionBy swaps neighbours; no-ops (same ref) at the timeline boundary", () => {
  expect(moveActionBy(base(), 0, 0, 1).scenes[0].beats[0].timeline.map((a) => a.kind)).toEqual(["wait", "text"]);
  const d = base();
  expect(moveActionBy(d, 0, 0, -1)).toBe(d); // already first → boundary no-op
});

test("duplicateActionAt deep-clones right after the source", () => {
  const d = duplicateActionAt(base(), 0, 0);
  expect(tl(d, 0).map((a) => a.kind)).toEqual(["text", "text", "wait"]);
  (tl(d, 0)[1] as { value: string }).value = "changed";
  expect((tl(d, 0)[0] as { value: string }).value).toBe("A"); // independent copy
});

test("out-of-range flat index returns the same doc", () => {
  const d = base();
  expect(deleteActionAt(d, 9, 0)).toBe(d);
});
