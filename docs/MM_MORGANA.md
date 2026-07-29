# morgana — Cinematic deck editor (standalone OSS)

Self-hostable web editor for cinematic, data-driven slide decks. Decks are
authored as `Scene → Beat → Action` JSON and played by a vendored GSAP +
tsParticles render engine; the editor puts a filmstrip, a WYSIWYG canvas, a
schema-driven inspector, and a scrubbable per-beat timeline on top of that same
data model. Runs as a single Node container with filesystem storage — no
database, no infrastructure-specific coupling.

See `MM_ARCHITECTURE.md` (MM-internal) → *Other repos* for the one-line role and the
render-engine lineage (vendored *from* mm-website's investor-hub deck; the
eventual export round-trip goes back the other way).

## Stack

Next.js 15 + React 19 + TypeScript. Vendored render engine under `engine/`
(GSAP + tsParticles). Zustand editor store. Vitest (unit) + Playwright (e2e).
Packaged as a single Node container (`Dockerfile` + `docker-compose.yml`);
decks are portable JSON on a mounted volume (`MORGANA_DATA_DIR`, default
`/data`).

## Where

Not yet hosted anywhere (`status: pending`, `infra_monthly_usd: 0`). The
deployment target is deliberately open — the product thesis is
"single self-hostable container on your own machine," so a hosted MM instance
remains possible but is never required.

## Design docs live in-repo (public-repo convention)

**Morgana's design docs, specs, and plans live in the Morgana repo itself**
(`docs/` — including `docs/superpowers/specs/` and `docs/superpowers/plans/`),
**not** in mm-documents. This is deliberate and follows the general MM
convention for **public** repos:

> A public repo keeps its own design documentation local to the repo, because
> outside contributors and downstream users may need those docs and have no
> access to mm-documents (which is private). The docs must travel with the
> code.

So for Morgana, mm-documents carries only this cross-cutting deep-dive (role,
lineage, positioning, cross-repo contracts) — the canonical MM per-service
summary. Anything a contributor needs to *build or extend* Morgana — the v1
design spec, the end-state ("north star") design, and every per-feature
brainstorm → spec → plan — is versioned inside the Morgana repo under `docs/`.
Notable in-repo docs:

- `docs/2026-06-23-morgana-design.md` — the v1 design spec (goals/non-goals,
  the effect-descriptor registry, the scrub compromise).
- `docs/2026-06-29-morgana-end-state-design.md` — the end-state ("north star")
  design; the tier roadmap (1.5 Hardening / 2 Depth / 3 Platform) lives here.
  **Tier 1.5 (Hardening) is complete as of 2026-07-27** — scene structural
  editing (reorder/delete/cross-scene beat move), the lint/Issues panel, and
  empty/error states (see `docs/superpowers/plans/2026-07-24-tier-1-5-hardening-sweep.md`).
  Tier 2 (Depth) is next.
- `docs/superpowers/specs/` + `docs/superpowers/plans/` — per-feature design
  specs and implementation plans.
- **Tier 2 §7 is decomposed** into §7a (time-pure note particles — spec
  `docs/superpowers/specs/2026-07-27-time-pure-particles-7a-design.md`), §7b (the seekable
  transport surface — spec/plan `docs/superpowers/plans/2026-07-28-transport-surface-7b.md`)
  and §7c (canvas swap + parity gate + `seek.ts` deletion). §7a and §7b are both landed.
  **Gotcha, now RESOLVED (§7b, 2026-07-28) — `CinematicSlide`'s GSAP master used to be a
  callback scheduler with time spacers, not a seekable representation**: effects were
  scheduled via `master.add(fn)` (a `delayedCall`), so the timelines the effect builders
  returned were orphaned and ran on wall-clock, which is why durations were re-declared as
  `master.to({}, {duration})` spacers and why `seek.ts` (see below) carried its own second
  copy of `introDuration`. `master.seek(t)` did not work. §7b replaced this wholesale inside
  `CinematicSlide`: see "`CinematicSlide` is seekable" below.
