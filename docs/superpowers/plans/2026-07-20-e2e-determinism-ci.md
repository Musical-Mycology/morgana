# E2E Determinism + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Playwright e2e suite pass reliably under default parallelism (no `--workers=1`) by isolating per-server data, and run unit + e2e automatically in GitHub Actions.

**Architecture:** Give each e2e server its own seeded data dir under a gitignored `.e2e/` root (`default`→:3000, `standalone`→:3100, `library`→:3200); move the one globally-destructive spec (`library.spec.ts`) onto its own server so emptying its decks dir can't race another spec; convert the two specs that autosave-mutate the shared `demo` deck (`deck-settings`, `inspector`) to create their own throwaway decks; add a `/api/decks` readiness gate and CI-only retries; wire a GitHub Actions workflow.

**Tech Stack:** Next.js 15, Playwright 1.60, Node 22, GitHub Actions. Test-harness + config + CI only — **no application/engine/production code changes.**

**Spec:** [`docs/superpowers/specs/2026-07-20-e2e-determinism-ci-design.md`](../specs/2026-07-20-e2e-determinism-ci-design.md)

## Global Constraints

- **No application/engine/production code changes.** Only `playwright.config.ts`, `e2e/**`, `scripts/prepare-standalone.sh`, `.gitignore`, and a new `.github/workflows/ci.yml` may change. The 69-test unit suite and app behavior stay untouched.
- **CI = unit + e2e only.** `npm run smoke:docker` stays a manual local check — it is NOT added to CI.
- **CI = GitHub Actions.** No Jenkinsfile, no mm-jenkins.
- **Node 22** everywhere (matches local `@types/node ^22`).
- **Three servers / data dirs:** `:3000`→`.e2e/default`, `:3100`→`.e2e/standalone` (standalone build), `:3200`→`.e2e/library` (second `next start`).
- **Deck seed source:** every seeded dir is populated from `samples/*.deck.json` (same source `npm run seed:demo` uses).
- **Readiness gate:** each server's `webServer.url` points at `http://localhost:<port>/api/decks` (returns HTTP 200 with the seeded list only once the data layer is live).
- **Retries:** `retries: process.env.CI ? 2 : 0`.

---

### Task 1: Per-server seeded data dirs + gitignore

Replace the single `./data` seed with three isolated `.e2e/*` dirs, reset fresh each run. This is the root-cause fix — after this task the seeding exists; Task 2 wires the servers to it.

**Files:**
- Modify: `scripts/prepare-standalone.sh`
- Modify: `.gitignore`

**Interfaces:**
- Produces: seeded dirs `.e2e/default/decks/`, `.e2e/standalone/decks/`, `.e2e/library/decks/`, each containing every `samples/*.deck.json` (including `demo.deck.json`). Consumed by `playwright.config.ts` (Task 2) via `MORGANA_DATA_DIR` and by `library.spec.ts` (Task 3) via a filesystem path.

- [ ] **Step 1: Rewrite the seed section of `scripts/prepare-standalone.sh`**

Replace the file's entire contents with:

```bash
#!/usr/bin/env bash
# One build shared by the `next start` (:3000, :3200) and standalone (:3100) e2e servers.
# Seeds a fresh, isolated data dir per server so specs never contend on shared state,
# then copies the assets the standalone server needs beside it.
set -euo pipefail

# Fresh per-server seeds from the bundled samples (reset each run — no stale decks).
for name in default standalone library; do
  dir=".e2e/$name/decks"
  rm -rf ".e2e/$name"
  mkdir -p "$dir"
  cp samples/*.deck.json "$dir/"
done

npm run build
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
echo "[prepare-standalone] ready (built once; public + static copied; .e2e/{default,standalone,library} seeded)"
```

- [ ] **Step 2: Add `.e2e/` to `.gitignore`**

Add this block after the existing `.smoke-data*` block in `.gitignore`:

