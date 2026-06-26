# Morgana — Plan 3d Brainstorm: Completing the Authoring Loop + Styling

- **Date:** 2026-06-26
- **Status:** Brainstorm / scope proposal (NOT a plan yet)
- **Author of record:** Chris Oltyan (brainstormed with Claude)
- **Predecessor:** Plan 3c — Structural Editing & Persistence (merged)
- **Center of gravity (decided 2026-06-26):** *Complete the v1 authoring loop* + *richer styling*
  (text bold/italic/size **and** per-deck typography from a bundled open-source font library)

> This is the convergence artifact from the Plan-3d brainstorm. It frames what 3d should
> accomplish, lays out the full design space with a recommended cut line, and flags the
> decisions left for Chris. The next step after sign-off is `writing-plans`, not code.

### Decisions taken during this brainstorm (2026-06-26)
1. **Focus:** complete the authoring loop (option 1), **plus** richer text effects (bold,
   italics, text size).
2. **Fonts:** bundle an open-source font library **self-hosted + manifest** (woff2 in
   `public/fonts/` + `fonts.json` + generated `@font-face` + bundled licenses); migrate off
   `next/font/google`.
3. **Font placement:** **fold the per-deck font picker into 3d** alongside text styling, with a
   thin starter bundle. 3d grows to ~8 tasks.
4. **Deferred to Plan 3e:** the "add new fonts as needed" system (upload / registration /
   subsetting pipeline), plus the trust/polish bucket (validation, keyboard, onboarding, a11y).

---

## 1. What Plan 3d should accomplish

Plans 3a→3c built the editor's *spine*: a 4-zone shell, a schema-driven inspector, a
scrubbable canvas, structural beat/scene editing, undo/redo, and autosave. But the loop a
real author walks — **open a deck → build a beat → style the text & typography → choreograph
it → preview → export → manage decks** — still has holes you can fall through:

- You **cannot add or remove an action inside a beat.** The only way to get a new action is
  to *duplicate a whole beat and edit it*. This is the single largest gap in the v1 promise
  ("open → arrange → place text → assign effects → choreograph → preview → **export**").
- **Deck management is API-only.** `listDecks` / `createDeck` / `deleteDeck` all exist, but
  the toolbar exposes none of them — you switch decks by hand-editing `?deck=` in the URL.
- **Export-to-TS is invisible.** `deckDocToModule()` is implemented and unit-tested, but no
  button, route, or menu surfaces it. The export half of the loop literally can't be reached.
- **Text is under-expressive.** A text line can set size (`lg`/`md`/`sm`), align, reveal, and
  position — but not **bold**, **italic**, or finer size.
- **Typography is hardcoded and un-generalized.** Fonts are still pulled via `next/font/google`
  in `app/layout.tsx` (Londrina Solid / Atkinson Hyperlegible / Dancing Script). The *engine*
  consumes `--font-display/body/cursive` cleanly (the §5.2 consumer seam is done), but the
  *provider* is hardwired to specific Google families with a build-time network dependency, and
  there's **no per-deck font choice**. Design §5.2's "inject as CSS-var config rather than
  `next/font` imports" is still unrealized.
- **Registry coverage is partial.** ~9 `Action` kinds fall through to an empty generic
  descriptor, so selecting them shows "No editable fields." The moment action-CRUD lets you
  *add* one of those kinds, that gap becomes a dead end.

**The thesis of 3d:** close the loop *and* let an author make decks look finished — build,
style (text + typography), and ship a deck end-to-end inside Morgana, without touching
TypeScript and without the duplicate-a-beat workaround. Everything here stays **Tier 1** (no
bespoke effect editors, no particle-scrub rewrite, no asset *upload* pipeline — those remain
Tier 2 per design §9; the font *upload/registration* system is the separate Plan 3e).

---

## 2. Current state — the gaps, precisely

