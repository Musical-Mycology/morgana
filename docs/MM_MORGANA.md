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
- `docs/superpowers/specs/` + `docs/superpowers/plans/` — per-feature design
  specs and implementation plans.

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
- **Export round-trip.** `deckDocToModule` (`lib/bridge/export-ts.ts`) emits a
  deck's scenes as a TS module the site can import; the round-trip closes when
  mm-website's hand-authored `investor-hub/lib/deck/` modules are authored in
  Morgana instead. In-app export UI and import are roadmap (tracked in the
  Morgana repo's issues/docs).

## CI / ops

CI runs in **GitHub Actions** (unit + e2e), keeping the repo free of MM infra
coupling — mm-jenkins is intentionally *not* used here. No Kuma monitor and no
hosting target yet (`ci_pipeline: none`, `expected_kuma_monitor: none` in
`mm-meta.yml`) until a deployment is chosen.
