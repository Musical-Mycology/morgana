import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "x", in: "fade" }] }, { id: "b2", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(base()); });

test("selectObject sets the path and clears selectedAction", () => {
  useEditor.getState().selectAction(0);
  useEditor.getState().selectObject([0]);
  expect(useEditor.getState().selectedObjectPath).toEqual([0]);
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("selectAction clears selectedObjectPath (mutual exclusion)", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().selectAction(0);
  expect(useEditor.getState().selectedAction).toBe(0);
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});

test("changing the selected beat clears both selections", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().select(1);
  expect(useEditor.getState().selectedObjectPath).toBeNull();
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("addObject selects the new object; deleteObject clears the selection", () => {
  useEditor.getState().addObject("s1", "text");
  expect(useEditor.getState().selectedObjectPath).toEqual([0]);
  useEditor.getState().deleteObject("s1", [0]);
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});

test("load clears object selection", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().load(base());
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});
