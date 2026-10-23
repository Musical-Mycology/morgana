import { expect, test } from "vitest";
import { renderBeatAt } from "@/engine/authoring/seek";

test("a text action with pos renders absolutely at its normalized point", () => {
  const host = document.createElement("div");
  renderBeatAt([{ kind: "text", value: "Placed", in: "fade", pos: { x: 0.5, y: 0.3 } }], 99, { textHost: host, art: null });
  const p = host.querySelector("p")!;
  expect(p.style.position).toBe("absolute");
  expect(p.style.left).toBe("50%");
  expect(p.style.top).toBe("30%");
});

test("art carries the transition's clip options through to ArtStage", () => {
  const host = document.createElement("div");
  const calls: unknown[][] = [];
  const art = {
    show: (...a: unknown[]) => calls.push(["show", ...a]),
    snap: (...a: unknown[]) => calls.push(["snap", ...a]),
    apply: () => {}, renderState: () => {},
  };
  const clips = { "media:a.mp4": { in: 2 } } as const;
  const tl = [{ kind: "art", art: { to: "media:a.mp4", mode: "fade", durationMs: 1000, clips } }, { kind: "wait", ms: 2000 }] as Parameters<typeof renderBeatAt>[0];
  renderBeatAt(tl, 0.5, { textHost: host, art }); // art is instantaneous on the beat clock: settled → snap
  expect(calls).toEqual([["snap", ["media:a.mp4"], clips]]);
});