| Area | Wired today (post-3c) | Gap 3d targets |
|---|---|---|
| **Beats / scenes** | add / dupe / delete / move-within-scene; add scene | scene **delete** unwired; no cross-scene move; no drag-reorder |
| **Actions within a beat** | edit fields (registered kinds); drag `pos` handle | **no add / insert / delete / reorder**; no convert-kind |
| **Timeline** | scrub slider, play/pause, action chips (select only) | no add/delete, no `┃gate┃` dividers, no segment grouping, no wait bars |
| **Text** | value, in (9), size lg/md/sm, align, speed, pos | **no bold / italic / finer size** |
| **Typography / fonts** | 3 roles consumed via `--font-*`; provider = `next/font/google` (hardcoded families, build-time fetch); app-global | **migrate to self-hosted bundle** (`public/fonts/` + manifest + `@font-face`); **bundle a starter OSS library**; **per-deck picker** |
| **Registry** | 13 kinds with schemas | ~9 kinds → empty generic; registry has **no `defaults()`** (needed to "add an action of kind X") |
| **Deck management** | API only (`list`/`create`/`delete`) | no switcher, no New, no Delete, no rename in the UI |
| **Export** | `deckDocToModule()` lib fn (tested) | **not surfaced** anywhere |
| **Canvas fidelity** | lightweight `seek.ts` renderer (text/art/clear/fade_out/nightlight) | counter / media / notes render **nothing under scrub** (the v1 seek compromise) |

> Unregistered kinds: `note_circle`, `stop_notes`, `stop_circle`, `cue`, `reveal_arrows`,
> `pulse_arrow`, `reveal_again`, `counter_hide`, `media_out`.

---

## 3. The design space — every candidate, weighed

Effort: **S**(mall) / **M**(edium) / **L**(arge). Each row notes value, risk, and whether
it touches the **engine** (higher-stakes than pure-editor work, because it must also keep
present/print modes and export round-tripping correct).

### Tier-1 — the authoring loop (3d's spine)

| # | Candidate | Effort | Why it matters | Notes / risk |
|---|---|---|---|---|
| A | **Timeline action CRUD** — add / insert / delete / reorder actions in a beat | **M** | *The* core gap. Without it you can't author a beat from scratch. | Needs registry `defaults()` / `newAction(kind)` + an "add kind" picker. Reorder can reuse the filmstrip's up/down pattern before drag. |
| C | **Deck management UI** — switcher + New + Delete (+ rename?) | **S–M** | Turns `?deck=` hand-editing into a real tool; "manage decks" is half of the loop. | All backing APIs already exist; mostly UI + confirm-on-delete (§5.5). |
| D | **Surface export-to-TS** — toolbar button → copy/download module | **S** | The export half of the loop is currently unreachable. Cheapest high-value win. | `deckDocToModule()` already exists + is tested. Mostly a button + download/clipboard. |
| E | **Registry gap-fill** — descriptors + `defaults()` for every add-able kind | **S–M** | If action-CRUD can insert kind X, kind X must be editable. Closes the empty-inspector dead end. | Several kinds are zero-field (trivial); a handful need small schemas. Scope to "every kind the add-menu offers." |

### Tier-1 — styling (3d's second theme)

| # | Candidate | Effort | Why it matters | Notes / risk |
|---|---|---|---|---|
| B | **Text styling — bold / italic / size** | **M** | Makes editor output match hand-authored richness. | **Touches the engine:** must render in `seek.ts` *and* the real `CinematicSlide`, and round-trip through export. Per-line vs inline is a real decision (§5.1). |
| T1 | **Font provider migration** — off `next/font/google` → self-hosted `@font-face` from a manifest | **M** | Realizes design §5.2; removes the build-time Google dependency; air-gapped-clean Docker. | Keep the 3 current families as defaults → **zero visual change**. Unifies engine `--font-*` and editor-chrome `--mm-font-*` on real `@font-face` family names. |
| T2 | **Thin starter font library** — curate ~6–8 OSS families across roles | **S–M** | Gives authors real typographic choice without an external CDN. | OFL/Apache only; bundle latin-subset woff2 + license files + manifest entries. Kept thin to control 3d size; expandable later. |
| T3 | **Per-deck font picker** — choose display/body/cursive in Deck Settings | **M** | The author-facing payoff of T1/T2; sibling to text styling. | Store on `meta.fonts` (§5.6); apply as deck-scoped CSS vars on canvas + engine; export round-trip. |

### Tier-1 companions — cheap, but 3d is now full (~8 tasks); likely slip to 3e

