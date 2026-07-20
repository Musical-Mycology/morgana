# E2E Determinism + CI — Design Spec

- **Date:** 2026-07-20
- **Status:** Design / spec (approved for planning)
- **Tier:** 1.5 — Hardening (see [`docs/2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md) §15, §16)
- **Author of record:** Chris Oltyan (brainstormed with Claude)
- **Scope:** test-harness + config + CI only. **No production/app code changes.**

---

## 1. Problem

The Playwright e2e suite is flaky under parallel workers. The reliable invocation today is
`CI=1 npm run test:e2e -- --workers=1`; there is no CI at all (`.github/workflows/` is absent),
and `playwright.config.ts` declares no `retries`.

**Root cause — shared mutable data dir.** `playwright.config.ts` points *both* production servers
at one seeded directory:

- `next start` on `:3000` (the `default` project — runs **all** specs)
- the standalone server on `:3100` (the `standalone` project — runs `editor.spec.ts` only)
- both via `MORGANA_DATA_DIR = resolve("./data")`

Two contention mechanisms follow:

1. **Cross-server writes.** `editor.spec.ts` runs against both servers, and several specs load and
   edit the shared `demo` deck with debounced autosave. Because both servers share `./data`, a write
   through one server is visible to the other, and concurrent specs observe each other's mutations.
2. **A globally-destructive test.** `library.spec.ts`'s *empty-state* test renames the **entire
   `data/decks` directory** aside (`mkdtempSync` holding dir), asserts the empty state, and restores
   it in a `finally`. Any spec touching either server during that window sees a vanished or
   half-restored data dir → flake.

`--workers=1` masks both by removing concurrency; it does not fix either.

## 2. Goals & non-goals

**Goals**

- The suite passes reliably under **default parallelism** (`--workers` unset).
- `--workers=1` becomes a safety net, not a requirement (end-state §15).
- Unit + e2e run automatically in **GitHub Actions** on every push and PR.
- Root-cause fix (per-run state isolation), not a serialization workaround.

**Non-goals**

- **No docker-smoke in CI.** `npm run smoke:docker` stays a documented **manual** local check
  (decided 2026-07-20). It remains runnable and unchanged.
- **No app/engine/production code changes.** Editor behavior, the deck API, and the 69-test unit
  suite are untouched.
- No per-worker server fleet (considered and declined — over-engineered for a ~14-spec suite; see §7).
- No mm-jenkins / Jenkinsfile (declined — would couple this standalone-OSS repo to MM infra,
  violating the positioning constraint in end-state principle #4).

## 3. Isolation architecture

Three moves, ordered by impact.

### 3.1 Per-server data dirs

Replace the single shared `./data` with **per-server seeded dirs** under a gitignored `.e2e/` root:

| Server | Port | Project | `MORGANA_DATA_DIR` |
| --- | --- | --- | --- |
| `next start` | `:3000` | `default` (all specs except `library`) | `.e2e/default` |
| standalone (`node .next/standalone/server.js`) | `:3100` | `standalone` (`editor.spec.ts`) | `.e2e/standalone` |
| `next start` (dedicated) | `:3200` | `library` (`library.spec.ts`) | `.e2e/library` |

> `:3200` is a **second `next start`** instance (same build as `:3000`), not a standalone server —
> its purpose is data isolation for the destructive test, not exercising the standalone build (that
> is `:3100`'s job).

Each dir is seeded from `samples/*.deck.json` before its server starts (extends the existing
`prepare-standalone.sh` / `global-setup` seed step to seed all three dirs). This alone eliminates
**all** cross-server contention — the `editor.spec`-on-both-servers case in §1(1) disappears because
`:3000` and `:3100` no longer share state.

### 3.2 Isolate the globally-destructive test

The library **empty-state** test needs a genuinely empty decks dir. Give `library.spec.ts` its own
server (`:3200`) and data dir (`.e2e/library`) via a dedicated Playwright **project + `testMatch`**.
Its dir-emptying can then never affect another spec.

Prefer making the empty-state assertion **non-destructive-to-others** by construction: because
`.e2e/library` is owned solely by this project, the test may simply delete its own seeded decks
(and re-seed in teardown) rather than renaming a shared directory aside. The `mkdtempSync` holding-dir
hack is removed.

> The `library` project runs `library.spec.ts` only; `library.spec.ts` is excluded from the `default`
> project via `testIgnore` (or an equivalent `testMatch` split) so it does not also run against
> `:3000`.

### 3.3 Self-contained mutating specs

Every spec must own its data so no two specs (across any workers) observe each other's writes.

- **Already parameterized** (`goto('/editor?deck=${id}')`): `drag-pos`, `persistence`,
  `timeline-actions`, `structural`. These create their deck via the API. Confirm each uses a
  **unique** id (e.g. suffixed with Playwright's `testInfo` id / title slug) and **deletes it in an
  `afterEach`**, so reruns and parallel runs don't collide on a fixed id.
- **Load `demo` via `goto('/editor')`:** `deck-settings`, `editor`, `inspector`, `theme`. The plan
  performs a **per-spec read/write audit**: any that *write* (autosaved edits to `demo`) are
  converted to create and use their **own throwaway deck**; purely **read-only** specs are left
  unchanged. (`editor.spec.ts` additionally runs on `:3100`/`:3200`-adjacent servers — it must not
  mutate a shared deck.)
- **Dev-route specs** (`beatstage`, `chrome`, `deck-canvas`, `spike`): no deck data — unaffected.

**Deliverable of the audit** (produced in the plan): a table classifying each of the 14 specs as
`read-only`, `owns-deck (already)`, or `convert-to-owned`, so the implementer changes exactly the
specs that need it and no more.

## 4. Readiness gate & retries

- **Readiness gate.** Playwright's `webServer.url` probe only waits for the port to answer; the
  standalone server can respond on `/` before its seeded decks are loadable (the residual startup
  race). Make each server's readiness assert **data liveness**: `GET /api/decks` returns the seeded
  `demo`. Preferred: point each `webServer.url` at `/api/decks` if the probe accepts a 200 as ready;
  if body-content assertion is needed, `global-setup` **polls each server's `/api/decks`** after
  launch (until `demo` is listed, with a timeout) before any test runs.
- **Retries.** `retries: process.env.CI ? 2 : 0`. Zero locally (real flakes stay visible); CI gets
  resilience against genuine infra hiccups (runner slowness) — standard practice.
- **Parallelism.** Remove all reliance on `--workers=1`; let Playwright default. `fullyParallel`
  stays at its current/default setting. §3 isolation is what makes default parallelism safe; retries
  are belt-and-suspenders, not the fix.

## 5. CI workflow (GitHub Actions)

A single `.github/workflows/ci.yml`, triggered on `push` and `pull_request`:

- **`unit` job:** `npm ci` → `npm test` (vitest, ~1 min).
- **`e2e` job:** `npm ci` → `npx playwright install --with-deps chromium` → `npm run test:e2e`
  (builds once via `global-setup` → `prepare-standalone.sh`, launches all three servers). Upload the
  Playwright HTML report as a build artifact **on failure**.
- Both jobs run in parallel; both **required to merge**.
- **Node** pinned to 22 (matches local `@types/node`), via `actions/setup-node` with `cache: npm`.
- **Not in CI:** docker-smoke (stays a manual local check).
- **`.gitignore`:** add the `.e2e/` data root (and confirm any stray `.smoke-data.*` pattern already
  covered).

## 6. Testing & verification

Proof the determinism fix holds (not just "passes once"):

- **Parallel run:** `npm run test:e2e` with `--workers` unset passes green — the bar the suite fails
  today.
- **Repeat-run stability:** `npx playwright test --repeat-each=3` green, to catch order-dependence a
  single run misses.
- **CI green on this PR:** the workflow validating on its own PR is the acceptance signal.
- **Unit suite unchanged:** 69/69 still pass; no app code touched.

## 7. Alternatives considered

| Alternative | Why not |
| --- | --- |
| **Per-worker isolated servers** (each Playwright worker boots its own server + temp dir via a worker-scoped fixture) | Gold-standard isolation but custom fixture + N server boots per run; over-engineered for a ~14-spec suite. §3's per-server + per-spec-deck isolation reaches parallel-safety at far lower complexity. |
| **Serialize + retries only** (`fullyParallel:false`, `workers:1`, retries) | Encodes the current workaround rather than fixing the root cause; end-state §15 explicitly wants `--workers=1` to be a safety net, not a requirement. |
| **mm-jenkins CI** (Jenkinsfile on the EC2 box) | Couples a standalone-OSS repo to MM-specific infra — violates end-state principle #4. GitHub Actions is the OSS-standard, zero-coupling choice. |
| **docker-smoke in CI** | Heaviest job (full image build + container boot); deferred to manual per 2026-07-20 decision. Kept runnable locally. |

## 8. Files touched (anticipated)

- `playwright.config.ts` — three servers/projects, per-server `MORGANA_DATA_DIR`, `retries`,
  readiness gate.
- `e2e/global-setup.ts`, `scripts/prepare-standalone.sh` — seed three `.e2e/*` dirs; optional
  readiness poll.
- `e2e/library.spec.ts` — own project/dir; remove the shared-dir-rename hack.
- The subset of mutating specs identified by the §3.3 audit — convert to owned throwaway decks with
  `afterEach` cleanup.
- `.github/workflows/ci.yml` — new.
- `.gitignore` — add `.e2e/`.

## 9. Open details (deferred to the plan, not forks of this design)

- The exact per-spec read/write audit (§3.3) — which `demo`-loading specs write vs. read.
- Whether the readiness assertion rides Playwright's `webServer.url` probe or a `global-setup` poll
  (§4) — an implementation choice, decided during the plan against Playwright's probe semantics.
- Exact `.e2e/` sub-layout and seed mechanics (one seed helper invoked three times vs. a loop).
