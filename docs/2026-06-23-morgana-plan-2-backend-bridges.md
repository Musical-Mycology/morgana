# Morgana — Plan 2: Backend & Bridges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give morgana a filesystem-backed deck store (JSON on the `/data` volume), a REST API over it, a seed tool (existing TS deck modules → deck JSON), an export bridge (deck JSON → a `content.*.ts` module string), a committed public sample deck, AND generalize the engine's last MM-hardcoded content (intro splash, `fin` CTAs, footer wordmark) behind the deck document — so Plan 3's editor builds on a real backend and a fully generic engine.

**Architecture:** A `DeckDoc` envelope (`{ version, meta, scenes }`) is the on-disk + API shape. A path-safe `deck-store` does CRUD over `${MORGANA_DATA_DIR}/decks/*.deck.json` (default `/data`). Next Route Handlers expose it under `/api/decks`. A `tsx`-run seed script imports a TS deck module, extracts its `Scene[]`, and writes a `DeckDoc`. An export bridge serializes a `DeckDoc` back to a TS module string. The engine's hardcoded chrome moves behind `DeckDoc.meta.chrome`, defaulting to none.

**Tech Stack:** Next.js 15 Route Handlers, TypeScript, Vitest (node env for store/bridge, jsdom for engine), `tsx` (run TS scripts), Playwright. Builds on Plan 1 (engine vendored under `engine/`, `AssetResolver`, `BeatStage`).

**Working dir:** `/Users/chris/projects/morgana` (call it `MG`). All paths below are repo-relative.

> **RUN ON: MYCOLOGICAL** for all shell blocks.

---

## File Structure (created/modified across this plan)

```
morgana/
  engine/deck-doc.ts                 # NEW: DeckDoc/DeckMeta/DeckChrome types + validateDeckDoc (T1)
  lib/store/deck-store.ts            # NEW: path-safe filesystem CRUD (T2)
  lib/bridge/export-ts.ts            # NEW: DeckDoc → content.*.ts string (T5)
  app/api/decks/route.ts             # NEW: GET list / POST create (T3)
  app/api/decks/[id]/route.ts        # NEW: GET / PUT / DELETE one deck (T3)
  tools/seed-deck.ts                 # NEW: TS deck module → DeckDoc JSON (T4)
  tools/__fixtures__/sample-deck.ts  # NEW: tiny Scene[] fixture for seed/export tests (T4)
  samples/demo.deck.json             # NEW: committed public demo deck (T6)
  engine/components/layouts/CinematicSlide.tsx  # MODIFY: chrome-driven splash/CTAs (T7)
  engine/components/Slide.tsx                    # MODIFY: chrome-driven wordmark (T7)
  engine/authoring/BeatStage.tsx                 # MODIFY: pass chrome through (T7)
  tests/unit/{deck-doc,deck-store,api-decks,seed-deck,export-ts,sample-deck}.test.ts
  e2e/chrome.spec.ts                 # NEW: intro splash hidden w/o chrome, shown with (T7)
  package.json                       # MODIFY: add tsx devDep + seed script (T4)
```

---

## Task 0: Branch from `main`

- [ ] **Step 1: Create the Plan 2 branch**
```bash
cd /Users/chris/projects/morgana
git checkout main && git pull --ff-only origin main
git checkout -b plan-2-backend-bridges
git push -u origin plan-2-backend-bridges
```
Expected: on `plan-2-backend-bridges`, tracking origin.

---

## Task 1: `DeckDoc` types + validation

**Files:** Create `engine/deck-doc.ts`, `tests/unit/deck-doc.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { expect, test } from "vitest";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

const good: DeckDoc = {
  version: 1,
  meta: { id: "demo", title: "Demo" },
  scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] }],
};

test("accepts a well-formed deck doc", () => {
  expect(validateDeckDoc(good)).toEqual({ ok: true, errors: [] });
});

test("rejects bad version / missing meta.id / non-array scenes", () => {
  expect(validateDeckDoc({ ...good, version: 2 }).ok).toBe(false);
  expect(validateDeckDoc({ ...good, meta: { title: "x" } }).ok).toBe(false);
  expect(validateDeckDoc({ ...good, scenes: "nope" }).ok).toBe(false);
});
```

