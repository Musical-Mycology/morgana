# Sub-path Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator serve Morgana under a sub-path of a larger site (e.g. `https://example.com/morgana/`) behind a reverse proxy, instead of only at the domain root.

**Architecture:** A single build-time environment variable, `MORGANA_BASE_PATH`, feeds Next.js's `basePath` and is re-exported to client code as `NEXT_PUBLIC_BASE_PATH`. Next rewrites `<Link>`, `<Image>`, and `/_next/*` automatically but never touches raw `fetch()` URLs or URLs built by hand, so a `withBasePath()` helper is threaded through every such call site and a repo-guard unit test keeps new ones from creeping in. The existing Docker smoke script gains a sub-path mode so the shipped artifact is verified end-to-end.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Vitest, Docker.

## Global Constraints

- **`basePath` is baked at `next build` time.** Next.js cannot change it at container runtime. `MORGANA_BASE_PATH` is therefore a Docker **build arg**, never a runtime env var.
- **Default behaviour must not change.** With `MORGANA_BASE_PATH` unset, every URL, test, and existing deployment path behaves exactly as it does today. `basePath` must be *absent* from the Next config in that case, not set to `""`.
- **Do not add a Playwright `webServer` entry.** `scripts/prepare-standalone.sh` performs one `next build` shared by all three servers; a sub-path build is a different build and a fourth server would double the slowest step in CI. See the `globalSetup` gotcha in `docs/MM_MORGANA.md`. Coverage comes from the Docker smoke instead.
- **Purity rule.** `engine/components/effects/note-state.ts` and `lib/editor/object-state.ts` must keep DOM-free runtime import graphs (`tests/unit/pure-import-graph.test.ts`). Never import `lib/base-path.ts` from either.
- **Unit tests** live in `tests/unit/*.test.ts`, run with `npm test` (Vitest, jsdom, `@` aliases the repo root).
- Node 22, `npm ci` for installs.

---

### Task 1: The base-path module and build-time wiring

**Files:**
- Create: `lib/base-path.ts`
- Create: `tests/unit/base-path.test.ts`
- Modify: `next.config.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `BASE_PATH: string` (normalised, `""` or `"/segment"`) and `withBasePath(path: string): string`, both exported from `lib/base-path.ts` and imported elsewhere as `@/lib/base-path`. Task 2 depends on both names exactly as written.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/base-path.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";

// BASE_PATH is read once at module load (the value is inlined at build time in
// a real build), so each case re-imports the module under a stubbed env.
async function loadWith(basePath: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
  return import("@/lib/base-path");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("is identity when no base path is configured", async () => {
  const { BASE_PATH, withBasePath } = await loadWith("");
  expect(BASE_PATH).toBe("");
  expect(withBasePath("/api/decks")).toBe("/api/decks");
});

test("prefixes a configured base path", async () => {
  const { BASE_PATH, withBasePath } = await loadWith("/morgana");
  expect(BASE_PATH).toBe("/morgana");
  expect(withBasePath("/api/decks")).toBe("/morgana/api/decks");
  expect(withBasePath("/api/decks/demo")).toBe("/morgana/api/decks/demo");
});

test("normalises a trailing slash away", async () => {
  const { BASE_PATH, withBasePath } = await loadWith("/morgana/");
  expect(BASE_PATH).toBe("/morgana");
  expect(withBasePath("/api/decks")).toBe("/morgana/api/decks");
});

test("treats a bare slash as no base path", async () => {
  const { BASE_PATH } = await loadWith("/");
  expect(BASE_PATH).toBe("");
});

test("leaves an already-absolute URL untouched", async () => {
  const { withBasePath } = await loadWith("/morgana");
  expect(withBasePath("https://example.test/api/mcp")).toBe(
    "https://example.test/api/mcp",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/base-path.test.ts`
Expected: FAIL — cannot resolve `@/lib/base-path`.

- [ ] **Step 3: Write the implementation**

Create `lib/base-path.ts`:

```ts
/**
 * Sub-path support for deployments that serve Morgana under a path of a larger
 * site (e.g. https://example.com/morgana/) behind a reverse proxy.
 *
 * Next.js rewrites <Link>, <Image>, and /_next/* for `basePath` automatically.
 * It does NOT rewrite raw fetch() URLs or URLs we build by hand — every such
 * call site must go through withBasePath().
 *
 * The value is inlined at build time (see next.config.mjs): Next bakes
 * `basePath` during `next build`, so it cannot be changed at container runtime.
 */
const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Normalised base path: either "" or "/segment" — leading slash, no trailing slash. */
export const BASE_PATH = raw === "/" ? "" : raw.replace(/\/+$/, "");

/** Prefix an app-absolute path with the configured base path. */
export function withBasePath(path: string): string {
  // Already a full URL (scheme://…) — nothing to prefix.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return `${BASE_PATH}${path}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/base-path.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the build-time input into the Next config**

