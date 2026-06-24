import { expect, test } from "vitest";
import { getPath, setPath } from "@/lib/editor/paths";
test("get/set nested dotted paths immutably", () => {
  const a = { value: "hi", pos: { x: 0.1, y: 0.2 } };
  expect(getPath(a, "value")).toBe("hi");
  expect(getPath(a, "pos.x")).toBe(0.1);
  const b = setPath(a, "pos.x", 0.5);
  expect(getPath(b, "pos.x")).toBe(0.5);
  expect(a.pos.x).toBe(0.1);
  expect(setPath(a, "size", "lg")).toMatchObject({ size: "lg" });
});
