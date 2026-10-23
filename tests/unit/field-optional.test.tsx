// Final review I4b: camera `to` fields are optional — a left-out field inherits the framing in effect.
// The inspector shows such a field empty with an "inherit" placeholder and clearing a field removes the
// key (never writes NaN).
import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "@/components/editor/Inspector";
import { Field } from "@/components/editor/Field";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [
    { kind: "camera", to: { zoom: 2, y: 0.4 }, durationMs: 800 },
    { kind: "wait", ms: 1000 },
  ] }] },
] });

beforeEach(() => act(() => { useEditor.getState().load(doc()); useEditor.getState().selectAction(0); }));
afterEach(cleanup);

const input = (label: string) => screen.getByTestId("inspector").querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) ?? (screen.getByLabelText(label) as HTMLInputElement);
const cam = () => useEditor.getState().doc!.scenes[0].beats[0].timeline[0] as { to: Record<string, number> };

test("an unset camera field shows empty with an inherit placeholder; a set one shows its value", () => {
  render(<Inspector />);
  const x = input("Center X");
  expect(x.value).toBe("");
  expect(x.placeholder).toBe("inherit");
  expect(input("Center Y").value).toBe("0.4");
  expect(input("Zoom (1–8)").value).toBe("2");
});

test("clearing a camera field deletes the key — never NaN", () => {
  render(<Inspector />);
  fireEvent.change(input("Center Y"), { target: { value: "" } });
  expect(cam().to).toEqual({ zoom: 2 });
  expect("y" in cam().to).toBe(false);
  fireEvent.change(input("Zoom (1–8)"), { target: { value: "" } });
  expect("zoom" in cam().to).toBe(false);
  for (const v of Object.values(cam().to)) expect(Number.isNaN(v)).toBe(false);
});

test("typing into an empty camera field sets it", () => {
  render(<Inspector />);
  fireEvent.change(input("Center X"), { target: { value: "0.7" } });
  expect(cam().to).toEqual({ zoom: 2, x: 0.7, y: 0.4 });
});

test("a non-optional number field is unchanged: it still shows 0 for an unset value", () => {
  let got: unknown = "untouched";
  render(<Field spec={{ key: "durationMs", label: "Duration ms", type: "number" }} value={undefined} onChange={(v) => { got = v; }} />);
  const el = screen.getByLabelText("Duration ms") as HTMLInputElement;
  expect(el.value).toBe("0");
  expect(el.placeholder).toBe("");
  fireEvent.change(el, { target: { value: "300" } });
  expect(got).toBe(300);
});
