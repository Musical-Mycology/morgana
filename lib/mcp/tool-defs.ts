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
    description: "Insert a new action of the given kind into a beat's timeline, immediately after action_index (or at the end if action_index is omitted). camera actions pan/zoom the world layers (art, tiles, notes, objects; text stays fixed): to {x,y,zoom 1–8}, durationMs (0 = cut), ease inOut|in|out|linear; a framing holds until the next camera action. A text action with in \"draw\" traces each glyph's outline, then fills it. particles {color: cream|cyan|lime|pink or a hex, rate 1–30 notes/s (default 6), rise (default 1)} on a text or credits action emits music notes off its words; particles on an append fragment is ignored, and text added with append is not measured for particles. credits actions roll items [{role?, names[]}] upward through area {x,y,w,h} (default 0.2,0.32,0.6,0.63) over durationMs, and the beat waits for the roll. screen_fade fades the whole frame to `to` (0–1) in color (a hex, default #000) over durationMs (default 1000, 0 = cut); the level holds until the next screen_fade.",
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
    description: "Set a single field on an existing action, addressed by a dot-path (e.g. \"value\", \"pos.x\", \"art.mode\"). Art layers (`art.to`/`keep`/`out`) and a media tile's `src` accept `media:<id>` refs from list_media; set video clip options with `art.clips` (keyed by ref) or the tile's `clip` (`{ in, loop }`). Use read_deck first to see current fields, or convert_action_kind/insert_action_after to see a kind's default field set. camera actions pan/zoom the world layers (art, tiles, notes, objects; text stays fixed): to {x,y,zoom 1–8}, durationMs (0 = cut), ease inOut|in|out|linear; a framing holds until the next camera action. A text action with in \"draw\" traces each glyph's outline, then fills it. particles {color: cream|cyan|lime|pink or a hex, rate 1–30 notes/s (default 6), rise (default 1)} on a text or credits action emits music notes off its words; particles on an append fragment is ignored, and text added with append is not measured for particles. credits actions roll items [{role?, names[]}] upward through area {x,y,w,h} (default 0.2,0.32,0.6,0.63) over durationMs, and the beat waits for the roll. screen_fade fades the whole frame to `to` (0–1) in color (a hex, default #000) over durationMs (default 1000, 0 = cut); the level holds until the next screen_fade.",
    inputSchema: schema({
      ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX,
      path: { type: "string", description: "Dot-path into the action, e.g. \"value\" or \"pos.x\"." },
      value: { description: "New value for the field. Type depends on the field." },
    }, ["deck_id", "beat_index", "action_index", "path", "value"]),
  },
  {
    name: "update_meta",
    description: "Set a single field on the deck's metadata, addressed by a dot-path (e.g. \"title\", \"chrome.wordmark\"). To make a timed (video) deck, set \"timing.targetSec\" to the intended total length in seconds (e.g. 120); set \"timing\" to null to make it untimed again. Setting \"soundtrack\" directly skips the media-list check (a typo leaves the deck pointing at a missing file) — use set_soundtrack instead.",
    inputSchema: schema({
      ...DECK_ID,
      path: { type: "string" },
      value: { description: "New value for the field." },
    }, ["deck_id", "path", "value"]),
  },
  {
    name: "set_scene_duration",
    description: "Pin a scene's length in seconds for timed playback, or pass seconds: null to un-pin it (length then follows the scene's content). A pinned scene always occupies exactly that long, so later scenes never move: if its beats finish early the last frame holds until the boundary; if they run longer, playback cuts them at the boundary (read_deck_timing reports the overrun).",
    inputSchema: schema({
      ...DECK_ID, ...SCENE_INDEX,
      seconds: { type: ["number", "null"], description: "Length in seconds (> 0), or null to un-pin." },
    }, ["deck_id", "scene_index", "seconds"]),
  },
  {
    name: "read_deck_timing",
    description: "Read-only. Returns the deck's computed time layout: targetSec (null if untimed), total seconds, and per scene its id, start, length, contentLength, pinned flag, overrunSec (content cut off past a pinned boundary), and each beat's flat index, id, scene-local start and duration. A pinned scene's length can exceed its contentLength: content that finishes before the pinned length holds its last frame until the boundary (no overrun, nothing cut). Use this instead of summing action durations yourself.",
    inputSchema: schema({ ...DECK_ID }, ["deck_id"]),
  },
  {
    name: "list_media",
    description: "Read-only. Lists the files in this deck's media store (id, original name, mime type, kind: video/image/audio, size in bytes, uploadedAt, and durationSec when known). Media is uploaded by the user in the editor, or via POST /api/decks/<id>/media (multipart `file`, optional `durationSec`); it cannot be uploaded over MCP. Images and video are used as `media:<id>` refs: as art `to`/`keep`/`out` layers and as a media tile's `src`. Clip options (video only): `art.clips[\"media:<id>\"] = { in?: seconds, loop?: boolean }` on the art transition, or `clip` on the media tile.",
    inputSchema: schema({ ...DECK_ID }, ["deck_id"]),
  },
  {
    name: "set_soundtrack",
    description: "Set the deck's soundtrack to an audio media id from list_media (kind \"audio\"; an image or video is rejected), or pass media_id: null to remove it. The soundtrack is one pre-mixed track that plays from deck time 0:00 in the timed Player (and in the MP4 export once that lands); its length should match the deck's total (read_deck_timing). Files must be uploaded in the editor first — binary uploads are not possible over MCP. Removing the soundtrack keeps the file in the media store.",
    inputSchema: schema({
      ...DECK_ID,
      media_id: { type: ["string", "null"], description: "A media id from list_media, or null to remove the soundtrack." },
    }, ["deck_id", "media_id"]),
  },
  {
    name: "set_markers",
    description: "Replaces the deck's whole list of cue markers. A marker is a named deck-time point (e.g. { id: \"m1\", label: \"drop\", t: 40.2 }) shown as a tick on the editor ruler and the Player scrubber — use them to line scene lengths up with the music. ids must be unique and non-empty, labels 1–40 characters, t ≥ 0 seconds. Pass [] to clear all markers.",
    inputSchema: schema({
      ...DECK_ID,
      markers: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, t: { type: "number" } }, required: ["id", "label", "t"] } },
    }, ["deck_id", "markers"]),
  },
];
