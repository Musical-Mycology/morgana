import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef, useRef } from "react";
import { usePointerDrag, type DragHandlers } from "@/lib/editor/usePointerDrag";

afterEach(cleanup);

function firePointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true }));
}

function Harness({ handlers }: { handlers: DragHandlers }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const start = usePointerDrag(hostRef);
  return (
    <div>
      <div ref={hostRef} data-testid="host" />
      <button data-testid="grip" onPointerDown={(e) => start(e, handlers)} />
    </div>
  );
}

/** stub the host's rect so the hook does not bail on a zero-size rect */
function stubHost(el: HTMLElement) {
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 1000, height: 562, right: 1000, bottom: 562, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
}

test("onStart/onMove fire and onCommit reports moved=true after a drag", () => {
  const onStart = vi.fn(), onMove = vi.fn(), onCommit = vi.fn();
  const { getByTestId } = render(<Harness handlers={{ onStart, onMove, onCommit }} />);
  stubHost(getByTestId("host"));

  firePointer(getByTestId("grip"), "pointerdown", 100, 100);
  firePointer(window, "pointermove", 300, 200);
  firePointer(window, "pointerup", 300, 200);

  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onMove).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit.mock.calls[0][0].moved).toBe(true);
});

test("a movement-free press reports moved=false", () => {
  const onCommit = vi.fn();
  const { getByTestId } = render(<Harness handlers={{ onMove: vi.fn(), onCommit }} />);
  stubHost(getByTestId("host"));

  firePointer(getByTestId("grip"), "pointerdown", 100, 100);
  firePointer(window, "pointerup", 100, 100);

  expect(onCommit.mock.calls[0][0].moved).toBe(false);
});
