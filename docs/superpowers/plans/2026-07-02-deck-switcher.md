# Deck Switcher / New / Delete UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `app/page.tsx` from a blank stub into a deck library — browse, open, create, and delete decks — since today the only way to reach a deck is hand-editing the `?deck=` URL param or calling the CRUD API directly.

**Architecture:** A new client-side library page fetches `listDecks()` + per-deck `loadDeck()`, renders a card grid where each card shows a read-only thumbnail of the deck's first cinematic beat (reusing the existing seek-renderer primitives, not `DeckCanvas` itself — that component is coupled to the singleton editor store). Two small pure helpers (`slugify`, `createDeckWithRetry`) handle the new-deck flow's id derivation and collision retry. A second hand-authored sample deck ships alongside the existing `demo` deck.

**Tech Stack:** Next.js App Router (client components), existing `lib/api/decks-client.ts` CRUD client, `engine/authoring/seek.ts` + `engine/components/ArtStage.tsx` for thumbnail rendering, Vitest for unit tests, Playwright for e2e.

**Spec:** [`docs/superpowers/specs/2026-07-02-deck-switcher-design.md`](../specs/2026-07-02-deck-switcher-design.md)

**Testing approach note:** This codebase has no established pattern of rendering React components in unit tests (`@testing-library/react` is a dependency but `render()` is never called anywhere in `tests/`) — UI wiring (`Timeline.tsx`, `Filmstrip.tsx` additions in the prior action-CRUD slice) is verified via Playwright e2e instead, with unit tests reserved for pure/extractable logic. This plan follows the same split: `slugify`/`createDeckWithRetry` get Vitest unit tests; the library page's rendering and interactions get one e2e spec.

---

### Task 1: Slug helper

**Files:**
- Create: `lib/library/slugify.ts`
- Test: `tests/unit/slugify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/slugify.test.ts
import { expect, test } from "vitest";
import { slugify } from "@/lib/library/slugify";

test("lowercases and hyphenates", () => {
  expect(slugify("Fall Product Reveal")).toBe("fall-product-reveal");
});

test("collapses repeated separators and strips leading/trailing hyphens", () => {
  expect(slugify("Deck #2!!")).toBe("deck-2");
  expect(slugify("  spaced  out  ")).toBe("spaced-out");
});

test("leaves an already-valid id unchanged", () => {
  expect(slugify("already-valid-id")).toBe("already-valid-id");
});

test("falls back to a fixed prefix when nothing alphanumeric survives", () => {
  expect(slugify("!!!")).toBe("deck");
  expect(slugify("")).toBe("deck");
});

test("always matches DECK_ID_RE", () => {
  const DECK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
  for (const input of ["Fall Product Reveal", "!!!", "Q3 Investor Update", "123 Go", "---"]) {
    expect(slugify(input)).toMatch(DECK_ID_RE);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/slugify.test.ts`
Expected: FAIL — `Cannot find module '@/lib/library/slugify'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/library/slugify.ts
/** Derives a DECK_ID_RE-safe id from a free-text deck title. */
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "deck";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/slugify.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/library/slugify.ts tests/unit/slugify.test.ts
git commit -m "feat(library): add slugify helper for new-deck ids"
```

---

### Task 2: Deterministic thumbnail-fallback swatch

**Files:**
- Create: `lib/library/swatch.ts`
- Test: `tests/unit/swatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/swatch.test.ts
import { expect, test } from "vitest";
import { swatchGradient } from "@/lib/library/swatch";

test("is deterministic for the same id", () => {
  expect(swatchGradient("fall-reveal-2026")).toBe(swatchGradient("fall-reveal-2026"));
});

test("differs for different ids", () => {
  expect(swatchGradient("demo")).not.toBe(swatchGradient("our-story"));
});

test("returns a well-formed CSS linear-gradient", () => {
  expect(swatchGradient("demo")).toMatch(
    /^linear-gradient\(135deg, hsl\(\d+, 45%, 32%\), hsl\(\d+, 55%, 14%\)\)$/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/swatch.test.ts`
