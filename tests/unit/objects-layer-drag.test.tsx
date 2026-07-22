import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ObjectsLayer } from "@/components/editor/ObjectsLayer";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => {
  useEditor.getState().load(doc());
  useEditor.getState().selectObject([0]);
});
afterEach(cleanup);

/** A host div with a stubbed, non-zero bounding rect so the drag math in
 *  ObjectsLayer's pointer handlers actually runs (it bails on a zero-size rect). */
function stubbedHostRef() {
  const ref = createRef<HTMLDivElement>();
  const div = document.createElement("div");
  Object.defineProperty(div, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 1000, height: 562, right: 1000, bottom: 562, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
  ref.current = div;
  return ref;
}

function boxFor(id: string) { return screen.getAllByTestId("obj").find((b) => b.getAttribute("data-obj-id") === id)!; }

/** jsdom in this project has no global PointerEvent, and @testing-library/dom's
 *  fireEvent.pointer* falls back to a bare `Event` (which drops clientX/clientY)
 *  when the constructor is missing. Dispatch real MouseEvents with the pointer
 *  event type strings instead — the handlers only match on `event.type`/coords,
 *  and MouseEvent carries clientX/clientY faithfully in jsdom. */
function firePointer(target: EventTarget, type: "pointerdown" | "pointermove" | "pointerup", clientX: number, clientY: number) {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
}

test("a movement-free click does not create a history entry or bump revision", () => {
  const hostRef = stubbedHostRef();
  render(<ObjectsLayer hostRef={hostRef} />);
  const before = useEditor.getState();
  const revisionBefore = before.revision;
  const pastLenBefore = before.past.length;

  const box = boxFor("a");
  firePointer(box, "pointerdown", 100, 100);
  firePointer(window, "pointerup", 100, 100);

  const after = useEditor.getState();
  expect(after.revision).toBe(revisionBefore);
  expect(after.past.length).toBe(pastLenBefore);
});

test("a drag that moves the object commits exactly one history entry", () => {
  const hostRef = stubbedHostRef();
  render(<ObjectsLayer hostRef={hostRef} />);
  const revisionBefore = useEditor.getState().revision;

  const box = boxFor("a");
  firePointer(box, "pointerdown", 100, 100);
  firePointer(window, "pointermove", 400, 300);
  firePointer(window, "pointerup", 400, 300);

  const after = useEditor.getState();
  expect(after.revision).toBe(revisionBefore + 1);
  const obj = after.doc!.scenes[0].objects![0];
  expect(obj.transform.x).not.toBe(0.1);
});
