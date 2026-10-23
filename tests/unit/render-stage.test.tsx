// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { RenderStage } from "@/components/player/RenderStage";
import { power2InOut } from "@/engine/authoring/art-clock";
import { deckLayout } from "@/engine/authoring/deck-clock";
import type { DeckDoc } from "@/engine/deck-doc";
import { NOTE_GLYPHS, storyAssetUrl } from "@/engine/deck/story-assets";

// jsdom has neither HTMLImageElement.decode nor document.fonts. `decoded` records every decode
// (detached preload Images included); a src matching `broken` rejects.
let broken: RegExp | null = null;
const decoded: string[] = [];
beforeAll(() => {
  (HTMLImageElement.prototype as unknown as { decode: () => Promise<void> }).decode = function (this: HTMLImageElement) {
    decoded.push(this.src);
    return broken?.test(this.src) ? Promise.reject(new Error("EncodingError")) : Promise.resolve();
  };
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
});
beforeEach(() => { broken = null; decoded.length = 0; });
afterEach(cleanup);

type Ready = Extract<NonNullable<Window["__morganaRender"]>, { ready: true }>;
async function ready(): Promise<Ready> {
  await waitFor(() => expect(window.__morganaRender?.ready).toBe(true));
  return window.__morganaRender as Ready;
}

// The Task 2 crossfade fixture: beat a fades to 1.01 and waits 2 s; beat b waits 0.5 s then crossfades to 1.02 (900 ms).
const D: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s0", beats: [
  { id: "a", art: { to: "1.01", mode: "fade" }, timeline: [{ kind: "wait", ms: 2000 }] },
  { id: "b", timeline: [{ kind: "wait", ms: 500 }, { kind: "art", art: { to: "1.02", mode: "crossfade" } }, { kind: "wait", ms: 2000 }] },
] }] };

test("mounting publishes a ready renderer with the deck total", async () => {
  render(<RenderStage doc={D} />);
  expect((await ready()).total).toBe(deckLayout(D).total);
});

test("every NoteField glyph (a CSS mask-image, not an <img>) is decoded before ready is published", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const spy = vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(function (this: HTMLImageElement) {
    decoded.push(this.src);
    return gate;
  });
  try {
    render(<RenderStage doc={D} />);
    await waitFor(() => expect(decoded.length).toBeGreaterThanOrEqual(NOTE_GLYPHS.length));
    for (const g of NOTE_GLYPHS) expect(decoded).toContain(new URL(storyAssetUrl(g), document.baseURI).href);
    expect(window.__morganaRender).toBeUndefined(); // still waiting on the glyphs
    release();
    await ready();
  } finally { spy.mockRestore(); }
});

test("a glyph that fails to preload is reported once, by the first renderFrame; the render still becomes ready", async () => {
  broken = /Notes3\.png$/;
  render(<RenderStage doc={D} />);
  const r = await ready();
  expect((await r.renderFrame(0.1)).failed).toEqual([new URL(storyAssetUrl("Notes3"), document.baseURI).href]);
  expect((await r.renderFrame(0.2)).failed).toEqual([]);
});

test("an <img> that fails to decode is reported once (newly failed srcs only); frames keep rendering", async () => {
  broken = /1\.02\.jpg$/;
  render(<RenderStage doc={D} />);
  const r = await ready();
  expect((await r.renderFrame(0.1)).failed).toEqual([]);
  const first = await r.renderFrame(2.95); // 1.02 is mounted mid-crossfade
  expect(first.failed).toEqual([expect.stringMatching(/\/storyboard\/panels\/1\.02\.jpg$/)]);
  expect((await r.renderFrame(3.0)).failed).toEqual([]);
});

test("renderFrame resolves with the art at mid-crossfade opacities", async () => {
  const { container } = render(<RenderStage doc={D} />);
  const r = await ready();
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

test("html[data-render=1] while mounted, removed on unmount; global removed too", async () => {
  const { unmount } = render(<RenderStage doc={D} />);
  await ready();
  expect(document.documentElement.dataset.render).toBe("1");
  unmount();
  expect(document.documentElement.dataset.render).toBeUndefined();
  expect(window.__morganaRender).toBeUndefined();
});

test("a deck with no duration publishes ready:false instead of a renderer", () => {
  const empty: DeckDoc = { version: 1, meta: { id: "e", title: "E" }, scenes: [] };
  render(<RenderStage doc={empty} />);
  expect(window.__morganaRender).toEqual({ ready: false, error: "deck has no duration" });
});