Expected: FAIL — `Cannot find module '@/lib/library/swatch'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/library/swatch.ts
/** Deterministic gradient swatch (hashed from the deck id) for decks with no cinematic
 *  beat to thumbnail — see design spec §3 "Thumbnail fallback". */
export function swatchGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const hue2 = (hue + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 45%, 32%), hsl(${hue2}, 55%, 14%))`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/swatch.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/library/swatch.ts tests/unit/swatch.test.ts
git commit -m "feat(library): add deterministic swatch fallback for deck thumbnails"
```

---

### Task 3: Create-deck-with-retry helper

**Files:**
- Create: `lib/library/create-deck-with-retry.ts`
- Test: `tests/unit/create-deck-with-retry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/create-deck-with-retry.test.ts
import { expect, test, vi } from "vitest";
import { createDeckWithRetry } from "@/lib/library/create-deck-with-retry";
import type { DeckDoc } from "@/engine/deck-doc";

function doc(id: string, title: string): DeckDoc {
  return { version: 1, meta: { id, title }, scenes: [] };
}

test("creates with the slugified id on the first attempt", async () => {
  const create = vi.fn(async (meta: { id: string; title: string }) => doc(meta.id, meta.title));
  const result = await createDeckWithRetry("Fall Product Reveal", create);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({ id: "fall-product-reveal", title: "Fall Product Reveal" });
  expect(result.meta.id).toBe("fall-product-reveal");
});

test("retries once with a -2 suffix when the first attempt rejects", async () => {
  const create = vi.fn()
    .mockRejectedValueOnce(new Error("deck already exists: demo"))
    .mockResolvedValueOnce(doc("demo-2", "Demo"));
  const result = await createDeckWithRetry("Demo", create);
  expect(create).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenNthCalledWith(2, { id: "demo-2", title: "Demo" });
  expect(result.meta.id).toBe("demo-2");
});

test("propagates the error when the retry also rejects", async () => {
  const create = vi.fn().mockRejectedValue(new Error("nope"));
  await expect(createDeckWithRetry("Demo", create)).rejects.toThrow("nope");
  expect(create).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/create-deck-with-retry.test.ts`
Expected: FAIL — `Cannot find module '@/lib/library/create-deck-with-retry'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/library/create-deck-with-retry.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/create-deck-with-retry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/library/create-deck-with-retry.ts tests/unit/create-deck-with-retry.test.ts
git commit -m "feat(library): add create-deck-with-retry helper for id collisions"
```

---

### Task 4: Read-only beat thumbnail component

**Files:**
- Create: `components/library/BeatThumbnail.tsx`

- [ ] **Step 1: Write the component**

Reuses the same rendering primitives `DeckCanvas.tsx` uses (`renderBeatAt`, `ArtStage`), but
without `DeckCanvas`'s imperative seek/play handle or its `PosHandle` (which reads the singleton
editor Zustand store and isn't safe to mount N times on the library page — see design spec §3
"Card thumbnail"). Renders once at `t = 0`.

```tsx
// components/library/BeatThumbnail.tsx
"use client";
import { useEffect, useRef } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { renderBeatAt } from "@/engine/authoring/seek";
import type { Beat } from "@/engine/deck/types";

/** Read-only, static (t=0) render of a single cinematic beat — used for deck-library card
 *  thumbnails. Not interactive; no seek/play controls, no editor-store coupling. */
export function BeatThumbnail({ beat }: { beat: Beat }) {
  const art = useRef<ArtStageHandle>(null);
  const textHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (textHost.current) renderBeatAt(beat.timeline, 0, { textHost: textHost.current, art: art.current });
  }, [beat]);

  return (
    <div
      className="lib__thumb-stage"
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
      aria-hidden
    >
      <ArtStage ref={art} nightlight={beat.nightlight ?? 0.6} reduced transparentBg />
      <div className="cin__stage">
        <div ref={textHost} className="cin__text" style={{ position: "absolute", inset: 0, maxWidth: "none" }} />
      </div>
    </div>
  );
}
```

`reduced` is passed to `ArtStage` so the art layer snaps instantly instead of running a GSAP
fade-in tween — appropriate for a single static frame (the same prop `ArtStage` already
documents for "reduced motion / jump nav / PDF").

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add components/library/BeatThumbnail.tsx
git commit -m "feat(library): add read-only BeatThumbnail component"
```

---

### Task 5: Sample deck — "Our Story"

**Files:**
- Create: `samples/our-story.deck.json`
- Modify: `tests/unit/sample-deck.test.ts`
- Modify: `package.json:15` (`seed:demo` script)
- Modify: `docker-entrypoint.sh`
- Modify: `Dockerfile:22`

