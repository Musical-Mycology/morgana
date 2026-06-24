import { expect, test } from "vitest";
import { descriptorFor } from "@/lib/editor/registry";
test("text descriptor exposes the editable fields", () => {
  const d = descriptorFor({ kind: "text", value: "x", in: "fade" });
  expect(d.kind).toBe("text");
  expect(d.schema.map((f) => f.key)).toEqual(expect.arrayContaining(["value", "in", "speed", "pos.x", "pos.y"]));
  expect(d.seekable).toBe(true);
});
test("every Action kind resolves to a descriptor (generic fallback)", () => {
  for (const kind of ["text","wait","art","nightlight","click_gate","clear","fade_out","note_emitter","counter_show","media"] as const) {
    expect(descriptorFor({ kind } as never).kind).toBeDefined();
  }
});
test("note_emitter is non-seekable", () => {
  expect(descriptorFor({ kind: "note_emitter" } as never).seekable).toBe(false);
});
