/** Derives a DECK_ID_RE-safe id from a free-text deck title. */
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "deck";
}
