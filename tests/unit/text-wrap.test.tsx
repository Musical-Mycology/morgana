import { afterEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { CinematicSlide, boxMaxWidth, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import type { Action, Beat } from "@/engine/deck/types";

afterEach(cleanup);
const runtime = { art() {}, applyArt() {}, setNightlight() {}, onGate() {}, revealArrows() {}, pulseArrow() {}, onWaiting() {}, resolveEntry: () => [], resolveEnd: () => [], jumpTo() {} } as CinematicRuntime;

function mount(timeline: Action[], sceneId = "s") {
  const transport = createRef<SlideTransport>();
  const beat: Beat = { id: "d", timeline: [...timeline, { kind: "wait", ms: 1000 }] };
  const { container } = render(<CinematicSlide slots={{ sceneId, beat }} animate runtime={runtime} transport={transport} autoplay={false} />);
  transport.current!.seek(1.5);
  return container;
}

test("boxMaxWidth is the room the box has on stage times 0.95", () => {
  expect(boxMaxWidth({ x: 0.5, y: 0.5 }, "center")).toBe("95%");
  expect(boxMaxWidth({ x: 0.27, y: 0.5 }, "center")).toBe("51.3%");
  expect(boxMaxWidth({ x: 0.73, y: 0.5 }, "center")).toBe("51.3%");
  expect(boxMaxWidth({ x: 0.8, y: 0.5 }, "right")).toBe("76%");
  expect(boxMaxWidth({ x: 0.2, y: 0.5 }, "left")).toBe("76%");
  expect(boxMaxWidth({ x: 0.2, y: 0.5 })).toBe("76%");
});

test("boxMaxWidth clamps x to [0, 1] and never goes negative", () => {
  expect(boxMaxWidth({ x: -0.1, y: 0 }, "center")).toBe("0%");
  expect(boxMaxWidth({ x: 1.2, y: 0 }, "center")).toBe("0%");
  expect(boxMaxWidth({ x: -0.1, y: 0 }, "left")).toBe("95%");
  expect(boxMaxWidth({ x: 1.2, y: 0 }, "left")).toBe("0%");
  expect(boxMaxWidth({ x: -0.1, y: 0 }, "right")).toBe("0%");
  expect(boxMaxWidth({ x: 1.2, y: 0 }, "right")).toBe("95%");
});

test("a positioned centred text line's box is capped to the room it has", () => {
  const c = mount([{ kind: "text", value: "A long centred sentence", in: "fade", align: "center", pos: { x: 0.27, y: 0.4 } }]);
  const box = c.querySelector<HTMLElement>(".cin__text--pos")!;
  expect(box).not.toBeNull();
  expect(box.classList.contains("cin__text--c")).toBe(true);
  expect(box.style.width).toBe("max-content");
  expect(box.style.maxWidth).toBe("51.3%");
});

test("a left/right positioned box is capped by its open side", () => {
  const c = mount([
    { kind: "text", value: "Left", in: "fade", pos: { x: 0.2, y: 0.3 } },
    { kind: "text", value: "Right", in: "fade", align: "right", pos: { x: 0.8, y: 0.6 } },
  ]);
  const boxes = Array.from(c.querySelectorAll<HTMLElement>(".cin__text--pos"));
  expect(boxes.map((b) => b.style.maxWidth)).toEqual(["76%", "76%"]);
});

test("a non-positioned line gets none of it", () => {
  const c = mount([{ kind: "text", value: "Plain line", in: "fade", align: "center" }]);
  expect(c.querySelector(".cin__text--pos")).toBeNull();
  const shared = c.querySelector<HTMLElement>(".cin__text")!;
  expect(shared.style.width).toBe("");
  expect(shared.style.maxWidth).toBe("");
});

test("the intro scene keeps its no-wrap lines: no inline width cap, and the intro rule follows the wrap rule", () => {
  const c = mount([{ kind: "text", value: "A long centred intro line", in: "fade", align: "center", pos: { x: 0.27, y: 0.4 } }], "intro");
  expect(c.querySelector(".cin--intro")).not.toBeNull();
  const box = c.querySelector<HTMLElement>(".cin__text--pos")!;
  expect(box.style.maxWidth).toBe("");
  expect(box.style.width).toBe("");
  const css = Array.from(c.querySelectorAll("style")).map((s) => s.textContent).join("");
  const wrap = css.indexOf(".cin__text.cin__text--pos .cin__line");
  const intro = css.indexOf(".cin--intro .cin__text--pos .cin__line { white-space: nowrap");
  expect(wrap).toBeGreaterThan(-1);
  expect(intro).toBeGreaterThan(wrap);
});
