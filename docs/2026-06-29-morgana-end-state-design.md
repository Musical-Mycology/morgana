# Morgana — End-State ("North Star") Design

- **Date:** 2026-06-29 · **Revised:** 2026-07-02 (resolved the eight §18 open questions; deepened §7/§9/§11/§12)
- **Status:** Vision / architecture artifact (not an implementation spec)
- **Author of record:** Chris Oltyan (brainstormed with Claude)
- **Companion docs:** [`2026-06-23-morgana-design.md`](2026-06-23-morgana-design.md) (the v1 design spec — goals/non-goals, the effect-descriptor registry, the scrub compromise, and the Tier 2/3 roadmap sketch in §11). This document is the long-horizon expansion of that §11.

---

## 0. How to read this document

This is a **north star**, not a backlog. It describes the *full intended shape* of Morgana as a
finished editing application, so that any individual feature — when its time comes — can be
specced against a coherent whole instead of invented in isolation. It deliberately stops at
vision + architecture. Per-feature specs and implementation plans come later, each through the
normal brainstorm → spec → plan flow.

**Audience:** a contributor who knows the current codebase and wants to see where it is going,
with the near-term/long-term boundary explicit.

**Tier vocabulary** (carried from the v1 design §11, with one addition):

| Tier | Meaning |
| --- | --- |
| **Tier 1** | The v1 authoring core — open → arrange → place → choreograph → preview → export, single-user, Docker-deployable. Largely shipped (through Plan 3c). |
| **Tier 1.5 — Hardening** | *New label.* Finishing the Tier-1 surface that the current branch hasn't completed yet (timeline action CRUD, deck switcher UI, in-app export, delete-scene button, validation surfacing). Small, near-term, no new architecture. |
| **Tier 2 — Depth** | Bespoke on-stage effect editors; the first cut of the plugin framework; deterministic preview (real engine in canvas + time-pure particles); richer timeline and editing-power features; assets and fonts management. |
| **Tier 3 — Platform** | Sharing/presenting, import/export round-trips, package extraction, the in-app AI assistant, and lightweight hosting. *Deliberately lean* — see §17. |

