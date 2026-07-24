import { REGISTRY } from "@/lib/editor/registry";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { destructiveHint?: boolean };
}

const ACTION_KINDS = Object.keys(REGISTRY);

const DECK_ID = { deck_id: { type: "string", description: "Deck id, as returned by list_decks." } };
const BEAT_INDEX = { beat_index: { type: "number", description: "Flat (filmstrip-order) beat index, 0-based." } };
const SCENE_INDEX = { scene_index: { type: "number", description: "Scene index in document order, 0-based." } };
const ACTION_INDEX = { action_index: { type: "number", description: "Index of the action within the beat's timeline, 0-based." } };
const DIR = { dir: { type: "number", enum: [-1, 1], description: "-1 to move earlier/left, 1 to move later/right." } };

function schema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "list_decks",
    description: "List all decks in this Morgana instance, with id and title.",
    inputSchema: schema({}, []),
  },
  {
    name: "read_deck",
    description: "Read the full JSON document for one deck: all scenes, beats, and actions.",
    inputSchema: schema({ ...DECK_ID }, ["deck_id"]),
  },
  {
    name: "insert_beat_after",
    description: "Insert a new, empty beat immediately after the given beat.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX }, ["deck_id", "beat_index"]),
  },
  {
    name: "duplicate_beat_at",
    description: "Duplicate the given beat, inserting the copy immediately after it.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX }, ["deck_id", "beat_index"]),
  },
  {
    name: "delete_beat_at",
    description: "Delete the given beat.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX }, ["deck_id", "beat_index"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "move_beat_by",
    description: "Move a beat one position in filmstrip order (dir -1 = earlier, 1 = later). Within a scene this swaps with the neighbouring beat; at a scene edge it moves the beat into the adjacent scene. Only a no-op when there is no adjacent scene in that direction.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...DIR }, ["deck_id", "beat_index", "dir"]),
  },
  {
    name: "append_scene",
    description: "Append a new scene (with one empty beat) to the end of the deck.",
    inputSchema: schema({ ...DECK_ID }, ["deck_id"]),
  },
  {
    name: "move_scene_by",
    description: "Swap a scene with its neighbour (dir -1 = earlier, 1 = later). No-op at either end of the deck.",
    inputSchema: schema({ ...DECK_ID, ...SCENE_INDEX, ...DIR }, ["deck_id", "scene_index", "dir"]),
  },
  {
    name: "append_beat_to_scene",
    description: "Append a new beat to the end of a scene, addressed by scene index. Use this to fill a scene that has no beats, which no flat beat index can address.",
    inputSchema: schema({ ...DECK_ID, ...SCENE_INDEX }, ["deck_id", "scene_index"]),
  },
  {
    name: "delete_scene_at",
    description: "Delete a whole scene and all of its beats. Give exactly one of beat_index (deletes the scene containing that beat) or scene_index (deletes that scene directly, including one with no beats).",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...SCENE_INDEX }, ["deck_id"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "insert_action_after",
    description: "Insert a new action of the given kind into a beat's timeline, immediately after action_index (or at the end if action_index is omitted).",
    inputSchema: schema({
      ...DECK_ID, ...BEAT_INDEX,
      action_index: { type: ["number", "null"], description: "Insert after this action index, or omit/null to append." },
      kind: { type: "string", enum: ACTION_KINDS, description: "Action kind to insert, with its registry defaults." },
    }, ["deck_id", "beat_index", "kind"]),
  },
  {
    name: "duplicate_action_at",
    description: "Duplicate the given action within its beat's timeline, inserting the copy immediately after it.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX }, ["deck_id", "beat_index", "action_index"]),
  },
  {
    name: "delete_action_at",
    description: "Delete the given action from its beat's timeline.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX }, ["deck_id", "beat_index", "action_index"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "move_action_by",
    description: "Swap the given action with its neighbor within the same beat's timeline (dir -1 = earlier, 1 = later). No-op at a timeline boundary.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX, ...DIR }, ["deck_id", "beat_index", "action_index", "dir"]),
  },
  {
    name: "convert_action_kind",
    description: "Replace an action with a different kind's defaults (fields are not preserved across the conversion).",
    inputSchema: schema({
      ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX,
      new_kind: { type: "string", enum: ACTION_KINDS },
    }, ["deck_id", "beat_index", "action_index", "new_kind"]),
  },
  {
    name: "update_action",
    description: "Set a single field on an existing action, addressed by a dot-path (e.g. \"value\", \"pos.x\", \"art.mode\"). Use read_deck first to see current fields, or convert_action_kind/insert_action_after to see a kind's default field set.",
    inputSchema: schema({
      ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX,
      path: { type: "string", description: "Dot-path into the action, e.g. \"value\" or \"pos.x\"." },
      value: { description: "New value for the field. Type depends on the field." },
    }, ["deck_id", "beat_index", "action_index", "path", "value"]),
  },
  {
    name: "update_meta",
    description: "Set a single field on the deck's metadata, addressed by a dot-path (e.g. \"title\", \"chrome.wordmark\").",
    inputSchema: schema({
      ...DECK_ID,
      path: { type: "string" },
      value: { description: "New value for the field." },
    }, ["deck_id", "path", "value"]),
  },
];
