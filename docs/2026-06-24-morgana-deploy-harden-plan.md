# Deploy-Harden Standalone/Docker Deck-Loading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Morgana reliably serve decks under the standalone server and the Docker image out of the box (zero-step onboarding), with explicit dynamic routes, robust data-dir handling, hardened API error handling, and two regression guards.

**Architecture:** App-Router API routes (`/api/decks`, `/api/decks/[id]`) read a filesystem deck store (`lib/store/deck-store.ts`) at `<MORGANA_DATA_DIR>/decks/<id>.deck.json`. The investigation proved the routes are already dynamic and serve correctly when `/data` is writable + seeded; the empty-editor symptom is caused by an unseeded volume, an unwritable local default, a silent catch, and no regression guard. This plan pins the routes dynamic, auto-seeds the demo deck on first container run, hardens error paths, and adds a Docker smoke + a Playwright standalone-server project.

**Tech Stack:** Next.js 15.5 (standalone output), Node 22 (Alpine in Docker), Vitest, Playwright, Docker. Spec: [`docs/2026-06-24-morgana-deploy-harden-standalone-api.md`](2026-06-24-morgana-deploy-harden-standalone-api.md).

**Constraints:** Public/MIT repo — never commit real decks (`/data/decks/*` is gitignored). No Mycelium-specific code. Keep all gates green: `npx tsc --noEmit`, `npm test`, `npm run test:e2e`, `npm run build`. The Plan-2 store unit tests set `MORGANA_DATA_DIR` explicitly and must stay green.

---

## Task 1: Resolve the data dir to an absolute path

**Files:**
- Modify: `lib/store/deck-store.ts:1-5`

This is a non-behavioral robustness/clarity change (the investigation proved path resolution is *not* broken). It satisfies the spec's "absolute path handling" by normalizing the configured dir to an absolute path. No new unit test — a stdlib `resolve()` wrap has no fail-first behavior to assert; existing round-trip tests + `tsc` guard it.

- [ ] **Step 1: Add `resolve` to the path import**

Change line 2 of `lib/store/deck-store.ts` from:

```ts
import { join } from "node:path";
```

to:

```ts
import { join, resolve } from "node:path";
```

- [ ] **Step 2: Wrap the data dir in `resolve()`**

Change line 5 of `lib/store/deck-store.ts` from:

```ts
const dataDir = () => process.env.MORGANA_DATA_DIR ?? (process.env.NODE_ENV === "production" ? "/data" : "./data");
```

to:

```ts
const dataDir = () => resolve(process.env.MORGANA_DATA_DIR ?? (process.env.NODE_ENV === "production" ? "/data" : "./data"));
```

- [ ] **Step 3: Verify types + existing store tests stay green**

Run: `npx tsc --noEmit && npx vitest run tests/unit/deck-store.test.ts tests/unit/api-decks.test.ts`
Expected: tsc clean; both test files PASS (the Plan-2 round-trip + path-traversal + create tests unaffected because they set an absolute `MORGANA_DATA_DIR`).

- [ ] **Step 4: Commit**

```bash
git add lib/store/deck-store.ts
git commit -m "fix(store): resolve data dir to an absolute path"
```

---

## Task 2: Pin deck routes dynamic + harden PUT/list error handling (TDD)

**Files:**
- Modify: `app/api/decks/route.ts`
- Modify: `app/api/decks/[id]/route.ts`
- Test: `tests/unit/api-decks.test.ts`

- [ ] **Step 1: Write the failing tests for PUT error paths**

Edit `tests/unit/api-decks.test.ts`. Change the imports on lines 3-4 from:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
```

to:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
```

Then append this test to the end of the file (after the existing `load of missing deck` test):

```ts
test("PUT: invalid JSON → 400; write failure → 500", async () => {
  // Malformed body: must be a clean 400, not an unhandled throw.
  const bad = await onePUT(new Request("http://t", { method: "PUT", body: "{not json" }), ctx("d1"));
  expect(bad.status).toBe(400);

  // Write failure: point the data dir at a FILE so mkdir(<dir>/decks) throws ENOTDIR.
  writeFileSync(join(dir, "blocker"), "x");
  process.env.MORGANA_DATA_DIR = join(dir, "blocker");
  const doc = { version: 1, meta: { id: "d1", title: "D1" }, scenes: [] };
  const res = await onePUT(new Request("http://t", { method: "PUT", body: JSON.stringify(doc) }), ctx("d1"));
  expect(res.status).toBe(500);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/api-decks.test.ts`