- [ ] **Step 2: Run it — verify it fails** — `npm test -- tests/unit/deck-doc.test.ts` → module not found.

- [ ] **Step 3: Implement `engine/deck-doc.ts`**
```ts
import type { Scene, SlideTreatment } from "@/engine/deck/types";

/** Optional host-app chrome, defaulted to none so decks render generic. */
export interface DeckChrome {
  /** Splash on the scene whose id is "intro". */
  splash?: { logo?: string; tagline?: string };
  /** CTAs on the beat whose id is "fin". */
  ending?: { ctas?: { label: string; href: string }[] };
  /** Footer wordmark text. */
  wordmark?: string;
}

export interface DeckMeta {
  id: string;
  title: string;
  treatment?: SlideTreatment;
  noindex?: boolean;
  chrome?: DeckChrome;
}

export interface DeckDoc {
  version: 1;
  meta: DeckMeta;
  scenes: Scene[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateDeckDoc(obj: unknown): { ok: boolean; errors: string[] } {
  const e: string[] = [];
  const d = obj as Partial<DeckDoc>;
  if (!d || typeof d !== "object") return { ok: false, errors: ["not an object"] };
  if (d.version !== 1) e.push("version must be 1");
  if (!d.meta || typeof d.meta !== "object") e.push("meta missing");
  else {
    if (typeof d.meta.id !== "string" || !ID_RE.test(d.meta.id)) e.push("meta.id must match /^[a-z0-9][a-z0-9-]*$/");
    if (typeof d.meta.title !== "string" || !d.meta.title) e.push("meta.title required");
  }
  if (!Array.isArray(d.scenes)) e.push("scenes must be an array");
  else d.scenes.forEach((s: Scene, i) => {
    if (!s || typeof s.id !== "string") e.push(`scenes[${i}].id required`);
    if (!Array.isArray(s?.beats)) e.push(`scenes[${i}].beats must be an array`);
  });
  return { ok: e.length === 0, errors: e };
}

export const DECK_ID_RE = ID_RE;
```

- [ ] **Step 4: Run the test — verify it passes** — `npm test -- tests/unit/deck-doc.test.ts` → 2 pass. Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(deck-doc): DeckDoc envelope + validateDeckDoc" && git push
```

---

## Task 2: Path-safe deck store (filesystem CRUD)

**Files:** Create `lib/store/deck-store.ts`, `tests/unit/deck-store.test.ts`

- [ ] **Step 1: Write the failing test (uses a temp data dir)**
```ts
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as store from "@/lib/store/deck-store";
import type { DeckDoc } from "@/engine/deck-doc";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };

test("save → load → list → delete round-trips", async () => {
  await store.saveDeck(doc);
  expect((await store.loadDeck("demo")).meta.title).toBe("Demo");
  expect((await store.listDecks()).map((m) => m.id)).toEqual(["demo"]);
  await store.deleteDeck("demo");
  expect(await store.listDecks()).toEqual([]);
});

test("rejects path-traversal ids", async () => {
  await expect(store.loadDeck("../etc/passwd")).rejects.toThrow();
  await expect(store.saveDeck({ ...doc, meta: { id: "../x", title: "x" } })).rejects.toThrow();
});

test("createDeck writes an empty deck and refuses duplicates", async () => {
  const created = await store.createDeck({ id: "fresh", title: "Fresh" });
  expect(created.scenes).toEqual([]);
  await expect(store.createDeck({ id: "fresh", title: "Dup" })).rejects.toThrow();
});
```

- [ ] **Step 2: Run it — verify it fails.**

- [ ] **Step 3: Implement `lib/store/deck-store.ts`**
```ts
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
```

- [ ] **Step 4: Run the test — verify it passes** (3 tests). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(store): path-safe filesystem deck store (CRUD)" && git push
```

---

## Task 3: REST API over the store

**Files:** Create `app/api/decks/route.ts`, `app/api/decks/[id]/route.ts`, `tests/unit/api-decks.test.ts`

