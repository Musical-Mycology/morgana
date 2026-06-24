# Morgana — Deployment Hardening: Standalone Server + Docker Deck-Loading

**Date:** 2026-06-24
**Status:** Spec (approved design) → implementation plan next
**Branch:** `deploy-harden-standalone-api` (from `main`)
**Type:** Deployment-readiness hardening (not a feature). Plans 1–3b are shipped to `main`.

---

## 1. Context

Morgana is an open-source (PUBLIC / MIT) Next.js 15 web editor for cinematic slide
decks. The editor (`/editor`) loads decks from a filesystem-backed API
(`/api/decks`, `/api/decks/[id]`) served by the deck store (`lib/store/deck-store.ts`),
which reads `<MORGANA_DATA_DIR>/decks/<id>.deck.json`.

The production target is the **standalone server** (`node .next/standalone/server.js`)
— what the Docker image (`output: "standalone"`, `Dockerfile`) runs. The reported bug:
under the standalone/Docker path `/editor` comes up empty (no filmstrip beats), even
though it works under `npm start`.

**Positioning constraint (informs every decision):** Morgana must be an easy-to-use,
easy-to-deploy **generic open-source tool** that simply spins up and runs in a container.
**No Mycelium-specific design** belongs in this repo — fleet integration will be built as
a separate service around Morgana.

## 2. Root-cause investigation (evidence, not assumptions)

The original bug report proposed three mechanisms. All three were **reproduced against
the real production paths and disproven**:

| Assumed cause | Verdict | Evidence |
|---|---|---|
| API routes statically prerendered → stale `[]` | ❌ Disproven | `next build` route table marks both `ƒ /api/decks` and `ƒ /api/decks/[id]` as **Dynamic** (Next 15.5.19) |
| Standalone bundle omits the API routes | ❌ Disproven | Route chunks present: `.next/standalone/.next/server/app/api/decks/route.js` and `[id]/route.js` |
| Path resolution broken under standalone/Docker | ❌ Disproven | With a writable, seeded data dir, **both** the standalone server and the Docker container serve `/api/decks`, `/api/decks/demo`, and `/editor` (HTTP 200, correct data) |

**Standalone repro (works when data dir is set):**
`MORGANA_DATA_DIR=<abs> PORT=3100 node .next/standalone/server.js` (with `public` and
`.next/static` copied beside the server) →
`/api/decks` returns `[{"id":"demo",...}]`, `/api/decks/demo` returns the deck, `/editor` is 200.

**Docker repro (works when volume is shared + seeded):**
`docker run -p 3000:3000 -v "$PWD/data:/data" morgana` with `data/decks/demo.deck.json`
present → `/api/decks` returns the demo deck, `/editor` is 200.

### Actual root causes of the empty editor

1. **Seeding gap (primary).** `docker compose up` mounts `./data`, which contains only
   `.gitkeep` (real decks are gitignored). Nothing seeds the demo deck, so `/api/decks`
   returns `[]` → empty filmstrip. A fresh clone → `docker compose up` is empty by
   construction.
2. **Unwritable default locally.** The production default `/data` is read-only on macOS
   (`mkdir: /data: Read-only file system`), so the bare standalone server breaks unless
   `MORGANA_DATA_DIR` is set. (Docker is fine — `/data` is created and writable there.)
3. **Silent failure.** `app/editor/page.tsx:20` does `loadDeck("demo").then(load).catch(() => {})`,
   so every load error is swallowed and shows only as "empty."
4. **No regression guard + implicit assumption.** The `ƒ Dynamic` classification is a
   Next 15 default, not pinned. Nothing exercises `/api/decks` against the
   standalone/Docker server, so a future change (e.g. someone adds caching or
   `dynamic = "force-static"`) could silently re-break deploys.
5. **`PUT /api/decks/[id]` lacks try/catch** → can 500 on a write/parse error while the
   other verbs return clean 4xx/5xx.

### Environment trap discovered (must shape the test design)

On Docker Desktop / macOS, **`/tmp` bind-mounts silently do not mount** (`/tmp` is a
symlink to `/private/tmp`, not in the shared paths). A smoke test that seeds a volume
under `/tmp` is a **false negative** — the container sees an empty dir. **All smoke
tests must use a project-relative path** (e.g. `mktemp -d` under `$PWD`), never `/tmp`.

## 3. Goals / Non-goals

**Goals**
- The Docker image and the standalone server serve decks out of the box with zero manual
  steps (`docker compose up` → `/editor` shows the demo).
- Robust, explicit data-dir handling (absolute paths; Docker default `/data`).
- Pin the API routes as dynamic so deploys can't silently regress.
- Clean error handling on all `/api/decks` verbs; load failures are visible, not silent.
- Two regression guards that run reliably: a Docker smoke script and a Playwright
  standalone-server project.
