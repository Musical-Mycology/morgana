import { expect, test } from "vitest";
import { newAction, ADDABLE_KINDS, descriptorFor } from "@/lib/editor/registry";

test("newAction returns a valid default for each kind", () => {
  expect(newAction("text")).toEqual({ kind: "text", value: "New line", in: "fade" });
  expect(newAction("wait")).toEqual({ kind: "wait", ms: 500 });
  expect(newAction("click_gate")).toEqual({ kind: "click_gate" });
  expect(newAction("nightlight")).toMatchObject({ kind: "nightlight", to: 0.6 });
  expect(newAction("counter_show")).toMatchObject({ kind: "counter_show", pos: { x: 0.5, y: 0.5 } });
});

test("ADDABLE_KINDS is a non-empty list of { kind, label } and every entry has a descriptor", () => {
  expect(ADDABLE_KINDS.length).toBeGreaterThan(8);
  for (const k of ADDABLE_KINDS) {
    expect(typeof k.kind).toBe("string");
    expect(typeof k.label).toBe("string");
    expect(descriptorFor({ kind: k.kind }).label).not.toBe(k.kind); // a real (non-generic) descriptor
  }
});

test("gap-filled kinds resolve to real descriptors", () => {
  expect(descriptorFor({ kind: "stop_notes" }).label).toBe("Stop notes");
  expect(descriptorFor({ kind: "counter_hide" }).schema.map((f) => f.key)).toContain("durationMs");
  expect(descriptorFor({ kind: "media_out" }).schema.map((f) => f.key)).toContain("id");
  expect(descriptorFor({ kind: "pulse_arrow" }).schema.map((f) => f.key)).toContain("which");
});
