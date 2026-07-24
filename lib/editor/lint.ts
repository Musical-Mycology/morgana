import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import { validateDeck } from "@/engine/deck/validate";
import { flattenStory } from "@/engine/deck/flatten";

export type LintSeverity = "error" | "warning";
export interface LintLocation { sceneIdx: number; beatIdx?: number; actionIdx?: number }
export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  message: string;
  /** Absent = a deck-level issue with nowhere to jump to. */
  at?: LintLocation;
}

const DOC_PATH_RE = /^scenes\[(\d+)\](?:\.beats\[(\d+)\](?:\.timeline\[(\d+)\])?)?/;

/** Read the leading `scenes[i][.beats[j][.timeline[k]]]` path that validateDeckDoc messages
 *  already carry. Object-tree messages (`scenes[i].objects[j]…`) match only the `scenes[i]`
 *  prefix and so resolve to the scene — the right granularity, since object selection is
 *  path-keyed rather than index-keyed. */
export function parseDocPath(message: string): LintLocation | undefined {
  const m = DOC_PATH_RE.exec(message);
  if (!m) return undefined;
  const at: LintLocation = { sceneIdx: Number(m[1]) };
  if (m[2] !== undefined) at.beatIdx = Number(m[2]);
  if (m[3] !== undefined) at.actionIdx = Number(m[3]);
  return at;
}

const SLIDE_ID_RE = /^slide "([^"]+)":/;

/** flattenStory builds slide ids as `${scene.id}.${beat.id}`, so a validateDeck message
 *  resolves back to a beat by scanning for that pair. */
function locateSlide(doc: DeckDoc, message: string): LintLocation | undefined {
  const m = SLIDE_ID_RE.exec(message);
  if (!m) return undefined;
  for (let sceneIdx = 0; sceneIdx < doc.scenes.length; sceneIdx++) {
    const scene = doc.scenes[sceneIdx];
    for (let beatIdx = 0; beatIdx < scene.beats.length; beatIdx++) {
      if (`${scene.id}.${scene.beats[beatIdx].id}` === m[1]) return { sceneIdx, beatIdx };
    }
  }
  return undefined;
}

const LAST = Number.MAX_SAFE_INTEGER;

/** Document order, with unlocated issues last. */
function byLocation(a: LintIssue, b: LintIssue): number {
  const key = (i: LintIssue) => i.at
    ? [i.at.sceneIdx, i.at.beatIdx ?? -1, i.at.actionIdx ?? -1]
    : [LAST, LAST, LAST];
  const ka = key(a), kb = key(b);
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

/** Every problem in a deck, errors first. An "error" is exactly what makes the server reject
 *  a PUT, so it means "this deck will not save"; a "warning" is advisory only. */
export function lintDeck(doc: DeckDoc): LintIssue[] {
  // validateDeckDoc emits deck-meta problems before per-scene ones, which is the right
  // priority already — so errors keep their emission order rather than being sorted.
  const errors: LintIssue[] = validateDeckDoc(doc).errors.map((message) => ({
    rule: "structure",
    severity: "error" as const,
    message,
    at: parseDocPath(message),
  }));

  const warnings: LintIssue[] = doc.scenes.flatMap((s, sceneIdx) =>
    s.beats.length === 0
      ? [{ rule: "scene-empty", severity: "warning" as const, message: `scene "${s.id}" has no beats`, at: { sceneIdx } }]
      : []);

  // validateDeck and flattenStory both assume a structurally valid document, so they only
  // run on a clean one. The try/catch means a validator crash can never blank the panel.
  if (errors.length === 0) {
    try {
      for (const message of validateDeck(flattenStory(doc.scenes))) {
        warnings.push({ rule: "slide", severity: "warning", message, at: locateSlide(doc, message) });
      }
    } catch { /* ignore — an unlintable deck is still an editable deck */ }
  }

  return [...errors, ...warnings.sort(byLocation)];
}

export function lintCounts(issues: LintIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}
