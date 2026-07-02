import { expect, test } from "vitest";
import { descriptorFor, REGISTRY } from "@/lib/editor/registry";

test("every REGISTRY kind has a defaults() producing an action of that kind", () => {
  for (const kind of Object.keys(REGISTRY)) {
    const action = descriptorFor({ kind } as never).defaults();
    expect(action.kind).toBe(kind);
  }
});

test("text defaults match the existing newBeat() default line", () => {
  const a = descriptorFor({ kind: "text" } as never).defaults();
  expect(a).toMatchObject({ kind: "text", value: "New line", in: "fade" });
});

test("wait defaults to a positive duration", () => {
  const a = descriptorFor({ kind: "wait" } as never).defaults() as { kind: "wait"; ms: number };
  expect(a.ms).toBeGreaterThan(0);
});

test("note_emitter defaults satisfy its required fields", () => {
  const a = descriptorFor({ kind: "note_emitter" } as never).defaults() as {
    kind: "note_emitter"; color: string; pos: { x: number; y: number }; dir: number; decay: number; freq: number;
  };
  expect(typeof a.color).toBe("string");
  expect(a.pos).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  expect(typeof a.dir).toBe("number");
  expect(typeof a.decay).toBe("number");
  expect(typeof a.freq).toBe("number");
});

test("media and media_move defaults include required id + point fields", () => {
  const media = descriptorFor({ kind: "media" } as never).defaults() as { kind: "media"; id: string; pos: { x: number; y: number } };
  expect(typeof media.id).toBe("string");
  expect(media.pos).toBeDefined();
  const move = descriptorFor({ kind: "media_move" } as never).defaults() as { kind: "media_move"; id: string; to: { x: number; y: number } };
  expect(typeof move.id).toBe("string");
  expect(move.to).toBeDefined();
});

test("GENERIC fallback still resolves (defaults() is unreachable from the UI but must not throw)", () => {
  expect(() => descriptorFor({ kind: "stop_notes" } as never).defaults()).not.toThrow();
});
