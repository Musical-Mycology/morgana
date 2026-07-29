import { expect, test } from "@playwright/test";

// Design spec §7b Task 10: BeatStage must drive text (CinematicSlide), notes, and objects from
// ONE clock. The dev fixture's beat (app/dev/beatstage/page.tsx) times out to:
//   "Hello Morgana" [0, 0.8) → "before gate" [0.8, 1.6) → click_gate @1.6
//   → "after gate" [1.6, 2.4) → note_emitter starts @2.4 → wait [2.4, 4.4)
// This regression only shows up with a click_gate in the mix: a second, independently-ticking
// clock for notes/objects (the old proxy `gsap.timeline()`) doesn't know playback paused at the
// gate, so it keeps advancing on wall-clock time — the note sprites would drift out of step with
// the gated text instead of landing exactly where the shared `t` says they should.

const sprites = '[data-testid="notefield"] span';
// NoteField pools <span> nodes and hides stale ones via display:none rather than removing
// them from the DOM, so a bare element count only ever grows — it must be filtered by the
// LIVE ones. Mirrors the established helper in e2e/notes.spec.ts:19-23.
// `$$eval` is Playwright's querySelectorAll-plus-callback API (runs the given function against
// matched DOM nodes in the page) — unrelated to JS `eval()`; no arbitrary/untrusted code runs.
const liveSpriteCount = (page: import("@playwright/test").Page) =>
  page.$$eval(sprites, (nodes) => nodes.filter((n) => (n as HTMLElement).style.display !== "none").length);

test("notes stay in sync with text across a click_gate", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/dev/beatstage");

  // Scrub to just before the gate: the pre-gate line shows, the post-gate line does not.
  await page.getByTestId("scrub").fill("1");
  await expect(page.getByText("before gate")).toBeVisible();
  await expect(page.getByText("after gate")).toHaveCount(0);

  // Past the gate: post-gate text AND its note sprites appear together, at the same `t`.
  await page.getByTestId("scrub").fill("2.5");
  await expect(page.getByText("after gate")).toBeVisible();
  await expect.poll(() => liveSpriteCount(page)).toBeGreaterThan(0);

  // Seek back to BEFORE the emitter starts (@2.4s local). A single clock recomputes note state
  // fresh from `t` on every call, so this correctly re-hides the sprites. A wall-clock-driven
  // second clock (the bug this test exists for) can only move forward — it would already be
  // past 2.4s of real elapsed time by now and could never un-show these sprites, so this
  // assertion does not just wait-and-retry its way to green the way the check above could: a
  // stuck-forward clock fails it deterministically.
  await page.getByTestId("scrub").fill("0.3");
  await expect.poll(() => liveSpriteCount(page)).toBe(0);

  expect(errors).toEqual([]);
});
