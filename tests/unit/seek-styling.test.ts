import { expect, test } from "vitest";
import { renderBeatAt } from "@/engine/authoring/seek";

test("bold/italic/size render as inline styles on the line", () => {
  const host = document.createElement("div");
  renderBeatAt([{ kind: "text", value: "Styled", in: "fade", bold: true, italic: true, size: "xl" }], 99, { textHost: host, art: null });
  const p = host.querySelector("p")!;
  expect(p.style.fontWeight).toBe("700");
  expect(p.style.fontStyle).toBe("italic");
  expect(p.style.fontSize).not.toBe("");
  expect(p.className).toContain("cin__line--xl");
});

test("unstyled text leaves weight/style unset", () => {
  const host = document.createElement("div");
  renderBeatAt([{ kind: "text", value: "Plain", in: "fade" }], 99, { textHost: host, art: null });
  const p = host.querySelector("p")!;
  expect(p.style.fontWeight).toBe("");
  expect(p.style.fontStyle).toBe("");
});