This seeds a second example deck alongside the existing `demo` one, per design spec §5 and the
`morgana-positioning` memory's 2026-07-02 exception. 3–5 beats hand-adapted from mm-website's
public "Our Story" opening (`~/projects/mm-website/lib/deck/content.story.ts`, the non-gated
deck — distinct from the investor-gated one under `investor-hub/`).

- [ ] **Step 1: Write the sample deck**

```json
// samples/our-story.deck.json
{
  "version": 1,
  "meta": { "id": "our-story", "title": "Our Story" },
  "scenes": [
    { "id": "opening", "beats": [
      { "id": "a", "nightlight": 0, "timeline": [
        { "kind": "text", "value": "It took me awhile", "in": "flyUp" },
        { "kind": "wait", "ms": 200 },
        { "kind": "text", "value": "to find my way back to music.", "in": "flyUp" },
        { "kind": "wait", "ms": 200 },
        { "kind": "text", "value": "Too long.", "in": "typewriter", "size": "lg", "speed": 0.25 }
      ] },
      { "id": "b", "timeline": [
        { "kind": "clear" },
        { "kind": "text", "value": "But I eventually found my way.", "in": "letterUp" },
        { "kind": "wait", "ms": 200 }
      ] },
      { "id": "c", "timeline": [
        { "kind": "clear" },
        { "kind": "text", "value": "So we built Musical Mycology —", "in": "fade" },
        { "kind": "wait", "ms": 200 },
        { "kind": "text", "value": "a place for musicians to grow.", "in": "fade" }
      ] }
    ] }
  ]
}
```

- [ ] **Step 2: Extend the sample-deck validity test to cover every sample file**

```ts
// tests/unit/sample-deck.test.ts
import { expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDeckDoc } from "@/engine/deck-doc";

const samplesDir = join(process.cwd(), "samples");
const files = readdirSync(samplesDir).filter((f) => f.endsWith(".deck.json"));

test("samples directory has at least the demo and our-story decks", () => {
  expect(files.sort()).toEqual(["demo.deck.json", "our-story.deck.json"]);
});

test.each(files)("samples/%s is a valid DeckDoc", (file) => {
  const doc = JSON.parse(readFileSync(join(samplesDir, file), "utf8"));
  expect(validateDeckDoc(doc)).toEqual({ ok: true, errors: [] });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/unit/sample-deck.test.ts`
Expected: PASS (3 tests: the directory-listing assertion + one `validateDeckDoc` check per file)

- [ ] **Step 4: Widen the local/e2e seed script to copy all samples**

In `package.json`, change:

```json
"seed:demo": "mkdir -p data/decks && cp samples/demo.deck.json data/decks/demo.deck.json",
```

to:

```json
"seed:demo": "mkdir -p data/decks && cp samples/*.deck.json data/decks/",
```

(Script name is kept as-is — it's referenced from `README.md` and several historical plan docs;
only the glob widens, so those references stay accurate.)

- [ ] **Step 5: Widen the Docker first-run seed to copy every bundled sample**

In `docker-entrypoint.sh`, replace:

```sh
# First-run seed: copy the bundled demo deck ONLY if no deck exists yet.
# Idempotent — never overwrites operator data.
if [ -z "$(ls -A "$DECKS_DIR"/*.deck.json 2>/dev/null)" ]; then
  if [ -f /app/samples/demo.deck.json ]; then
    cp /app/samples/demo.deck.json "$DECKS_DIR/demo.deck.json"
    echo "[entrypoint] seeded demo deck into $DECKS_DIR"
  fi
fi
```

with:

```sh
# First-run seed: copy every bundled sample deck ONLY if no deck exists yet.
# Idempotent — never overwrites operator data.
if [ -z "$(ls -A "$DECKS_DIR"/*.deck.json 2>/dev/null)" ]; then
  if [ -d /app/samples ]; then
    for f in /app/samples/*.deck.json; do
      [ -f "$f" ] || continue
      cp "$f" "$DECKS_DIR/"
      echo "[entrypoint] seeded $(basename "$f") into $DECKS_DIR"
    done
  fi
fi
```

- [ ] **Step 6: Widen the Dockerfile's sample copy**

In `Dockerfile:22`, replace:

```dockerfile
COPY samples/demo.deck.json ./samples/demo.deck.json
```

with:

```dockerfile
COPY samples/ ./samples/
```

- [ ] **Step 7: Verify the local seed script picks up both files**

Run: `npm run seed:demo && ls data/decks/`
Expected: `demo.deck.json` and `our-story.deck.json` both present