```
# Per-server e2e data dirs (seeded fresh each run by prepare-standalone.sh)
.e2e/
```

- [ ] **Step 3: Run the script and verify the three dirs seed**

Run: `bash scripts/prepare-standalone.sh && ls .e2e/default/decks .e2e/standalone/decks .e2e/library/decks`
Expected: the build completes, and each of the three `decks` dirs lists the sample deck files (including `demo.deck.json`).

- [ ] **Step 4: Verify `.e2e/` is ignored**

Run: `git status --porcelain .e2e`
Expected: no output (the dir is ignored, not staged).

- [ ] **Step 5: Commit**

```bash
git add scripts/prepare-standalone.sh .gitignore
git commit -m "test(e2e): seed isolated per-server data dirs under .e2e/"
```

---

### Task 2: Three servers/projects + readiness gate + retries in `playwright.config.ts`

Wire each Playwright project to its own server + data dir, add the `/api/decks` readiness gate and CI retries, and split `library.spec.ts` onto its own project.

**Files:**
- Modify: `playwright.config.ts` (full rewrite)

**Interfaces:**
- Consumes: the seeded `.e2e/*` dirs from Task 1.
- Produces: three projects — `default` (all specs except `library.spec.ts`, baseURL `:3000`), `standalone` (`editor.spec.ts` only, baseURL `:3100`), `library` (`library.spec.ts` only, baseURL `:3200`).

- [ ] **Step 1: Replace `playwright.config.ts` with the isolated-servers config**

```ts
import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Per-server seeded data dirs (created by scripts/prepare-standalone.sh via global-setup).
// Isolation kills the shared-./data contention that made the suite flaky under parallel workers.
const dataDir = (name: string) => resolve("./.e2e", name);

export default defineConfig({
  testDir: "./e2e",
  expect: { timeout: 15_000 },
  // CI gets retries against genuine infra hiccups; locally real flakes stay visible.
  retries: process.env.CI ? 2 : 0,
  // Builds once + copies standalone assets + seeds the three .e2e dirs before any server starts.
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      // Regular production server — runs ALL specs except the destructive library spec.
      command: "npm start",
      // Readiness gate: /api/decks returns 200 only once the data layer can serve decks.
      url: "http://localhost:3000/api/decks",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, MORGANA_DATA_DIR: dataDir("default") },
    },
    {
      // Standalone production server — the Docker/deploy target. Guards deck-loading.
      command: "node .next/standalone/server.js",
      url: "http://localhost:3100/api/decks",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, PORT: "3100", MORGANA_DATA_DIR: dataDir("standalone") },
    },
    {
      // Dedicated `next start` for the destructive library spec — its own data dir so
      // emptying the decks dir can never race another spec.
      command: "npm start -- --port 3200",
      url: "http://localhost:3200/api/decks",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, MORGANA_DATA_DIR: dataDir("library") },
    },
  ],
  projects: [
    { name: "default", testIgnore: /library\.spec\.ts/, use: { baseURL: "http://localhost:3000" } },
    { name: "standalone", testMatch: /editor\.spec\.ts/, use: { baseURL: "http://localhost:3100" } },
    { name: "library", testMatch: /library\.spec\.ts/, use: { baseURL: "http://localhost:3200" } },
  ],
});
```

- [ ] **Step 2: Sanity-check config parses and lists the three projects**

Run: `npx playwright test --list 2>&1 | head -40`
Expected: no config/parse error; specs are listed under `[default]`, `[standalone]`, and `[library]` projects (e.g. `library.spec.ts` appears only under `[library]`, `editor.spec.ts` under both `[default]` and `[standalone]`).

- [ ] **Step 3: Run a read-only spec across the default + standalone servers**