- [ ] **Step 1: Write the failing test (drives the handlers directly)**
```ts
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as listGET, POST as createPOST } from "@/app/api/decks/route";
import { GET as oneGET, PUT as onePUT, DELETE as oneDELETE } from "@/app/api/decks/[id]/route";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test("create → list → load → save → delete via handlers", async () => {
  const created = await createPOST(new Request("http://t/api/decks", { method: "POST", body: JSON.stringify({ id: "d1", title: "D1" }) }));
  expect(created.status).toBe(201);

  const list = await (await listGET()).json();
  expect(list.map((m: { id: string }) => m.id)).toEqual(["d1"]);

  const loaded = await (await oneGET(new Request("http://t"), ctx("d1"))).json();
  loaded.scenes.push({ id: "s1", beats: [] });
  const put = await onePUT(new Request("http://t", { method: "PUT", body: JSON.stringify(loaded) }), ctx("d1"));
  expect(put.status).toBe(200);

  const del = await oneDELETE(new Request("http://t", { method: "DELETE" }), ctx("d1"));
  expect(del.status).toBe(200);
  expect(await (await listGET()).json()).toEqual([]);
});

test("load of missing deck → 404; invalid create → 400", async () => {
  expect((await oneGET(new Request("http://t"), ctx("missing"))).status).toBe(404);
  expect((await createPOST(new Request("http://t", { method: "POST", body: JSON.stringify({ id: "BAD ID", title: "x" }) }))).status).toBe(400);
});
```

- [ ] **Step 2: Run it — verify it fails.**

- [ ] **Step 3: Implement `app/api/decks/route.ts`**
```ts
import { listDecks, createDeck } from "@/lib/store/deck-store";

export async function GET() {
  return Response.json(await listDecks());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const doc = await createDeck({ id: body.id, title: body.title, treatment: body.treatment });
    return Response.json(doc, { status: 201 });
  } catch (err) {
    return Response.json({ error: String((err as Error).message) }, { status: 400 });
  }
}
```

- [ ] **Step 4: Implement `app/api/decks/[id]/route.ts`**
```ts
import { loadDeck, saveDeck, deleteDeck } from "@/lib/store/deck-store";
import { validateDeckDoc } from "@/engine/deck-doc";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json(await loadDeck(id));
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const doc = await req.json();
  if (doc?.meta?.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  const v = validateDeckDoc(doc);
  if (!v.ok) return Response.json({ error: v.errors.join(", ") }, { status: 400 });
  await saveDeck(doc);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try { await deleteDeck(id); return Response.json({ ok: true }); }
  catch { return Response.json({ error: "not found" }, { status: 404 }); }
}
```

- [ ] **Step 5: Run the test — verify it passes** (2 tests). `npx tsc --noEmit` clean; `npm run build` succeeds (routes compile).

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(api): /api/decks CRUD route handlers over the store" && git push
```

---

## Task 4: Seed script (TS deck module → DeckDoc JSON)

**Files:** Create `tools/seed-deck.ts`, `tools/__fixtures__/sample-deck.ts`, `tests/unit/seed-deck.test.ts`; Modify `package.json`

- [ ] **Step 1: Add `tsx` + a `seed` script to `package.json`**
Add to `devDependencies`: `"tsx": "^4.19.2"`. Add to `scripts`: `"seed": "tsx tools/seed-deck.ts"`. Then `npm install`.

- [ ] **Step 2: Create the committed fixture `tools/__fixtures__/sample-deck.ts`**
```ts
import type { Scene } from "@/engine/deck/types";

// Generic, non-MM content — safe to commit publicly.
export const sampleScenes: Scene[] = [
  { id: "open", beats: [
    { id: "b1", timeline: [{ kind: "text", value: "A tiny show", in: "fade" }] },
    { id: "b2", timeline: [{ kind: "text", value: "two beats long.", in: "flyUp" }] },
  ] },
];
```

- [ ] **Step 3: Write the failing test (the seed's pure core)**
```ts
import { expect, test } from "vitest";
import { extractScenes, buildDoc } from "@/tools/seed-deck";
import { sampleScenes } from "@/tools/__fixtures__/sample-deck";

