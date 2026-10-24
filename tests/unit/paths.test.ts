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

test("setPath with undefined deletes the key (no undefined-valued keys left behind)", () => {
  const a = { kind: "camera", to: { zoom: 2, x: 0.3, y: 0.4 } };
  const b = setPath(a, "to.x", undefined);
  expect(b.to).toEqual({ zoom: 2, y: 0.4 });
  expect("x" in b.to).toBe(false);
  expect(a.to.x).toBe(0.3); // immutable
  expect("size" in setPath({ size: "lg", v: 1 }, "size", undefined)).toBe(false);
});
