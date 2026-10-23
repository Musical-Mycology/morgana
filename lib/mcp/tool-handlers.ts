import { loadDeck, saveDeck, listDecks } from "@/lib/store/deck-store";
import { validateDeckDoc, type DeckDoc, type DeckMarker } from "@/engine/deck-doc";
import { listMedia, mediaKind, type MediaInfo, type MediaKind } from "@/lib/store/media-store";
import {
  insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy,
  appendScene, deleteSceneAt, deleteSceneAtIndex, moveSceneBy, appendBeatToScene, setSceneDuration,
  insertActionAfter, duplicateActionAt, deleteActionAt, moveActionBy, convertActionKind,
} from "@/lib/editor/mutations";
import { beatLocation } from "@/lib/editor/flatten-beats";
import { setPath } from "@/lib/editor/paths";
import { deckLayout, sceneOverrun } from "@/engine/authoring/deck-clock";

export class ToolCallError extends Error {}

export interface DeckTiming {
  targetSec: number | null;
  total: number;
  scenes: {
    index: number; id: string; start: number; length: number; contentLength: number; pinned: boolean; overrunSec: number;
    beats: { flatIndex: number; id: string; start: number; duration: number }[];
  }[];
}

function args(rawArgs: unknown): Record<string, unknown> {
  return (rawArgs ?? {}) as Record<string, unknown>;
}

function requireString(a: Record<string, unknown>, key: string): string {
  const v = a[key];
  if (typeof v !== "string") throw new ToolCallError(`"${key}" must be a string`);
  return v;
}

function requireNumber(a: Record<string, unknown>, key: string): number {
  const v = a[key];
  if (typeof v !== "number") throw new ToolCallError(`"${key}" must be a number`);
  return v;
}

function optionalNumber(a: Record<string, unknown>, key: string): number | null {
  const v = a[key];
  if (v == null) return null;
  if (typeof v !== "number") throw new ToolCallError(`"${key}" must be a number or omitted`);
  return v;
}

function requireDir(a: Record<string, unknown>, key: string): -1 | 1 {
  const v = requireNumber(a, key);
  if (v !== -1 && v !== 1) throw new ToolCallError(`"${key}" must be -1 or 1`);
  return v;
}

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/** Guards against prototype-pollution via attacker-controlled dot-paths reaching `setPath`. */
function assertSafePath(path: string): void {
  for (const segment of path.split(".")) {
    if (UNSAFE_PATH_SEGMENTS.has(segment)) {
      throw new ToolCallError(`"${segment}" is not allowed in a path`);
    }
  }
}

async function mutate(deckId: string, f: (doc: DeckDoc) => DeckDoc): Promise<DeckDoc> {
  const doc = await loadDeck(deckId);
  const next = f(doc);
  const v = validateDeckDoc(next);
  if (!v.ok) throw new ToolCallError(`resulting deck would be invalid: ${v.errors.join(", ")}`);
  await saveDeck(next);
  return next;
}

