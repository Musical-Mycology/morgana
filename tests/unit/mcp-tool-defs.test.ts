import { expect, test } from "vitest";
import { TOOL_DEFS } from "@/lib/mcp/tool-defs";

test("every tool has a unique name, a description, and an object input schema", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of TOOL_DEFS) {
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.inputSchema.type).toBe("object");
  }
});

test("includes the full mutation surface", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining([
    "list_decks", "read_deck",
    "insert_beat_after", "duplicate_beat_at", "delete_beat_at", "move_beat_by",
    "append_scene", "delete_scene_at",
    "insert_action_after", "duplicate_action_at", "delete_action_at", "move_action_by", "convert_action_kind",
    "update_action", "update_meta",
  ]));
});

test("delete_scene_at and delete_action_at are marked destructive", () => {
  const byName = Object.fromEntries(TOOL_DEFS.map((t) => [t.name, t]));
  expect(byName.delete_scene_at.annotations?.destructiveHint).toBe(true);
  expect(byName.delete_action_at.annotations?.destructiveHint).toBe(true);
});

test("convert_action_kind's new_kind enum matches the effect registry", () => {
  const tool = TOOL_DEFS.find((t) => t.name === "convert_action_kind")!;
  const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
  expect(props.new_kind.enum).toContain("text");
  expect(props.new_kind.enum).toContain("obj_reveal");
});

test("includes the scene-structural tools", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(["move_scene_by", "append_beat_to_scene"]));
});

test("delete_scene_at accepts either a beat index or a scene index, requiring neither outright", () => {
  const tool = TOOL_DEFS.find((t) => t.name === "delete_scene_at")!;
  const props = tool.inputSchema.properties as Record<string, unknown>;
  expect(props.beat_index).toBeDefined();
  expect(props.scene_index).toBeDefined();
  expect(tool.inputSchema.required).toEqual(["deck_id"]);
});

test("move_beat_by's description reflects that it now crosses scene boundaries", () => {
  const tool = TOOL_DEFS.find((t) => t.name === "move_beat_by")!;
  expect(tool.description.toLowerCase()).toContain("scene");
  expect(tool.description.toLowerCase()).not.toContain("no-op at a scene boundary");
});

test("includes the timing tools", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(["set_scene_duration", "read_deck_timing"]));
  const upd = TOOL_DEFS.find((t) => t.name === "update_meta")!;
  expect(upd.description).toContain("timing.targetSec");
});

test("read_deck_timing explains that content shorter than a pinned length holds", () => {
  const tool = TOOL_DEFS.find((t) => t.name === "read_deck_timing")!;
  expect(tool.description).toMatch(/holds? (its|the) last frame until the boundary/);
});

test("includes the soundtrack tools with descriptions that state the contract", () => {
  const byName = Object.fromEntries(TOOL_DEFS.map((t) => [t.name, t]));
  expect(byName.list_media).toBeDefined();
  expect(byName.set_soundtrack.description).toMatch(/upload.*editor/i);
  expect(byName.set_soundtrack.description).toMatch(/0:00/);
  expect(byName.set_markers.description).toMatch(/replaces/i);
});

test("set_soundtrack does not promise exported video yet; update_meta points soundtrack edits at set_soundtrack", () => {
  const byName = Object.fromEntries(TOOL_DEFS.map((t) => [t.name, t]));
  expect(byName.set_soundtrack.description).toContain("in the timed Player (and in the MP4 export once that lands)");
  expect(byName.set_soundtrack.description).not.toMatch(/in exported video/);
  expect(byName.update_meta.description).toMatch(/soundtrack.*skips the media-list check.*use set_soundtrack/i);
});

test("action docs describe draw, particles, credits and screen_fade", () => {
  for (const name of ["insert_action_after", "update_action"]) {
    const d = TOOL_DEFS.find((t) => t.name === name)!.description;
    for (const word of ["\"draw\"", "particles", "credits", "screen_fade"]) expect(d, `${name}: ${word}`).toContain(word);
    expect(d, `${name}: append particles ignored`).toContain("append fragment is ignored");
    expect(d, `${name}: append not measured`).toContain("not measured for particles");
  }
});
