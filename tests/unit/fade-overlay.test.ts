import { expect, test } from "vitest";
import { paintFadeOverlay } from "@/engine/components/fade-overlay";
import { fadeAt, fadeEvents } from "@/engine/authoring/fade-clock";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Action } from "@/engine/deck/types";

const deck = (timeline: Action[]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [{ id: "b", timeline }] }] });

/** Paint the overlay at each time in turn on one element (a stepped run), and return its style. */
function paintAt(doc: DeckDoc, times: number[]): string {
  const el = document.createElement("div");
  const events = fadeEvents(doc);
  let last = "";
  for (const t of times) last = paintFadeOverlay(el, fadeAt(events, t), last);
  return el.getAttribute("style") ?? "";
}

test("stepping from a valid-colour fade into an invalid-colour fade paints what a jump does", () => {
  const doc = deck([
    { kind: "screen_fade", to: 0.5, color: "#f00", durationMs: 0 },
    { kind: "wait", ms: 1000 },
    { kind: "screen_fade", to: 0.8, color: "nope", durationMs: 0 },
    { kind: "wait", ms: 1000 },
  ]);
  const jumped = paintAt(doc, [1.5]);
  expect(paintAt(doc, [0.5, 1.5])).toBe(jumped);
  expect(jumped).toContain("opacity: 0.8");
});

test("a repaint clears the previous background before writing the new one", () => {
  const el = document.createElement("div");
  const last = paintFadeOverlay(el, { level: 0.5, color: "#f00" }, "");
  paintFadeOverlay(el, { level: 0.6, color: "not-a-colour" }, last);
  const fresh = document.createElement("div");
  paintFadeOverlay(fresh, { level: 0.6, color: "not-a-colour" }, "");
  expect(el.style.background).toBe(fresh.style.background);
});