| # | Candidate | Effort | Why it matters | Notes |
|---|---|---|---|---|
| F | **Click-gate dividers + segment grouping in the timeline** | **S–M** | Design §6.5 vision; makes a CRUD-edited timeline legible. Natural companion to A. | Fold into A's timeline rework only if 3d has room; else 3e. |
| G | **Scene-management completeness** — wire `deleteScene`; rename; (maybe) reorder/cross-scene move | **S** | `deleteScene` exists in the store but no button calls it. | The delete wire-up is trivial — worth sneaking in; reorder/move is larger → 3e. |
| H | **Copy / paste of actions & beats** | **M** | Multiplies authoring speed; pairs with action-CRUD. | → 3e (needs a clipboard model; not core to the loop). |

### Tier-2 / later — explicitly deferred (design §9 / §7.2 / §3)

| # | Candidate | Why deferred |
|---|---|---|
| K | **Bespoke on-stage effect editors** (note emitter arc/decay, counter spin, media scale/move handles) | Explicit Tier-2 (design §9). The generic `pos` handle from 3c covers placement. |
| L | **Deterministic particle scrubbing** (time-pure NoteField/spore rewrite) | Highest-risk item, explicitly Tier-2 (design §7.2, §9). The seek approximation is the accepted v1 compromise. |
| M | **Asset picker / upload / management UI** | Tier-2 (design §3). v1 references assets by key/URL via the inspector. |
| Q | **Real GSAP `BeatStage` runtime in the canvas** (so counter/media/notes show under scrub) | Large fidelity lift; the lightweight `seek.ts` renderer is the intentional v1 compromise. |
| P | **Nightlight keyframing curve UI** | Deferred in design §9; per-beat value + mid-beat `nightlight` actions suffice. |
| O | **Multi-select + bulk ops** | Depends on copy/paste (H) landing first; better as a fast-follow. |

### Proposed **Plan 3e** — trust, polish & font extensibility (split out of 3d)

| # | Candidate | Why split out |
|---|---|---|
| **"Add new fonts" system** | upload / drop-in registration / subsetting pipeline so users extend the bundled library | Chris's call (2026-06-26): the *library + picker* land in 3d; the *extensibility system* is its own later plan. Matches design's "loaded from outside the core" philosophy. |
| J | **Deck validation / linting** (`counter_to` with no prior `counter_show`, `media_move` → missing tile id, empty beats, gate-less infinite beats) | Coherent body of work orthogonal to the authoring loop; cleaner once CRUD can *produce* invalid states. |
| I | **Keyboard-driven authoring** (arrow-key nav, delete-key, enter-to-add) | Polish layer over CRUD; design once the CRUD surface is settled. |
| N | **Empty-state / onboarding UX** | Only meaningful once deck-create (C) exists; small, deferrable. |
| — | **Accessibility pass** (focus order, ARIA on canvas handles/timeline, keyboard operability) | Worth a dedicated sweep; pairs with I. |

---

## 4. Recommended scope for Plan 3d

**(recommended) Ship the loop + styling: A + C + D + E (authoring loop) and B + T1 + T2 + T3
(styling) — ~8 tasks, matching the appetite Chris chose by folding fonts in.** Sneak in the
trivial `deleteScene` wire-up (part of G). Everything else (F, copy/paste H, scene reorder,
the "add fonts" system, validation/keyboard/a11y) → **Plan 3e**. Tier-2 stays deferred on-spec.

**Reasoning:**
- **A, C, D, E together *are* the loop.** A removes the duplicate-a-beat workaround; C makes
  decks switchable/creatable; D makes export reachable; E guarantees that anything A can add is
  editable. Drop any one and the loop still leaks — they belong in one plan.
- **B + T1/T2/T3 are the styling theme** you asked for. B is per-line text expressiveness;
  T1/T2/T3 are deck-level typography. Both reach into the engine's text/CSS-var path, so doing
  them in one plan keeps the rendering changes coherent rather than spread across releases.
- **T1 is also overdue cleanup:** it finally realizes design §5.2 and removes the build-time
  Google dependency — valuable for the "standalone, easy-to-deploy OSS tool" positioning even
  before anyone picks a non-default font. Keeping the current 3 families as defaults makes it a
  zero-visual-change migration.
- **D is nearly free** (the bridge exists) and closes the loop's most embarrassing gap.
- **8 tasks is a full plan.** If it runs heavy, the natural trims are: keep T2 *minimal*
  (3 current families + 2–3 added, not 8), and drop the convert-kind / resizable-wait stretch
  goals (§5.2/§5.3) — neither is core.