Run: `CI=1 npx playwright test editor.spec.ts`
Expected: PASS on both `[default]` (:3000) and `[standalone]` (:3100). (`CI=1` forces fresh servers via `reuseExistingServer:false`, exercising the new per-server dirs + readiness gate.)

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts
git commit -m "test(e2e): isolate servers per data dir, add /api/decks readiness gate + CI retries"
```

---

### Task 3: Point `library.spec.ts` at its own server's data dir

The library empty-state test does filesystem surgery on the decks dir; it must target the `library` server's dir (`.e2e/library/decks`), which now only it uses.

**Files:**
- Modify: `e2e/library.spec.ts:6-8`

**Interfaces:**
- Consumes: the `library` project/server on `:3200` with `MORGANA_DATA_DIR=.e2e/library` (Task 2), seeded by Task 1.

- [ ] **Step 1: Repoint the `DECKS_DIR` constant and its comment**

In `e2e/library.spec.ts`, replace lines 6-8:

```ts
// Matches playwright.config.ts's DATA_DIR (resolve("./data")), which both the
// test process and the servers share via MORGANA_DATA_DIR.
const DECKS_DIR = resolve("./data/decks");
```

with:

```ts
// The `library` project runs alone on :3200 against MORGANA_DATA_DIR=.e2e/library
// (playwright.config.ts). This spec owns that dir, so emptying it in the empty-state
// test can never race another spec.
const DECKS_DIR = resolve("./.e2e/library/decks");
```

- [ ] **Step 2: Run the library spec against its isolated server**

Run: `CI=1 npx playwright test library.spec.ts`
Expected: PASS — both the `create/open/delete` test and the `empty-state` test go green under the `[library]` project on :3200.

- [ ] **Step 3: Commit**

```bash
git add e2e/library.spec.ts
git commit -m "test(e2e): point library spec at its isolated .e2e/library data dir"
```

---

### Task 4: Convert `deck-settings` + `inspector` specs to throwaway decks

Both specs currently autosave-mutate the shared `demo` deck (title rename / action-text edit), which races `editor.spec` and each other. Give each its own deck so `demo` stays pristine.

**Files:**
- Modify: `e2e/deck-settings.spec.ts` (full rewrite)
- Modify: `e2e/inspector.spec.ts` (full rewrite)

**Interfaces:**
- Consumes: the deck API — `POST /api/decks` (`{id, title}`) then `PUT /api/decks/:id` (`{version, meta, scenes}`), and `DELETE /api/decks/:id` for cleanup — the exact pattern already used by `persistence.spec.ts` and `drag-pos.spec.ts`.

- [ ] **Step 1: Rewrite `e2e/deck-settings.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

