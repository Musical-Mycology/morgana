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
