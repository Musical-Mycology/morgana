import type { Action, TextIn } from "@/engine/deck/types";

export type FieldType = "text" | "textarea" | "number" | "select" | "range";
export interface Field { key: string; label: string; type: FieldType; options?: { value: string; label: string }[]; min?: number; max?: number; step?: number; }
export interface EffectDescriptor { kind: string; label: string; icon: string; schema: Field[]; seekable: boolean; }

const opts = (...vs: string[]) => vs.map((v) => ({ value: v, label: v }));
const TEXT_INS: TextIn[] = ["flyUp", "fade", "fadeSide", "cursive", "letterFly", "letterUp", "wordUp", "blurIn", "typewriter"];
const ART_MODES = ["cut", "fade", "crossfade", "morph", "dissolve"];

export const REGISTRY: Record<string, EffectDescriptor> = {
  text: { kind: "text", label: "Text", icon: "ti-text-caption", seekable: true, schema: [
    { key: "value", label: "Value", type: "textarea" },
    { key: "in", label: "Effect", type: "select", options: TEXT_INS.map((v) => ({ value: v, label: v })) },
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
    { key: "align", label: "Align", type: "select", options: opts("left", "center", "right") },
    { key: "speed", label: "Speed", type: "range", min: 0.2, max: 3, step: 0.1 },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
  ] },
  wait: { kind: "wait", label: "Wait", icon: "ti-clock", seekable: true, schema: [{ key: "ms", label: "Milliseconds", type: "number", min: 0, step: 50 }] },
  art: { kind: "art", label: "Art", icon: "ti-photo", seekable: true, schema: [
    { key: "art.to", label: "Panel(s)", type: "text" },
    { key: "art.mode", label: "Transition", type: "select", options: ART_MODES.map((v) => ({ value: v, label: v })) },
    { key: "art.durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  nightlight: { kind: "nightlight", label: "Nightlight", icon: "ti-moon", seekable: true, schema: [
    { key: "to", label: "Level (0-1)", type: "range", min: 0, max: 1, step: 0.05 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  click_gate: { kind: "click_gate", label: "Click gate", icon: "ti-hand-click", seekable: true, schema: [] },
  clear: { kind: "clear", label: "Clear", icon: "ti-eraser", seekable: true, schema: [] },
  fade_out: { kind: "fade_out", label: "Fade out", icon: "ti-square-rounded-x", seekable: true, schema: [{ key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 }] },
  note_emitter: { kind: "note_emitter", label: "Note emitter", icon: "ti-music", seekable: false, schema: [
    { key: "color", label: "Color", type: "text" },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "freq", label: "Notes/sec", type: "number", min: 0, step: 0.5 },
  ] },
};

const GENERIC = (kind: string): EffectDescriptor => ({ kind, label: kind, icon: "ti-square", seekable: kind !== "note_circle" && kind !== "cue", schema: [] });

export function descriptorFor(a: Pick<Action, "kind"> & Record<string, unknown>): EffectDescriptor {
  return REGISTRY[a.kind] ?? GENERIC(a.kind);
}