Replace the whole of `next.config.mjs` with:

```js
/** @type {import('next').NextConfig} */
// MORGANA_BASE_PATH serves Morgana under a sub-path (e.g. "/morgana") behind a
// reverse proxy. Next bakes basePath during `next build`, so this is a
// BUILD-time input, not a runtime one — see the Dockerfile's build arg.
//
// It is re-exported as NEXT_PUBLIC_BASE_PATH so client code (lib/base-path.ts)
// reads the same value without the operator setting two variables. `basePath`
// is omitted entirely when unset: Next treats basePath: "" as invalid.
const basePath = (process.env.MORGANA_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
export default nextConfig;
```

- [ ] **Step 6: Verify the default build is unchanged**

Run: `npm run build`
Expected: build succeeds. The output summary lists routes as `/`, `/editor`, `/api/decks`, … with **no** `/morgana` prefix.

- [ ] **Step 7: Verify the sub-path build applies the prefix**

Run: `MORGANA_BASE_PATH=/morgana npm run build`
Expected: build succeeds. Next prints `- basePath: /morgana` in its config summary near the top of the output.

- [ ] **Step 8: Run the full unit suite**

Run: `npm test`
Expected: PASS. No existing test changes behaviour — `basePath` is unset in the test environment.

- [ ] **Step 9: Commit**

```bash
git add lib/base-path.ts tests/unit/base-path.test.ts next.config.mjs
git commit -m "feat(config): build-time MORGANA_BASE_PATH for sub-path deployments

Next bakes basePath at build time, so this is a build input rather than a
runtime one. The value is re-exported as NEXT_PUBLIC_BASE_PATH so client
code reads one source of truth, and basePath is omitted entirely when
unset so the default deployment is byte-identical to today."
```

---

### Task 2: Thread `withBasePath()` through every hand-built URL

**Files:**
- Create: `tests/unit/base-path-callsites.test.ts`
- Modify: `lib/api/decks-client.ts:1-4`
- Modify: `lib/editor/use-external-change-poll.ts:20`
- Modify: `components/editor/McpPanel.tsx:5,11,28`
- Modify: `components/editor/EmptyStates.tsx:24`

**Interfaces:**
- Consumes: `withBasePath` from `@/lib/base-path` (Task 1).
- Produces: no new exported names. After this task, no file under `app/`, `components/`, `lib/`, or `engine/` contains a raw app-absolute `fetch()` URL or a hand-built `${window.location.origin}/…` string.

- [ ] **Step 1: Write the failing repo-guard test**

This is the regression guard for the whole feature: a new `fetch("/api/…")` added later would work at the root and silently 404 under a sub-path, and nothing else in the suite would catch it.

Create `tests/unit/base-path-callsites.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { expect, test } from "vitest";

const ROOT = resolve(__dirname, "../..");
const DIRS = ["app", "components", "lib", "engine"];

// fetch("/…"), fetch('/…'), fetch(`/…`) — an app-absolute URL. Next does NOT
// rewrite these for basePath, so they must go through withBasePath().
const RAW_FETCH = /fetch\(\s*[`"']\//;
// `${window.location.origin}/…` — the same problem for hand-built URLs.
const RAW_ORIGIN = /location\.origin\}\//;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

