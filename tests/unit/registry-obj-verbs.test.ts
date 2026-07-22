// tests/unit/registry-obj-verbs.test.ts
import { expect, test } from "vitest";
import { descriptorFor } from "@/lib/editor/registry";
import { getPath } from "@/lib/editor/paths";

test("each obj verb has a registry descriptor whose defaults set an empty target", () => {
  for (const kind of ["obj_reveal", "obj_move", "obj_out"] as const) {
    const d = descriptorFor({ kind });
    expect(d.kind).toBe(kind);
    expect(d.seekable).toBe(true);
    const def = d.defaults() as Record<string, unknown>;
    expect(def.kind).toBe(kind);
    expect(def.target).toBe("");
  }
});

test("obj_reveal defaults to a fade entrance and obj_move to an empty to", () => {
  expect((descriptorFor({ kind: "obj_reveal" }).defaults() as Record<string, unknown>).in).toBe("fade");
  expect((descriptorFor({ kind: "obj_move" }).defaults() as Record<string, unknown>).to).toEqual({});
});

test("every schema field key resolves via getPath on the default action", () => {
  for (const kind of ["obj_reveal", "obj_move", "obj_out"] as const) {
    const d = descriptorFor({ kind });
    const def = d.defaults();
    for (const f of d.schema) {
      expect(() => getPath(def, f.key)).not.toThrow();
    }
  }
});

test("the target field is typed objectRef", () => {
  expect(descriptorFor({ kind: "obj_reveal" }).schema.find((f) => f.key === "target")?.type).toBe("objectRef");
});
