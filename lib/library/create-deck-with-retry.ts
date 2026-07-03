import type { DeckDoc } from "@/engine/deck-doc";
import { createDeck } from "@/lib/api/decks-client";
import { slugify } from "./slugify";

type Create = (meta: { id: string; title: string }) => Promise<DeckDoc>;

/** Slugifies `title` into an id and calls `create`; on failure (id collision), retries
 *  once with a "-2" suffix. Rethrows if the retry also fails. See design spec §3
 *  "Id collision". */
export async function createDeckWithRetry(title: string, create: Create = createDeck): Promise<DeckDoc> {
  const base = slugify(title);
  try {
    return await create({ id: base, title });
  } catch {
    return await create({ id: `${base}-2`, title });
  }
}