- [ ] **Step 8: Commit**

```bash
git add samples/our-story.deck.json tests/unit/sample-deck.test.ts package.json docker-entrypoint.sh Dockerfile
git commit -m "feat(samples): add a second sample deck (Our Story)"
```

---

### Task 6: Library page — card grid + open

**Files:**
- Create: `app/library.css`
- Modify: `app/page.tsx` (replaces the current stub)

- [ ] **Step 1: Write the card-grid styles**

```css
/* app/library.css */
.lib { min-height: 100vh; background: var(--ed-bg-0); color: var(--ed-fg); font-family: var(--ed-body); padding: 32px; }
.lib__bar { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.lib__brand { font-family: var(--ed-disp); font-size: 24px; color: var(--ed-accent); }
.lib__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
.lib__card { border: 1.5px solid var(--ed-line-2); border-radius: var(--ed-radius); overflow: hidden; background: var(--ed-bg-1); position: relative; }
.lib__card-swatch { height: 88px; }
.lib__card-body { padding: 10px 12px; }
.lib__card-title { font-family: var(--ed-disp); font-size: 14px; color: var(--ed-fg); margin: 0 0 2px; }
.lib__card-id { font-family: var(--ed-mono); font-size: 11px; color: var(--ed-fg-muted); }
.lib__card-open { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 0; cursor: pointer; color: inherit; }
.lib__card-del { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--ed-line-2); background: rgba(20,16,10,0.55); color: var(--ed-fg); font-size: 12px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.15s; }
.lib__card:hover .lib__card-del { opacity: 1; }
.lib__new { display: flex; flex-direction: column; gap: 8px; justify-content: center; min-height: 130px; border: 1.5px dashed var(--ed-line-2); border-radius: var(--ed-radius); padding: 14px; background: transparent; color: var(--ed-fg-muted); font-family: var(--ed-disp); font-size: 14px; cursor: pointer; }
.lib__new:hover { color: var(--ed-accent); border-color: var(--ed-accent); }
.lib__new-form { display: flex; flex-direction: column; gap: 8px; }
.lib__new-input { background: var(--ed-bg-2); border: 1px solid var(--ed-line-2); border-radius: 8px; color: var(--ed-fg); font-family: var(--ed-body); font-size: 13px; padding: 7px 9px; }
.lib__new-slug { font-family: var(--ed-mono); font-size: 10.5px; color: var(--ed-fg-muted); margin: 0; }
.lib__new-actions { display: flex; gap: 6px; }
.lib__pill { font-family: var(--ed-disp); font-size: 12px; border-radius: var(--ed-radius-pill); padding: 6px 12px; border: 1.5px solid transparent; cursor: pointer; }
.lib__pill--gold { background: var(--ed-accent); color: #3a2318; }
.lib__pill--ghost { background: transparent; color: var(--ed-fg); border-color: var(--ed-line-2); }
.lib__empty { text-align: center; padding: 60px 20px; border: 1.5px dashed var(--ed-line-2); border-radius: 12px; }
.lib__empty h2 { font-family: var(--ed-disp); font-size: 18px; color: var(--ed-fg); margin: 0 0 8px; }
.lib__empty p { color: var(--ed-fg-muted); font-size: 13px; margin: 0 0 16px; }
.lib__error { color: var(--ed-fg-muted); font-family: var(--ed-mono); font-size: 12px; margin-top: 12px; }
```

- [ ] **Step 2: Write the library page (list + open only, no create/delete yet)**