export async function callTool(name: string, rawArgs: unknown): Promise<DeckDoc | { decks: Awaited<ReturnType<typeof listDecks>> } | DeckTiming | { media: Array<MediaInfo & { kind: MediaKind | null }> }> {
  const a = args(rawArgs);

  if (name === "list_decks") return { decks: await listDecks() };

  const deckId = requireString(a, "deck_id");

  switch (name) {
    case "read_deck":
      return loadDeck(deckId);
    case "insert_beat_after":
      return mutate(deckId, (doc) => insertBeatAfter(doc, requireNumber(a, "beat_index")));
    case "duplicate_beat_at":
      return mutate(deckId, (doc) => duplicateBeatAt(doc, requireNumber(a, "beat_index")));
    case "delete_beat_at":
      return mutate(deckId, (doc) => deleteBeatAt(doc, requireNumber(a, "beat_index")));
    case "move_beat_by":
      return mutate(deckId, (doc) => moveBeatBy(doc, requireNumber(a, "beat_index"), requireDir(a, "dir")));
    case "append_scene":
      return mutate(deckId, (doc) => appendScene(doc));
    case "delete_scene_at": {
      const beatIndex = optionalNumber(a, "beat_index");
      const sceneIndex = optionalNumber(a, "scene_index");
      if ((beatIndex == null) === (sceneIndex == null)) {
        throw new ToolCallError('give exactly one of "beat_index" or "scene_index"');
      }
      return mutate(deckId, (doc) =>
        sceneIndex == null ? deleteSceneAt(doc, beatIndex!) : deleteSceneAtIndex(doc, sceneIndex));
    }
    case "move_scene_by":
      return mutate(deckId, (doc) => moveSceneBy(doc, requireNumber(a, "scene_index"), requireDir(a, "dir")));
    case "append_beat_to_scene":
      return mutate(deckId, (doc) => appendBeatToScene(doc, requireNumber(a, "scene_index")));
    case "insert_action_after":
      return mutate(deckId, (doc) =>
        insertActionAfter(doc, requireNumber(a, "beat_index"), optionalNumber(a, "action_index"), requireString(a, "kind")));
    case "duplicate_action_at":
      return mutate(deckId, (doc) => duplicateActionAt(doc, requireNumber(a, "beat_index"), requireNumber(a, "action_index")));
    case "delete_action_at":
      return mutate(deckId, (doc) => deleteActionAt(doc, requireNumber(a, "beat_index"), requireNumber(a, "action_index")));
    case "move_action_by":
      return mutate(deckId, (doc) => moveActionBy(doc, requireNumber(a, "beat_index"), requireNumber(a, "action_index"), requireDir(a, "dir")));
    case "convert_action_kind":
      return mutate(deckId, (doc) => convertActionKind(doc, requireNumber(a, "beat_index"), requireNumber(a, "action_index"), requireString(a, "new_kind")));
    case "update_action": {
      const path = requireString(a, "path");
      if (path === "kind") {
        throw new ToolCallError("update_action cannot change an action's kind — use convert_action_kind instead");
      }
      assertSafePath(path);
      return mutate(deckId, (doc) => {
        const beatIndex = requireNumber(a, "beat_index");
        const actionIndex = requireNumber(a, "action_index");
        const loc = beatLocation(doc, beatIndex);
        if (!loc) throw new ToolCallError(`no beat at index ${beatIndex}`);
        const value = a.value;
        return {
          ...doc,
          scenes: doc.scenes.map((s, si) => si !== loc.sceneIdx ? s : {
            ...s,
            beats: s.beats.map((b, bi) => bi !== loc.beatIdx ? b : {
              ...b,
              timeline: b.timeline.map((act, ai) => ai !== actionIndex ? act : setPath(act, path, value)),
            }),
          }),
        };
      });
    }
    case "update_meta": {
      const path = requireString(a, "path");
      assertSafePath(path);
      return mutate(deckId, (doc) => ({ ...doc, meta: setPath(doc.meta, path, a.value === null && path === "timing" ? undefined : a.value) }));
    }
    case "set_scene_duration": {
      const v = a.seconds;
      if (v !== null && typeof v !== "number") throw new ToolCallError('"seconds" must be a number or null');
      return mutate(deckId, (doc) => setSceneDuration(doc, requireNumber(a, "scene_index"), v));
    }
    case "read_deck_timing": {
      const doc = await loadDeck(deckId);
      const layout = deckLayout(doc);
      return {
        targetSec: doc.meta.timing?.targetSec ?? null,
        total: layout.total,
        scenes: layout.scenes.map((s) => ({
          index: s.sceneIdx, id: doc.scenes[s.sceneIdx].id, start: s.start, length: s.length,
          contentLength: s.contentLength, pinned: s.pinned, overrunSec: sceneOverrun(s),
          beats: s.beats.map((b) => ({ flatIndex: b.flatIdx, id: doc.scenes[s.sceneIdx].beats[b.beatIdx].id, start: b.start, duration: b.duration })),
        })),
      };
    }
    case "list_media":
      return { media: (await listMedia(deckId)).map((m) => ({ ...m, kind: mediaKind(m.mime) })) };
    case "set_soundtrack": {
      const mediaId = a.media_id;
      if (mediaId !== null && typeof mediaId !== "string") throw new ToolCallError('"media_id" must be a string or null');
      if (mediaId !== null && !(await listMedia(deckId)).some((m) => m.id === mediaId)) {
        throw new ToolCallError(`media "${mediaId}" is not in this deck's media — upload it in the editor first`);
      }
      return mutate(deckId, (doc) => {
        const meta = { ...doc.meta };
        if (mediaId === null) delete meta.soundtrack; else meta.soundtrack = { media: mediaId };
        return { ...doc, meta };
      });
    }
    case "set_markers": {
      if (!Array.isArray(a.markers)) throw new ToolCallError('"markers" must be an array');
      // Keep exactly { id, label, t } so stray keys never persist; trim so "   " is rejected as empty.
      const markers = (a.markers as unknown[]).map((m) => {
        if (!m || typeof m !== "object") return m;
        const { id, label, t } = m as Record<string, unknown>;
        return { id, label: typeof label === "string" ? label.trim() : label, t };
      }) as DeckMarker[];
      return mutate(deckId, (doc) => {
        const meta = { ...doc.meta };
        if (markers.length === 0) delete meta.markers; else meta.markers = markers;
        return { ...doc, meta };
      });
    }
    default:
      throw new ToolCallError(`unknown tool: ${name}`);
  }
}