test("extractScenes finds the Scene[] export (array whose items have beats)", () => {
  const mod = { sampleScenes, sampleDeck: [{ id: "x", layout: "cinematic", slots: {} }] };
  expect(extractScenes(mod)).toBe(sampleScenes);
  expect(extractScenes(mod, "sampleScenes")).toBe(sampleScenes);
});

test("buildDoc wraps scenes in a valid DeckDoc envelope", () => {
  const doc = buildDoc(sampleScenes, { id: "sample", title: "Sample", treatment: "warm" });
  expect(doc.version).toBe(1);
  expect(doc.meta).toMatchObject({ id: "sample", title: "Sample", treatment: "warm" });
  expect(doc.scenes).toBe(sampleScenes);
});
```

- [ ] **Step 4: Run it — verify it fails.**

- [ ] **Step 5: Implement `tools/seed-deck.ts`**
```ts
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
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
    (v): v is Scene[] => Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && "beats" in (v[0] as object),
  );
  if (candidates.length !== 1) throw new Error(`expected exactly one Scene[] export, found ${candidates.length}; pass --export <name>`);
  return candidates[0];
}

export function buildDoc(scenes: Scene[], meta: { id: string; title: string; treatment?: DeckMeta["treatment"] }): DeckDoc {
  return { version: 1, meta: { id: meta.id, title: meta.title, ...(meta.treatment ? { treatment: meta.treatment } : {}) }, scenes };
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const module = arg("--module"), id = arg("--id"), title = arg("--title");
  if (!module || !id || !title) { console.error("usage: npm run seed -- --module <path.ts> --id <id> --title <title> [--treatment warm] [--export <name>]"); process.exit(1); }
  const mod = await import(pathToFileURL(resolve(module)).href) as Record<string, unknown>;
  const scenes = extractScenes(mod, arg("--export"));
  const doc = buildDoc(scenes, { id, title, treatment: arg("--treatment") as DeckMeta["treatment"] | undefined });
  await saveDeck(doc);
  console.log(`seeded ${doc.scenes.length} scene(s) → deck "${id}"`);
}

// Run only as a script, not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
```

- [ ] **Step 6: Run the test + an end-to-end seed against the fixture**
```bash
cd /Users/chris/projects/morgana
npm test -- tests/unit/seed-deck.test.ts
MORGANA_DATA_DIR=$(mktemp -d) npm run seed -- --module tools/__fixtures__/sample-deck.ts --id sample --title "Sample" && echo "seed OK"
```
Expected: 2 unit tests pass; the seed run prints `seeded 1 scene(s) → deck "sample"`.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat(seed): tsx seed-deck tool (TS module → DeckDoc JSON) + fixture" && git push
```

---

## Task 5: Export bridge (DeckDoc → `content.*.ts` string)

**Files:** Create `lib/bridge/export-ts.ts`, `tests/unit/export-ts.test.ts`

- [ ] **Step 1: Write the failing test (round-trips the scenes)**
```ts
import { expect, test } from "vitest";
import { deckDocToModule } from "@/lib/bridge/export-ts";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = {
  version: 1, meta: { id: "demo", title: "Demo" },
  scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] }],
};

test("emits a typed TS module and round-trips the scenes JSON", () => {
  const out = deckDocToModule(doc, { constName: "demoScenes" });
  expect(out).toContain('import type { Scene } from "@/lib/deck/types";');
  expect(out).toContain("export const demoScenes: Scene[] =");
  // extract the array literal and parse it back
  const json = out.slice(out.indexOf("=") + 1, out.lastIndexOf(";")).trim();
  expect(JSON.parse(json)).toEqual(doc.scenes);
});
```

- [ ] **Step 2: Run it — verify it fails.**

