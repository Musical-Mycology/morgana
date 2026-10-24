import { afterEach, expect, test } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

afterEach(cleanup);
const docTo = (to: number): DeckDoc => ({ version: 1, meta: { id: "d", title: "T" }, scenes: [{ id: "s", beats: [{ id: "b", timeline: [
  { kind: "screen_fade", to, durationMs: 0 }, { kind: "wait", ms: 1000 },
] }] }] });

function mount(d: DeckDoc) {
  act(() => { useEditor.getState().load(d); useEditor.getState().select(0); });
  const ref = createRef<CanvasHandle>();
  const { container } = render(<DeckCanvas ref={ref} flat={useEditor.getState().beats[0]} />);
  act(() => ref.current!.seek(0.5));
  return container.querySelector<HTMLElement>(".ed__canvas-host .deck__fade")!;
}

test("the editor preview caps the fade at 50% so the beat stays visible", () => {
  expect(mount(docTo(1)).style.opacity).toBe("0.5");
});
test("a fade below the cap previews as-is; level 0 paints nothing", () => {
  expect(mount(docTo(0.3)).style.opacity).toBe("0.3");
  cleanup();
  expect(mount(docTo(0)).style.display).toBe("none");
});
