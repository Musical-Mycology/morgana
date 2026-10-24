import { expect, test } from "@playwright/test";
import { creditsOffset, estimateCreditsBlockH, CREDITS_NAME_LH, CREDITS_ROLE_LH } from "../engine/deck/credits";

// Per-worker deck id: parallel workers (--repeat-each) must not share a deck.
let id = "";
test.beforeEach(({}, info) => { id = `e2e-credits-editor-${info.parallelIndex}`; });
test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${id}`); });

const scrub = (page: import("@playwright/test").Page, v: number) => page.getByTestId("scrub").evaluate((el: HTMLInputElement, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true }));
}, v);

test("add Credits and type entries: they save parsed and the canvas rolls; a screen fade previews at most 50%", async ({ page, request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Credits editor" }, scenes: [
    { id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [{ kind: "wait", ms: 100 }, { kind: "wait", ms: 3000 }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Credits editor" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const timeline = page.getByTestId("timeline");
  await expect(timeline.locator(".ed__chip")).toHaveCount(2);

  // Credits after the first wait: 0.1 s → 20.1 s (default 20000 ms).
  await timeline.locator(".ed__chip").nth(0).click();
  await page.getByTestId("action-add").selectOption("credits");
  await expect(timeline.locator(".ed__chip")).toHaveCount(3);
  await expect(page.getByTestId("inspector")).toContainText("Credits action");
  await page.getByTestId("field-items").fill("Directed by: Ann Lee\nMusic: Bo Chen, Cy Diaz\nThanks for watching");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  const saved = (await (await request.get(`/api/decks/${id}`)).json()) as { scenes: { beats: { timeline: { kind: string; items?: unknown }[] }[] }[] };
  expect(saved.scenes[0].beats[0].timeline[1]).toMatchObject({ kind: "credits", items: [
    { role: "Directed by", names: ["Ann Lee"] }, { role: "Music", names: ["Bo Chen", "Cy Diaz"] }, { names: ["Thanks for watching"] },
  ] });

  // Mid-roll (local 10 of 20 s): the canvas shows the block at creditsOffset.
  await scrub(page, 10.1);
  const canvas = page.locator(".ed__canvas");
  await expect(canvas.locator(".cin__credits")).toContainText("Ann Lee");
  // Layout-dependent values (fonts, container query units) are read by polling until they agree with
  // the model — never once, never after a fixed wait.
  type Sample = { off: number; blockH: number; areaH: number; stageH: number; nameLH: number; roleLH: number; vh: number };
  const sample = () => canvas.evaluate((c): Sample => {
    const roll = c.querySelector<HTMLElement>(".cin__credits-roll")!, block = c.querySelector<HTMLElement>(".cin__credits")!;
    const host = c.querySelector<HTMLElement>(".ed__canvas-host")!;
    const lh = (sel: string) => parseFloat(getComputedStyle(c.querySelector<HTMLElement>(sel)!).lineHeight);
    return {
      off: Number(/translateY\((-?[\d.]+)px\)/.exec(roll.style.transform)?.[1] ?? NaN),
      blockH: roll.offsetHeight, areaH: block.clientHeight, stageH: host.clientHeight,
      nameLH: lh(".cin__credits-name"), roleLH: lh(".cin__credits-role"), vh: window.innerHeight,
    };
  });
  const items = saved.scenes[0].beats[0].timeline[1].items as Parameters<typeof estimateCreditsBlockH>[0];
  // cqh must resolve against the DeckCanvas host (the 16:9 stage), not fall back to the viewport:
  // the name line is 0.05 of the stage height (the viewport height differs from the stage height).
  await expect.poll(async () => {
    const r = await sample();
    return r.stageH > 0 && r.blockH > 0 && r.areaH > 0
      && Math.abs(r.nameLH - CREDITS_NAME_LH * r.stageH) <= 1
      && Math.abs(r.roleLH - CREDITS_ROLE_LH * r.stageH) <= 1
      && Math.abs(r.blockH - estimateCreditsBlockH(items) * r.stageH) <= 2
      && Math.abs(r.off - creditsOffset(10, 20000, r.blockH, r.areaH)) <= 0.01;
  }, { message: "credits lines are sized in stage-height units and the roll sits at creditsOffset" }).toBe(true);
  const r = await sample();
  expect(r.nameLH).toBeGreaterThan(0);
  expect(Math.abs(r.nameLH - r.vh * CREDITS_NAME_LH)).toBeGreaterThan(1); // would be equal if cqh fell back to the viewport

  // A screen fade after the roll (20.1 s, 1000 ms to 1): the preview is capped at 50%.
  await timeline.locator(".ed__chip").nth(1).click();
  await page.getByTestId("action-add").selectOption("screen_fade");
  await expect(timeline.locator(".ed__chip")).toHaveCount(4);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  const fade = canvas.locator(".deck__fade");
  await scrub(page, 20.35);                                   // level 0.25: under the cap
  await expect.poll(() => fade.evaluate((e: HTMLElement) => e.style.opacity)).toBe("0.25");
  await scrub(page, 22.5);                                    // level 1: capped
  await expect.poll(() => fade.evaluate((e: HTMLElement) => [e.style.display, e.style.opacity])).toEqual(["block", "0.5"]);
  await scrub(page, 1);                                       // before the fade: nothing painted
  await expect.poll(() => fade.evaluate((e: HTMLElement) => e.style.display)).toBe("none");
});