- [ ] **Step 3: Implement `lib/bridge/export-ts.ts`**
```ts
import type { DeckDoc } from "@/engine/deck-doc";

/** Serialize a deck's scenes to a TS module that mm-website (or any consumer) can import.
 *  The scenes are emitted as a JSON array literal — valid TS — so the round-trip is lossless. */
export function deckDocToModule(
  doc: DeckDoc,
  opts: { constName?: string; typesImport?: string } = {},
): string {
  const constName = opts.constName ?? "scenes";
  const typesImport = opts.typesImport ?? "@/lib/deck/types";
  const body = JSON.stringify(doc.scenes, null, 2);
  return [
    `// Generated by Morgana from deck "${doc.meta.id}" — edit in Morgana, not here.`,
    `import type { Scene } from "${typesImport}";`,
    ``,
    `export const ${constName}: Scene[] = ${body};`,
    ``,
  ].join("\n");
}
```

- [ ] **Step 4: Run the test — verify it passes.** `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(bridge): export DeckDoc → content.*.ts module string" && git push
```

---

## Task 6: Committed public sample/demo deck

**Files:** Create `samples/demo.deck.json`, `tests/unit/sample-deck.test.ts`

- [ ] **Step 1: Create `samples/demo.deck.json` (generic, no MM branding)**
```json
{
  "version": 1,
  "meta": { "id": "demo", "title": "Morgana Demo" },
  "scenes": [
    { "id": "open", "beats": [
      { "id": "b1", "timeline": [{ "kind": "text", "value": "Welcome to Morgana", "in": "flyUp" }] },
      { "id": "b2", "timeline": [
        { "kind": "text", "value": "Build shows as data.", "in": "fade" },
        { "kind": "wait", "ms": 300 },
        { "kind": "text", "value": "Scrub the timeline.", "in": "fade" }
      ] }
    ] }
  ]
}
```

- [ ] **Step 2: Write the test that the sample validates + is loadable**
```ts
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { validateDeckDoc } from "@/engine/deck-doc";

test("samples/demo.deck.json is a valid DeckDoc", () => {
  const doc = JSON.parse(readFileSync(new URL("../../samples/demo.deck.json", import.meta.url), "utf8"));
  expect(validateDeckDoc(doc)).toEqual({ ok: true, errors: [] });
});
```
> If `import.meta.url` is awkward under the test env (Plan 1 used `process.cwd()` for a similar read), resolve from `process.cwd()` + `samples/demo.deck.json` instead — `npm test` runs from the repo root.

- [ ] **Step 3: Run the test — verify it passes.**

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(samples): committed public demo deck + validation test" && git push
```

---

## Task 7: Brand-agnostic engine chrome (the Plan-1 follow-up)

**Goal:** Remove the three MM-hardcoded spots so a deck with no `chrome` renders generic. Drive them from `DeckDoc.meta.chrome` (threaded into the engine).

**Files:** Modify `engine/components/layouts/CinematicSlide.tsx`, `engine/components/Slide.tsx`, `engine/authoring/BeatStage.tsx`; Create `e2e/chrome.spec.ts`, `app/dev/chrome/page.tsx`

- [ ] **Step 1: Add a `chrome?: DeckChrome` prop to `CinematicSlide`**
In `engine/components/layouts/CinematicSlide.tsx`, import `DeckChrome` from `@/engine/deck-doc`, add `chrome?: DeckChrome` to its `Props`, and accept it in the component signature. Replace the hardcoded `slots.sceneId === "intro"` splash block so it renders ONLY when `chrome?.splash` is set:
```tsx
{slots.sceneId === "intro" && chrome?.splash && (
  <div className="cin__splash">
    {chrome.splash.logo && <img className="cin__logo" src={assets.brand(chrome.splash.logo as never)} alt="" />}
    {chrome.splash.tagline && <p className="cin__tagline">{chrome.splash.tagline}</p>}
  </div>
)}
```
> `assets.brand` is typed to `SporekleAsset`; cast the injected logo string with `as never` (chrome logos are caller-supplied strings, not the MM union) OR widen `AssetResolver.brand` to accept `string`. Prefer widening `brand(file: SporekleAsset | string)` in `engine/asset-resolver.ts` and dropping the cast — cleaner. Update the default resolver accordingly (it already just interpolates the filename).

Replace the hardcoded `beat.id === "fin"` ending block so its CTAs come from `chrome?.ending?.ctas` (render the `Watch again` button always; render the CTA row only if `chrome.ending.ctas?.length`):
```tsx
{slots.beat.id === "fin" && againRevealed && (
  <div className="cin__ending">
    {!!chrome?.ending?.ctas?.length && (
      <div className="cin__ending-row">
        {chrome.ending.ctas.map((c) => <a key={c.href} className="cin__cta" href={c.href}>{c.label}</a>)}
      </div>
    )}
    <button className="cin__again" onClick={() => { const u = new URL(location.href); u.searchParams.set("slide", "1"); location.href = u.toString(); }}>↺ Watch again</button>
  </div>
)}
```

