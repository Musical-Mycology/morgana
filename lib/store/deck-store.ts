import { mkdir, readFile, writeFile, readdir, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import { DECK_ID_RE, validateDeckDoc, type DeckDoc, type DeckMeta } from "@/engine/deck-doc";

const dataDir = () => process.env.MORGANA_DATA_DIR ?? "/data";
const decksDir = () => join(dataDir(), "decks");

function safeId(id: string): string {
  if (typeof id !== "string" || !DECK_ID_RE.test(id)) throw new Error(`invalid deck id: ${id}`);
  return id;
}
function fileFor(id: string): string { return join(decksDir(), `${safeId(id)}.deck.json`); }

export async function listDecks(): Promise<DeckMeta[]> {
  await mkdir(decksDir(), { recursive: true });
  const files = (await readdir(decksDir())).filter((f) => f.endsWith(".deck.json"));
  const out: DeckMeta[] = [];
  for (const f of files) {
    try { out.push((JSON.parse(await readFile(join(decksDir(), f), "utf8")) as DeckDoc).meta); } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadDeck(id: string): Promise<DeckDoc> {
  const doc = JSON.parse(await readFile(fileFor(id), "utf8")) as DeckDoc;
  const v = validateDeckDoc(doc);
  if (!v.ok) throw new Error(`invalid deck on disk: ${v.errors.join(", ")}`);
  return doc;
}

export async function saveDeck(doc: DeckDoc): Promise<void> {
  const v = validateDeckDoc(doc);
  if (!v.ok) throw new Error(`refusing to save invalid deck: ${v.errors.join(", ")}`);
  await mkdir(decksDir(), { recursive: true });
  await writeFile(fileFor(doc.meta.id), JSON.stringify(doc, null, 2) + "\n", "utf8");
}

export async function createDeck(meta: { id: string; title: string; treatment?: DeckMeta["treatment"] }): Promise<DeckDoc> {
  const file = fileFor(meta.id);
  if (await access(file).then(() => true, () => false)) throw new Error(`deck already exists: ${meta.id}`);
  const doc: DeckDoc = { version: 1, meta: { id: meta.id, title: meta.title, ...(meta.treatment ? { treatment: meta.treatment } : {}) }, scenes: [] };
  await saveDeck(doc);
  return doc;
}

export async function deleteDeck(id: string): Promise<void> { await unlink(fileFor(id)); }