// Uses a THROWAWAY deck so the seeded demo stays pristine for read-only specs.
test("deck settings edits the title and the toolbar reflects it", async ({ page, request }) => {
  const id = "e2e-deck-settings";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Settings" }, scenes: [
    { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Settings" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("deck-settings-toggle").click();
  const title = page.getByTestId("deck-settings").locator("input").first();
  await title.fill("Renamed Deck");
  await expect(page.locator(".ed__bar")).toContainText("Renamed Deck");

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 2: Rewrite `e2e/inspector.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

// Uses a THROWAWAY 2-beat deck so the seeded demo stays pristine for read-only specs.
test("editing a text action's value updates the canvas live", async ({ page, request }) => {
  const id = "e2e-inspector";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Inspector" }, scenes: [
    { id: "s", beats: [
      { id: "b1", timeline: [{ kind: "text", value: "first", in: "fade" }] },
      { id: "b2", timeline: [{ kind: "text", value: "second", in: "fade" }] },
    ] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Inspector" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("filmstrip").getByRole("button").nth(1).click();   // beat 2
  await page.getByTestId("timeline").locator(".ed__chip").first().click();  // select first action
  const value = page.getByTestId("inspector").locator("textarea").first();
  await expect(value).toBeVisible();
  await value.fill("Edited live");
  await page.getByTestId("scrub").evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, "99"); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByTestId("canvas-text").getByText("Edited live")).toBeVisible();

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 3: Run both converted specs**

Run: `CI=1 npx playwright test deck-settings.spec.ts inspector.spec.ts`
Expected: PASS under `[default]` (:3000). If the `inspector` beat-2 click fails to find `nth(1)` (unexpected extra filmstrip buttons), fix by targeting the beat more specifically (e.g. `page.getByTestId("filmstrip").locator(".ed__beat").nth(1)`) — verify against the real `Filmstrip.tsx` markup — then re-run.

- [ ] **Step 4: Commit**

```bash
git add e2e/deck-settings.spec.ts e2e/inspector.spec.ts
git commit -m "test(e2e): give deck-settings + inspector their own throwaway decks"
```

---

### Task 5: GitHub Actions CI workflow

Run unit + e2e on every push and PR, both required, with the Playwright report uploaded on failure.

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm test` (vitest) and `npm run test:e2e` (Playwright — triggers `global-setup` → `prepare-standalone.sh`). No app code.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Lint the workflow YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml OK')"`
Expected: `ci.yml OK` (valid YAML; no parse error).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run unit + e2e on push and PR via GitHub Actions"
```

---

### Task 6: Full-suite determinism verification

Prove the fix holds under real parallelism and repeated runs — the acceptance bar the suite fails today. No source changes; this task is the integration gate.

**Files:** none (verification only).

- [ ] **Step 1: Full suite under default parallelism (no `--workers=1`)**

Run: `CI=1 npm run test:e2e`
Expected: ALL specs PASS across `[default]`, `[standalone]`, `[library]` with Playwright's default worker count — the run that is flaky today.

- [ ] **Step 2: Repeat-run stability (catches order-dependence)**

Run: `CI=1 npx playwright test --repeat-each=3`
Expected: green across all three repeats.

- [ ] **Step 3: Unit suite still green (no app regression)**

Run: `npm test`
Expected: 69/69 (or current count) PASS — unchanged.

- [ ] **Step 4: Confirm no production code changed**

Run: `git diff --stat main -- app engine lib components | grep -v editor || echo "no app/engine/lib/component source changed outside tests"`
Expected: only test/config/CI files in the branch diff (`e2e/`, `playwright.config.ts`, `scripts/prepare-standalone.sh`, `.gitignore`, `.github/`); no `app/`, `engine/`, `lib/`, or `components/` source changes.

- [ ] **Step 5: Push the branch so CI validates on the PR itself**

```bash
git push -u origin HEAD
```

Expected: the `unit` and `e2e` jobs run and go green on the PR — the workflow validating on its own PR is the final acceptance signal.

---

## Notes for the implementer

- **The §3.3 audit result, in full** (so you know why only two specs get converted):
  - `deck-settings`, `inspector` → **convert** (Task 4): they autosave-mutate the shared `demo`.
  - `editor`, `theme` → **leave** (read-only against `demo`).
  - `drag-pos`, `persistence`, `timeline-actions`, `structural` → **leave**: they already create their own throwaway deck with a distinct fixed id and `DELETE` it at test end. `afterEach` cleanup is intentionally *not* added — Task 1 resets each `.e2e/*` dir with `rm -rf` at the start of every run, so a crash-orphaned deck is wiped next run regardless. Before relying on this, confirm those four ids are mutually distinct (`e2e-drag`, `e2e-persist`, and the timeline/structural specs' ids); if any two collide, rename one.
  - dev-route specs (`beatstage`, `chrome`, `deck-canvas`, `spike`) → **leave**: no deck data.
- **`reuseExistingServer` is `!CI`** (unchanged from today): locally, a stray `npm run dev` on :3000/:3100/:3200 would be reused and break isolation. Always verify locally with `CI=1` (forces fresh servers), which is also how CI runs.
- **`editor.spec.ts` runs in two projects** (`default` on :3000, `standalone` on :3100) by design — it guards deck-loading on both the regular and standalone builds. Keep it read-only against `demo`; never make it write.
- **Do not add `smoke:docker` to CI** — it stays a manual local check per the spec.