- Keep all existing gates green: `npx tsc --noEmit`, `npm test`, `npm run test:e2e`, `npm run build`.

**Non-goals (YAGNI)**
- Any Mycelium-specific config, naming, or coupling.
- Rewriting the deck store or its on-disk format.
- New deck-management UI, auth, or multi-user.

## 4. Design

### 4.1 Data-dir resolution — `lib/store/deck-store.ts`
Resolve the data dir to an absolute path so relative values (`./data`) are stable
regardless of `cwd`, and "absolute path handling" is explicit:

```ts
import { resolve, join } from "node:path";
const dataDir = () =>
  resolve(process.env.MORGANA_DATA_DIR ?? (process.env.NODE_ENV === "production" ? "/data" : "./data"));
```

Default unchanged (`/data` in production, `./data` in dev). `resolve("/data")` is a no-op
for the absolute Docker case. Plan-2 unit tests set `MORGANA_DATA_DIR` to an absolute
`mkdtemp` dir, so they stay green.

### 4.2 Pin API routes dynamic — `app/api/decks/route.ts`, `app/api/decks/[id]/route.ts`
Add to both files:

```ts
export const dynamic = "force-dynamic";
```

Pins runtime evaluation against the live data dir; regression-proofs against future Next
caching defaults; satisfies "ensure the API routes are server-rendered/dynamic in the
standalone output." It is an inert extra export for the direct-import unit tests.

### 4.3 Harden API error handling
- **`PUT /api/decks/[id]`** (`app/api/decks/[id]/route.ts`): wrap body parse + save in
  `try/catch`. Return `400 {error}` for bad JSON / validation / id-mismatch, `500 {error}`
  for a write failure. Match the existing GET/DELETE style.
- **List `GET`** (`app/api/decks/route.ts`): defensive `try/catch` → `500 {error}` on an
  unwritable/unreadable data dir instead of an unhandled throw (same cheap pattern).

### 4.4 Surface load failures — `app/editor/page.tsx`
Replace `.catch(() => {})` with `console.error(...)` plus a small error state shown in the
editor bar (e.g. "couldn't load deck"). A `console.error` is **not** a `pageerror`, so the
existing `e2e/editor.spec.ts` `expect(errors).toEqual([])` assertion still passes. The
happy path is unchanged.

### 4.5 Auto-seed on first run — Docker
- Bake the sample into the image (`samples/` is in the build context, not dockerignored).
- Add `docker-entrypoint.sh`:
  - `DATA_DIR="${MORGANA_DATA_DIR:-/data}"`; `mkdir -p "$DATA_DIR/decks"`.
  - If no `*.deck.json` exists in `$DATA_DIR/decks`, copy the bundled demo deck in.
    Idempotent; **never overwrites** existing decks.
  - `exec "$@"` (runs the `CMD`, i.e. `node server.js`).
- `Dockerfile`: `COPY` the sample (e.g. to `/app/samples/demo.deck.json`) and the
  entrypoint (`chmod +x`), set `ENTRYPOINT ["/docker-entrypoint.sh"]`, keep
  `CMD ["node", "server.js"]`.
- Result: `docker compose up` / `docker run` with an empty volume → demo deck present →
  `/editor` works. Generic; respects `MORGANA_DATA_DIR`.

### 4.6 Regression guards
**(a) Docker smoke — `scripts/smoke-docker.sh` + `npm run smoke:docker`**
- `set -euo pipefail`; `trap` cleanup that always `docker rm -f` the container and removes
  the temp data dir.
- Build the image (tag e.g. `morgana:smoke`).
- Create an **empty** project-relative volume dir: `DATA="$(mktemp -d "$PWD/.smoke-data.XXXXXX")"`.
- `docker run -d -p <port>:3000 -v "$DATA:/data" morgana:smoke`.
- Poll `/` for readiness (timeout).
- Assert: `GET /api/decks` body contains `"id":"demo"` (proves **auto-seed** + dynamic
  route + path resolution), and `GET /api/decks/demo` is HTTP 200, and `/` is 200.
- Non-zero exit on any failure; clean teardown via trap.

**(b) Playwright standalone project — `playwright.config.ts` (+ a small launch script)**
- `globalSetup`: run once — `npm run seed:demo` (seed `./data`), `next build`, then copy
  `public` → `.next/standalone/` and `.next/static` → `.next/standalone/.next/`. One build
  shared by both servers (avoids double-build).
- `webServer` becomes an array:
  - `{ command: "next start", url: "http://localhost:3000", env: { MORGANA_DATA_DIR: "<abs ./data>" } }`
  - `{ command: "node .next/standalone/server.js", url: "http://localhost:3100",
       env: { PORT: "3100", MORGANA_DATA_DIR: "<abs ./data>" } }`
  - (Both reuse the globalSetup build; neither rebuilds.)
