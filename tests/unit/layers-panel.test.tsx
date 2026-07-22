import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 0.1, h: 0.1 } },
    { id: "g", kind: "group", name: "My Group", transform: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, children: [
      { id: "c0", kind: "text", text: "hi", transform: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } },
    ] },
    { id: "b", kind: "shape", shape: "rect", transform: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

const rows = () => screen.getAllByTestId("layer-row");
const rowFor = (id: string) => rows().find((r) => r.getAttribute("data-obj-id") === id)!;

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

test("renders one row per object, front-of-z first with the group above its child", () => {
  render(<LayersPanel />);
  expect(rows().map((r) => r.getAttribute("data-obj-id"))).toEqual(["b", "g", "c0", "a"]);
});

test("a row shows the object's name when present, else kind + id", () => {
  render(<LayersPanel />);
  expect(rowFor("g").textContent).toContain("My Group");
  expect(rowFor("a").textContent).toContain("shape");
});

test("clicking a row selects that exact object at its depth", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("c0"));
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toEqual([1, 0]);
});

test("shift-clicking toggles multi-selection", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  fireEvent.click(rowFor("b"), { shiftKey: true });
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0], [2]]);
});

test("the primary row is aria-current", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  expect(rowFor("a").getAttribute("aria-current")).toBe("true");
});

const toggleIn = (id: string, testid: string) => fireEvent.click(within(rowFor(id)).getByTestId(testid));

test("the hide toggle flips the object's hidden flag", () => {
  render(<LayersPanel />);
  toggleIn("a", "layer-hide");
  expect(useEditor.getState().doc!.scenes[0].objects![0].hidden).toBe(true);
});

test("the lock toggle flips the object's locked flag", () => {
  render(<LayersPanel />);
  toggleIn("a", "layer-lock");
  expect(useEditor.getState().doc!.scenes[0].objects![0].locked).toBe(true);
});

test("collapsing a group hides its children in the tree", () => {
  render(<LayersPanel />);
  toggleIn("g", "layer-collapse");
  expect(rows().map((r) => r.getAttribute("data-obj-id"))).toEqual(["b", "g", "a"]);
});

test("double-clicking a row name commits a rename on Enter", () => {
  render(<LayersPanel />);
  fireEvent.doubleClick(within(rowFor("a")).getByTestId("layer-name"));
  const input = screen.getByTestId("layer-rename-input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Backdrop" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useEditor.getState().doc!.scenes[0].objects![0].name).toBe("Backdrop");
});

test("raise moves the primary up in z (reorderObject +1)", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));                       // path [0], backmost
  fireEvent.click(screen.getByTestId("layer-raise"));
  // 'a' swaps with 'g' -> objects order becomes [g, a, b]
  expect(useEditor.getState().doc!.scenes[0].objects!.map((o) => o.id)).toEqual(["g", "a", "b"]);
});

test("raise is disabled at the top of the sibling list, lower stays enabled", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("b"));                        // path [2], topmost z (front-of-z first row)
  expect((screen.getByTestId("layer-raise") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTestId("layer-lower") as HTMLButtonElement).disabled).toBe(false);
});

test("lower is disabled at the bottom of the sibling list, raise stays enabled", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));                        // path [0], backmost z
  expect((screen.getByTestId("layer-lower") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTestId("layer-raise") as HTMLButtonElement).disabled).toBe(false);
});

test("Group is disabled unless >=2 same-parent siblings are selected", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  expect((screen.getByTestId("layer-group") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(rowFor("b"), { shiftKey: true });   // [0] + [2], same parent
  expect((screen.getByTestId("layer-group") as HTMLButtonElement).disabled).toBe(false);
});

test("Group wraps the selection into a group", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  fireEvent.click(rowFor("b"), { shiftKey: true });
  fireEvent.click(screen.getByTestId("layer-group"));
  const kinds = useEditor.getState().doc!.scenes[0].objects!.map((o) => o.kind);
  expect(kinds.filter((k) => k === "group")).toHaveLength(2); // pre-existing 'g' + new group
});

test("Ungroup is enabled only for a single selected group and splices it", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("g"));
  expect((screen.getByTestId("layer-ungroup") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByTestId("layer-ungroup"));
  expect(useEditor.getState().doc!.scenes[0].objects!.some((o) => o.id === "c0")).toBe(true);
});

test("the add control appends a new object", () => {
  render(<LayersPanel />);
  fireEvent.change(screen.getByTestId("layer-object-add"), { target: { value: "text" } });
  expect(useEditor.getState().doc!.scenes[0].objects!.some((o) => o.kind === "text" && o.id !== "c0")).toBe(true);
});
