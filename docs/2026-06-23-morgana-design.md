# Morgana — Design Spec

- **Date:** 2026-06-23
- **Status:** Draft for review
- **Repo (to create):** `Musical-Mycology/morgana` (public, MIT)
- **Author of record:** Chris Oltyan (brainstormed with Claude)

> **Note on this file's home.** This spec was written in the `mm-website` worktree
> (where the brainstorm happened and where Morgana's engine is vendored from). It is the
> *seed* document for the new `morgana` repo — v1 task 0 creates that repo and copies this
> spec in. If you'd rather it live in `mm-documents` instead, say so and I'll relocate it.

---

## 1. Summary

**Morgana** is an open-source, web-based **slide-deck editor** for the cinematic presentation
engine that currently powers `musicalmycology.org`'s `/story` and `/investor-presentation`
decks. Today those decks are authored by hand-writing TypeScript data (`Scene → Beat →
Action[]`) that a GSAP-driven engine interprets. Morgana puts a visual editor on top of that
exact data model: a WYSIWYG canvas, a schema-driven property inspector, and a hybrid timeline
for choreographing each slide's actions — speed, delay, click-gates, effect assignment — with a
**scrubbable playhead**.

It ships as a Docker container you can run locally, and a hosted instance stands up in the
Mycelium network behind the gateway.

The name: *Morgana* (Fata Morgana — the mirage that builds castles in the air), the enchantress
who makes visions. Fitting for a tool that conjures shows and illusions.

## 2. Context — the existing deck engine

The engine being vendored lives in `mm-website` at:

- **`lib/deck/`** — the data + logic layer: `types.ts` (the canonical `Scene`/`Beat`/`Action`
  shapes), `content.story.ts` / `content.investor.ts` (authored decks), `flatten.ts`
  (`Scene[] → Deck`), `panel.ts`, `inline-links.ts`, `nightlight.ts`, `theme.ts`,
  `cinematic-style.ts`, `story-assets.ts`, etc.
- **`components/deck/`** — the render layer: `Deck.tsx` (interactive player), `PrintDeck.tsx`
  (static PDF render), `Slide.tsx`, `ArtStage.tsx` (layer compositor), `Atmosphere.tsx`
  (sky + tsParticles spores), `NoteField.tsx` (GSAP note sprites), and
  `layouts/CinematicSlide.tsx` — the engine that splits a beat's `timeline: Action[]` at
  `click_gate` boundaries into segments, builds a GSAP timeline per segment, and auto-plays.

**Key facts that shape Morgana:**

- A **`Beat`** is the unit of interaction (one click-to-advance); its `timeline: Action[]`
  auto-plays and is **segmented by `click_gate`** into pause-points with no fixed duration.
- Durations are largely **implicit** (computed from text length) or set via `wait`/`durationMs`.
- Text is positioned with normalized **`StagePoint {x, y}`** (0–1) on a fixed 16:9 stage.
- Open-source effect libs in use: **GSAP** (+ SplitText, `@gsap/react`) and **tsParticles**
  (`@tsparticles/slim` + emitters). Custom effects: ArtStage, NoteField, counter widget,
  media tiles, native data panels, and the text-reveal set (`flyUp`, `fade`, `letterFly`,
  `letterUp`, `wordUp`, `blurIn`, `typewriter`, `cursive`).
- Assets today resolve to **local `/storyboard/...` paths** (`story-assets.ts`), with a
  noted Phase-3 intent to swap to the sporekles CDN.

## 3. Goals & non-goals (v1)

**Goals**
- A usable, end-to-end deck editor: open → arrange → place text → assign effects → choreograph
  the per-beat timeline (with gates, delays, and a **scrubbable** playhead) → preview → export.
- **True WYSIWYG** by rendering the *real* vendored engine in the canvas.
- Architected so "extend the features of existing effects" and "a framework for future effects"
  are natural extensions, not rewrites.
- Runs in Docker locally; hosted behind the Mycelium gateway.

**Non-goals (v1)**
- Bespoke on-stage visual editors for NoteField / counter / media (v1 edits these via inspector
  fields).
- A plugin framework for third-party effects (designed-for, not built).
- Asset upload/management UI (v1 picks from existing sporekles/volume assets).
- Multi-user editing / in-app auth (gateway-gated, single-user assumption).
- Pixel-perfect *particle* scrubbing (see §7.2 for the v1 compromise).

## 4. Key decisions (brainstorm record)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Name / repo | **`morgana`** (bare, public Musical-Mycology org); "mm-morgana" = informal shorthand |
| 2 | License | **MIT** (confirm it matches `arco`/`abctools`); public from the start |
| 3 | Engine model | **Vendor now, converge later** — snapshot the engine, ship standalone, extract to a shared package once the format stabilizes |
| 4 | Storage | **Filesystem + JSON** on a mounted volume; light Next.js (Node) backend |
| 5 | Timeline | **Hybrid** — deck-level filmstrip + per-beat choreography track |
| 6 | v1 scope | **Tier 1 authoring core** + GH repo creation (task 0) + **scrubbing in v1** |
| 7 | Effect architecture | **Effect-descriptor registry** (schema-driven inspector + render/seek contract) |
| 8 | Preview | **Play/pause + frame-accurate scrub** (particles approximated under scrub) |
| 9 | Auth | **Gateway-gated, auth-light** (confirm) |

## 5. Architecture

### 5.1 Repo & stack
- New repo **`Musical-Mycology/morgana`**, public, MIT.
- **Next.js 15 + React 19 + TypeScript + Tailwind v4** — mirrors the MM house stack. The
  vendored engine is React + GSAP + tsParticles, so the host must be React.
- **Not** a static export (unlike `mm-website`): runs as a Node server for filesystem I/O.
- Internal layers:
  - **`engine/`** — vendored snapshot of `lib/deck/*` + `components/deck/*`, behind injection
    points (§5.2). This is the future shared package, pre-shaped.
  - **`editor/`** — the Morgana UI + the effect-descriptor registry.
  - **`app/api/`** — Next Route Handlers for deck CRUD, asset listing, TS export.

### 5.2 Engine vendoring & injection points
The engine is generalized so it carries no hardcoded MM specifics:
- **`AssetResolver`** — replaces hardcoded `/storyboard/...` (and the future sporekles swap)
  with an injected resolver: `(assetKey) => url`. Morgana can point at the sporekles CDN, the
  local volume, or arbitrary URLs.
- **Font config** — injected as CSS-var config (`--font-display`, `--font-body`,
  `--font-cursive`) rather than `next/font` imports.
- **Brand tokens** — injected theme object, so a non-MM user can rebrand.

Keeping these as clean seams is also exactly what makes the eventual **extract-to-shared-package**
(the "converge later" half of decision #3) a lift-and-shift.

### 5.3 Storage & document format
- One JSON document per deck on the mounted volume:
  ```jsonc
  {
    "version": 1,
    "meta": { "id": "investor", "title": "…", "treatment": "warm", "noindex": true },
    "scenes": [ /* Scene[] — the exact engine shape */ ]
  }
  ```
- Volume layout:
  ```
  /data/
    decks/     investor.deck.json, story.deck.json, …   (git-friendly; gitignored in OSS repo)
    assets/    optional local assets (else resolve via sporekles)
  ```
- We work in **JSON natively** — the engine already operates on these structures, so load =
  `JSON.parse`, no transform.
- **Autosave** (debounced) to the volume + explicit save.

### 5.4 Effect-descriptor registry (the spine)
Every `Action.kind` is registered as a descriptor. The inspector UI, timeline block, and
render/seek behavior all derive from it:

```ts
interface EffectDescriptor<A extends Action = Action> {
  kind: A["kind"];
  label: string;
  category: "text" | "art" | "particles" | "counter" | "media" | "flow";
  schema: ParamSchema;            // fields, ranges, enums → auto-generates the inspector
  defaults: () => Partial<A>;
  duration: (a: A) => number;     // timeline block length (ms)

  // Render contract:
  play: (a: A, ctx: RenderCtx) => void;   // append to the master GSAP timeline (forward play)
  seekable: boolean;                       // true ⇒ renderAt is frame-accurate
  renderAt?: (a: A, t: number, ctx: RenderCtx) => void; // visual state at arbitrary time t
}
```

Three payoffs:
1. **Inspector is generated from `schema`** — no hand-built form per effect.
2. **"Extend features of existing effects" = widen the schema** — e.g. expose GSAP's full ease
   list and tsParticles' broader parameter surface the hand-authored deck never used.
3. **The future plugin framework** is just "descriptors loaded from outside the core."

### 5.5 Bridges to mm-website
- **Export:** deck JSON → a `content.*.ts` module string matching today's hand-authored shape,
  to commit into `mm-website` until convergence.
- **Seed/import:** a one-time script converts the existing `content.investor.ts` /
  `content.story.ts` into deck JSON — so Morgana boots with the real decks as test content and
  the format is proven to round-trip.

### 5.6 Deploy (Docker + Mycelium)
- Multi-stage Docker image → Node runtime serving Next; volume mount for `/data`.
- Local: `docker run -v ./data:/data -p 3000:3000 morgana`.
- Hosted: stood up behind the **Mycelium gateway**, which provides access control.

### 5.7 License & open-source boundary
- **MIT.** Vendoring the engine makes the *engine* open code (it's MM's own code — fine).
- **Real decks never enter the public repo.** Investor figures and story copy live only as JSON
  on the private volume; `.gitignore` excludes `/data/decks/*`. The public repo ships engine +
  editor + a couple of **sample/demo decks** only.

## 6. The editor UI

### 6.1 Layout (4-zone)
```
┌───────────────────────────────────────────────────────────────────┐
│ Morgana  [investor ▼]  [＋New][Save][⤓Export TS]    ◀ ▶ ⏯   ↶ ↷    │ toolbar
├──────────┬─────────────────────────────────────────┬──────────────┤
│ FILMSTRIP│              CANVAS (16:9)               │  INSPECTOR   │
│  thumbs  │   real vendored-engine render;           │  schema-gen  │
│  per beat│   drag text boxes to set pos; click=sel  │  per select  │
├──────────┴─────────────────────────────────────────┴──────────────┤
│ TIMELINE (selected beat): blocks · ┃gate┃ dividers · waits · ▲scrub│
└───────────────────────────────────────────────────────────────────┘
```

### 6.2 Filmstrip (left)
One thumbnail per beat, grouped by scene; drag to reorder, add / duplicate / delete. This is
the deck-level "master" half of the hybrid timeline (placed left so thumbnails get vertical room
and the per-beat timeline gets full width).

### 6.3 Canvas / authoring mode (center)
The **real vendored engine** renders the selected beat → exact preview fidelity. Text boxes are
**directly draggable** to set `pos` (with snap guides); click selects → inspector. See §7.1 —
this requires a new controlled "authoring mode" in the engine.

### 6.4 Inspector (right)
Context-sensitive, **generated from the selected effect's descriptor `schema`**. Selecting:
- a **text action** → value, `in` (full effect list), size, align, speed, dots, tone, pos;
- the **beat** → nightlight, art (panel set + transition mode), pos;
- the **deck** → meta.

This is where "extend features of existing effects" is surfaced — widened ease/param ranges.

### 6.5 Timeline (bottom; hybrid + scrub)
The selected beat's `Action[]` as draggable blocks; `click_gate`s render as `┃gate┃` dividers
between segments; `wait`s are resizable gaps. Click a block → selects it in inspector + canvas.
A **scrubbable playhead** drives the canvas (§6.6).

### 6.6 Playback & seek model
- **Play/pause** runs the beat's actual GSAP master timeline live in the canvas.
- **Scrub** sets the playhead to time T:
  - GSAP-tween effects (text, art, counter, media, nightlight) → frame-accurate via
    `master.seek(T)` (rebuild-to-time + suppressed callbacks where backward seek needs it).
  - Particle/note effects → deterministic approximation at T (see §7.2).

### 6.7 Undo/redo
Deck document is a serializable JSON tree; undo/redo via an edit-history stack (immer snapshots
or command pattern). First-class in v1.

## 7. Technical risks

### 7.1 Engine authoring mode (medium risk)
The engine today is built to *present*: it auto-plays, captures keyboard/touch, goes fullscreen.
Morgana needs it to *render under external control* — show beat N at segment/time S, **don't**
hijack input, and **expose the DOM nodes** so we can overlay drag-handles. v1 adds a controlled
**authoring mode** alongside the existing present/print modes.

### 7.2 Deterministic seek / scrubbing (highest risk — pulled into v1)
GSAP timelines are seekable for pure tweens, but **continuous-particle effects** (note emitters,
spore fields) accumulate state and don't seek backward cleanly.

**v1 approach:**
- Effect descriptors declare `seekable` + optional `renderAt(a, t)`.
- Text / art / counter / media / nightlight are `seekable: true` → frame-accurate.
- Note / spore effects are `seekable: false` → under scrub they render a **deterministic seeded
  state at T** (or a steady-state), with full particle life only in **play** mode. The UI marks
  this so it isn't mistaken for a bug.
- **De-risk first:** an early **scrubbing spike** — a thin vertical slice (one beat with text +
  art + notes, scrubbable end-to-end) — validates the model before the full build.

Pixel-perfect particle scrubbing (a deterministic, time-pure rewrite of NoteField/spores) is
explicitly **deferred** to a Tier 2 spec.

## 8. v1 scope checklist

0. **Create `Musical-Mycology/morgana`** — public, MIT, with README / LICENSE / `.gitignore`
   (Node + `/data/decks/*`), default branch `main`. *(Outward-facing — confirm params before
   firing.)*
1. **Repo scaffold** — Next.js (Node, non-static) + Tailwind v4 + Docker + volume mount.
2. **Vendor engine** + generalize behind `AssetResolver` / font / brand injection.
3. **Engine authoring mode** — controlled render of a beat, no input hijack, selectable DOM,
   plus seek support.
4. **Scrubbing spike** — thin vertical slice proving frame-accurate scrub across text + art +
   notes before the full build.
5. **Deck CRUD API** (list / load / new / save / delete) + debounced autosave.
6. **Seed script** — existing `content.investor.ts` / `content.story.ts` → deck JSON.
7. **Effect-descriptor registry** (incl. seek contract) covering every current `Action` kind.
8. **Schema-driven inspector** (deck meta, beat props, per-effect).
9. **Filmstrip** (reorder / add / dupe / delete, scene grouping).
10. **Canvas WYSIWYG** + text direct-manipulation (drag pos, select).
11. **Per-beat timeline** with scrubbable playhead, click-gates, resizable waits, block reorder.
12. **Play/pause + scrub** live preview.
13. **Undo/redo** (JSON edit-history).
14. **Export-to-TS bridge** + a **sample/demo deck** shipped in the public repo.

## 9. Explicitly deferred (Tier 2+ specs)
- Bespoke on-stage handles for NoteField (emitter/circle), counter, media (drag/scale).
- The plugin framework (external descriptors).
- Pixel-perfect particle scrubbing (deterministic time-pure particle refactor).
- Asset upload/management UI.
- Multi-user / collaboration / in-app auth.
- The single continuous master-scrubber (rejected in favor of the hybrid).
- Nightlight keyframing curve UI (v1: per-beat value + mid-beat `nightlight` actions).

## 10. Open questions

**Resolved during brainstorm (2026-06-23):**
- ✅ **Name is free.** `morgana` is not present in the Musical-Mycology org (checked via
  `gh repo list`). The listing also confirms the convention: every `mm-*` repo is private; the
  only public repos (`arco`, `pyarco`, `abctools`) are bare-named — so a bare public `morgana`
  fits.
- ✅ **License.** The existing public repos are currently *unlicensed* (no LICENSE file), so
  there is no precedent to match — **MIT** is a fresh, deliberate choice. (Optional later:
  backfill MIT onto `arco`/`abctools` for org-wide consistency.) The npm scope
  `@musical-mycology/morgana` is a package-extraction concern, not a v1 blocker — v1 ships as a
  Docker app, not an npm package.

**Confirmed by Chris (2026-06-23):**
1. ✅ **Auth** — gateway-gated / auth-light; no in-app login for v1.
2. ✅ **Scrub** — the particle-approximation-under-scrub compromise (§7.2) is acceptable for v1.
3. ✅ **Spec home** — stays in the mm-website worktree as the brainstorm artifact; seeded into
   the `morgana` repo at task 0.

## 11. Roadmap sketch (beyond v1)
- **Tier 2 — Full effect editors:** bespoke on-stage editors for every custom effect; first cut
  of the plugin framework (declarative effect registration); deterministic particle scrubbing.
- **Tier 3 — Platform:** third-party effect plugins, asset upload/management, multi-user editing;
  converge `mm-website` onto the extracted shared engine package (closing the "converge later"
  loop from decision #3).