Expected: FAIL — the new test throws (current `PUT` has no try/catch, so `req.json()` on bad JSON and `saveDeck` on a write error reject instead of returning a Response).

- [ ] **Step 3: Harden `PUT` in `app/api/decks/[id]/route.ts`**

Replace the entire contents of `app/api/decks/[id]/route.ts` with:

```ts
import { loadDeck, saveDeck, deleteDeck } from "@/lib/store/deck-store";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json(await loadDeck(id));
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  let doc: DeckDoc;
  try {
    doc = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (doc?.meta?.id !== id) return Response.json({ error: "id mismatch" }, { status: 400 });
  const v = validateDeckDoc(doc);
  if (!v.ok) return Response.json({ error: v.errors.join(", ") }, { status: 400 });
  try {
    await saveDeck(doc);
  } catch (err) {
    return Response.json({ error: String((err as Error).message) }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try { await deleteDeck(id); return Response.json({ ok: true }); }
  catch { return Response.json({ error: "not found" }, { status: 404 }); }
}
```

- [ ] **Step 4: Harden the list `GET` + pin dynamic in `app/api/decks/route.ts`**

Replace the entire contents of `app/api/decks/route.ts` with:

```ts
import { listDecks, createDeck } from "@/lib/store/deck-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await listDecks());
  } catch (err) {
    return Response.json({ error: String((err as Error).message) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const doc = await createDeck({ id: body.id, title: body.title, treatment: body.treatment });
    return Response.json(doc, { status: 201 });
  } catch (err) {
    return Response.json({ error: String((err as Error).message) }, { status: 400 });
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/api-decks.test.ts`
Expected: PASS — all tests including the new `PUT: invalid JSON → 400; write failure → 500`.

- [ ] **Step 6: Verify types + the routes are still Dynamic in the build**

Run: `npx tsc --noEmit && npm run build 2>&1 | grep -E "ƒ /api/decks"`
Expected: tsc clean; output shows `ƒ /api/decks` and `ƒ /api/decks/[id]` (both Dynamic).

- [ ] **Step 7: Commit**

```bash
git add app/api/decks/route.ts "app/api/decks/[id]/route.ts" tests/unit/api-decks.test.ts
git commit -m "fix(api): pin deck routes dynamic + harden PUT/list error handling"
```

---

## Task 3: Surface deck-load failures in the editor

**Files:**
- Modify: `app/editor/page.tsx:18-20,27`

UI surfacing change. Verified by the existing happy-path e2e (which must stay green) plus the standalone e2e added in Task 6. No new automated test: rendering the full editor page in jsdom pulls the canvas/GSAP stack (heavy/fragile) for negligible value (YAGNI). A `console.error` is **not** a `pageerror`, so `editor.spec.ts`'s `expect(errors).toEqual([])` still passes.

- [ ] **Step 1: Add a load-error state**

In `app/editor/page.tsx`, change line 19 from:

```tsx
  const [showSettings, setShowSettings] = useState(false);
```

to:

```tsx
  const [showSettings, setShowSettings] = useState(false);
  const [loadError, setLoadError] = useState(false);
```

- [ ] **Step 2: Surface the error in the effect**

Change line 20 from:

```tsx
  useEffect(() => { loadDeck("demo").then(load).catch(() => {}); }, [load]);
```

to:

```tsx
  useEffect(() => {
    loadDeck("demo").then(load).catch((e) => { console.error("failed to load deck", e); setLoadError(true); });
  }, [load]);
```

- [ ] **Step 3: Show an indicator in the bar**

Change line 27 (the title span) from:

```tsx
        <span style={{ color: "var(--ed-fg-muted)" }}>{doc?.meta.title ?? "no deck"}</span>
```

to:

```tsx
        <span style={{ color: "var(--ed-fg-muted)" }}>{doc?.meta.title ?? (loadError ? "couldn't load deck" : "no deck")}</span>
```

- [ ] **Step 4: Verify types + lint via build**

Run: `npx tsc --noEmit`
Expected: clean (no unused-var or type errors).