**What 3d explicitly is NOT** (say so in the plan, like 3c did):
- Not bespoke per-effect on-stage editors (Tier-2 §9).
- Not deterministic particle scrubbing (Tier-2 §7.2).
- Not an asset *upload* pipeline, and **not** the font upload/registration system (that's 3e).
- Not a fidelity rewrite of the canvas to the full GSAP runtime.
- Not validation/linting or a keyboard/a11y pass (Plan 3e).

### Indicative task shape (sketch, not a plan)
~8 tasks. Order chosen so each builds on the last:

1. **Registry `defaults()` + gap-fill (E)** — every add-able kind gets `defaults()` and a real
   (possibly empty) schema. Pure, unit-testable; unblocks A.
2. **Pure action mutations (A, lib)** — `insertActionAfter` / `deleteActionAt` / `moveActionBy`
   / `duplicateActionAt` in `mutations.ts`, mirroring the beat mutations; store methods over
   `commit()`; unit-tested.
3. **Timeline CRUD UI (A)** [+ gate dividers F if room] — "+ add action" kind-picker, per-chip
   delete/reorder, `┃gate┃` rendering.
4. **Text styling (B)** — extend the `text` Action type + registry schema + `seek.ts` render +
   the real engine's text renderer + an export round-trip test.
5. **Font provider migration + manifest + starter bundle (T1 + T2)** — `public/fonts/` woff2 +
   `fonts.json` + generated `@font-face`; swap `app/layout.tsx` off `next/font/google`; bundle
   licenses. Defaults unchanged → existing e2e/theme specs stay green.
6. **Per-deck font picker (T3)** — Deck Settings pickers over the manifest; `meta.fonts`;
   deck-scoped CSS-var application; export round-trip.
7. **Deck management UI (C)** + the `deleteScene` wire-up (G) — toolbar switcher (over
   `listDecks`), New, Delete (confirm), maybe rename; navigates by `?deck=`.
8. **Export button (D)** + full-suite verification.

---

## 5. Design decisions to make (these shape the plan)

### 5.1 Text styling: per-line vs inline rich text  *(biggest fork on the text side)*
- **(recommended) Per-line styling fields.** Add `weight?: "normal" | "bold"`,
  `italic?: boolean`, and finer size (extend the enum — e.g. `xs/sm/md/lg/xl` — or a numeric
  scale) to the `text` Action. The *whole line* is bold/italic. **Why:** small, safe data-model
  change; renders trivially via inline style in both `seek.ts` and the real engine; exports as
  plain extra fields with zero parsing; covers the literal ask. **Cost:** can't bold a single
  word inside a line.
- **Alternative — inline markup** (`**bold**` / `*italic*` → spans). Supports mixed styling
  within a line, but collides with the engine's **SplitText** letter/word reveals (char-split
  vs span boundaries), forces the seek-renderer and export to parse markup, and touches the
  riskiest part of the engine. **Recommend deferring to Tier-2** unless per-word styling is a
  hard requirement. (See Q1.)

### 5.2 "Convert a block's kind" (from the flagged 3d list)
Changing `text` → `rotateList` in place means reconciling fields between two schemas — fiddly,
and "delete + add the right kind" already covers the need once A exists.
**(recommended) Treat convert-kind as a stretch goal, not core** — ship add/delete/reorder
first; add convert only if it falls out cheaply.

### 5.3 "Resizable waits" (from the flagged 3d list)
`wait.ms` is already editable via the inspector. A drag-to-resize gap is a UX nicety, not new
capability. **(recommended) Fold a draggable wait into the timeline rework only if cheap;
otherwise defer** — the inspector field is sufficient for v1.

### 5.4 Add-action UX
A "+ Add action" control opens a kind-picker (grouped by category) and inserts the chosen kind
with its `defaults()`. The picker should offer only kinds that make sense to author by hand
(text, wait, click_gate, art, nightlight, counter_*, media*, note_emitter, rotateList) — not
internal/paired kinds. Registry needs `defaults()` (and ideally a `category`) added per kind.

### 5.5 Deck deletion safety
Deleting a deck removes a file on the volume. **(recommended) Require a confirm step** and
never allow deleting the last/only deck without a clear path back (or seed a fresh empty deck
on delete-all).

