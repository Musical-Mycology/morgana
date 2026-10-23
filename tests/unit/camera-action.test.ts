import { describe, expect, test } from "vitest";
import { actionDuration } from "@/engine/authoring/beat-clock";
import { validateDeckDoc } from "@/engine/deck-doc";
import { REGISTRY } from "@/lib/editor/registry";
import { TOOL_DEFS } from "@/lib/mcp/tool-defs";
import type { Action } from "@/engine/deck/types";

function deckWith(camera: unknown) {
  return {
    version: 1,
    meta: { id: "cam", title: "Cam" },
    scenes: [{ id: "s0", beats: [{ id: "b0", timeline: [{ kind: "wait", ms: 10 }, camera] }] }],
  };
}
const AT = "scenes[0].beats[0].timeline[1]";

describe("camera action", () => {
  test("occupies no beat-timeline time", () => {
    expect(actionDuration({ kind: "camera", to: { zoom: 2 } })).toBe(0);
  });

  test("a valid camera action produces no errors", () => {
    const r = validateDeckDoc(deckWith({ kind: "camera", to: { zoom: 2, x: 0.5, y: 0.5 }, durationMs: 1200, ease: "inOut" }));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(validateDeckDoc(deckWith({ kind: "camera", to: { zoom: 1 } })).ok).toBe(true);
  });

  test.each([
    ["empty to", { kind: "camera", to: {} }, "camera needs at least one of x, y, zoom"],
    ["zoom below 1", { kind: "camera", to: { zoom: 0.5 } }, ".to.zoom must be 1–8"],
    ["zoom above 8", { kind: "camera", to: { zoom: 9 } }, ".to.zoom must be 1–8"],
    ["x above 1", { kind: "camera", to: { x: 1.2 } }, ".to.x must be 0–1"],
    ["negative duration", { kind: "camera", to: { zoom: 2 }, durationMs: -1 }, ".durationMs must be a finite number ≥ 0"],
    ["unknown ease", { kind: "camera", to: { zoom: 2 }, ease: "bounce" }, ".ease must be one of"],
  ])("rejects %s", (_n, action, frag) => {
    const r = validateDeckDoc(deckWith(action));
    expect(r.ok).toBe(false);
    expect(r.errors.some((m) => m.startsWith(AT) && m.includes(frag))).toBe(true);
  });

  test("registry entry", () => {
    const d = REGISTRY.camera;
    expect(d.label).toBe("Camera");
    expect(d.icon).toBe("ti-zoom-in");
    expect(d.seekable).toBe(true);
    expect(d.defaults()).toEqual({ kind: "camera", to: { zoom: 2, x: 0.5, y: 0.5 }, durationMs: 1200, ease: "inOut" } satisfies Action);
    const by = Object.fromEntries(d.schema.map((f) => [f.key, f]));
    expect(d.schema.map((f) => f.key).sort()).toEqual(["durationMs", "ease", "to.x", "to.y", "to.zoom"]);
    expect(by["to.zoom"]).toMatchObject({ type: "range", min: 1, max: 8, step: 0.05 });
    expect(by["to.x"]).toMatchObject({ type: "number", min: 0, max: 1, step: 0.01 });
    expect(by["to.y"]).toMatchObject({ type: "number", min: 0, max: 1, step: 0.01 });
    expect(by.durationMs).toMatchObject({ type: "number", min: 0, step: 50 });
    expect(by.ease.type).toBe("select");
    expect(by.ease.options?.map((o) => o.value)).toEqual(["inOut", "in", "out", "linear"]);
  });

  test("MCP action kinds include camera", () => {
    const insert = TOOL_DEFS.find((t) => t.name === "insert_action_after")!;
    const kind = (insert.inputSchema.properties as Record<string, { enum?: string[] }>).kind;
    expect(kind.enum).toContain("camera");
  });
});
