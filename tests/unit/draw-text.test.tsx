import { afterEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { CinematicSlide, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { DRAW_VARIANT, drawGlyphAt, drawSweepAt } from "@/engine/components/effects/draw-state";
import type { Action, Beat } from "@/engine/deck/types";

afterEach(cleanup);
const runtime = { art() {}, applyArt() {}, setNightlight() {}, onGate() {}, revealArrows() {}, pulseArrow() {}, onWaiting() {}, resolveEntry: () => [], resolveEnd: () => [], jumpTo() {} } as CinematicRuntime;
const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);

function mount(timeline: Action[], instantText = false) {
  const transport = createRef<SlideTransport>();
  const beat: Beat = { id: "d", timeline: [...timeline, { kind: "wait", ms: 1000 }] };
  const { container } = render(<CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={runtime} transport={transport} autoplay={false} instantText={instantText} />);
  return { transport, container };
}

test("a draw line is an SVG <text> with one <tspan> per character over a hidden HTML ghost", () => {
  const { transport, container } = mount([{ kind: "text", value: "Hi you", in: "draw", size: "md", align: "center" }]);
  transport.current!.seek(0.09);
  const p = container.querySelector<HTMLElement>(".cin__line--draw")!;
  expect(p.classList.contains("cin__line--md")).toBe(true);
  expect(p.style.textAlign).toBe("center");
  expect(p.getAttribute("aria-label")).toBe("Hi you");
  expect(p.querySelector(".cin__draw-ghost")!.textContent).toBe("Hi you");
  const spans = Array.from(p.querySelectorAll(".cin__draw tspan")).map((t) => t.textContent);
  expect(spans).toEqual(["H", "i", " ", "y", "o", "u"]);
  expect(p.querySelector(".cin__draw")!.getAttribute("aria-hidden")).toBe("true");
});

test("seek paints each glyph from drawGlyphAt (in-flight) and the settled end state", () => {
  const { transport, container } = mount([{ kind: "text", value: "Hi you", in: "draw" }]);
  const glyphs = () => Array.from(container.querySelectorAll<SVGElement>(".cin__draw tspan"));
  const svg = () => container.querySelector<SVGElement>(".cin__draw")!;
  for (const t of [0, 0.09, 0.3, 0.7, 0.9]) {
    transport.current!.seek(t);
    glyphs().forEach((g, i) => {
      const s = drawGlyphAt(i, 6, t);
      if (DRAW_VARIANT === "dash") expect(g.style.getPropertyValue("--d"), `t=${t} i=${i}`).toBe(r4(s.dash));
      expect(g.style.getPropertyValue("--f")).toBe(r4(s.fill));
      expect(g.style.getPropertyValue("--s")).toBe(r4(s.stroke));
    });
    if (DRAW_VARIANT === "mask") expect(svg().style.getPropertyValue("--sweep")).toBe(r4(drawSweepAt(6, t)));
  }
  transport.current!.seek(1.5); // past introDuration 0.98: settled
  for (const g of glyphs()) {
    if (DRAW_VARIANT === "dash") expect(g.style.getPropertyValue("--d")).toBe("0");
    expect(g.style.getPropertyValue("--f")).toBe("1");
    expect(g.style.getPropertyValue("--s")).toBe("0");
  }
  transport.current!.seek(0.09); // backward: the same values as a fresh seek to 0.09
  expect(glyphs()[0].style.getPropertyValue("--f")).toBe("0");
});

test("Review Focus #5: inline markup, append, instantText, dots and an empty value fall back without an SVG", () => {
  const cases: [string, Action[], boolean][] = [
    ["markup", [{ kind: "text", value: "**Bold** words", in: "draw" }], false],
    ["append", [{ kind: "text", value: "Start", in: "fade" }, { kind: "text", value: " more", in: "draw", append: true }], false],
    ["instantText", [{ kind: "text", value: "Instant", in: "draw" }], true],
    ["dots", [{ kind: "text", value: "Hello there...", in: "draw", dots: true }], false],
    ["empty value", [{ kind: "text", value: "", in: "draw" }], false],
  ];
  for (const [name, tl, instant] of cases) {
    const { transport, container } = mount(tl, instant);
    for (const t of [0.1, 0.5, 3]) expect(() => transport.current!.seek(t), `${name} seek ${t}`).not.toThrow();
    expect(container.querySelector(".cin__draw"), `${name}: no .cin__draw`).toBeNull();
    expect(container.querySelector(".cin__line--draw"), `${name}: no draw line`).toBeNull();
    cleanup();
  }
  const inst = mount([{ kind: "text", value: "Instant", in: "draw" }], true);
  inst.transport.current!.seek(0.1);
  expect(inst.container.querySelector(".cin__line")!.textContent).toBe("Instant");
});
