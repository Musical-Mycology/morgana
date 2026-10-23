// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RenderStage } from "@/components/player/RenderStage";
import { power2InOut } from "@/engine/authoring/art-clock";
import { deckLayout } from "@/engine/authoring/deck-clock";
import type { DeckDoc } from "@/engine/deck-doc";

// jsdom has neither HTMLImageElement.decode nor document.fonts.
beforeAll(() => {
  (HTMLImageElement.prototype as unknown as { decode: () => Promise<void> }).decode = () => Promise.resolve();
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
});
afterEach(cleanup);

// The Task 2 crossfade fixture: beat a fades to 1.01 and waits 2 s; beat b waits 0.5 s then crossfades to 1.02 (900 ms).
const D: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s0", beats: [
  { id: "a", art: { to: "1.01", mode: "fade" }, timeline: [{ kind: "wait", ms: 2000 }] },
  { id: "b", timeline: [{ kind: "wait", ms: 500 }, { kind: "art", art: { to: "1.02", mode: "crossfade" } }, { kind: "wait", ms: 2000 }] },
] }] };

test("mounting publishes a ready renderer with the deck total", () => {
  render(<RenderStage doc={D} />);
  const r = window.__morganaRender;
  expect(r?.ready).toBe(true);
  expect(r && r.ready && r.total).toBe(deckLayout(D).total);
});

test("renderFrame resolves with the art at mid-crossfade opacities", async () => {
  const { container } = render(<RenderStage doc={D} />);
  const r = window.__morganaRender!;
  if (!r.ready) throw new Error("not ready");
  await r.renderFrame(2.95); // crossfade 2.5 s → 3.4 s, p = 0.5
  const op = (a: string) => Number(container.querySelector<HTMLElement>(`.artstage__layer[data-asset="${a}"]`)!.style.opacity);
  expect(op("1.01")).toBeCloseTo(1 - power2InOut(0.5), 6);
  expect(op("1.02")).toBeCloseTo(power2InOut(0.5), 6);
});

test("no HUD chrome is rendered", () => {
  const { queryByTestId } = render(<RenderStage doc={D} />);
  expect(queryByTestId("play-clock")).toBeNull();
  expect(queryByTestId("play-scrub")).toBeNull();
  expect(queryByTestId("play-hud")).toBeNull();
});

test("html[data-render=1] while mounted, removed on unmount; global removed too", () => {
  const { unmount } = render(<RenderStage doc={D} />);
  expect(document.documentElement.dataset.render).toBe("1");
  unmount();
  expect(document.documentElement.dataset.render).toBeUndefined();
  expect(window.__morganaRender).toBeUndefined();
});
