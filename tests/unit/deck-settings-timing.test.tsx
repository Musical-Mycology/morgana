import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { DeckSettings } from "@/components/editor/DeckSettings";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

const deck = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [{ id: "a", timeline: [{ kind: "wait", ms: 90500 }] }] }] });
beforeEach(() => useEditor.getState().load(deck()));
afterEach(cleanup);

test("turning Timed deck on sets a target rounded up from the current total", () => {
  render(<DeckSettings />);
  fireEvent.click(screen.getByTestId("timed-toggle"));
  expect(useEditor.getState().doc!.meta.timing).toEqual({ targetSec: 91 });
  expect((screen.getByTestId("target-length") as HTMLInputElement).value).toBe("1:31");
});

test("editing the target accepts m:ss and ignores garbage", () => {
  render(<DeckSettings />);
  fireEvent.click(screen.getByTestId("timed-toggle"));
  const input = screen.getByTestId("target-length");
  fireEvent.change(input, { target: { value: "2:00" } });
  fireEvent.blur(input);
  expect(useEditor.getState().doc!.meta.timing).toEqual({ targetSec: 120 });
  fireEvent.change(input, { target: { value: "soon" } });
  fireEvent.blur(input);
  expect(useEditor.getState().doc!.meta.timing).toEqual({ targetSec: 120 });
  expect((input as HTMLInputElement).value).toBe("2:00"); // reverted
});

test("turning Timed deck off leaves a valid, saveable deck", () => {
  render(<DeckSettings />);
  fireEvent.click(screen.getByTestId("timed-toggle"));
  fireEvent.click(screen.getByTestId("timed-toggle"));
  const doc = useEditor.getState().doc!;
  expect(doc.meta.timing).toBeUndefined();
  expect(validateDeckDoc(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
  expect(screen.queryByTestId("target-length")).toBeNull();
});

const hist = () => { const st = useEditor.getState(); return [st.past.length, st.revision]; };

test("blur without edits, or re-committing the same value, records no history", () => {
  render(<DeckSettings />);
  fireEvent.click(screen.getByTestId("timed-toggle"));
  const before = hist();
  const input = screen.getByTestId("target-length") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.blur(input);
  expect(hist()).toEqual(before);
  fireEvent.change(input, { target: { value: "91" } }); // same value, different spelling
  fireEvent.blur(input);
  expect(hist()).toEqual(before);
  expect(input.value).toBe("1:31"); // normalized
});

test("Enter then blur commits exactly once", () => {
  render(<DeckSettings />);
  fireEvent.click(screen.getByTestId("timed-toggle"));
  const [past0] = hist();
  const input = screen.getByTestId("target-length");
  fireEvent.change(input, { target: { value: "2:00" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  expect(hist()[0]).toBe(past0 + 1);
});

test("a fractional target (set via MCP/JSON) survives focus+blur untouched", () => {
  useEditor.getState().load({ ...deck(), meta: { id: "d", title: "D", timing: { targetSec: 90.5 } } });
  render(<DeckSettings />);
  const before = hist();
  const input = screen.getByTestId("target-length") as HTMLInputElement;
  expect(input.value).toBe("1:30"); // displayed rounded
  fireEvent.focus(input);
  fireEvent.blur(input);
  expect(useEditor.getState().doc!.meta.timing).toEqual({ targetSec: 90.5 });
  expect(hist()).toEqual(before);
});
