import { loadDeck, saveDeck, listDecks } from "@/lib/store/deck-store";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import {
  insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy,
  appendScene, deleteSceneAt,
  insertActionAfter, duplicateActionAt, deleteActionAt, moveActionBy, convertActionKind,
} from "@/lib/editor/mutations";
import { beatLocation } from "@/lib/editor/flatten-beats";
import { setPath } from "@/lib/editor/paths";

export class ToolCallError extends Error {}

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

async function mutate(deckId: string, f: (doc: DeckDoc) => DeckDoc): Promise<DeckDoc> {
  const doc = await loadDeck(deckId);
  const next = f(doc);
  const v = validateDeckDoc(next);
  if (!v.ok) throw new ToolCallError(`resulting deck would be invalid: ${v.errors.join(", ")}`);
  await saveDeck(next);
  return next;
}

export async function callTool(name: string, rawArgs: unknown): Promise<DeckDoc | { decks: Awaited<ReturnType<typeof listDecks>> }> {
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
    case "delete_scene_at":
      return mutate(deckId, (doc) => deleteSceneAt(doc, requireNumber(a, "beat_index")));
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
    case "update_action":
      return mutate(deckId, (doc) => {
        const beatIndex = requireNumber(a, "beat_index");
        const actionIndex = requireNumber(a, "action_index");
        const loc = beatLocation(doc, beatIndex);
        if (!loc) throw new ToolCallError(`no beat at index ${beatIndex}`);
        const path = requireString(a, "path");
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
    case "update_meta":
      return mutate(deckId, (doc) => ({ ...doc, meta: setPath(doc.meta, requireString(a, "path"), a.value) }));
    default:
      throw new ToolCallError(`unknown tool: ${name}`);
  }
}
