# Deck Switcher / New / Delete UI — Design Spec

- **Date:** 2026-07-02
- **Status:** Approved (brainstormed with Claude)
- **Tier:** 1.5 — Hardening
- **Parent doc:** [`2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md), §3 (feature matrix, "Deck switcher"), §16 (roadmap)

## 1. Purpose

There is currently **no UI to browse, create, or delete decks**. `app/page.tsx` is a blank stub;
the editor ([`app/editor/page.tsx`](../../../app/editor/page.tsx)) only loads whatever deck the
`?deck=` query param names, defaulting to `"demo"`. The full CRUD API already exists and works
(`GET/POST /api/decks`, `GET/PUT/DELETE /api/decks/[id]`, wrapped by
[`lib/api/decks-client.ts`](../../../lib/api/decks-client.ts)) — it's simply unreachable except by
hand-editing the URL or calling the API directly. This is the largest usability gap in the app
today: nobody can actually start using Morgana without doing one of those two things.

This slice makes `app/page.tsx` the deck library: browse, open, create, and delete decks.

## 2. Scope

**In scope:**
- Deck library page (`app/page.tsx`) replacing the current blank stub.
- Card grid: one card per deck, each opens `/editor?deck=<id>`.
- Per-card read-only thumbnail (first cinematic beat, reusing the existing seek-renderer) with a
  deterministic gradient-swatch fallback.
- "+ New deck" in-place form (title only; id auto-slugified).
- Per-card delete with a native `confirm()` guard.
- Empty state (zero decks).
- A second hand-authored example deck (3–5 beats, inspired by mm-website's public "Our Story"
  narrative) seeded alongside the existing generic `demo` deck.

**Explicitly out of scope:**
- Any change to the editor's own deck-loading behavior (`?deck=` param, default-to-`demo`) or an
  in-editor deck switcher — the library page is the only new surface (§3 design decision, "entry
  point").
- Deck rename/duplicate (not requested; `DeckSettings.tsx` already covers title edits once a deck
  is open).
- Thumbnails for non-cinematic layouts (`title`/`sectionLead`/`closing`) — no renderer exists for
  those yet anywhere in the app (§3 design decision, "thumbnail scope").
- A full port of mm-website's story deck — this seeds a small illustrative sample only.
- Any change to the underlying deck-store API layer (`lib/store/deck-store.ts`,
  `app/api/decks/**`) — it's already complete for this slice's needs.

## 3. Design decisions

Resolved during brainstorming (including a visual-companion session); recorded here so the plan
doesn't re-litigate them.

| Decision | Resolution | Why |
| --- | --- | --- |
| Entry point | **`app/page.tsx` becomes the library**; editor stays deck-scoped via `?deck=`, no in-editor switcher | A real home page is the natural "front door" for a self-hosted tool; avoids fighting for space in the editor's already-tight top bar (undo/redo/settings/save-status). |
| Grid vs. list | **Card grid** | User preference, overriding the initial row-list recommendation. |
| Card thumbnail | **Reuse the existing seek-renderer** (`renderBeatAt` + `ArtStage` from `engine/authoring/seek.ts` / `engine/components/ArtStage.tsx`) to render the deck's first **cinematic** beat, paused at `t=0`, via a new read-only wrapper — **not** `DeckCanvas` directly, since `DeckCanvas`'s `PosHandle` reads the singleton editor Zustand store (`lib/editor/store.ts`) and isn't meant to be mounted N times outside the editor. | Zero new rendering architecture (pure reuse of what the editor canvas already does); honest about what the app can actually render today — no renderer exists yet for `title`/`sectionLead`/`closing` layouts. |
| Thumbnail fallback | **Deterministic gradient swatch, hashed from deck id** | Covers decks with no cinematic beat (or none at all) without inventing placeholder content. |
| Delete confirmation | **Native `confirm()`**, breaking from the no-confirm pattern used for in-doc deletes (`deleteBeat`/`deleteAction` in `Filmstrip.tsx`/`Timeline.tsx`) | Those deletes are covered by the 50-step undo history; deck delete is a filesystem operation outside that history and cannot be undone. |
| New-deck UI | **In-place form** (dashed card flips to title input + Create/Cancel) | No modal/dialog component exists anywhere in the codebase; matches the existing in-place-toggle pattern (`DeckSettings` toggling in for `Inspector` in `app/editor/page.tsx`). |
| New-deck fields | **Title only**; id auto-slugified from title (lowercase, non-`[a-z0-9-]` → `-`, collapse repeats, strip leading digit-only edge cases handled by prefixing if needed to satisfy `DECK_ID_RE`) | One input, matches how most consumer tools name new documents; avoids exposing `DECK_ID_RE`'s format rules as a user-facing validation error path. |
| Id collision | **Retry once with a `-2` suffix** on a `createDeck` 409/error; surface an inline error only if the retry also fails | Keeps the common case (no collision) a single request with no visible friction. |
| Sample content | **Hand-author 3–5 beats** inspired by mm-website's public `lib/deck/content.story.ts` (confirmed non-gated — distinct from the investor-gated deck under `investor-hub/`), seeded as a **second** example deck alongside `demo`, not the default | Deliberate, Chris-approved exception to the "no MM-specific content" positioning (recorded in the `morgana-positioning` memory) — content, not code/infra coupling. mm-website uses its own bespoke deck schema, so beats are re-authored against Morgana's `Action` vocabulary, not machine-ported. Full port deferred to a future project once more of Tier 2 (real effect editors) exists. |

## 4. Architecture

### 4.1 New: read-only beat thumbnail component

`components/library/BeatThumbnail.tsx` (new) — a minimal, editor-store-independent wrapper around
the same primitives `DeckCanvas` uses for static rendering:

```ts
function BeatThumbnail({ beat }: { beat: Beat }) { /* ArtStage + renderBeatAt(beat.timeline, 0, ...), no PosHandle, no play/seek imperative handle */ }
```

Renders once at `t = 0` (no rAF loop, no interactivity) into a fixed-aspect (16:9) container sized
by its CSS context (the card's swatch area). No new engine code — this only reuses
`beatDuration`/`renderBeatAt` from `engine/authoring/seek.ts` and `ArtStage` from
`engine/components/ArtStage.tsx`, both already exported and used by `DeckCanvas`.

### 4.2 New: library page

`app/page.tsx` (replaces the current stub) — a client component:

- On mount, `listDecks()` (existing `lib/api/decks-client.ts` export) → `DeckMeta[]`.
- For each deck, lazily `loadDeck(id)` → `DeckDoc`, `flattenBeats(doc)` (existing
  `lib/editor/flatten-beats.ts` export), find the first `FlatBeat` whose `beat` came from a
  `cinematic` slide context — since `flattenBeats` only walks `doc.scenes[].beats[]` (already
  cinematic-only in this schema; see §4.4 note below) — and pass `beats[0].beat` to
  `BeatThumbnail`. A `loadDeck` failure (or zero beats) falls back to the gradient swatch.
- Renders a CSS grid of cards (`repeat(auto-fill, minmax(180px, 1fr))`, matching the mockup),
  reusing `--ed-*` tokens from `app/editor/editor.css` / `app/mm-tokens.css` for visual
  consistency with the editor (pill buttons, disp/mono fonts, accent gold, bg/line colors).
- Trailing "+ New deck" card, toggling between its idle (dashed, `+ New deck` label) and
  form (title `<input>` + slug preview `<p>` + Create/Cancel `<button>`s) states via local
  `useState`.
- Empty state (`decks.length === 0` after load): centered prompt with its own "+ New deck"
  trigger, reusing the same form toggle.

### 4.3 Slug helper

`lib/library/slugify.ts` (new, pure function): lowercase, replace runs of non-`[a-z0-9]` with
`-`, strip leading/trailing `-`, and if the result doesn't start with `[a-z0-9]` (e.g. empty
after stripping) fall back to a fixed prefix (`"deck"`) so it always satisfies
`DECK_ID_RE = /^[a-z0-9][a-z0-9-]*$/` (`engine/deck-doc.ts`). Pure and unit-testable in isolation
from the page component.

### 4.4 Data flow note (`flattenBeats` scope)

`flattenBeats` (`lib/editor/flatten-beats.ts`) walks `DeckDoc.scenes[].beats[]`. In the current
`DeckDoc`/`engine/deck-doc.ts` schema, `scenes[].beats[]` are inherently the cinematic timeline
beats the editor already works with — this is the same data source `Filmstrip.tsx` and
`DeckCanvas.tsx` already use, so no new traversal logic is needed beyond calling the existing
function and taking index `0`.

### 4.5 No changes to

`lib/store/deck-store.ts`, `app/api/decks/**`, `lib/api/decks-client.ts`, `app/editor/page.tsx`,
`lib/editor/store.ts` — all already support this slice's needs as-is.

## 5. Sample deck content

New deck file seeded under `data/decks/` (mirroring how the existing `demo` deck ships), e.g.
`our-story.deck.json` with `meta.id: "our-story"`, `meta.title: "Our Story"`. 3–5 beats
hand-authored by adapting a representative slice of mm-website's `storyScenes` opening (the
"lone musician at dusk" beats — `content.story.ts` lines ~21–60) into Morgana's `Action` schema
(`text`, `art`, `wait`, `note_emitter`, etc. — the two schemas share enough vocabulary that this
is a direct hand-translation, not new authoring work). Exact beat content is an implementation
detail for the plan/build step, not fixed here.

## 6. Testing

Following existing conventions (no new test infrastructure):

- **`tests/unit/slugify.test.ts`** — pure-function tests: basic slugification, collapsing
  repeated separators, leading-digit/empty-string edge cases, already-valid input is a no-op.
- **`tests/unit/library-page.test.ts`** (or colocated with existing component test patterns) —
  card list renders from `listDecks()`, "+ New deck" form calls `createDeck` with the slugified
  id, 409-retry-with-suffix behavior, delete calls `deleteDeck` after `confirm()` returns true and
  is a no-op when `confirm()` returns false.
- **`e2e/library.spec.ts`** (new, following `e2e/deck-settings.spec.ts`'s structure) — full flow
  through the real UI: land on `/`, create a deck via the form, see it appear as a card, open it
  (lands on `/editor?deck=<id>` with the right title loaded), delete it (confirm dialog handled
  via Playwright's `page.on("dialog")`), see it disappear. Also cover the empty state when no
  decks exist (test setup clears `data/decks/` or uses an isolated data dir per the existing e2e
  data-dir convention).

## 7. Non-goals / deferred

- In-editor deck switcher (§2).
- Deck rename/duplicate from the library.
- Real thumbnails for `title`/`sectionLead`/`closing` layouts — tracked as a follow-up once
  present-mode (Tier 3) or a richer canvas (Tier 2) exists to reuse.
- Full port of mm-website's story deck.
- Any resolver/CDN/thumbnail-caching optimization for large deck counts — out of scope until deck
  counts in practice justify it (self-hosted single-user tool, no stated scale requirement).