- **The canonical beat time axis lives in `engine/authoring/beat-clock.ts`.** It is a pure
  module — no DOM, no GSAP, no React — extracted from `engine/authoring/seek.ts` in §7b, which
  now imports `beatTimeline` from it instead of carrying its own copy. `beat-clock.ts` owns
  `beatTimeline`/`beatDuration`/`actionDuration`/`introDuration`/`foldAt`/`rebuildBoundary`:
  everything that answers "when does X happen in this beat" or "what is reached by time t"
  reads from here, and nowhere else derives a duration by reading a built GSAP timeline
  (Global Constraint D2 of the §7b plan). Both pure reducers —
  `engine/components/effects/note-state.ts` and `lib/editor/object-state.ts` — import from it
  to fold notes and objects to the same `t` CinematicSlide renders. Note that `seek.ts` itself
  is a separate, simpler renderer (`renderBeatAt`) still used for non-interactive preview paint
  (`DeckCanvas`, `BeatThumbnail`, the `/spike` page) — §7b did not delete or seekify it; only
  `CinematicSlide`'s own live-playback path became seekable. Unifying or deleting `seek.ts` is
  §7c's `seek.ts`-deletion item, not done here.
- **Note particles are pure functions of time** (`engine/components/effects/note-state.ts`).
  `NoteField` holds no time state: both `DeckCanvas` and `BeatStage` mount it and supply a
  clock. `CinematicRuntime` no longer carries `cue`/`emitter`/`noteCircle`/`stopNotes`/
  `stopCircles` — the `cue` *action kind* survives in `types.ts` for deck-format
  compatibility but is inert. Do not re-add per-sprite GSAP tweens: a second note animation
  implementation is exactly the drift liability §7 exists to remove.
  **Purity is a one-way import rule, and — as of §7b — it is enforced.**
  `note-state.ts` and `lib/editor/object-state.ts` must not import anything that touches the
  DOM (`beat-clock.ts` included, since both depend on it): the dependency runs *toward* these
  pure cores and never back. `tests/unit/pure-import-graph.test.ts` walks each module's
  runtime import graph (type-only imports are erased, so they don't count) and fails if any
  reachable file contains a DOM token (`document.`, `.innerHTML`, `createElement(`). §7a
  shipped one near-miss before this existed — `randomGlyph` briefly lived in `notes.ts` (which
  calls `document.createElement`) and was hoisted into `note-state.ts` on 2026-07-28 — and it
  cost nothing to catch by hand only because both sides deferred the import to call time. That
  test is what makes the next near-miss cost something instead of nothing.
- **`CinematicSlide` is seekable.** It exposes `SlideTransport { seek, play, pause, duration }`
  via an imperative `transport` ref. Internally, every action kind renders from a single
  `renderAt(t)` that folds the beat's timeline (`foldAt`, from `beat-clock.ts`) to its state at
  `t` — building each action's real effect timeline once, paused, and driving it with
  `.time()`/`.progress(1)`, never running it on wall-clock. The old per-segment GSAP
  timelines, `scheduleAction`, and `masterRef` are gone; one time axis with gate boundaries
  replaced them. `duration()` is always `beatDuration(beat.timeline)` — the pure reading,
  never a GSAP timeline's own `.duration()`. Autoplay drives `t` from a `gsap.ticker` callback
  that pauses at each `click_gate` and hands `resume` to `runtime.onGate`, exactly as the old
  segment machinery did. **`seek(t)` pauses the autoplay ticker internally** — a caller does
  not pause() first. The alternative (require callers to pause before seeking) was tried and
  rejected as a footgun: it is too easy to forget, and the failure mode is a ticker silently
  racing a scrub. In static/print mode (reduced motion, a backgrounded tab, or PDF), the whole
  beat renders as `renderAt(duration())` — the fully-settled fold — rather than a hand-written
  end-state replay loop; see the deferred-issue gotcha below for the one sharp edge this
  merges in.
- **`BeatStage` drives text, notes, and objects from one clock.** `CinematicSlide`'s `onTime`
  fires with the exact beat-local `t` it just painted (from the ticker, from `seek()`, or from
  the static-mode settle), and `BeatStage` paints `ObjectStage` and `NoteField` from that same
  callback rather than polling or running a second ticker. The long-standing KNOWN LIMITATION
  here — objects and notes riding an independent wall-clock timeline that desynced from text at
  gates — is gone along with the code that caused it; there is exactly one clock now.
- **Three deliberate behaviour changes from §7b, not bugs:** counters (`counterValueAt`) and
  media (`mediaStateAt`) are now computed from time rather than animated on wall-clock, and
  `rotateList` derives its currently-visible item from elapsed time (`rotateItemAt`,
  `engine/components/effects/cinematic-anim.ts`) instead of running an infinite GSAP loop. All
  three are consequences of the same shift: state is a pure function of `t`, not a live tween.
- **Gotcha — GSAP's power ease names run one ahead of their exponent.** `power1` is quadratic,
  `power2` is cubic, `power3` is quartic (`power3.inOut` is symmetric). Porting a GSAP ease to
  a closed-form function and getting this off-by-one wrong makes a scrubbed frame silently
  disagree with playback — precisely the drift §7 exists to remove — and it happened twice
  during §7b. The in-repo proof is `note-state.ts`'s `powerOut1`, GSAP's `power1.out`,
  implemented as `1 - (1 - p) * (1 - p)` (quadratic, not linear or cubic).
- **Deferred issue, recorded so §7c inherits it rather than rediscovering it.** In static/print
  mode, `CinematicSlide` calls `runtime.art(runtime.resolveEnd(), "cut")` explicitly and then
  `renderAt(duration())`'s own art-diffing re-issues this beat's mid-timeline `art` actions —
  a genuine double-issue. It is idempotent **by construction today only**: `applyArt` in
  `engine/deck/flatten.ts` unconditionally discards its input and resets to `[...to]` whenever
  a transition carries neither `keep` nor `out`, and no action anywhere in the codebase uses
  those fields yet. The moment one does, `keep`/`out` will filter against the wrong
  already-resolved stack in this branch and can produce duplicate layers or a wrong final
  composition. This was flagged and deliberately left unfixed during §7b (not in scope); fix
  it (e.g. suppress `renderAt`'s art dispatch for this one static call) before or alongside the
  first `keep`/`out`-bearing mid-timeline `art` action.

When syncing this deep-dive after a Morgana change, remember the split:
architecture/role/contract facts belong **here**; feature design detail belongs
in the Morgana repo's `docs/`.

## Positioning (the invariant)

**Generic, standalone OSS — no Mycelium-specific coupling in the repo.** It
spins up in a container, stores portable JSON, and is fully usable by one
person with no account. Convergence with other MM consumers (notably
mm-website, whose investor-hub cinematic deck the engine was vendored from) is
an *interop outcome* of clean seams, not the organizing principle: mm-website
is one consumer of the deck format, not a dependency baked into Morgana. Any
proposal that would couple this repo to MM infrastructure (a specific CDN host,
mm-jenkins CI, an MM auth requirement to run) is out of scope by construction.

## Cross-repo contracts

- **Render engine lineage.** `engine/` is vendored from mm-website's
  investor-hub cinematic deck (GSAP + tsParticles). Package extraction into a
  shared `@musical-mycology/morgana` engine package is a Tier-3 roadmap item,
  gated on a `DeckDoc` format-version freeze (see the end-state design §14a).
  **The lineage is one-way, and `engine/` has now materially diverged** (§7a,
  2026-07-27): `CinematicRuntime` lost five members, `NoteField` was rewritten
  reducer-driven, and `makeNote`/`emitNote`/`launchNote` were deleted. Nothing
  downstream broke — the vendoring direction is *from* mm-website, not to it —
  but a future re-vendor in either direction will conflict in those files and
  should be treated as a merge, not a copy.
- **Export round-trip.** `deckDocToModule` (`lib/bridge/export-ts.ts`) emits a
  deck's scenes as a TS module the site can import; the round-trip closes when
  mm-website's hand-authored `investor-hub/lib/deck/` modules are authored in
  Morgana instead. **In-app export shipped** (the Export panel, `export-toggle`
  → `components/editor/ExportPanel.tsx`); **import is still roadmap**, so the
  round-trip is currently one-way.

## AI integration (MCP server)

Morgana exposes its deck-editing mutation API as an MCP server (`/api/mcp`,
Streamable HTTP, bearer-token auth generated by the instance itself). A user's
own Claude client (claude.ai Connectors, Claude Desktop) connects directly and
edits a deck using their own subscription — Morgana never calls the Anthropic
API and never stores an Anthropic credential of any kind. This preserves the
positioning invariant above (no account requirement, no external service
dependency baked into the container): the MCP server is opt-in, needs nothing
beyond the token Morgana generates for itself, and the rest of the app is
unchanged if it's never connected to. Design:
`docs/superpowers/specs/2026-07-23-morgana-mcp-server-design.md` (in-repo,
supersedes the end-state design's earlier §12 "in-app AI assistant" sketch,
which had assumed a third-party "Sign in with Claude" OAuth product that
doesn't exist). As of the Tier 1.5 hardening sweep, the tool surface also
includes scene-structural tools with `scene_index` addressing:
`move_scene_by`, `append_beat_to_scene`, and `delete_scene_at` (which also
accepts `scene_index` directly, in addition to `beat_index`).

**Contract change to an already-published tool (2026-07-27):** `move_beat_by`
used to no-op at a scene boundary; it now *transfers* the beat into the
adjacent scene, and is a no-op only when no adjacent scene exists in that
direction. Connected Claude clients see the changed behavior immediately —
there is no version negotiation on the tool surface — so the tool's own
`description` and the README were updated in the same change. Treat any future
change to a shipped tool's semantics the same way: the description is the only
contract a remote model reads.

**Contract widening via the registry (2026-07-27, §7a):** `lib/mcp/tool-defs.ts`
derives `ACTION_KINDS` from `Object.keys(REGISTRY)` and publishes it as the
`enum` for `add_action.kind` and `convert_action.new_kind`. So **adding a
descriptor to `lib/editor/registry.ts` silently widens the MCP tool surface** —
completing the note descriptors added `note_circle`, `stop_notes`, and
`stop_circle` as callable kinds for connected Claude clients, and changing
`note_emitter`'s `decay` default (`1` → `1000`; it was one *millisecond*,
clamped by the engine to a 0.1s floor) changed what `add_action` inserts.
Neither needed a tool-description edit, but both reached remote clients the
moment they shipped. Remember this coupling when touching the registry: it is
an editor-metadata file with a published-API side effect.

## CI / ops

CI runs in **GitHub Actions** (unit + e2e), keeping the repo free of MM infra
coupling — mm-jenkins is intentionally *not* used here. No Kuma monitor and no
hosting target yet (`ci_pipeline: none`, `expected_kuma_monitor: none` in
`mm-meta.yml`) until a deployment is chosen.

**Gotcha — a scene with no beats is legal, and must stay reachable.** The
filmstrip originally derived its scene groups from the *flat beat list*, so a
scene whose last beat was deleted became invisible: unselectable, unfillable,
undeletable, and still present in the saved JSON. Since the Tier 1.5 sweep the
filmstrip iterates `doc.scenes` (`sceneGroups` in `lib/editor/flatten-beats.ts`)
and renders an empty scene with its header plus an empty-state row, and a
`scene-empty` lint warning surfaces it. Cross-scene beat move can legitimately
empty a scene, so this is a normal authoring state, not a defect. Do **not**
"tidy" it by auto-pruning empty scenes — that silently restores the orphan bug
and removes the only way to refill a scene. Any new code that maps scene→beat
indices must tolerate a zero-beat scene (`flatIndexOf` returns `-1` for one,
which is why lint rows located only to a scene are deliberately not jumpable).

**Gotcha — the e2e build step must not move into a Playwright `globalSetup`.**
The suite needs one `next build` up front (three `webServer` entries share it:
`next start` on :3000/:3200 and the standalone server on :3100). That build runs
from the `test:e2e` **npm script** (`scripts/prepare-standalone.sh && playwright
test`), *not* from `globalSetup`, because Playwright launches `webServer` entries
during plugin setup — which happens **before** `globalSetups`. A build in
`globalSetup` is therefore always too late, and every server dies instantly with
`Could not find a production build in the '.next' directory`. This is not
theoretical: it was the configuration from the CI workflow's introduction
(2026-07-20) until 2026-07-24, and CI failed on *every* run in that window,
before a single test executed. Corollaries: run the suite as `npm run test:e2e`
(a bare `npx playwright test` assumes a prepared build), and treat any future
"move the build into globalSetup" tidy-up as a regression.