- Projects:
  - existing default project → all specs on `:3000` (baseURL 3000).
  - new `standalone` project → runs only `editor.spec.ts` on `:3100` (baseURL 3100),
    proving the 2-beat filmstrip renders against the real production server.
- The standalone launch steps may be factored into `scripts/prepare-standalone.sh` for
  clarity/reliability, invoked from `globalSetup`.

### 4.7 Docs — `README.md`
Add a concise section: Docker quickstart (`docker compose up`), running the standalone
production server manually (build + copy `public`/`.next/static` + `MORGANA_DATA_DIR`),
the `MORGANA_DATA_DIR` contract and `/data` default, and seeding (`npm run seed:demo` /
auto-seed on first run). Generic OSS framing.

### 4.8 Housekeeping
- `.gitignore` + `.dockerignore`: ignore the smoke temp dirs (`.smoke-data*`).
- `.dockerignore` already excludes `data` (no privacy risk; local decks never baked into
  the image) — keep as is.

## 5. Testing strategy

- **Unit (vitest), keep green + extend:**
  - All existing tests stay green (they set `MORGANA_DATA_DIR` or stub `fetch`).
  - Add a PUT-handler test: bad JSON body → 400; (optionally) write failure → 500 by
    pointing `MORGANA_DATA_DIR` at an unwritable location (e.g. a path whose parent is a
    file). Id-mismatch 400 already covered behavior — assert it stays.
- **E2E (Playwright):** existing specs on `:3000`; new `standalone` project runs
  `editor.spec.ts` on `:3100` against the standalone server.
- **Docker smoke:** `npm run smoke:docker` (manual/local; no CI exists yet).
- **Gates (all must pass):** `npx tsc --noEmit`, `npm test`, `npm run test:e2e`,
  `npm run build`, plus `npm run smoke:docker`.

## 6. Acceptance criteria

1. `docker compose up` from a clean checkout (empty `./data`) → `GET /api/decks` returns
   the demo deck and `/editor` renders the 2-beat filmstrip — **no manual seeding**.
2. `node .next/standalone/server.js` (assets copied, `MORGANA_DATA_DIR` set) serves
   `/api/decks`, `/api/decks/demo`, and `/editor` correctly.
3. Both API route files declare `export const dynamic = "force-dynamic"`; `next build`
   still lists them as `ƒ`.
4. `PUT /api/decks/[id]` returns clean `400`/`500` (no unhandled 500); list `GET` returns
   a clean `500` on an unwritable dir.
5. `npm run smoke:docker` passes against an **empty** volume (auto-seed proven) and is the
   regression guard for the deploy path.
6. The Playwright `standalone` project passes (`editor.spec.ts` green against the
   standalone server).
7. All gates green; the Plan-2 store unit tests remain unchanged and passing.
8. No Mycelium-specific code; README documents Docker + standalone + `MORGANA_DATA_DIR` +
   seeding.

## 7. Risks & mitigations

- **`/tmp` mount false-negative** → smoke test uses a `$PWD`-relative `mktemp` dir.
- **Double `next build` in Playwright** → single `globalSetup` build shared by both servers.
- **Port collision (3000 vs 3100)** → standalone project uses a dedicated port.
- **Touching the deck store could break Plan-2 tests** → change is limited to wrapping the
  default in `resolve()`; tests set absolute `MORGANA_DATA_DIR`, unaffected.
- **No CI yet** → tests/smokes are wired as npm scripts that run reliably locally;
  trivially CI-adoptable later.

## 8. Files touched (summary)

- `lib/store/deck-store.ts` — `resolve()` the data dir.
- `app/api/decks/route.ts` — `force-dynamic`; defensive try/catch on list GET.
- `app/api/decks/[id]/route.ts` — `force-dynamic`; harden PUT with try/catch.
- `app/editor/page.tsx` — surface load failure (console + indicator).
- `Dockerfile` — bake sample + entrypoint; `ENTRYPOINT`.
- `docker-entrypoint.sh` — new; idempotent auto-seed.
- `scripts/smoke-docker.sh` — new; Docker regression smoke.
- `scripts/prepare-standalone.sh` — new (optional); standalone build/copy/seed helper.
- `playwright.config.ts` — globalSetup + webServer array + `standalone` project.
- `package.json` — `smoke:docker` (and any standalone e2e) scripts.
- `README.md` — Docker / standalone / `MORGANA_DATA_DIR` / seeding docs.
- `.gitignore`, `.dockerignore` — ignore `.smoke-data*`.
- `tests/unit/api-decks.test.ts` — add PUT error-path coverage.
