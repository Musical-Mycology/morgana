import type { Action, TextIn } from "@/engine/deck/types";

export type FieldType = "text" | "textarea" | "number" | "select" | "range" | "checkbox";
export interface Field { key: string; label: string; type: FieldType; options?: { value: string; label: string }[]; min?: number; max?: number; step?: number; }
export interface EffectDescriptor { kind: string; label: string; icon: string; schema: Field[]; seekable: boolean; }

const opts = (...vs: string[]) => vs.map((v) => ({ value: v, label: v }));
const TEXT_INS: TextIn[] = ["flyUp", "fade", "fadeSide", "cursive", "letterFly", "letterUp", "wordUp", "blurIn", "typewriter"];
const ART_MODES = ["cut", "fade", "crossfade", "morph", "dissolve"];
const MEDIA_INS = ["fade", "flyUp", "pop", "fadeSide"];

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
  rotateList: { kind: "rotateList", label: "Rotating list", icon: "ti-list", seekable: true, schema: [
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
  ] },
  counter_show: { kind: "counter_show", label: "Counter (show)", icon: "ti-number", seekable: true, schema: [
    { key: "prefix", label: "Prefix", type: "text" },
    { key: "label", label: "Label", type: "text" },
    { key: "value", label: "Start value", type: "number", step: 1 },
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
  ] },
  counter_to: { kind: "counter_to", label: "Counter → value", icon: "ti-number", seekable: true, schema: [
    { key: "value", label: "Target value", type: "number", step: 1 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  counter_add: { kind: "counter_add", label: "Counter +/−", icon: "ti-number", seekable: true, schema: [
    { key: "delta", label: "Delta", type: "number", step: 1 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  media: { kind: "media", label: "Media tile", icon: "ti-photo", seekable: true, schema: [
    { key: "id", label: "Tile id", type: "text" },
    { key: "src", label: "Source", type: "text" },
    { key: "label", label: "Placeholder label", type: "text" },
    { key: "width", label: "Width (0–1)", type: "range", min: 0.05, max: 0.6, step: 0.01 },
    { key: "in", label: "Reveal", type: "select", options: MEDIA_INS.map((v) => ({ value: v, label: v })) },
    { key: "round", label: "Round (headshot)", type: "checkbox" },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
  ] },
  media_move: { kind: "media_move", label: "Media move", icon: "ti-arrows-move", seekable: true, schema: [
    { key: "id", label: "Tile id", type: "text" },
    { key: "scale", label: "Scale", type: "range", min: 0.2, max: 3, step: 0.1 },
    { key: "to.x", label: "To X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "to.y", label: "To Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  counter_hide: { kind: "counter_hide", label: "Counter hide", icon: "ti-number", seekable: true, schema: [
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  media_out: { kind: "media_out", label: "Media out", icon: "ti-photo", seekable: true, schema: [
    { key: "id", label: "Tile id", type: "text" },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  // `hex` (string[]) is intentionally not exposed: no array-field type in the inspector yet; newAction sets a default palette.
  note_circle: { kind: "note_circle", label: "Note circle", icon: "ti-circle", seekable: false, schema: [
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "width", label: "Width (0–1)", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "height", label: "Height (0–1)", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "speed", label: "Ms per orbit", type: "number", min: 0, step: 100 },
  ] },
  stop_notes: { kind: "stop_notes", label: "Stop notes", icon: "ti-music-off", seekable: true, schema: [] },
  stop_circle: { kind: "stop_circle", label: "Stop circle", icon: "ti-circle-off", seekable: true, schema: [] },
  reveal_arrows: { kind: "reveal_arrows", label: "Reveal arrows", icon: "ti-arrows-right", seekable: true, schema: [] },
  reveal_again: { kind: "reveal_again", label: "Reveal 'again'", icon: "ti-repeat", seekable: true, schema: [] },
  pulse_arrow: { kind: "pulse_arrow", label: "Pulse arrow", icon: "ti-arrow-big-right", seekable: true, schema: [
    { key: "which", label: "Which", type: "select", options: [{ value: "next", label: "next" }, { value: "prev", label: "prev" }] },
    { key: "scale", label: "Scale", type: "number", min: 1, max: 6, step: 0.5 },
  ] },
};

const GENERIC = (kind: string): EffectDescriptor => ({ kind, label: kind, icon: "ti-square", seekable: kind !== "cue", schema: [] });

export function descriptorFor(a: Pick<Action, "kind"> & Record<string, unknown>): EffectDescriptor {
  return REGISTRY[a.kind] ?? GENERIC(a.kind);
}

/** A sensible default Action for each add-able kind (used by the timeline "add action" menu). */
export function newAction(kind: Action["kind"]): Action {
  switch (kind) {
    case "text": return { kind: "text", value: "New line", in: "fade" };
    case "rotateList": return { kind: "rotateList", items: ["One", "Two", "Three"] };
    case "clear": return { kind: "clear" };
    case "art": return { kind: "art", art: { to: "1.01", mode: "fade" } };
    case "nightlight": return { kind: "nightlight", to: 0.6 };
    case "note_emitter": return { kind: "note_emitter", color: "#d4a843", pos: { x: 0.5, y: 0.8 }, dir: 0, decay: 2000, freq: 4 };
    case "note_circle": return { kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.3, hex: ["#d4a843"] };
    case "stop_notes": return { kind: "stop_notes" };
    case "stop_circle": return { kind: "stop_circle" };
    case "click_gate": return { kind: "click_gate" };
    case "reveal_arrows": return { kind: "reveal_arrows" };
    case "reveal_again": return { kind: "reveal_again" };
    case "pulse_arrow": return { kind: "pulse_arrow", which: "next" };
    case "wait": return { kind: "wait", ms: 500 };
    case "fade_out": return { kind: "fade_out" };
    case "counter_show": return { kind: "counter_show", pos: { x: 0.5, y: 0.5 }, value: 0 };
    case "counter_to": return { kind: "counter_to", value: 100 };
    case "counter_add": return { kind: "counter_add", delta: 10 };
    case "counter_hide": return { kind: "counter_hide" };
    case "media": return { kind: "media", id: "tile", pos: { x: 0.5, y: 0.5 } };
    case "media_move": return { kind: "media_move", id: "tile", to: { x: 0.5, y: 0.5 } };
    case "media_out": return { kind: "media_out" };
    default: return { kind: "clear" };
  }
}

/** Kinds offered in the timeline "add action" menu, in author-friendly order. */
export const ADDABLE_KINDS: { kind: Action["kind"]; label: string }[] = (
  ["text", "rotateList", "wait", "click_gate", "clear", "fade_out", "art", "nightlight",
   "counter_show", "counter_to", "counter_add", "counter_hide",
   "media", "media_move", "media_out",
   "note_emitter", "note_circle", "stop_notes", "stop_circle",
   "reveal_arrows", "reveal_again", "pulse_arrow"] as Action["kind"][]
).map((kind) => ({ kind, label: (REGISTRY[kind]?.label ?? kind) }));
