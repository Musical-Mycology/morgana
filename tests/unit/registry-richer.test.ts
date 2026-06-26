import { expect, test } from "vitest";
import { descriptorFor } from "@/lib/editor/registry";

test("counter_show exposes prefix/label/value + pos", () => {
  const keys = descriptorFor({ kind: "counter_show" } as never).schema.map((f) => f.key);
  expect(keys).toEqual(expect.arrayContaining(["prefix", "label", "value", "pos.x", "pos.y"]));
});

test("media exposes a checkbox field for round", () => {
  const round = descriptorFor({ kind: "media" } as never).schema.find((f) => f.key === "round");
  expect(round?.type).toBe("checkbox");
});

test("rotateList and counter_to/counter_add resolve to real descriptors", () => {
  expect(descriptorFor({ kind: "rotateList" } as never).label).toBe("Rotating list");
  expect(descriptorFor({ kind: "counter_to" } as never).schema.map((f) => f.key)).toContain("value");
  expect(descriptorFor({ kind: "counter_add" } as never).schema.map((f) => f.key)).toContain("delta");
});