### 5.6 Font bundle: manifest, storage, licensing  *(the font-side decisions)*
- **(recommended) `public/fonts/` + `fonts.json` manifest + generated `@font-face`.** Manifest
  entry shape: `{ family, role: "display"|"body"|"cursive", weights: number[], files: { [weight]: path }, license, licenseFile, source }`.
  A small build step (or a checked-in generated CSS) turns the manifest into `@font-face` rules;
  a `fontFamilies()` helper feeds the picker. **Why:** decouples font *availability* (manifest)
  from *selection* (per-deck) — which is exactly the seam the 3e "add fonts" system extends.
- **(recommended) Per-deck storage as flat `meta.fonts?: { display?, body?, cursive? }`**
  (family names referencing the manifest; unset → bundled defaults). Flat keeps it
  export-friendly and easy to apply as CSS vars. *Alternative:* nest under `meta.theme.fonts`.
  Recommend flat. (See Q3.)
- **(recommended) Keep the existing 3 roles** (display / body / cursive). Adding a `mono`/accent
  role touches the engine more for marginal value in 3d. (See Q4.)
- **License compliance (hard gate for a public MIT repo):** bundle **only** OFL/Apache-2.0 (or
  similarly permissive) families; ship each license file under `public/fonts/LICENSES/`; record
  the license in the manifest; note attribution in the README. The current 3 families are all
  **OFL**, so the migration itself is clean.
- **Subsetting:** latin subset only for v1 (repo-size discipline); non-latin is a 3e concern,
  tied to the "add fonts" pipeline.
- **Cross-repo export caveat (note in the plan, out of scope to solve):** a deck that uses a
  non-default font exports TS referencing that family; the *consuming* repo (mm-website) must
  also have the font available. Morgana-internal round-trip is just data; the mm-website side is
  a convergence concern, not a 3d deliverable.

---

## 6. Open questions for Chris

1. **Text styling depth (§5.1).** Per-line bold/italic/size (recommended, low-risk) — or do you
   need *inline* mixed styling within a line (defers to Tier-2)? And for "text size": a few
   more named steps (`xs…xl`) or a true numeric size?
2. **Convert-kind & resizable-waits (§5.2/§5.3).** "Nice if cheap" (my default), or do you
   specifically want them guaranteed in 3d?
3. **Per-deck font storage (§5.6).** Flat `meta.fonts` (recommended) vs `meta.theme.fonts`?
   And is font choice **per-deck only** for 3d (recommended), or do you also want per-scene /
   per-beat overrides?
4. **Font roles (§5.6).** Keep the existing 3 (display / body / cursive), or add a `mono`
   and/or accent role now? (Recommend keep 3.)
5. **Starter library (T2).** Which OSS families should the thin starter set include (beyond the
   current Londrina Solid / Atkinson Hyperlegible / Dancing Script)? Any must-haves or
   must-avoids? Target count ~6–8 to keep 3d sized.
6. **Trim levers if 3d runs heavy.** Are you OK with the proposed trims (minimal T2; drop
   convert-kind/resizable-wait) — or would you rather slip C (deck management) or F to 3e to
   protect the styling work?
7. **Cross-scene beat move / drag-reorder (G).** In scope for 3d, or leave beats moving only
   within a scene (current behavior) until 3e?

---

## 7. Summary

- **Theme:** complete the v1 authoring loop **+ styling** (per-line text + per-deck typography).
  All Tier-1.
- **Recommended 3d scope (~8 tasks):** **A** action CRUD · **C** deck switcher/new/delete ·
  **D** surface export · **E** registry gap-fill/`defaults()` · **B** text bold/italic/size ·
  **T1** font provider migration (off `next/font/google`) · **T2** thin OSS font library
  (self-hosted + manifest) · **T3** per-deck font picker — plus the trivial `deleteScene`
  wire-up.
- **Plan 3e (split out):** the "add new fonts" extensibility system + validation/linting,
  keyboard authoring, onboarding, a11y; companions F/G-reorder/H if they slip.
- **Deferred on-spec (Tier-2):** bespoke effect editors, particle scrubbing, asset upload,
  canvas-fidelity rewrite, nightlight keyframing, multi-select.
- **Decide before planning:** text-styling depth (§5.1 / Q1) and the font storage/roles shape
  (§5.6 / Q3–Q5) — those most affect the engine + data-model work.
