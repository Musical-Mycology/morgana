import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "@/components/editor/Inspector";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [
  { kind: "credits", items: [{ role: "Directed by", names: ["Ann"] }], durationMs: 9000 },
  { kind: "text", value: "Hi", in: "fade" },
] }] }] });
const action = (i: number) => useEditor.getState().doc!.scenes[0].beats[0].timeline[i] as Record<string, unknown>;
beforeEach(() => act(() => { useEditor.getState().load(doc()); useEditor.getState().selectAction(0); }));
afterEach(cleanup);

test("the Entries textarea shows the formatted items and parses live", () => {
  render(<Inspector />);
  const ta = screen.getByTestId("field-items") as HTMLTextAreaElement;
  expect(ta.value).toBe("Directed by: Ann");
  fireEvent.change(ta, { target: { value: "Directed by: Ann\nMusic: Bo, " } });
  expect(action(0).items).toEqual([{ role: "Directed by", names: ["Ann"] }, { role: "Music", names: ["Bo"] }]);
  expect(ta.value).toBe("Directed by: Ann\nMusic: Bo, ");        // the draft is not reformatted under the cursor
});

test("an outside change to the items re-syncs the textarea", () => {
  // undo() also clears the selection (so the Inspector would remount); an outside write while the
  // action stays selected (MCP, another panel) is what exercises the re-sync.
  render(<Inspector />);
  const ta = screen.getByTestId("field-items") as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: "Cast: Zed" } });
  expect(ta.value).toBe("Cast: Zed");
  act(() => useEditor.getState().updateAction(0, 0, "items", [{ role: "Directed by", names: ["Ann"] }]));
  expect(ta.value).toBe("Directed by: Ann");
});

test("items authored outside the textarea syntax survive opening the inspector (no write on mount or re-render)", () => {
  const odd = { role: "Music: live", names: ["Smith, J."] };   // a ":" in the role, a "," in a name: does not round-trip
  act(() => useEditor.getState().load({ ...doc(), scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [{ kind: "credits", items: [odd], durationMs: 9000 }] }] }] }));
  act(() => useEditor.getState().selectAction(0));
  const before = useEditor.getState().doc;
  const pastLen = useEditor.getState().past.length;
  const { rerender } = render(<Inspector />);
  rerender(<Inspector />);
  act(() => useEditor.getState().selectAction(0));
  rerender(<Inspector />);
  expect(useEditor.getState().doc).toBe(before);
  expect(useEditor.getState().past.length).toBe(pastLen);
  expect(action(0).items).toEqual([odd]);
});

test("the first edit of an Area sub-field seeds the whole default area (one undo step)", () => {
  render(<Inspector />);
  expect("area" in action(0)).toBe(false);
  const pastLen = useEditor.getState().past.length;
  fireEvent.change(screen.getByTestId("field-area.w"), { target: { value: "0.5" } });
  expect(action(0).area).toEqual({ x: 0.2, y: 0.32, w: 0.5, h: 0.63 });
  expect(useEditor.getState().past.length).toBe(pastLen + 1);
  fireEvent.change(screen.getByTestId("field-area.x"), { target: { value: "0.1" } });
  expect(action(0).area).toEqual({ x: 0.1, y: 0.32, w: 0.5, h: 0.63 });
});

test("Area sub-fields show the default area while the action has none", () => {
  render(<Inspector />);
  expect((screen.getByTestId("field-area.h") as HTMLInputElement).value).toBe("0.63");
});

test("Particles: hidden sub-fields until checked; checking writes the defaults, clearing deletes the key", () => {
  act(() => useEditor.getState().selectAction(1));
  render(<Inspector />);
  expect(screen.queryByTestId("field-particles.color")).toBeNull();
  fireEvent.click(screen.getByTestId("field-particles"));
  expect(action(1).particles).toEqual({ color: "cream", rate: 6, rise: 1 });
  expect(screen.getByTestId("field-particles.color")).toBeTruthy();
  fireEvent.click(screen.getByTestId("field-particles"));
  expect("particles" in action(1)).toBe(false);
  expect(screen.queryByTestId("field-particles.color")).toBeNull();
});

test("clearing an Area box writes nothing (no NaN seed), with or without an area", () => {
  render(<Inspector />);
  const before = useEditor.getState().doc;
  const pastLen = useEditor.getState().past.length;
  fireEvent.change(screen.getByTestId("field-area.w"), { target: { value: "" } });
  expect(useEditor.getState().doc).toBe(before);
  expect(useEditor.getState().past.length).toBe(pastLen);
  expect("area" in action(0)).toBe(false);
  fireEvent.change(screen.getByTestId("field-area.w"), { target: { value: "0.5" } });
  fireEvent.change(screen.getByTestId("field-area.h"), { target: { value: "" } });
  expect(action(0).area).toEqual({ x: 0.2, y: 0.32, w: 0.5, h: 0.63 });
});