- [ ] **Step 5: Commit**

```bash
git add app/editor/page.tsx
git commit -m "fix(editor): surface deck-load failures instead of swallowing them"
```

---

## Task 4: Auto-seed the demo deck on first container run

**Files:**
- Create: `docker-entrypoint.sh`
- Modify: `Dockerfile`
- Modify: `.gitignore`
- Modify: `.dockerignore`

- [ ] **Step 1: Ignore smoke temp dirs (keeps the working tree clean for verification)**

Append to `.gitignore`:

```
# Smoke-test scratch volumes (project-relative; /tmp does not bind-mount on Docker Desktop)
.smoke-data*
```

Append to `.dockerignore`:

```
.smoke-data*
```

- [ ] **Step 2: Create the entrypoint script**

Create `docker-entrypoint.sh`:

```sh
#!/bin/sh
set -e

DATA_DIR="${MORGANA_DATA_DIR:-/data}"
DECKS_DIR="$DATA_DIR/decks"
mkdir -p "$DECKS_DIR"

# First-run seed: copy the bundled demo deck ONLY if no deck exists yet.
# Idempotent — never overwrites operator data.
if [ -z "$(ls -A "$DECKS_DIR"/*.deck.json 2>/dev/null)" ]; then
  if [ -f /app/samples/demo.deck.json ]; then
    cp /app/samples/demo.deck.json "$DECKS_DIR/demo.deck.json"
    echo "[entrypoint] seeded demo deck into $DECKS_DIR"
  fi
fi

exec "$@"
```

- [ ] **Step 3: Make the entrypoint executable**

Run: `chmod +x docker-entrypoint.sh`
Expected: no output; `ls -l docker-entrypoint.sh` shows the `x` bit.

- [ ] **Step 4: Wire the sample + entrypoint into the Dockerfile**

Replace the entire contents of `Dockerfile` with:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN mkdir -p /data/decks
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Bundled sample for first-run auto-seed (see docker-entrypoint.sh).
COPY samples/demo.deck.json ./samples/demo.deck.json
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
```

- [ ] **Step 5: Build the image and verify auto-seed against an EMPTY project-relative volume**

Run:

```bash
docker build -t morgana:t4 . && \
rm -rf ./.smoke-data.t4 && mkdir -p ./.smoke-data.t4 && \
docker run -d --rm -p 3000:3000 -v "$PWD/.smoke-data.t4:/data" --name morgana-t4 morgana:t4 && \
sleep 3 && \
echo "container decks:" && docker exec morgana-t4 ls -la /data/decks && \
echo "api:" && curl -s http://127.0.0.1:3000/api/decks && echo && \
docker rm -f morgana-t4 && rm -rf ./.smoke-data.t4
```

Expected: `/data/decks` contains `demo.deck.json`; `curl /api/decks` returns `[{"id":"demo","title":"Morgana Demo"}]`. (Uses a `$PWD`-relative volume — `/tmp` would silently not mount on Docker Desktop/macOS.)

- [ ] **Step 6: Commit**

```bash
git add docker-entrypoint.sh Dockerfile .gitignore .dockerignore
git commit -m "feat(docker): auto-seed demo deck on first run"
```

---

## Task 5: Docker deck-loading smoke test

**Files:**
- Create: `scripts/smoke-docker.sh`
- Modify: `package.json:13` (scripts block)

- [ ] **Step 1: Create the smoke script**

Create `scripts/smoke-docker.sh`:

```bash
#!/usr/bin/env bash
# Build the image, run it with an EMPTY volume, and assert the deck-loading API works
# (auto-seed + dynamic routes + path resolution). The regression guard for the deploy path.
set -euo pipefail

IMAGE="morgana:smoke"
PORT="${SMOKE_PORT:-3009}"
NAME="morgana-smoke-$$"
# Project-relative scratch volume: /tmp does NOT bind-mount on Docker Desktop/macOS.
DATA="$(mktemp -d "$PWD/.smoke-data.XXXXXX")"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

echo "[smoke] building image…"
docker build -t "$IMAGE" .

echo "[smoke] running container with EMPTY volume $DATA (auto-seed must populate it)…"
docker run -d --rm -p "$PORT:3000" -v "$DATA:/data" --name "$NAME" "$IMAGE" >/dev/null