test("no app code builds an app-absolute URL without withBasePath()", () => {
  const offenders: string[] = [];
  for (const dir of DIRS) {
    for (const file of walk(resolve(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      if (RAW_FETCH.test(src) || RAW_ORIGIN.test(src)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
  }
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails, and confirm it names exactly the expected files**

Run: `npx vitest run tests/unit/base-path-callsites.test.ts`
Expected: FAIL. The diff lists exactly these three files:
```
components/editor/McpPanel.tsx
lib/api/decks-client.ts
lib/editor/use-external-change-poll.ts
```
If any *other* file appears, stop and fix that call site too — the list below is not exhaustive by assumption, it is exhaustive by this test.

- [ ] **Step 3: Route the deck API client through the helper**

In `lib/api/decks-client.ts`, add the import below the existing type import and wrap the fetch URL. All five deck CRUD calls funnel through `req()`, so this one edit covers them:

```ts
import type { DeckDoc, DeckMeta } from "@/engine/deck-doc";
import { withBasePath } from "@/lib/base-path";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBasePath(url), { method: "GET", ...init });
```

Leave the rest of `req()` untouched — the error message deliberately reports the app-relative `url`, which is the more useful thing to read in a stack trace.

- [ ] **Step 4: Route the external-change poller through the helper**

In `lib/editor/use-external-change-poll.ts`, add `import { withBasePath } from "@/lib/base-path";` to the imports at the top of the file, then change line 20:

```ts
      const res = await fetch(withBasePath(`/api/decks/${deckId}/meta`));
```

- [ ] **Step 5: Route the MCP panel through the helper — including the URL shown to the user**

In `components/editor/McpPanel.tsx`, add `import { withBasePath } from "@/lib/base-path";` to the imports at the top of the file, then make three edits:

```ts
  const res = await fetch(withBasePath("/api/mcp-token"));
```

```ts
  const res = await fetch(withBasePath("/api/mcp-token"), { method: "POST" });
```

```ts
  const url = typeof window !== "undefined"
    ? `${window.location.origin}${withBasePath("/api/mcp")}`
    : withBasePath("/api/mcp");
```

The third is the connector URL **displayed to the user for copy-paste**. Missing it does not break the app — it hands out a URL that 404s, which is worse because it looks fine.

- [ ] **Step 6: Fix the one absolute link**

In `components/editor/EmptyStates.tsx`, add `import Link from "next/link";` to the imports at the top of the file, then change line 24 from a raw anchor to a `Link` — Next applies `basePath` to `Link` automatically, so no helper is needed:

```tsx
            <Link className="ed__pill ed__pill--ghost" href="/">Back to library</Link>
```

- [ ] **Step 7: Run the guard test to verify it passes**

Run: `npx vitest run tests/unit/base-path-callsites.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full unit suite**

Run: `npm test`
Expected: PASS, including `tests/unit/pure-import-graph.test.ts` — `lib/base-path.ts` touches no DOM and none of the pure modules import it.

- [ ] **Step 9: Run the e2e suite to prove root-path behaviour is unchanged**

Run: `npm run test:e2e`
Expected: PASS. These specs all run at the root, so a green run is the evidence that threading the helper changed nothing for the default deployment.

- [ ] **Step 10: Commit**

```bash
git add tests/unit/base-path-callsites.test.ts lib/api/decks-client.ts \
        lib/editor/use-external-change-poll.ts \
        components/editor/McpPanel.tsx components/editor/EmptyStates.tsx
git commit -m "feat(client): route hand-built URLs through withBasePath()

Next rewrites Link/Image/_next for basePath but never raw fetch() URLs.
Covers the deck API client, the external-change poller, both MCP token
calls, and the MCP connector URL shown to the user — plus a repo-guard
test so a new absolute fetch() cannot regress sub-path deployments
without failing the suite."
```

---

### Task 3: Ship it — Docker build arg, sub-path smoke, and docs

**Files:**
- Modify: `Dockerfile` (builder stage, lines 6-13)
- Modify: `scripts/smoke-docker.sh`
- Modify: `package.json` (scripts)
- Modify: `README.md` (the "Run it" and "Storage & configuration" sections)

**Interfaces:**
- Consumes: `MORGANA_BASE_PATH` from Task 1.
- Produces: the Docker build arg `MORGANA_BASE_PATH` (consumed by downstream deployment tooling) and the npm script `smoke:docker:subpath`.

- [ ] **Step 1: Add the build arg to the Dockerfile builder stage**

Replace the builder stage in `Dockerfile` with:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
# Optional sub-path (e.g. "/morgana") for serving behind a reverse proxy.
# Next bakes basePath during `next build`, so this MUST be a build-time input —
# setting it on the runner has no effect. Empty default = serve at the root.
ARG MORGANA_BASE_PATH=""
ENV MORGANA_BASE_PATH=$MORGANA_BASE_PATH
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
```

Leave the `deps` and `runner` stages untouched.

- [ ] **Step 2: Teach the smoke script about sub-paths**

In `scripts/smoke-docker.sh`, add the base-path variable next to the existing `PORT` line:

```bash
PORT="${SMOKE_PORT:-3009}"
# Optional sub-path to build and probe (e.g. "/morgana"). Empty = root.
BASE="${SMOKE_BASE_PATH:-}"
```

Change the build line to pass it through:

```bash
docker build --build-arg "MORGANA_BASE_PATH=${BASE}" -t "$IMAGE" .
```

Prefix all four existing probes with `$BASE` — the readiness loop and the three assertions:

```bash
  if curl -fsS "http://127.0.0.1:$PORT$BASE/" >/dev/null 2>&1; then break; fi
```
```bash
BODY="$(curl -fsS "http://127.0.0.1:$PORT$BASE/api/decks")"
```
```bash
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE/api/decks/demo")"
```
```bash
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE/editor")"
```

Then add one negative assertion immediately before the final `echo "[smoke] PASS"` — it proves the prefix is genuinely applied rather than the server answering everything:

```bash
if [ -n "$BASE" ]; then
  echo "[smoke] with a base path set, the bare root must NOT serve the app…"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/decks")"
  [ "$CODE" = "404" ] || { echo "[smoke] FAIL: / served $CODE, expected 404 under base path $BASE"; exit 1; }
  echo "[smoke] OK: bare root → 404"
fi
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add below the existing `smoke:docker` entry:

```json
    "smoke:docker": "bash scripts/smoke-docker.sh",
    "smoke:docker:subpath": "SMOKE_BASE_PATH=/morgana bash scripts/smoke-docker.sh",
```

- [ ] **Step 4: Run the root smoke to verify nothing regressed**

Run: `npm run smoke:docker`
Expected: `[smoke] PASS`. The negative assertion is skipped (empty `$BASE`).

- [ ] **Step 5: Run the sub-path smoke**

Run: `npm run smoke:docker:subpath`
Expected: `[smoke] PASS`, including `[smoke] OK: bare root → 404`.

This is the end-to-end gate for the whole feature: a real container, built with the arg, serving the editor and the deck API under `/morgana/`.

- [ ] **Step 6: Document the env var**

In `README.md`, add a row to the env-var table in "Storage & configuration" (immediately after the `MORGANA_DATA_DIR` row):

```markdown
| `MORGANA_BASE_PATH` | _(unset)_ | **Build-time only.** Serve Morgana under a sub-path, e.g. `/morgana`. Next.js bakes this into the build, so it must be passed as a Docker `--build-arg` (or set before `npm run build`) — setting it at container runtime has no effect. |
```

- [ ] **Step 7: Document the deployment**

In `README.md`, add this subsection at the end of the "Run it" section, after "Production server (standalone, no Docker)":

```markdown
### Serving under a sub-path

To serve Morgana at `https://example.com/morgana/` instead of the domain root,
build with `MORGANA_BASE_PATH`:

```bash
docker build --build-arg MORGANA_BASE_PATH=/morgana -t morgana:subpath .
docker run -p 3000:3000 -v "$PWD/data:/data" morgana:subpath
# → http://localhost:3000/morgana/editor
```

Next.js bakes the base path into the build, so this is a **build-time** input —
it cannot be changed by setting an environment variable on the running
container. Point your reverse proxy at the container without stripping the
prefix: the app expects to receive `/morgana/...` paths as-is.

Verify a sub-path image end-to-end with `npm run smoke:docker:subpath`.

If you add code that fetches an app URL, route it through `withBasePath()`
([`lib/base-path.ts`](lib/base-path.ts)) — `tests/unit/base-path-callsites.test.ts`
fails the build otherwise. Next handles `<Link>`, `<Image>`, and `/_next/*` for
you; it does not handle raw `fetch()`.
```

- [ ] **Step 8: Commit**

```bash
git add Dockerfile scripts/smoke-docker.sh package.json README.md
git commit -m "feat(docker): MORGANA_BASE_PATH build arg + sub-path smoke test

The image can now be built to serve under a sub-path behind a reverse
proxy. scripts/smoke-docker.sh gains SMOKE_BASE_PATH, which builds with
the arg, probes the prefixed paths, and asserts the bare root 404s so a
passing smoke cannot be a false positive."
```

- [ ] **Step 9: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "Serve Morgana under a sub-path (MORGANA_BASE_PATH)" \
  --body "Adds build-time sub-path support for reverse-proxy deployments.

- \`MORGANA_BASE_PATH\` feeds Next's \`basePath\` and is re-exported to
  client code as \`NEXT_PUBLIC_BASE_PATH\`.
- \`withBasePath()\` threaded through the six hand-built URLs Next does
  not rewrite, including the MCP connector URL shown to the user.
- A repo-guard unit test fails on any new raw absolute \`fetch()\`.
- \`npm run smoke:docker:subpath\` verifies a real container end-to-end.

Default deployments are unaffected: with the var unset, \`basePath\` is
omitted from the config entirely and the e2e suite passes unchanged."
```

---

## Self-Review

**Spec coverage:** the three requirements this plan exists to satisfy — an env-gated `basePath`, all six hand-built URL call sites, and end-to-end verification of the shipped artifact — map to Tasks 1, 2, and 3 respectively. The deliberate omission of a Playwright sub-path project is recorded as a Global Constraint with its reason.

**Placeholder scan:** no TBDs. Every code step carries the literal code; every verification step carries the command and its expected output.

**Type consistency:** `BASE_PATH` and `withBasePath` are defined in Task 1 Step 3 and used under exactly those names in Task 2 Steps 3-5. `MORGANA_BASE_PATH` (build input) and `NEXT_PUBLIC_BASE_PATH` (client-visible re-export) are used consistently throughout; the Dockerfile arg in Task 3 matches the config read in Task 1.

**Known risk carried forward:** Task 2 Step 2 depends on the guard test naming exactly three files. If it names more, the extra call sites are real and must be fixed in the same task — the step says so explicitly rather than assuming the enumeration is complete.