```tsx
// app/page.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import "./library.css";
import type { DeckMeta } from "@/engine/deck-doc";
import type { Beat } from "@/engine/deck/types";
import { listDecks, loadDeck } from "@/lib/api/decks-client";
import { flattenBeats } from "@/lib/editor/flatten-beats";
import { swatchGradient } from "@/lib/library/swatch";
import { BeatThumbnail } from "@/components/library/BeatThumbnail";

type LoadState = "loading" | "ready" | "error";

export default function Library() {
  const [decks, setDecks] = useState<DeckMeta[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, Beat | null>>({});
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    listDecks()
      .then((metas) => { setDecks(metas); setState("ready"); })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    decks.forEach((meta) => {
      if (meta.id in thumbs) return;
      loadDeck(meta.id)
        .then((doc) => setThumbs((t) => ({ ...t, [meta.id]: flattenBeats(doc)[0]?.beat ?? null })))
        .catch(() => setThumbs((t) => ({ ...t, [meta.id]: null })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks]);

  return (
    <div className="lib">
      <div className="lib__bar">
        <span className="lib__brand">Morgana</span>
      </div>
      {state === "error" && <p className="lib__error" data-testid="library-error">Couldn&apos;t load decks.</p>}
      {state === "ready" && decks.length === 0 ? (
        <div className="lib__empty" data-testid="library-empty">
          <h2>No decks yet</h2>
          <p>Create your first deck to start authoring.</p>
        </div>
      ) : (
        <div className="lib__grid" data-testid="library-grid">
          {decks.map((meta) => (
            <div className="lib__card" key={meta.id} data-testid="deck-card">
              <Link href={`/editor?deck=${meta.id}`} className="lib__card-open">
                <div className="lib__card-swatch" data-testid="deck-card-swatch" style={thumbs[meta.id] ? undefined : { background: swatchGradient(meta.id) }}>
                  {thumbs[meta.id] ? <BeatThumbnail beat={thumbs[meta.id]!} /> : null}
                </div>
                <div className="lib__card-body">
                  <p className="lib__card-title">{meta.title}</p>
                  <p className="lib__card-id">{meta.id}</p>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/library.css app/page.tsx
git commit -m "feat(library): add deck library page with card grid and thumbnails"
```

---

### Task 7: Library page — new-deck form

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the in-place new-deck form**

Add imports and a `NewDeckCard` component, then render it as the grid's trailing item.

```diff
--- a/app/page.tsx
+++ b/app/page.tsx
@@
 import { listDecks, loadDeck } from "@/lib/api/decks-client";
 import { flattenBeats } from "@/lib/editor/flatten-beats";
 import { swatchGradient } from "@/lib/library/swatch";
+import { slugify } from "@/lib/library/slugify";
+import { createDeckWithRetry } from "@/lib/library/create-deck-with-retry";
 import { BeatThumbnail } from "@/components/library/BeatThumbnail";
@@
 type LoadState = "loading" | "ready" | "error";
 
+function NewDeckCard({ onCreated }: { onCreated: (meta: DeckMeta) => void }) {
+  const [open, setOpen] = useState(false);
+  const [title, setTitle] = useState("");
+  const [error, setError] = useState<string | null>(null);
+
+  const submit = async () => {
+    const trimmed = title.trim();
+    if (!trimmed) return;
+    try {
+      const doc = await createDeckWithRetry(trimmed);
+      onCreated(doc.meta);
+      setOpen(false); setTitle(""); setError(null);
+    } catch {
+      setError("Couldn't create deck — try a different title.");
+    }
+  };
+
+  if (!open) {
+    return (
+      <button className="lib__new" data-testid="new-deck-toggle" onClick={() => setOpen(true)}>
+        + New deck
+      </button>
+    );
+  }
+  return (
+    <div className="lib__new lib__new-form" data-testid="new-deck-form">
+      <input
+        className="lib__new-input"
+        placeholder="Deck title…"
+        value={title}
+        autoFocus
+        data-testid="new-deck-title"
+        onChange={(e) => setTitle(e.target.value)}
+        onKeyDown={(e) => e.key === "Enter" && submit()}
+      />
+      <p className="lib__new-slug">→ {slugify(title || "deck")}</p>
+      <div className="lib__new-actions">
+        <button className="lib__pill lib__pill--gold" data-testid="new-deck-create" onClick={submit}>Create</button>
+        <button className="lib__pill lib__pill--ghost" data-testid="new-deck-cancel" onClick={() => { setOpen(false); setTitle(""); setError(null); }}>Cancel</button>
+      </div>
+      {error && <p className="lib__error" data-testid="new-deck-error">{error}</p>}
+    </div>
+  );
+}
+
 export default function Library() {
```

Then wire it into the grid (rendered whether the grid is populated or empty), and pass a
callback that appends the newly created deck to local state:

```diff
   const [state, setState] = useState<LoadState>("loading");
 
+  const onCreated = (meta: DeckMeta) => setDecks((d) => [...d, meta]);
+
   useEffect(() => {
@@
       {state === "ready" && decks.length === 0 ? (
         <div className="lib__empty" data-testid="library-empty">
           <h2>No decks yet</h2>
           <p>Create your first deck to start authoring.</p>
+          <NewDeckCard onCreated={onCreated} />
         </div>
       ) : (
         <div className="lib__grid" data-testid="library-grid">
           {decks.map((meta) => (
@@
             </div>
           ))}
+          <NewDeckCard onCreated={onCreated} />
         </div>
       )}
```

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(library): add in-place new-deck form"
```

---

### Task 8: Library page — delete with confirm

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the delete button and confirm-guarded handler**

```diff
--- a/app/page.tsx
+++ b/app/page.tsx
@@
-import { listDecks, loadDeck } from "@/lib/api/decks-client";
+import { deleteDeck, listDecks, loadDeck } from "@/lib/api/decks-client";
@@
   const onCreated = (meta: DeckMeta) => setDecks((d) => [...d, meta]);
+  const onDelete = async (meta: DeckMeta) => {
+    if (!window.confirm(`Delete deck "${meta.title}"? This can't be undone.`)) return;
+    await deleteDeck(meta.id);
+    setDecks((d) => d.filter((m) => m.id !== meta.id));
+  };
@@
             <div className="lib__card" key={meta.id} data-testid="deck-card">
+              <button
+                className="lib__card-del"
+                title="Delete"
+                data-testid="deck-card-delete"
+                onClick={(e) => { e.preventDefault(); onDelete(meta); }}
+              >
+                ✕
+              </button>
               <Link href={`/editor?deck=${meta.id}`} className="lib__card-open">
```

`e.preventDefault()` stops the surrounding `Link` from navigating when the delete button (nested
inside it) is clicked.

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(library): add deck delete with confirm guard"
```

---

### Task 9: e2e coverage

**Files:**
- Create: `e2e/library.spec.ts`

Follows the same throwaway-deck convention as `e2e/persistence.spec.ts` / `e2e/structural.spec.ts`
(fixed `e2e-*` id, pre-delete-then-create via `request`, delete at the end) — the shared `data/`
dir used by all e2e specs must keep `demo` pristine and shouldn't be cleared wholesale.

- [ ] **Step 1: Write the e2e spec**

```ts
// e2e/library.spec.ts
import { expect, test } from "@playwright/test";

test("create, open, and delete a deck from the library", async ({ page, request }) => {
  const id = "e2e-library";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.delete(`/api/decks/${id}-2`).catch(() => {});

  await page.goto("/");
  await expect(page.getByTestId("library-grid")).toBeVisible();

  // Create via the in-place form.
  await page.getByTestId("new-deck-toggle").click();
  await page.getByTestId("new-deck-title").fill("E2E Library");
  await page.getByTestId("new-deck-create").click();
  const card = page.getByTestId("deck-card").filter({ hasText: "E2E Library" });
  await expect(card).toBeVisible();
  await expect(card.getByText("e2e-library", { exact: true })).toBeVisible();

  // Open it — lands in the editor with the right deck loaded.
  await card.locator(".lib__card-open").click();
  await expect(page).toHaveURL(/\/editor\?deck=e2e-library/);
  await expect(page.locator(".ed__bar")).toContainText("E2E Library");

  // Back to the library, delete it.
  await page.goto("/");
  const cardAgain = page.getByTestId("deck-card").filter({ hasText: "E2E Library" });
  page.once("dialog", (d) => d.accept());
  await cardAgain.getByTestId("deck-card-delete").click();
  await expect(page.getByTestId("deck-card").filter({ hasText: "E2E Library" })).toHaveCount(0);

  await request.delete(`/api/decks/${id}`).catch(() => {});
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `CI=1 npx playwright test e2e/library.spec.ts --workers=1`
Expected: PASS (1 test). (Per north-star §16/§15, the suite is flaky under parallel workers today
— always invoke with `--workers=1`.)

- [ ] **Step 3: Commit**

```bash
git add e2e/library.spec.ts
git commit -m "test(e2e): cover deck library create/open/delete"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS, including the new `slugify`, `swatch`, `create-deck-with-retry`, and widened
`sample-deck` tests.

- [ ] **Step 2: Run the full e2e suite**

Run: `CI=1 npm run test:e2e -- --workers=1`
Expected: PASS, including `e2e/library.spec.ts`, with no regressions in existing specs (the demo
deck must still exist and be untouched by the new spec's cleanup).

- [ ] **Step 3: Manually smoke-test in a dev server**

Run: `npm run dev`, open `http://localhost:3000`. Confirm: the library shows `demo` and
`our-story` cards with thumbnails, `+ New deck` creates and opens a deck, delete removes a card
after confirming.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors
