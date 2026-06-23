import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import type { Scene } from "@/engine/deck/types";
import type { DeckDoc, DeckMeta } from "@/engine/deck-doc";
import { saveDeck } from "@/lib/store/deck-store";

/** Pick the Scene[] export: an array whose first element has a `beats` property. */
export function extractScenes(mod: Record<string, unknown>, exportName?: string): Scene[] {
  if (exportName) {
    const v = mod[exportName];
    if (!Array.isArray(v)) throw new Error(`export "${exportName}" is not an array`);
    return v as Scene[];
  }
  const candidates = Object.values(mod).filter(
    (v): v is Scene[] =>
      Array.isArray(v) &&
      v.length > 0 &&
      typeof v[0] === "object" &&
      v[0] !== null &&
      "beats" in (v[0] as object),
  );
  if (candidates.length !== 1)
    throw new Error(
      `expected exactly one Scene[] export, found ${candidates.length}; pass --export <name>`,
    );
  return candidates[0];
}

export function buildDoc(
  scenes: Scene[],
  meta: { id: string; title: string; treatment?: DeckMeta["treatment"] },
): DeckDoc {
  return {
    version: 1,
    meta: {
      id: meta.id,
      title: meta.title,
      ...(meta.treatment ? { treatment: meta.treatment } : {}),
    },
    scenes,
  };
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const module = arg("--module"),
    id = arg("--id"),
    title = arg("--title");
  if (!module || !id || !title) {
    console.error(
      "usage: npm run seed -- --module <path.ts> --id <id> --title <title> [--treatment warm] [--export <name>]",
    );
    process.exit(1);
  }
  const mod = (await import(
    pathToFileURL(resolve(module)).href
  )) as Record<string, unknown>;
  const scenes = extractScenes(mod, arg("--export"));
  const doc = buildDoc(scenes, {
    id,
    title,
    treatment: arg("--treatment") as DeckMeta["treatment"] | undefined,
  });
  await saveDeck(doc);
  console.log(`seeded ${doc.scenes.length} scene(s) → deck "${id}"`);
}

// Run main() only when executed as the entry script (not when imported by tests).
// tsx may resolve symlinks differently, so compare realpaths.
const isEntry = !process.env.VITEST &&
  process.argv[1] != null &&
  (() => {
    try {
      return realpathSync(process.argv[1]) === realpathSync(
        new URL(import.meta.url).pathname,
      );
    } catch {
      return false;
    }
  })();

if (isEntry) main();
