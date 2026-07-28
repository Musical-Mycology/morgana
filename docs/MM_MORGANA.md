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
  transport surface) and §7c (canvas swap + parity gate + `seek.ts` deletion). §7a is the
  first landed. **Gotcha — `CinematicSlide`'s GSAP master is a callback scheduler with time
  spacers, not a seekable representation**: effects are scheduled via `master.add(fn)` (a
  `delayedCall`), so the timelines the effect builders return are orphaned and run on
  wall-clock, which is why durations are re-declared as `master.to({}, {duration})` spacers
  and why `seek.ts` carries a second copy of `introDuration`. `master.seek(t)` therefore
  does *not* work today — §7b is a restructure, not a control surface.
- **Note particles are pure functions of time** (`engine/components/effects/note-state.ts`).
  `NoteField` holds no time state: both `DeckCanvas` and `BeatStage` mount it and supply a
  clock. `CinematicRuntime` no longer carries `cue`/`emitter`/`noteCircle`/`stopNotes`/
  `stopCircles` — the `cue` *action kind* survives in `types.ts` for deck-format
  compatibility but is inert. Do not re-add per-sprite GSAP tweens: a second note animation
  implementation is exactly the drift liability §7 exists to remove.

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