echo "[smoke] waiting for readiness on :$PORT…"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then break; fi
  if [ "$i" = "30" ]; then echo "[smoke] FAIL: server did not become ready"; docker logs "$NAME" || true; exit 1; fi
  sleep 1
done

echo "[smoke] GET /api/decks must list the auto-seeded demo deck…"
BODY="$(curl -fsS "http://127.0.0.1:$PORT/api/decks")"
echo "  → $BODY"
case "$BODY" in
  *'"id":"demo"'*) echo "[smoke] OK: /api/decks lists demo" ;;
  *) echo "[smoke] FAIL: /api/decks did not list demo"; exit 1 ;;
esac

echo "[smoke] GET /api/decks/demo must be 200…"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/decks/demo")"
[ "$CODE" = "200" ] || { echo "[smoke] FAIL: /api/decks/demo → $CODE"; exit 1; }
echo "[smoke] OK: /api/decks/demo → 200"

echo "[smoke] GET /editor must be 200…"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/editor")"
[ "$CODE" = "200" ] || { echo "[smoke] FAIL: /editor → $CODE"; exit 1; }
echo "[smoke] OK: /editor → 200"

echo "[smoke] PASS"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/smoke-docker.sh`
Expected: no output.

- [ ] **Step 3: Add the npm script**

In `package.json`, add a `smoke:docker` entry to the `scripts` block. Change:

```json
    "seed:demo": "mkdir -p data/decks && cp samples/demo.deck.json data/decks/demo.deck.json"
```

to:

```json
    "seed:demo": "mkdir -p data/decks && cp samples/demo.deck.json data/decks/demo.deck.json",
    "smoke:docker": "bash scripts/smoke-docker.sh"
```

- [ ] **Step 4: Run the smoke test**

Run: `npm run smoke:docker`
Expected: ends with `[smoke] PASS`; `/api/decks` line shows `[{"id":"demo","title":"Morgana Demo"}]`. Container + scratch dir auto-cleaned by the `trap`.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-docker.sh package.json
git commit -m "test(docker): add standalone deck-loading smoke test"
```

---

## Task 6: Playwright standalone-server project

**Files:**
- Create: `scripts/prepare-standalone.sh`
- Create: `e2e/global-setup.ts`
- Modify: `playwright.config.ts` (full rewrite)

- [ ] **Step 1: Create the standalone-prepare helper**

Create `scripts/prepare-standalone.sh`:

```bash
#!/usr/bin/env bash
# One build shared by the `next start` and standalone e2e servers.
# Seeds ./data and copies the assets the standalone server needs beside it.
set -euo pipefail
npm run seed:demo
npm run build
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
echo "[prepare-standalone] ready (built once; public + static copied; ./data seeded)"
```

Run: `chmod +x scripts/prepare-standalone.sh`
Expected: no output.

- [ ] **Step 2: Create the Playwright global setup**

Create `e2e/global-setup.ts`:

```ts
import { execSync } from "node:child_process";

/** Build once and prepare the standalone server so both webServers launch without rebuilding. */
export default function globalSetup() {
  execSync("bash scripts/prepare-standalone.sh", { stdio: "inherit" });
}
```

- [ ] **Step 3: Rewrite `playwright.config.ts` with two servers + a standalone project**

Replace the entire contents of `playwright.config.ts` with:

```ts
import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Absolute, seeded data dir shared by both servers.
const DATA_DIR = resolve("./data");

export default defineConfig({
  testDir: "./e2e",
  // Builds once + copies standalone assets before either server starts.
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      // Regular production server — exercises ALL e2e specs.
      command: "npm start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, MORGANA_DATA_DIR: DATA_DIR },
    },
    {
      // Standalone production server — the Docker/deploy target. Guards deck-loading.
      command: "node .next/standalone/server.js",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { ...process.env, PORT: "3100", MORGANA_DATA_DIR: DATA_DIR },
    },
  ],
  projects: [
    { name: "default", use: { baseURL: "http://localhost:3000" } },
    { name: "standalone", use: { baseURL: "http://localhost:3100" }, testMatch: /editor\.spec\.ts/ },
  ],
});
```

