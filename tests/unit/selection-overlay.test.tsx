import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { SelectionOverlay } from "@/components/editor/SelectionOverlay";
import type { ObjectTransform } from "@/engine/deck/types";

afterEach(cleanup);

function firePointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true }));
}
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
const t: ObjectTransform = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };

function setup(overrides: Partial<Parameters<typeof SelectionOverlay>[0]> = {}) {
  const commit = vi.fn();
  const onPreview = vi.fn();
  const onPreviewEnd = vi.fn();
  const utils = render(
    <SelectionOverlay
      hostRef={stubbedHostRef()} transform={t} sceneId="s1" path={[0]}
      onPreview={onPreview} onPreviewEnd={onPreviewEnd} commit={commit} {...overrides}
    />,
  );
  return { commit, onPreview, onPreviewEnd, ...utils };
}

test("renders the frame, 8 resize handles, and a rotate handle", () => {
  const { getByTestId } = setup();
  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((id) =>
    expect(getByTestId(`obj-handle-${id}`)).toBeTruthy(),
  );
  expect(getByTestId("obj-handle-rotate")).toBeTruthy();
  expect(getByTestId("obj-selection")).toBeTruthy();
});

test("dragging the se handle commits one resize (w/h change)", () => {
  const { commit, getByTestId } = setup();
  firePointer(getByTestId("obj-handle-se"), "pointerdown", 600, 600); // se corner
  firePointer(window, "pointermove", 700, 700);
  firePointer(window, "pointerup", 700, 700);
  expect(commit).toHaveBeenCalledTimes(1);
  const [, , patch] = commit.mock.calls[0];
  expect(patch.w).toBeGreaterThan(0.2);
  expect(patch.h).toBeGreaterThan(0.2);
});

test("dragging the rotate handle commits a rot change", () => {
  const { commit, getByTestId } = setup();
  firePointer(getByTestId("obj-handle-rotate"), "pointerdown", 500, 400); // above center
  firePointer(window, "pointermove", 900, 500);                          // swing right
  firePointer(window, "pointerup", 900, 500);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0][2]).toHaveProperty("rot");
});

test("a movement-free handle press commits nothing", () => {
  const { commit, onPreviewEnd, getByTestId } = setup();
  firePointer(getByTestId("obj-handle-se"), "pointerdown", 600, 600);
  firePointer(window, "pointerup", 600, 600);
  expect(commit).not.toHaveBeenCalled();
  expect(onPreviewEnd).toHaveBeenCalledTimes(1);
});
