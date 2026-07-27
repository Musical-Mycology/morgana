import { expect, test } from "vitest";
import { lintDeck, parseDocPath, lintCounts } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const clean = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
] });

test("parseDocPath reads all three prefix depths", () => {
  expect(parseDocPath("scenes[2].id required")).toEqual({ sceneIdx: 2 });
  expect(parseDocPath("scenes[1].beats[3] bad")).toEqual({ sceneIdx: 1, beatIdx: 3 });
  expect(parseDocPath("scenes[0].beats[1].timeline[2]: bad target")).toEqual({ sceneIdx: 0, beatIdx: 1, actionIdx: 2 });
});

test("parseDocPath maps object-tree messages to their scene, and gives up on deck-level ones", () => {
  expect(parseDocPath("scenes[1].objects[0].id must match /re/")).toEqual({ sceneIdx: 1 });
  expect(parseDocPath("version must be 1")).toBeUndefined();
});

test("a clean deck lints clean", () => {
  expect(lintDeck(clean())).toEqual([]);
});

test("structural failures become errors, located where the path says", () => {
  const doc = clean();
  doc.scenes[0].beats[0].timeline = [{ kind: "obj_reveal", target: "ghost" } as never];
  const issues = lintDeck(doc);
  const err = issues.find((i) => i.severity === "error")!;
  expect(err.rule).toBe("structure");
  expect(err.at).toEqual({ sceneIdx: 0, beatIdx: 0, actionIdx: 0 });
});

test("deck-level structural failures carry no location", () => {
  const doc = { ...clean(), version: 2 } as unknown as DeckDoc;
  const issues = lintDeck(doc);
  expect(issues.some((i) => i.severity === "error" && i.at === undefined)).toBe(true);
});

test("an empty scene is a warning located at that scene", () => {
  const doc = clean();
  doc.scenes.push({ id: "gap", beats: [] });
  const issues = lintDeck(doc);
  const w = issues.find((i) => i.rule === "scene-empty")!;
  expect(w.severity).toBe("warning");
  expect(w.at).toEqual({ sceneIdx: 1 });
  expect(w.message).toContain("gap");
});

test("slide-level warnings resolve their slide id back to a beat location", () => {
  const doc = clean();
  doc.scenes[0].beats.push({ id: "hollow", timeline: [] });   // no art, no timeline
  const issues = lintDeck(doc);
  const w = issues.find((i) => i.rule === "slide")!;
  expect(w.severity).toBe("warning");
  expect(w.at).toEqual({ sceneIdx: 0, beatIdx: 1 });
});

test("slide warnings are suppressed while structural errors exist", () => {
  const doc = clean();
  doc.scenes[0].beats.push({ id: "hollow", timeline: [] });   // would warn
  (doc as unknown as { version: number }).version = 2;         // but the doc is structurally broken
  const issues = lintDeck(doc);
  expect(issues.some((i) => i.severity === "error")).toBe(true);
  expect(issues.some((i) => i.rule === "slide")).toBe(false);
});

test("errors come first; warnings are sorted into document order", () => {
  const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s0", beats: [{ id: "hollow", timeline: [] }] },     // slide warning at scene 0
    { id: "gap", beats: [] },                                   // scene-empty warning at scene 1
  ] };
  const issues = lintDeck(doc);
  expect(issues.every((i) => i.severity === "warning")).toBe(true);
  expect(issues.map((i) => i.at!.sceneIdx)).toEqual([0, 1]);
});

test("the no-art/no-timeline slide warning is suppressed for a beat whose scene has objects", () => {
  const doc = clean();
  doc.scenes[0].objects = [
    { id: "o1", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } },
  ];
  doc.scenes[0].beats.push({ id: "hollow", timeline: [] }); // no art, no timeline
  const issues = lintDeck(doc);
  expect(issues.some((i) => i.rule === "slide")).toBe(false);
});

test("the no-art/no-timeline slide warning still fires when the scene has no objects", () => {
  const doc = clean();
  doc.scenes[0].beats.push({ id: "hollow", timeline: [] }); // no art, no timeline, no objects
  const issues = lintDeck(doc);
  expect(issues.some((i) => i.rule === "slide")).toBe(true);
});

test("a duplicate slide id warning resolves to a real beat location", () => {
  const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "dup", beats: [{ id: "x", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "dup", beats: [{ id: "x", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
  ] };
  const issues = lintDeck(doc);
  const w = issues.find((i) => i.message.startsWith("duplicate slide id"));
  expect(w).toBeDefined();
  expect(w!.at).toBeDefined();
  expect(w!.at).toEqual({ sceneIdx: 0, beatIdx: 0 });
});

test("lintCounts tallies by severity", () => {
  const doc = clean();
  doc.scenes.push({ id: "gap", beats: [] });
  expect(lintCounts(lintDeck(doc))).toEqual({ errors: 0, warnings: 1 });
  expect(lintCounts([])).toEqual({ errors: 0, warnings: 0 });
});
