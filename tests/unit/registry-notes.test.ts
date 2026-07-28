import { expect, test } from "vitest";
import { descriptorFor } from "@/lib/editor/registry";
import { isSeekable } from "@/engine/authoring/beat-clock";
import type { Action } from "@/engine/deck/types";

test("all four note kinds have real descriptors, not the GENERIC fallback", () => {
  for (const kind of ["note_emitter", "note_circle", "stop_notes", "stop_circle"]) {
    const d = descriptorFor({ kind } as never);
    expect(d.label).not.toBe(kind);            // GENERIC uses the raw kind as its label
    expect(d.icon).not.toBe("ti-square");      // GENERIC's icon
    expect(d.seekable).toBe(true);
  }
});

test("note_emitter exposes every authorable field and a sane decay default", () => {
  const d = descriptorFor({ kind: "note_emitter" } as never);
  const keys = d.schema.map((f) => f.key);
  expect(keys).toEqual(expect.arrayContaining(["color", "pos.x", "pos.y", "dir", "var", "decay", "freq"]));
  const def = d.defaults() as Extract<Action, { kind: "note_emitter" }>;
  expect(def.decay).toBe(1000);   // was 1 (one millisecond!), silently clamped to 0.1s
});

test("note_circle exposes its geometry; hex is a documented gap", () => {
  const d = descriptorFor({ kind: "note_circle" } as never);
  const keys = d.schema.map((f) => f.key);
  expect(keys).toEqual(expect.arrayContaining(["pos.x", "pos.y", "width", "height", "bounce", "notes", "speed"]));
  expect(keys).not.toContain("hex");   // string[] — no array FieldType exists yet
  const def = d.defaults() as Extract<Action, { kind: "note_circle" }>;
  expect(def.hex.length).toBeGreaterThan(0);
});

test("cue is the only non-seekable kind left", () => {
  expect(isSeekable({ kind: "note_emitter", color: "#fff", pos: { x: 0, y: 0 }, dir: 0, decay: 1000, freq: 5 })).toBe(true);
  expect(isSeekable({ kind: "note_circle", pos: { x: 0, y: 0 }, width: 0.2, height: 0.2, hex: ["#fff"] })).toBe(true);
  expect(isSeekable({ kind: "cue", cue: { effect: "noteEmit", action: "start" } })).toBe(false);
  expect(descriptorFor({ kind: "cue" } as never).seekable).toBe(false);
});
