import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ObjectsLayer } from "@/components/editor/ObjectsLayer";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "g", kind: "group", transform: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, children: [
      { id: "c0", kind: "shape", shape: "rect", transform: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } },
    ] },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); useEditor.getState().selectObject([0]); });
afterEach(cleanup);

/** A host div with a stubbed, non-zero bounding rect so the drag math in
 *  ObjectsLayer's pointer handlers actually runs (it bails on a zero-size rect). */
function stubbedHostRef() {
  const ref = createRef<HTMLDivElement>();
  const div = document.createElement("div");
  Object.defineProperty(div, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
  ref.current = div;
  return ref;
}

/** jsdom in this project has no global PointerEvent, and @testing-library/dom's
 *  fireEvent.pointer* falls back to a bare `Event` (which drops clientX/clientY)
 *  when the constructor is missing. Dispatch real MouseEvents with the pointer
 *  event type strings instead — the handlers only match on `event.type`/coords,
 *  and MouseEvent carries clientX/clientY faithfully in jsdom. Mirrors
 *  tests/unit/objects-layer-drag.test.tsx, whose `firePointer` helper this
 *  duplicates: usePointerDrag binds pointermove/pointerup on `window`, so move
 *  and up are dispatched on `window` here too. */
function firePointer(target: EventTarget, type: "pointerdown" | "pointermove" | "pointerup", clientX: number, clientY: number) {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
}

test("dragging a selected group moves the group and its child together", () => {
  const hostRef = stubbedHostRef();
  render(<ObjectsLayer hostRef={hostRef} />);
  const box = screen.getAllByTestId("obj").find((b) => b.getAttribute("data-obj-id") === "g")!;

  firePointer(box, "pointerdown", 300, 300);
  firePointer(window, "pointermove", 400, 400); // +0.1, +0.1
  firePointer(window, "pointerup", 400, 400);

  const objs = useEditor.getState().doc!.scenes[0].objects!;
  expect(objs[0].transform).toMatchObject({ x: 0.3, y: 0.3 });
  expect((objs[0] as { children: { transform: { x: number; y: number } }[] }).children[0].transform).toMatchObject({ x: 0.3, y: 0.3 });
});