- [ ] **Step 2: Drive the wordmark in `engine/components/Slide.tsx` from chrome**
Add an optional `chrome?: DeckChrome` prop to `Slide`; render the wordmark span only when `chrome?.wordmark` is set, using its value. Pass `chrome` down to `CinematicSlide` where `Slide` renders it.

- [ ] **Step 3: Thread `chrome` through `BeatStage`**
Add an optional `chrome?: DeckChrome` prop to `BeatStage` and pass it to `<CinematicSlide chrome={chrome} ... />`.

- [ ] **Step 4: Create a dev harness `app/dev/chrome/page.tsx`**
```tsx
"use client";
import { useState } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Beat } from "@/engine/deck/types";
import type { DeckChrome } from "@/engine/deck-doc";

const beat: Beat = { id: "demo", timeline: [{ kind: "text", value: "Body copy", in: "fade" }] };
const chrome: DeckChrome = { splash: { tagline: "Injected tagline" } };

export default function Page() {
  const [on, setOn] = useState(false);
  return (
    <>
      <button data-testid="toggle" style={{ position: "fixed", zIndex: 20, top: 8, left: 8 }} onClick={() => setOn((v) => !v)}>toggle</button>
      <BeatStage sceneId="intro" beat={beat} chrome={on ? chrome : undefined} />
    </>
  );
}
```

- [ ] **Step 5: Write the e2e `e2e/chrome.spec.ts`**
```ts
import { expect, test } from "@playwright/test";

test("intro splash is absent without chrome, present with it", async ({ page }) => {
  await page.goto("/dev/chrome");
  await expect(page.getByText("Injected tagline")).toHaveCount(0);  // no chrome → no splash
  await page.getByTestId("toggle").click();
  await expect(page.getByText("Injected tagline")).toBeVisible();    // chrome.splash → splash shows
});
```

- [ ] **Step 6: Verify**
```bash
cd /Users/chris/projects/morgana
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit
npm test
npm run test:e2e
```
Expected: tsc clean; all unit tests green; all e2e specs pass (beatstage + spike + chrome). Confirm the OLD hardcoded strings are gone: `grep -n 'Connecting People and Music\|Musical Mycology\|/vision/' engine/components` → empty.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat(engine): drive intro splash / fin CTAs / wordmark from DeckChrome (generic by default)" && git push
```

---

## Plan 2 Done — Definition of Done

- `DeckDoc` envelope + `validateDeckDoc`; a path-safe filesystem `deck-store`; `/api/decks` CRUD handlers (all unit-tested).
- A `tsx` `seed-deck` tool (TS module → DeckDoc JSON, auto-detecting the `Scene[]` export) and an `export-ts` bridge (DeckDoc → `content.*.ts` string), both round-trip-tested.
- A committed public `samples/demo.deck.json` that validates.
- The engine renders generic by default: no MM splash/CTAs/wordmark unless `chrome` supplies them (the Plan-1 follow-up closed).
- `tsc` clean; all Vitest unit + Playwright e2e green; `npm run build` succeeds.

## Self-Review (completed during authoring)

- **Spec coverage:** Implements spec checklist items 4–6 (deck CRUD + autosave-ready store, seed, export bridge) plus the final-review brand-agnostic follow-up. Autosave UI itself and the editor are Plan 3.
- **Placeholder scan:** every code step ships real code; the only judgment note is the `import.meta.url` vs `process.cwd()` read in T6 (both spelled out).
- **Type consistency:** `DeckDoc`/`DeckMeta`/`DeckChrome` (T1) are used identically in the store (T2), API (T3), seed (T4), bridge (T5), sample (T6), and engine chrome (T7). `validateDeckDoc`, `DECK_ID_RE`, `extractScenes`/`buildDoc`, `deckDocToModule` names are consistent across tasks and tests. `AssetResolver.brand` is widened to `SporekleAsset | string` in T7 to accept caller-supplied logos.
