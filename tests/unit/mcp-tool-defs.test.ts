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
