import { expect, test } from "vitest";
import { canvasPlaceholder, isBeatEmpty } from "@/lib/editor/empty-state";
import type { DeckDoc } from "@/engine/deck-doc";
import type { FlatBeat } from "@/lib/editor/flatten-beats";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
] });
const flat = (d: DeckDoc): FlatBeat => ({ sceneId: d.scenes[0].id, beat: d.scenes[0].beats[0] });

test("a load failure wins over everything else", () => {
  expect(canvasPlaceholder({ loadError: true, doc: null, selectedFlat: null })).toBe("load-error");
  const d = doc();
  expect(canvasPlaceholder({ loadError: true, doc: d, selectedFlat: flat(d) })).toBe("load-error");
});

test("a deck that has not arrived yet shows no card", () => {
  expect(canvasPlaceholder({ loadError: false, doc: null, selectedFlat: null })).toBeNull();
});

test("a deck with no scenes shows the empty-deck card", () => {
  const d: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [] };
  expect(canvasPlaceholder({ loadError: false, doc: d, selectedFlat: null })).toBe("empty-deck");
});

test("scenes but no selectable beat shows the empty-scene card", () => {
  const d: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "gap", beats: [] }] };
  expect(canvasPlaceholder({ loadError: false, doc: d, selectedFlat: null })).toBe("empty-scene");
});

test("a normal deck shows no card", () => {
  const d = doc();
  expect(canvasPlaceholder({ loadError: false, doc: d, selectedFlat: flat(d) })).toBeNull();
});

test("isBeatEmpty is true only with no art, no timeline, and no scene objects", () => {
  const d: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", beats: [{ id: "a", timeline: [] }] },
  ] };
  expect(isBeatEmpty(d, { sceneId: "s1", beat: d.scenes[0].beats[0] })).toBe(true);

  const withAction = structuredClone(d);
  withAction.scenes[0].beats[0].timeline = [{ kind: "text", value: "A", in: "fade" }];
  expect(isBeatEmpty(withAction, { sceneId: "s1", beat: withAction.scenes[0].beats[0] })).toBe(false);

  const withObject = structuredClone(d);
  withObject.scenes[0].objects = [{ id: "o1", kind: "text", transform: { x: 0, y: 0, w: 0.1, h: 0.1 } } as never];
  expect(isBeatEmpty(withObject, { sceneId: "s1", beat: withObject.scenes[0].beats[0] })).toBe(false);
});