Each area below is written as **Vision · How it extends today · Tier**. The [feature matrix](#3-current-vs-end-state-feature-matrix) gives the whole target shape at a glance; the [consolidated roadmap](#16-consolidated-tier-roadmap) maps every piece onto a tier.

---

## 1. What Morgana becomes

Morgana's end state is **the** way cinematic data-decks are authored: a true-WYSIWYG editor where
the canvas runs the *real* rendering engine, every effect has both a schema-driven inspector and a
bespoke on-stage editor, the timeline is a full choreography surface, and an optional in-app AI
assistant can drive the same editing operations a human can — all while remaining a **single
self-hostable container that stores portable JSON and needs no account to run**.

The product keeps the shape it has today (filmstrip · canvas · inspector · per-beat timeline) and
deepens every zone, rather than adding new top-level surfaces.

## 2. Guiding principles (the invariants that survive to the end state)

These are the through-lines. Every area below is an expression of one or more of them.

1. **Decks are data; the engine is the renderer.** `DeckDoc { version, meta, scenes }` →
   `Scene{ id, beats }` → `Beat{ id, timeline: Action[] }` → `Action{ kind, …params }`. Editing is
   pure transformation of that tree ([`lib/editor/mutations.ts`](../lib/editor/mutations.ts)); load
   is `JSON.parse`, save is `JSON.stringify`. This never changes.
2. **The effect-descriptor registry is the spine.**
   [`lib/editor/registry.ts`](../lib/editor/registry.ts) already derives the inspector and
   seekability from per-kind descriptors. The end state widens this contract so that *one*
   descriptor per effect drives the inspector, the on-stage editor, the timeline block, the
   render/seek behavior, the validators, **and** the AI tool schema. Adding capability = widening a
   descriptor, not editing six call sites.
3. **True WYSIWYG: the canvas runs the real engine.** The seek-renderer
   ([`engine/authoring/seek.ts`](../engine/authoring/seek.ts)) is a v1 compromise. The end state
   drives the actual GSAP `BeatStage`/`CinematicSlide` runtime in the canvas, so what you edit is
   exactly what plays — including particles, counters, and media. (Decision confirmed 2026-06-29.)
4. **Generic, self-hostable OSS tool.** No infrastructure-specific coupling lives in this repo. It
   spins up in a container, stores portable JSON, and is fully usable by one person with no account.
   Convergence with other consumers (e.g. mm-website) is an *interop outcome* of clean seams, not
   the organizing principle. (Decision confirmed 2026-06-29 — see Morgana's standalone-OSS positioning constraint.)
5. **Safety by construction.** Undo/redo, a deck validator, and debounced autosave already exist.
   Every new editing power — bulk ops, AI assistance, imports — routes through the same pure
   mutations, the same validation, and the same undo history, so "more power" never means "less
   safe."

---

## 3. Current-vs-end-state feature matrix

"Today" = verified against the code on this branch (≈ Plan 3c). "Tier" = where the end-state work
lands.

| Area | Capability | Today (this branch) | End-state | Tier |
| --- | --- | --- | --- | --- |
| **Filmstrip** | Scene-grouped beats; select | ✅ | ✅ + collapse/zoom, live thumbnails | 1 / 2 |
| | Beat add/dupe/delete/move | ✅ (move within scene only) | ✅ + cross-scene move, drag-reorder | 1.5 |
| | Scene add | ✅ | ✅ | 1 |
| | Scene delete / reorder | ⚠️ delete in store, no UI button; no reorder | ✅ buttons + drag | 1.5 |
| **Canvas** | Render selected beat | ✅ via seek-renderer (text/art/nightlight only) | ✅ via real GSAP runtime (all effects) | 2 |
| | On-stage placement | ✅ generic `pos` handle | ✅ bespoke per-effect editors (arc, decay, spin, scale, layers) | 2 |
| | Play / pause / scrub | ✅ (rAF over seek-renderer) | ✅ deterministic scrub of the real engine, incl. particles | 2 |
| **Timeline** | Per-beat action list | ✅ read-only chips | ✅ editable track | 1.5 |
| | Add / delete / reorder / dupe action | ❌ | ✅ kind picker + drag | 1.5 |
| | Convert action kind | ❌ | ✅ | 2 |
| | Click-gate viz; resizable waits | ❌ (plain chips) | ✅ gate dividers + drag-resize waits + segment grouping | 2 |
| | Keyframe / curve editing | ❌ | ✅ (e.g. nightlight curve) | 2 |
| **Inspector** | Schema-driven fields | ✅ (text/textarea/number/select/range/checkbox) | ✅ + color, asset, font, vector/point pickers | 1 / 2 |
| | Per-line text styling | ❌ | ✅ bold/italic, full size scale | 2 |
| **Editing power** | Undo/redo + ⌘Z | ✅ (50-step) | ✅ + deeper/named history, version snapshots | 1 / 3 |
| | Copy / paste actions·beats·scenes | ❌ | ✅ (incl. cross-deck) | 2 |
| | Multi-select + bulk ops | ❌ | ✅ | 2 |
| | Keyboard-driven authoring | ⚠️ ⌘Z only | ✅ full command surface | 2 |
| | Templates / snippets | ❌ | ✅ deck + beat library | 2 |
| **Assets** | Picker / upload / manage | ❌ (no asset handling; MM-coupled default resolver) | ✅ asset panel + upload + generic/pluggable resolver | 2 / 3 |
| **Fonts** | Per-deck fonts | ❌ (no font system) | ✅ bundled library + upload/registration/subsetting | 2 |
| **Effects** | Effect framework | ✅ internal registry | ✅ external/declarative third-party descriptors | 2 / 3 |
| **AI** | In-app assistant | ❌ | ✅ docked Claude assistant (read · safe-edit · lint-fix · generative) over the editing API | 3 |
| **Validation** | Deck validators | ⚠️ `validateDeckDoc` (structural) + `validateDeck` (slide-level), not surfaced in editor | ✅ live lint panel (dangling counters, missing media, gate-less infinite beats, empty beats) | 1.5 / 2 |
| **Interop** | Export to TS | ⚠️ `deckDocToModule` lib, no UI | ✅ in-app export + import + round-trip | 1.5 / 2 |
| | Portable format / package | ⚠️ vendored engine | ✅ documented format + `@musical-mycology/morgana` engine package | 3 |
| **QoL** | Onboarding / empty states | ⚠️ minimal | ✅ first-run, empty-state guidance | 1.5 |
| | Accessibility | ⚠️ partial | ✅ focus order, ARIA, keyboard operability | 2 |
| | Error handling | ✅ load-fail surfaced; save status | ✅ comprehensive, recoverable | 1.5 |
| **Theming** | Token / chrome injection | ✅ (engine tokens + `meta.chrome`) | ✅ in-app theme editor + brand presets | 2 |
| **Platform** | Deck CRUD + autosave | ✅ | ✅ | 1 |
| | Deck switcher / New / Delete UI | ❌ (API exists; `?deck=` only) | ✅ | 1.5 |
| | Share / present mode | ❌ | ✅ read-only links + present mode | 3 |
| | Multi-user / realtime collab | ❌ | ❌ **explicit non-goal** (§17) | — |
| **Infra** | Unit + e2e + Docker smoke | ✅ | ✅ + e2e determinism + CI | 1.5 / 2 |

Legend: ✅ done · ⚠️ partial / not surfaced · ❌ absent.

---

## 4. Authoring depth — bespoke on-stage effect editors

**Vision.** Every custom effect is editable *directly on the stage*, with handles that match what
the effect actually does — not just a numeric inspector. Concretely:

- **NoteField emitter** (`note_emitter`): drag the emitter origin; drag a direction handle to set
  `dir`; drag an arc wedge to set spread (`var`); a decay/freq control to shape the stream.
- **NoteField circle** (`note_circle`): drag the ellipse center, resize width/height handles, set
  orbit speed/notes inline.
- **Counter** (`counter_show`/`counter_to`/`counter_add`): place the counter, scrub a "spin
  preview," edit prefix/label in place, set the target with a draggable value ramp.
- **Media** (`media`/`media_move`): drag to position, corner-handles to scale (`width`), a ghost
  end-state for `media_move` showing the `to`/`scale` destination.
- **Art panel** (`art`): a layer-composition view — pick the panel set, preview the transition
  `mode`, arrange layered art.

**How it extends today.** Today there is one *generic* `pos` handle
([`components/editor/DeckCanvas.tsx`](../components/editor/DeckCanvas.tsx)) that appears when the
selected action's descriptor declares a `pos.x` field. The end state generalizes this into an
**on-stage editor contract on the descriptor**: each descriptor optionally provides an
`onStageEditor` (the handles/affordances to render and the mutations they emit). The canvas asks the
registry "what handles does this action want?" exactly as the inspector asks "what fields?" today.
This is the same widen-the-descriptor move as principle #2.

**Where the bespoke editor lives (resolves §18 Q2).** Descriptor-owned — but *split*, so declarative
plugins (§11) still work. The descriptor carries **declarative metadata** (schema, defaults, duration,
validators, AI hints) *and* an optional **`onStageEditor`** reference: a lazily-imported editor
module — the handles to draw and the mutations they emit — keyed by kind. A pure-JSON/config plugin
with no editor module still gets the generic `pos` handle plus its full inspector, validators, and AI
tools; bespoke handles are an **optional code capability** layered on top, never a requirement. That
keeps principle #2's "one definition lights up the whole editor" while letting the plugin framework
load declarative effects that can't embed a React component. (The end-state descriptor interface is
defined in [§11](#11-effect--plugin-framework).)

**Tier.** Tier 2 (design §9, §11 "full effect editors"). Depends on the real-engine canvas
(§7) so handles overlay the true render.

## 5. Timeline UX

**Vision.** The per-beat timeline becomes a real choreography surface:

- **Editable track:** add (via a kind picker), delete, reorder, duplicate, and **convert** actions
  in place.
- **Click-gate visualization:** `click_gate` renders as a labeled divider that splits the track into
  segments (matching how `CinematicSlide` segments the GSAP timeline), so the click-to-advance
  structure is visible.
- **Segment grouping:** actions between gates are grouped and movable as a unit.
- **Drag-resize waits:** `wait` actions are resizable gaps; durations editable by dragging.
- **Keyframe / curve editing:** time-varying effects (e.g. `nightlight` ramps, counter tweens, art
  transitions) expose keyframes on the track with editable easing curves.

**How it extends today.** The timeline today
([`components/editor/Timeline.tsx`](../components/editor/Timeline.tsx)) is **read-only chips** plus
play/pause/scrub — no action CRUD, no gate dividers, no resize. The duration model already exists
(`beatTimeline`/`actionDuration` in [`seek.ts`](../engine/authoring/seek.ts) assign `[start,end)`
windows), so the track geometry is computable now; the end state adds direct manipulation on top of
it and feeds edits through the existing pure mutations.

**Tier.** Action CRUD is **Tier 1.5** (completes the v1 timeline promised in design §6.5). Gate
viz, segment grouping, drag-resize, convert-kind, and keyframe/curve editing are **Tier 2**.

## 6. Editing power

**Vision.** Authoring scales from "edit one action" to "restructure a deck quickly":

- **Copy / paste** of actions, beats, and whole scenes — including **cross-deck** paste.
- **Multi-select + bulk ops** — select several beats/actions and move, delete, restyle, or retune
  them together.
- **Keyboard-driven authoring** — a full command surface (add beat, duplicate, nudge `pos`, change
  effect, navigate) so a power user rarely touches the mouse.
- **Cross-scene moves** — relocate a beat to another scene (today's `moveBeat` is intentionally
  within-scene only, per [`mutations.ts`](../lib/editor/mutations.ts)).
- **Templates / snippets** — a library of reusable beats ("title card," "counter reveal," "data
  panel") and deck templates to start from.

**How it extends today.** Undo/redo (50-step history in
[`lib/editor/store.ts`](../lib/editor/store.ts)) and the pure-mutation layer make all of this safe
to add: every bulk op is a sequence of the same transformations, captured as one undo entry. Today
there is no clipboard, no multi-select, and only ⌘Z keyboard support.

**Tier.** Cross-scene move is **Tier 1.5–2**; copy/paste, multi-select, keyboard surface, and
templates are **Tier 2**.

## 7. Preview fidelity & determinism

**Vision (decided 2026-06-29 — "real runtime, made seekable").** The canvas drives the **actual GSAP
`BeatStage`/`CinematicSlide` runtime** — the same code that runs production playback — so the editor
preview is pixel-faithful: real text reveals (SplitText, per-letter/word, cursive, typewriter),
real art transitions, real counters and media tiles, and real particles. To keep scrubbing
deterministic, the particle/note effects (`note_emitter`, `note_circle`, `cue`) are reworked to be
**time-pure** (a seeded, deterministic state at time *t*), closing the gap that the v1 design (§7.2)
explicitly deferred.

**How it extends today.** Today the editor canvas uses the **lightweight, GSAP-free seek-renderer**
(`renderBeatAt`/`beatDuration` from [`seek.ts`](../engine/authoring/seek.ts)) driven by a
`requestAnimationFrame` loop, which approximates text/art/nightlight and **draws nothing** for
particles, counters, or media (they fall through `applyAt`'s `default` branch). The real runtime
already exists ([`engine/authoring/BeatStage.tsx`](../engine/authoring/BeatStage.tsx) wrapping
[`CinematicSlide`](../engine/components/layouts/CinematicSlide.tsx)) and is exercised in a dev route
(`app/dev/beatstage/page.tsx`, `e2e/beatstage.spec.ts`).

Two of the three "authoring mode" properties are *already met*: the runtime **doesn't hijack global
input** (`makeAuthoringRuntime` in [`runtime.ts`](../engine/authoring/runtime.ts) no-ops
`revealArrows`/`pulseArrow`/`cue`, and the e2e asserts ArrowRight isn't captured) and it **exposes DOM
nodes** (`data-testid="beatstage"`). The missing piece is the hard one — **external time control.**
The slide is *play-only*: its GSAP master timeline is driven by the `animate` prop with no
`seek(t)`/`pause()` surface (the only index hook is `jumpTo(index)`, an internal `click_gate`
beat-jump, not a time-seek). So the §7 work is **not** "promote the runtime," it is two concrete
pieces:

1. **Expose a transport surface** over the GSAP master timeline — `seek(t)`, `pause()`, `play()`,
   `duration()` — so the canvas scrub bar drives the *real* timeline instead of the seek-renderer's
   rAF loop. GSAP timelines are natively seekable; the work is surfacing that control and reconciling
   it with `CinematicSlide`'s click-gate segmentation of the master timeline.
2. **Make particles time-pure.** `note_emitter`/`note_circle`/`cue` are stochastic today;
   deterministic scrubbing needs a seeded, closed-form state at time *t* (design §7.2, explicitly
   deferred in v1). This is the one genuinely new algorithmic piece.

**Determinism & the seek-renderer's fate (resolves §18 Q1).** The end state **retires**
[`seek.ts`](../engine/authoring/seek.ts): once the real engine scrubs deterministically, keeping two
renderers that can drift is a liability, not a safety net (the drift is *already* visible — counters,
media, and notes are editable in the inspector but invisible on today's seek-renderer canvas). The
retirement is gated, not abrupt: keep `seek.ts` as a **transitional lo-fi fallback** until a **parity
gate** passes — an e2e assertion that, across the deck corpus, the real-engine scrub matches the
seek-renderer on the shared set (text/art/nightlight) *and* renders the three kinds the seek-renderer
drops (particles/counters/media) at representative times. When the gate is green, `seek.ts` is
deleted; a fallback survives only as an explicit opt-in for very long decks / low-power clients, and
only if a measured need appears — not by default.

**Tier.** Tier 2 (design §11 "deterministic particle scrubbing") — the keystone. The transport
surface and time-pure particles are prerequisites for the on-stage editors (§4, handles overlay the
true render) and keyframe/curve editing (§5).

## 8. Validation & linting

**Vision.** A live **lint panel** surfaces deck problems as you author, each with a jump-to-fix:

- dangling counter refs (`counter_to`/`counter_add` with no preceding `counter_show`),
- missing media ids (`media_move`/`media_out` targeting an unknown tile; `media` with an
  unresolvable `src`),
- gate-less infinite beats (a `rotateList`/looping effect with no `click_gate` exit),
- empty beats (no art and no timeline),
- out-of-range values, duplicate ids, and orientation/layout mismatches.

**How it extends today.** Two validators already exist but are **not surfaced in the editor**:
`validateDeckDoc` ([`engine/deck-doc.ts`](../engine/deck-doc.ts)) checks top-level structure on
save (and gates the `PUT /api/decks/[id]` route), and `validateDeck`
([`engine/deck/validate.ts`](../engine/deck/validate.ts)) checks the flattened slide model
(duplicate ids, nightlight range, required slots, empty cinematic beats, build-key references). The
end state (a) extends these to the action-level lints above and (b) runs them live in the editor as
a panel. Validators become part of the descriptor contract too — a descriptor declares its own
cross-action invariants.

**Tier.** Surfacing the existing validators is **Tier 1.5**; the richer action-level lints are
**Tier 2**.

## 9. Assets

**Vision.** A first-class **asset panel**: browse, upload, and manage images/media; pick an asset
from any `media`/`art`/`src` field; and a clear **resolver story** so the same deck renders against
the local volume, a CDN (sporekles), or arbitrary URLs by swapping the injected resolver.

**How it extends today.** There is **no asset handling at all** today — the data volume holds only
`decks/`, there is no `assets/` directory and no upload/serve route, and the design's `assets/` slot
is reserved but unimplemented. The engine has a resolver seam, but *not* the shape earlier drafts
assumed: [`engine/asset-resolver.ts`](../engine/asset-resolver.ts) exports an **`AssetResolver`
interface with two methods** (`story(key)` and `brand(file)` → URL, design §5.2), and the shipped
`defaultAssetResolver` routes through `sporekleAsset`, which **hardcodes an MM-specific CDN**
(`https://design-assets.musicalmycology.org`). That default is an existing infrastructure coupling —
exactly what principle #4 says the end state neutralizes.

The end state therefore: **(a)** makes the **default resolver generic** — local-`assets/`-volume-first,
no MM host baked in — and demotes the sporekle/CDN resolver to **one configured backend** among
others (chosen in settings), so out of the box Morgana resolves against its own volume; **(b)** keeps
the resolver a clean **pluggable seam** so S3 / CDN / custom-base-URL backends slot in later without
touching decks (**resolves §18 Q5:** volume-first, seam kept pluggable for later backends); **(c)**
adds the `assets/` volume area, upload + list + delete API routes mirroring the deck API, an
asset-picker inspector field, and the resolver-selection settings surface. The **upload/storage
plumbing is shared with fonts** (§10, **resolves §18 Q6:** one storage + upload mechanism underneath,
distinct registration UIs on top).

**Tier.** The asset **panel + upload + picker** and the **generic default resolver** are Tier 2;
**pluggable CDN/S3 backends** and hosted asset management are Tier 2–3. (Asset upload UI is explicitly
a v1 non-goal, design §3.)

## 10. Fonts

**Vision.** A bundled, OFL-licensed font library *plus* an **"add new fonts" system**: upload a font
(or point at one), register it for a deck, optionally subset it for size, and pick it per-deck. Fonts
flow into the engine as CSS-var config (`--font-display`, `--font-body`, `--font-cursive`, design
§5.2) so they carry no MM-specific assumptions.

**How it extends today.** This branch has **no runtime font system** — no `public/fonts/`, no
`sync:fonts` script, no `meta.fonts`, no font packing in the inspector. Fonts today are **build-time
Google fonts** loaded via `next/font/google` in [`app/layout.tsx`](../app/layout.tsx) (Londrina
Solid, Atkinson Hyperlegible, Dancing Script — display / body / cursive), fixed at build time and not
deck-selectable. (A later branch introduced a self-hosted bundle + per-deck picker; treat that as
Tier-2 work to bring here.) The end state is: a bundled library shipped under `public/fonts/` with
OFL licensing, a `sync:fonts` tooling step, a per-deck `meta.fonts` selection feeding those same
`--font-*` vars, **and** an extensibility path — upload → register → (optional) subset → available in
the deck font picker — so users aren't limited to the bundled set. That upload/register/subset path
**shares storage + upload plumbing with the asset pipeline** (§9, §18 Q6), with a font-specific
registration UI on top.

**Tier.** The bundled library + per-deck picker is **Tier 2**; the upload/registration/subsetting
extensibility is **Tier 2** (advanced) and overlaps the assets pipeline (§9).

## 11. Effect / plugin framework

**Vision.** Third-party effects register **declaratively from outside the core**. A plugin supplies a
descriptor (kind, label, schema, defaults, duration, render/seek contract, on-stage editor,
validators) and Morgana loads it without a core edit — the design's "descriptors loaded from outside
the core" (§5.4). This is what lets non-MM users extend Morgana with their own effects, and is the
natural home for the engine's `cue`/legacy and any future effect.

**How it extends today.** Today the registry is **internal and static** — a `REGISTRY` record in
[`registry.ts`](../lib/editor/registry.ts) with a `GENERIC` fallback for unregistered kinds — and the
descriptor is just five fields:

```ts
// today (registry.ts)
interface EffectDescriptor { kind: string; label: string; icon: string; schema: Field[]; seekable: boolean; }
```

The end state widens this into the single contract every zone reads (illustrative shape):

```ts
// end state
interface EffectDescriptor {
  kind: string; label: string; icon: string;
  schema: Field[];                    // inspector fields (today)
  defaults(): Partial<Action>;        // what "add this effect" inserts (§5 kind picker)
  duration(a: Action): number;        // timeline geometry (today lives in seek.ts's actionDuration)
  render: RenderContract;             // how it draws + whether/how it seeks (replaces the `seekable` boolean)
  validators?: ActionValidator[];     // cross-action lints (§8) — declarative
  aiHints?: AiToolHints;              // labels/enums that sharpen the generated tool schema (§12) — declarative
  onStageEditor?: () => Promise<EditorModule>;  // optional, lazily-imported bespoke handles (§4) — CODE
}
```

The line that matters: **everything except `render` and `onStageEditor` is declarative data.** That is
what makes two loading tiers possible without special-casing:

- **Tier 2 — config-declared descriptors.** A plugin that supplies only declarative fields (schema,
  defaults, duration, validators, aiHints) plus a `render` chosen from built-in primitives loads from
  config with **no core edit** — the design's "descriptors loaded from outside the core" (§5.4). It
  immediately lights up the inspector, timeline, validators, and AI tools; with no `onStageEditor` it
  falls back to the generic `pos` handle. This is the first cut.
- **Tier 3 — sandboxed runtime.** Effects that ship *code* — a custom `render` or an `onStageEditor`
  module — need a sandbox so third-party code can't compromise the host. That isolation model is the
  long-horizon plugin runtime.

Because the descriptor already drives inspector + seekability today, widening it to also drive the
on-stage editor + validators + AI schema means **one plugin definition lights up the whole editor**
for a new effect — the payoff of principle #2, and the same contract the on-stage-editor split (§4)
and the AI tool surface (§12) both consume.

**Tier.** First cut (declarative, config-loaded descriptors) is **Tier 2**; a fully sandboxed
third-party plugin runtime is **Tier 3**.

## 12. In-app AI assistant (authenticated, tool-driven)

> **Superseded 2026-07-23** — see [`docs/superpowers/specs/2026-07-23-morgana-mcp-server-design.md`](superpowers/specs/2026-07-23-morgana-mcp-server-design.md).
> The auth model this section assumed ("Log in with Claude" OAuth for third-party apps) does not
> exist as a public Anthropic product. The shipped design instead makes Morgana an MCP server that
> the user's own Claude client (claude.ai/Desktop) connects to directly — no Anthropic credential
> ever passes through Morgana. The rest of this section is kept for its guardrail/UX thinking
> (batched undo, confirm-gated destructive ops), which may still be relevant if a public third-party
> Claude sign-in product appears and an in-app docked assistant becomes buildable.

**Vision.** A **docked AI assistant** inside the editor — no window-switching — that can help while
you author: answer questions about the current deck, draft and restructure beats, write and
choreograph timelines, suggest effects, and fix validation issues. It operates **only through the
same editing operations exposed in the UI**, so it can do what a user can do and no more.

**Scope of the first cut (resolves §18 Q3).** The first milestone covers read + safe-edit + lint-fix
**and generative authoring** ("draft a 5-beat investor intro," "add a counter-reveal scene"). Generation
adds no new tool surface — it is the model *composing* the same undoable, validated safe-mutations —
so it is the strongest reason to dock an assistant at all, and it rides for free on the guardrails
below. The **in-app dock is the first and primary surface**; the MCP server (below) is a **follow-up
milestone**, not part of the first cut.

**Authentication (decided 2026-06-29).** Primary path is **"Log in with Claude"** — an OAuth flow so
the assistant runs on the *user's own* Claude account/subscription; Morgana holds the resulting
short-lived bearer token **server-side** (per session) and refreshes it. A **bring-your-own Anthropic
API key** is the fallback. The assistant is entirely **optional**: with no credentials connected,
Morgana is unchanged and fully usable — preserving the standalone-OSS positioning (principle #4).

**Token custody (resolves §18 Q4).** By default the bearer/refresh token lives in **server memory
only** — a container restart re-auths, and no secret ever touches the volume. An explicit env opt-in
(e.g. `MORGANA_PERSIST_CLAUDE_TOKEN`) enables an **encrypted-at-rest** refresh token for users who'd
rather not re-auth across restarts; it is **off by default**. Either way the token **never reaches
the browser** — the agentic loop runs server-side. (Residual detail for the §12 spec: where the
encryption key comes from on a self-hosted box.)

**Action model (decided 2026-06-29) — apply-with-guardrails.** The assistant reads the deck freely;
**safe** edits (add beat, set text, choreograph a timeline, place an effect) apply directly and are
**fully undoable**; **destructive** ops (delete scene/deck, bulk replace) require an explicit confirm.
The existing **undo/redo + `validateDeckDoc`** are the safety net — every AI edit is just another
entry in the same history, and is validated like any human edit.

**Architecture — the registry *is* the tool surface.** Morgana already has (a) a bounded
**mutation API** ([`mutations.ts`](../lib/editor/mutations.ts)) and (b) a **schema-driven descriptor
registry** ([`registry.ts`](../lib/editor/registry.ts)). Together these map almost directly onto
Claude **tool use**:

- A server-side route handler holds the credential and runs the **agentic loop** (Messages API tool
  runner) — the token never reaches the browser. Default model: the latest Claude (e.g.
  `claude-opus-4-8`).
- **Tools are generated from the registry + mutation API**: `read_deck`, `add_beat`,
  `update_action`, `add_action`, `move_beat`, etc., with `input_schema` derived from the same field
  schemas that generate the inspector, and `strict: true` so tool inputs validate exactly. "Items
  explicitly exposed through the interface" becomes literally true — the AI's capabilities are the
  registry's capabilities. *Honesty check:* the mutation layer today is **beat/scene-level only** —
  `insertBeatAfter`/`duplicateBeatAt`/`deleteBeatAt`/`moveBeatBy` (within-scene), `appendScene`/
  `deleteSceneAt`, plus the store's `updateAction(path,value)`/`updateMeta`
  ([`mutations.ts`](../lib/editor/mutations.ts), [`store.ts`](../lib/editor/store.ts)). The
  action-level tools (`add_action`/`delete_action`/`convert_action`) map onto mutations that **don't
  exist yet** — that's the **Tier-1.5 action CRUD** of §5. So the AI tool surface *grows with* the
  mutation API, and shipping the assistant **presupposes Tier-1.5 landed**; it does not invent a
  parallel editing path.
- **Guardrails as tool design:** safe mutations execute and return the new state; destructive
  mutations are promoted to confirm-gated tools (the agent-design "promote to a dedicated tool to
  gate it" pattern). Every applied tool call is one undo entry; `validateDeckDoc` runs on the result.
- The same operation surface can **also** be exposed as an **MCP server**, so external Claude clients
  (Claude Code / Desktop / connectors) can drive Morgana too — but the **in-app dock is primary**
  (Chris's "don't make me switch windows"). MCP is the secondary surface and overlaps the plugin
  framework's "capabilities declared once, consumed many ways" idea.

**Streaming & approval UX.** The dock streams the assistant's turn — prose *and* tool calls — as it
runs. **Safe** tool calls apply **optimistically** and land as ordinary undo entries, tagged
AI-authored so the user can see (and ⌘Z) exactly what changed; the canvas, filmstrip, and inspector
re-render live as each mutation commits. **Destructive** tool calls **pause the loop** on a confirm
card that summarizes the effect ("delete scene `s-3` and its 4 beats?") — approve or reject before
the agent continues. A **generative** turn that touches many beats collapses into **one batched undo
entry** ("AI: draft 5-beat intro"), so a single ⌘Z reverts the whole suggestion, and `validateDeckDoc`
runs on the batched result before it commits. An optional **review-before-apply** mode surfaces
proposed-but-unapplied edits as ghosted filmstrip/timeline entries the user accepts or discards. This
is the guardrail model made concrete: every AI change is an entry in the *same* history a human edit
uses, and nothing bypasses the validator.

**How it extends today.** Nothing AI exists today; this is wholly new. But it is *cheap* precisely
because the spine is already in place — the registry, pure mutations, undo, and the validator are
exactly the substrate an agentic editor needs.

**Tier.** Tier 3 (platform), opt-in. **Prerequisite:** Tier-1.5 action CRUD (§5), which the tool
surface is generated from. Token custody, generative scope, streaming, and proposed-vs-applied are now
decided (above); the residual open detail for the spec is **rate/cost controls** (per-tool budgets,
loop caps) and the encryption-key source for the opt-in at-rest token.

## 13. Quality of life

**Vision.** The editor is approachable and forgiving:

- **Onboarding / empty states** — a first-run experience, helpful empty-deck/empty-scene/empty-beat
  states, and inline hints (vs. today's bare "no deck" label).
- **Accessibility** — correct focus order, ARIA roles on the four zones and their controls, and full
  keyboard operability (overlapping the keyboard-authoring surface in §6).
- **Error handling** — comprehensive, recoverable errors (today: load failures surface in the bar
  and save status shows `Saving…/Saved/Save failed`; the end state extends this to autosave conflicts,
  validation blocks, and asset/AI failures).
- **Version history / undo depth** — beyond the 50-step in-memory history: named snapshots/versions
  of a deck, restore points, and a visible history a user can scrub. This is nearly free structurally:
  the store's `past`/`future` are *already* arrays of full `DeckDoc` snapshots (capped at 50 in
  [`store.ts`](../lib/editor/store.ts)), so persisting named ones is the same shape written to the
  volume. **Resolves §18 Q8:** persisted snapshots are **single-user and linear** — restore points for
  one author, *not* concurrent branches or merge — so they stay firmly clear of the §17 collaboration
  non-goal.

**How it extends today.** Undo/redo, save-status, and surfaced load errors exist; onboarding, a11y
passes, named versions, and richer error recovery do not.

**Tier.** Onboarding/empty-states and error handling are **Tier 1.5**; a11y is **Tier 2**. Version
history splits: a scrubbable in-memory view is **Tier 2**, while **persisted named snapshots on the
volume are Tier 3** — and, per Q8, deliberately **single-user/linear**, not the shared-or-collab kind.

## 14. Interop, portability & theming

### 14a. Interop & portability

**Vision.** Morgana is the authoritative editor; other systems consume its output and feed it back:

- **In-app export** of a deck to a TS module (today's `deckDocToModule` exists in
  [`lib/bridge/export-ts.ts`](../lib/bridge/export-ts.ts) but has **no UI** and emits only
  `scenes`), plus **import** (TS module / deck JSON → DeckDoc) for a real **round-trip** with
  consumers like mm-website.
- A **documented, portable deck format** (the `DeckDoc` schema as a stable, versioned contract) so a
  deck is a durable artifact independent of Morgana's internals.
- **Package extraction** — lift the vendored `engine/` into `@musical-mycology/morgana` so the engine
  is a shared dependency, closing the design's "vendor now, converge later" loop (decision #3).
  *Framing (decided 2026-06-29):* this is **generic-OSS-first** — extraction is a clean-seams
  outcome, and any downstream consumer (mm-website included) is just one user of the package, not the
  reason it exists. *Trigger (resolves §18 Q7):* the signal that the engine is "stable enough" to lift
  is a **`DeckDoc` format-version freeze** — a published, versioned format spec *plus* a declared
  version-bump policy (what changes bump `version`, what stays backward-compatible). Until the format
  is frozen, vendoring keeps engine and editor free to co-evolve; once frozen, the package boundary is
  safe to draw.

**How it extends today.** Export is a library function only; there is no import, no in-app export
panel, no published format doc, and the engine is vendored (not a package).

**Tier.** In-app export is **Tier 1.5**; import + round-trip and a published format are **Tier 2**;
package extraction is **Tier 3**.

### 14b. Theming & branding

**Vision.** An in-app **theme editor**: edit brand tokens and chrome (splash, wordmark, footer, color
treatment) visually, with brand presets, so a non-MM user can fully rebrand without touching CSS.

**How it extends today.** Theming exists as **injection seams** — engine CSS-var tokens
([`engine/engine-tokens.css`](../engine/engine-tokens.css), `app/mm-tokens.css`) and per-deck
`meta.chrome` (splash tagline/logo, wordmark), editable through the four Deck-settings fields
([`components/editor/DeckSettings.tsx`](../components/editor/DeckSettings.tsx)). The end state turns
those seams into a proper visual editor with presets.

**Tier.** Tier 2.

## 15. Testing & infra

**Vision.** Determinism and CI as first-class:

- **E2E determinism** — Playwright retries where appropriate, an explicit **standalone-readiness
  gate**, and isolation so the two production servers don't contend on a shared data dir.
- **CI** — the unit suite, the e2e suite, and the Docker smoke run automatically on every change
  (none of this is automated today — "no CI exists yet").
- **Coverage of the new surfaces** — on-stage editors, timeline editing, assets, AI tool calls, and
  the plugin contract all get their own tests.

**How it extends today.** Today: `npm test` (vitest), `npm run test:e2e` (Playwright against **two**
production servers — `next start` on :3000 for all specs, the standalone server on :3100 for
`editor.spec.ts`), and `npm run smoke:docker`. The e2e suite is **flaky under parallel workers**
because both servers share one seeded `./data` directory; the reliable invocation today is
`CI=1 npm run test:e2e -- --workers=1`. The end state fixes the contention (per-run data isolation),
adds a readiness gate, and wires CI so `--workers=1` is a safety net, not a requirement.

**Tier.** E2e determinism + CI is **Tier 1.5**; broader coverage tracks each feature's tier.

---

## 16. Consolidated tier roadmap

The near-term/long-term boundary at a glance. Tier 1 is largely shipped; the table below is the *work
ahead*.

| Tier | Theme | Work items |
| --- | --- | --- |
| **1.5 — Hardening** *(near-term; finish the v1 surface)* | Complete what Plan-3c started | Timeline **action CRUD** (add/delete/reorder/dupe); **deck switcher / New / Delete** UI; **delete-scene** button + **scene reorder**; **cross-scene** beat move; **in-app TS export**; **surface the existing validators**; onboarding/empty-states + error handling; **e2e determinism + CI**. |
| **2 — Depth** *(the core of the north star)* | Make every effect first-class and the canvas truthful | **Real-engine canvas + deterministic particle scrubbing** (§7, the keystone); **bespoke on-stage effect editors** (§4); **rich timeline** — gate viz, segment grouping, drag-resize waits, convert-kind, keyframe/curve (§5); **editing power** — copy/paste, multi-select, keyboard surface, templates (§6); **assets** panel + upload + picker (§9); **fonts** library + upload/subset (§10); **action-level validators** (§8); **plugin framework** first cut (§11); **theme editor** (§14b); **a11y** (§13); **import + round-trip** (§14a). |
| **3 — Platform** *(long-horizon; deliberately lean)* | Share, assist, extract | **In-app AI assistant** (§12, incl. generative; needs Tier-1.5 action CRUD); **share links + present mode** (§17); **package extraction** `@musical-mycology/morgana` (§14a); **CDN/hosted asset management** (§9); **sandboxed third-party plugin runtime** (§11); **named version history** (§13); optional **lightweight hosting**. |
| **— Non-goals** | Out of the north star | **Multi-user / realtime collaboration / CRDT**; **in-app accounts/auth as a requirement to run**; any infrastructure-specific coupling (§17). |

---

## 17. Platform tier — deliberately lean (decided 2026-06-29)

The Platform tier is intentionally **modest**. The end-state platform features are:

- **Read-only share links** — share a rendered deck without granting edit access.
- **Present mode** — a clean, full-screen playback surface (the engine's existing present/print modes,
  surfaced from the editor).
- **Import/export round-trips** — the interop work in §14a.
- **Optional lightweight hosting** — a hosted instance remains possible (gateway-gated, single-user,
  auth-light per design §3/§10), but is never required; the container-on-your-machine story is the
  primary one.

**Explicit non-goals** (recorded so the decision is durable):

- **Multi-user / realtime collaboration / CRDT editing** is **out of the north star.** It was
  considered and declined: it conflicts with the single-user, generic-OSS positioning, and the value
  it adds doesn't justify the architectural weight for this tool. Decks are single-author artifacts;
  collaboration happens through the portable format and version control, not live co-editing.
- **In-app accounts/auth as a requirement to run.** The tool must always work for one person with no
  login. (The AI assistant's "Log in with Claude" is *opt-in for the assistant only* — not an app
  gate.)
- **Any infrastructure-specific coupling** in this repo (principle #4, Morgana's standalone-OSS positioning constraint).

---

## 18. Resolved questions & residual open details

The eight forks the first draft left open were **resolved on 2026-07-02** (brainstormed with Claude)
and folded into their home sections. Recorded here as the decision log:

| Was open | Resolution | Lives in |
| --- | --- | --- |
| Q1 — Seek-renderer retirement | **Retire** `seek.ts`; keep only as a transitional lo-fi fallback behind a **parity gate**, then delete. | §7 |
| Q2 — On-stage editor authoring | **Descriptor-owned, split:** declarative metadata + an optional lazily-imported `onStageEditor` module keyed by kind. | §4, §11 |
| Q3 — AI assistant scope | read + safe-edit + lint-fix **+ generative** from v1; **dock-only** first; **MCP a follow-up**. | §12 |
| Q4 — OAuth token custody | **In-memory per session** by default (zero token at rest); **explicit env opt-in** for encrypted-at-rest refresh. | §12 |
| Q5 — Asset storage ceiling | **Volume-first**; resolver kept a clean **pluggable seam** and its default **de-MM-coupled**. | §9 |
| Q6 — Fonts vs. assets pipeline | **Shared** upload/storage plumbing; **distinct** registration UIs. | §9, §10 |
| Q7 — Package-extraction trigger | A **`DeckDoc` format-version freeze** (published spec + version-bump policy). | §14a |
| Q8 — Version-history depth | Persisted **single-user, linear** named snapshots; explicitly *not* collaboration. | §13 |

**Residual open details.** Genuinely deferred to per-feature specs — implementation choices, not forks
of the north star:

- The sandboxed third-party plugin **runtime** mechanics (§11, Tier 3) — isolation model and capability surface.
- The font **subsetting** toolchain (§10) — which subsetter, build-time vs. on-upload.
- AI **rate/cost controls** — per-tool budgets and agentic-loop caps (§12).
- The parity-gate **corpus** (§7) — which decks and times the determinism e2e asserts against.
- The **encryption-key source** for the opt-in at-rest token on a self-hosted box (§12, Q4).

---

## 19. Summary

Morgana's end state is the *same four-zone editor, deepened*: a canvas that runs the **real engine**,
**bespoke on-stage editors** and a **full timeline** for every effect, **assets/fonts/plugins** that
make it extensible, an **optional AI assistant** that drives the very same editing API a human uses,
and a **lean platform tier** for sharing and extraction — all while staying a **single, portable,
self-hostable JSON-backed tool with no required account.** The spine that makes this affordable —
data-as-truth, the descriptor registry, pure mutations, undo, and validation — is already in the
codebase. The north star is mostly a matter of *widening the contract that's already there.*