- [ ] **Step 4: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: PASS. Playwright runs `globalSetup` (one build), starts both servers, runs all specs under the `default` project (`:3000`) and `editor.spec.ts` under the `standalone` project (`:3100`). The standalone run proves the 2-beat filmstrip renders against the real production server. (If a prior dev server is already on `:3000`/`:3100`, it is reused locally.)

- [ ] **Step 5: Commit**

```bash
git add scripts/prepare-standalone.sh e2e/global-setup.ts playwright.config.ts
git commit -m "test(e2e): add standalone-server Playwright project"
```

---

## Task 7: Document Docker, standalone server, and configuration

**Files:**
- Modify: `README.md` (insert before the `## License` section)

- [ ] **Step 1: Insert run/config/test docs**

In `README.md`, insert the following **immediately before** the `## License` line:

````markdown
## Run it

### Docker (recommended)

```bash
docker compose up --build
```

Open <http://localhost:3000/editor> — the bundled **demo deck** is auto-seeded into the
mounted `./data` volume on first run, so the editor works immediately. Your decks live as
JSON under `./data/decks/` (gitignored; never committed).

### Production server (standalone)

`docker compose` runs Next.js's standalone server (`output: "standalone"`). To run it
directly without Docker:

```bash
npm ci
npm run build
# the standalone server needs these copied beside it:
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
MORGANA_DATA_DIR="$PWD/data" node .next/standalone/server.js
```

### Local development

```bash
npm ci
npm run seed:demo   # copy the demo deck into ./data/decks/
npm run dev         # http://localhost:3000
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `MORGANA_DATA_DIR` | `/data` (production), `./data` (dev) | Directory holding `decks/<id>.deck.json`. Use an absolute, writable path in production. |
| `PORT` | `3000` | Server port. |

In Docker the data dir is the mounted volume (`/data`). On first run the demo deck is
seeded only if no `*.deck.json` already exists — existing decks are never overwritten.

## Tests & checks

```bash
npm test             # unit (vitest)
npm run test:e2e     # Playwright — editor specs run against BOTH `next start` and the standalone server
npm run smoke:docker # build the image, run with an empty volume, assert /api/decks serves the auto-seeded demo
npm run build        # production build
```

````

- [ ] **Step 2: Verify the README renders sensibly**

Run: `grep -n "## Run it\|## Configuration\|## Tests & checks\|## License" README.md`
Expected: the three new headings appear before `## License`, in order.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document Docker, standalone server, and config"
```

---

## Task 8: Full verification gates

**Files:** none (verification only).

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: all test files pass (35 prior + the new PUT error-path assertions).

- [ ] **Step 3: Production build + route classification**

Run: `npm run build 2>&1 | grep -E "ƒ /api/decks"`
Expected: build succeeds; `ƒ /api/decks` and `ƒ /api/decks/[id]` both present (Dynamic).

- [ ] **Step 4: End-to-end (both servers)**

Run: `npm run test:e2e`
Expected: PASS for the `default` and `standalone` projects.

- [ ] **Step 5: Docker smoke**

Run: `npm run smoke:docker`
Expected: `[smoke] PASS`.

- [ ] **Step 6: Confirm acceptance criteria**

Manually confirm against the spec's §6: clean checkout + `docker compose up --build` (empty `./data`) → `/api/decks` returns the demo and `/editor` shows 2 filmstrip beats with no manual seeding. (The smoke test in Step 5 already exercises the empty-volume auto-seed path programmatically.)

This completes the plan. Hand off to `superpowers:finishing-a-development-branch` for merge/cleanup.

---

## Self-review notes

- **Spec coverage:** §4.1 → T1; §4.2/4.3 → T2; §4.4 → T3; §4.5 → T4; §4.6(a) → T5; §4.6(b) → T6; §4.7 → T7; §5/§6 gates → T8. All spec sections mapped.
- **`/tmp` trap (spec §2):** honored in T4 step 5 and T5 (project-relative `mktemp`/dirs only).
- **Keep Plan-2 tests green (spec constraint):** T1 step 3 and T8 step 2 verify; the route changes are additive (extra `dynamic` export is inert for direct-import tests).
- **Type consistency:** `DeckDoc` imported in `[id]/route.ts` for the typed `let doc: DeckDoc`; `validateDeckDoc(obj: unknown)` accepts it; `loadError`/`setLoadError` names consistent in T3.
