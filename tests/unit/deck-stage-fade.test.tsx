import { afterEach, expect, test } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef, forwardRef, useImperativeHandle } from "react";
import { useDeckStage, type DeckStageHandle } from "@/components/player/DeckStage";
import { fadeAt, fadeEvents } from "@/engine/authoring/fade-clock";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Scene } from "@/engine/deck/types";

afterEach(cleanup);

/** Calls to `el.style[prop]`'s setter since watching started, same-value writes included (jsdom
 *  queues no MutationObserver record for a same-value write). */
function watchStyle(el: HTMLElement, prop: "transform" | "opacity" | "display") {
  let desc: PropertyDescriptor | undefined;
  for (let p: object | null = el.style; p && !desc; p = Object.getPrototypeOf(p)) desc = Object.getOwnPropertyDescriptor(p, prop);
  if (!desc?.set || !desc.get) throw new Error(`style.${prop} has no accessor descriptor`);
  const { get, set } = desc;
  let n = 0;
  Object.defineProperty(el.style, prop, { set(v: string) { n++; set.call(this, v); }, get() { return get.call(this); }, configurable: true });
  return { count: () => n, stop: () => { delete (el.style as unknown as Record<string, unknown>)[prop]; } };
}

const doc = (scenes: Scene[]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes });
const Host = forwardRef<DeckStageHandle, { doc: DeckDoc; initialT?: number }>(function Host({ doc, initialT = 0 }, ref) {
  const { apply, T, layout, stage } = useDeckStage(doc, initialT);
  useImperativeHandle(ref, () => ({ apply, total: layout.total, current: () => T.current }), [apply, layout.total, T]);
  return <div style={{ position: "relative", width: 1920, height: 1080 }}>{stage}</div>;
});
function setup(d: DeckDoc, initialT = 0) {
  const ref = createRef<DeckStageHandle>();
  const { container } = render(<Host ref={ref} doc={d} initialT={initialT} />);
  const fade = () => container.querySelector<HTMLElement>(".deck__fade")!;
  return { container, fade, apply: (t: number) => act(() => { ref.current!.apply(t); }) };
}
// Fade to black over 1–3 s in scene 0; scene 1 (from 4 s) has no fade action.
const FADED = doc([
  { id: "s0", beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }, { kind: "screen_fade", to: 1, durationMs: 2000 }, { kind: "wait", ms: 3000 }] }] },
  { id: "s1", beats: [{ id: "b", timeline: [{ kind: "wait", ms: 2000 }] }] },
]);

test("the overlay is the stage wrapper's last child; apply(T) paints fadeAt's level and colour", () => {
  const { fade, apply } = setup(FADED);
  expect(fade().parentElement!.lastElementChild).toBe(fade());
  apply(2);
  expect(fade().style.display).toBe("block");
  expect(Number(fade().style.opacity)).toBeCloseTo(fadeAt(fadeEvents(FADED), 2).level, 6);
  expect(fade().style.background).toMatch(/^(#000|rgb\(0, 0, 0\))$/);
});

test("Review Focus #3: the level holds across a scene cut; a backward scrub to before the fade paints nothing", () => {
  const { fade, apply } = setup(FADED);
  apply(5);
  expect(fade().style.opacity).toBe("1");
  apply(0.5);
  expect(fade().style.display).toBe("none");
});

test("mount paints the fade at initialT; a fade-less deck never shows the overlay", () => {
  expect(setup(FADED, 2.5).fade().style.display).toBe("block");
  cleanup();
  const plain = setup(doc([{ id: "s", beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] }]));
  plain.apply(0.5);
  expect(plain.fade().style.display).toBe("none");
  expect(plain.fade().style.opacity).toBe("");
});

test("writes only when the painted value changes", () => {
  const { fade, apply } = setup(FADED);
  apply(2);
  const w = watchStyle(fade(), "opacity");
  apply(2);
  apply(2);
  expect(w.count()).toBe(0);
  apply(2.5);
  expect(w.count()).toBe(1);
  w.stop();
});
