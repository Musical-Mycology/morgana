import { expect, test } from "vitest";
import { renderBeatAt } from "@/engine/authoring/seek";
import type { Action } from "@/engine/deck/types";

test("clear resets text so a clear -> text sequence does not stack", () => {
  const host = document.createElement("div");
  const tl: Action[] = [{ kind: "text", value: "A", in: "fade" }, { kind: "clear" }, { kind: "text", value: "B", in: "fade" }];
  renderBeatAt(tl, 99, { textHost: host, art: null });
  expect(host.textContent).toContain("B");
  expect(host.textContent).not.toContain("A");
});

test("nightlight calls setNight", () => {
  const host = document.createElement("div");
  let n = -1;
  renderBeatAt([{ kind: "nightlight", to: 0.8 }] as Action[], 99, { textHost: host, art: null, setNight: (v) => { n = v; } });
  expect(n).toBe(0.8);
});
