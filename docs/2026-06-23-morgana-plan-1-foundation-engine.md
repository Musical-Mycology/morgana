# Morgana — Plan 1: Foundation & Engine Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `morgana` repo as a Dockerized Next.js app that vendors mm-website's deck engine behind injection points, renders a beat under external "authoring mode" control, and proves a frame-accurate **scrub** of a beat (text + art + notes) — de-risking the three hardest parts before any CRUD or UI is built on top.

**Architecture:** New public repo `Musical-Mycology/morgana`. Next.js 15 (Node runtime, **not** static export) + React 19 + Tailwind v4 + TypeScript, tested with Vitest (unit) + Playwright (integration). The mm-website deck engine (`lib/deck/*`, `components/deck/{Slide,ArtStage,Atmosphere,NoteField}.tsx`, `components/deck/layouts/*`, `components/deck/effects/*`) is copied into `engine/` and generalized behind an injected `AssetResolver` and brand/font CSS vars. The present-mode shell (`Deck.tsx`) is **not** vendored — it is replaced by a controlled `BeatStage` authoring host that supplies its own `CinematicRuntime` (no global key/touch handlers, no fullscreen, no nav). Seek uses a **rebuild-to-time** model that generalizes the engine's existing static end-state replay.

**Tech Stack:** Next.js ^15.0.3, React ^19, Tailwind v4 (`@tailwindcss/postcss`), TypeScript ^5.6, GSAP ^3.15 (+ `@gsap/react`), tsParticles ^3.9 (`@tsparticles/slim` + emitters), Vitest ^4, Playwright ^1.60, Docker.

**Source of truth for the engine being vendored:** the mm-website repo. During execution the worker needs both repos checked out locally; this plan assumes `MM_WEBSITE=/Users/chris/projects/mm-website` (a clean checkout of `main`, or this worktree) and the new `MORGANA=/Users/chris/projects/morgana`.

> **RUN ON: MYCOLOGICAL** (the session host) for all shell blocks below unless noted otherwise.

---

## File Structure (created across this plan)

```
morgana/
  package.json                      # deps + scripts (build, test, test:e2e)
  next.config.mjs                   # Node output (standalone), NOT export
  tsconfig.json                     # @/* path alias → repo root
  postcss.config.mjs                # @tailwindcss/postcss
  vitest.config.ts                  # jsdom env for component units
  playwright.config.ts              # spike e2e
  Dockerfile                        # multi-stage → Next standalone
  .dockerignore
  docker-compose.yml                # mounts ./data:/data, ports 3000
  .gitignore                        # node, .next, /data/decks/*
  app/
    layout.tsx                      # loads fonts → assigns --font-* vars; imports engine tokens
    globals.css                     # @import engine tokens + tailwind
    page.tsx                        # placeholder landing ("Morgana")
    spike/page.tsx                  # the scrub spike (Task 7)
  engine/                           # VENDORED + generalized (Tasks 3–6)
    deck/                           # copy of mm-website lib/deck/*
    components/                     # copy of Slide/ArtStage/Atmosphere/NoteField + layouts + effects
    sporekles.ts                    # copy of mm-website lib/sporekles.ts
    spore-palette.ts                # copy of mm-website lib/spore-palette.ts
    asset-resolver.tsx              # NEW: AssetResolver context + hook (Task 4)
    engine-tokens.css               # NEW: --font-* + --color-mm-* vars (Task 5)
    authoring/
      runtime.ts                    # NEW: makeAuthoringRuntime() (Task 6)
      BeatStage.tsx                 # NEW: controlled host (Task 6)
      seek.ts                       # NEW: renderBeatAt() rebuild-to-time (Task 7)
      sample-beat.ts                # NEW: a text+art+notes beat for the spike (Task 7)
  docs/
    2026-06-23-morgana-design.md    # seeded from mm-website (Task 0)
    2026-06-23-morgana-plan-1-foundation-engine.md
  tests/
    unit/…                          # vitest
  e2e/
    spike.spec.ts                   # playwright (Task 7)
```

---

## Task 0: Create the GitHub repo + seed docs

**Outward-facing action — confirm `Musical-Mycology/morgana`, public, MIT with Chris before running `gh repo create`.**

**Files:**
- Create: `MORGANA/README.md`, `MORGANA/LICENSE` (via `gh`), `MORGANA/docs/2026-06-23-morgana-design.md`, `MORGANA/docs/2026-06-23-morgana-plan-1-foundation-engine.md`

- [ ] **Step 1: Create the repo on GitHub (confirm first)**

```bash
gh repo create Musical-Mycology/morgana \
  --public \
  --license MIT \
  --description "Morgana — an open-source web editor for cinematic, GSAP-driven slide decks." \
  --clone
# clones into ./morgana
```
Expected: `✓ Created repository Musical-Mycology/morgana on GitHub` and a local `morgana/` clone.

- [ ] **Step 2: Move the clone to the standard projects root and seed docs**

```bash
[ -d /Users/chris/projects/morgana ] || mv morgana /Users/chris/projects/morgana
mkdir -p /Users/chris/projects/morgana/docs
cp "$MM_WEBSITE/docs/superpowers/specs/2026-06-23-morgana-design.md" /Users/chris/projects/morgana/docs/
cp "$MM_WEBSITE/docs/superpowers/plans/2026-06-23-morgana-plan-1-foundation-engine.md" /Users/chris/projects/morgana/docs/
```
Expected: both docs present under `morgana/docs/`.

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/chris/projects/morgana
gh repo view --json name,visibility,licenseInfo --jq '"\(.name) · \(.visibility) · \(.licenseInfo.spdxId)"'
git add docs && git commit -m "docs: seed design spec + Plan 1 from mm-website brainstorm"
git push
```
Expected: `morgana · PUBLIC · MIT`; commit pushed to `main`.

---

## Task 1: Scaffold the Next.js app (Node runtime, Vitest)

**Files:**
- Create: `package.json`, `next.config.mjs`, `tsconfig.json`, `postcss.config.mjs`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `vitest.config.ts`, `tests/unit/smoke.test.ts`

- [ ] **Step 1: Initialize package.json with pinned deps (match mm-website)**

Create `package.json`:
```json
{
  "name": "morgana",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@gsap/react": "^2.1.2",
    "@tsparticles/engine": "^3.9.1",
    "@tsparticles/plugin-emitters": "^3.9.1",
    "@tsparticles/react": "^3.0.0",
    "@tsparticles/slim": "^3.9.1",
    "gsap": "^3.15.0",
    "next": "^15.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "@tailwindcss/postcss": "^4.0.0",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Add config files**

Create `next.config.mjs` (Node standalone output — explicitly NOT `output: "export"`):
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
};
export default nextConfig;
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

Create `app/globals.css`:
```css
@import "tailwindcss";
```

Create `app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Morgana", description: "Cinematic deck editor" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `app/page.tsx`:
```tsx
export default function Home() {
  return <main style={{ padding: 32, fontFamily: "system-ui" }}><h1>Morgana</h1></main>;
}
```

- [ ] **Step 3: Add Vitest config + a failing smoke test**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  resolve: { alias: { "@": new URL(".", import.meta.url).pathname } },
});
```

Create `tests/unit/smoke.test.ts`:
```ts
import { expect, test } from "vitest";

test("arithmetic sanity", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 4: Install, run the test (verify it passes), build**

```bash
cd /Users/chris/projects/morgana
npm install
npx playwright install chromium
npm test
```
Expected: `npm test` → 1 passed.

```bash
npm run build
```
Expected: Next build completes, prints a `.next/standalone` note (standalone output).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js (node) + tailwind v4 + vitest"
git push
```

---

## Task 2: Dockerfile + compose smoke run

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.gitignore`

- [ ] **Step 1: Add .gitignore and .dockerignore**

Create `.gitignore`:
```
node_modules
.next
out
*.tsbuildinfo
next-env.d.ts
test-results
playwright-report
# Real decks are private user data — never commit them.
/data/decks/*
!/data/decks/.gitkeep
```

Create `.dockerignore`:
```
node_modules
.next
.git
test-results
playwright-report
data
```

- [ ] **Step 2: Add the multi-stage Dockerfile**

Create `Dockerfile`:
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
EXPOSE 3000
CMD ["node", "server.js"]
```

Create `docker-compose.yml`:
```yaml
services:
  morgana:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
```

- [ ] **Step 3: Build and smoke-run the container**

```bash
cd /Users/chris/projects/morgana
mkdir -p public data/decks && touch data/decks/.gitkeep
docker build -t morgana:dev .
docker run --rm -d -p 3000:3000 --name morgana-smoke morgana:dev
sleep 3 && curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3000/
docker stop morgana-smoke
```
Expected: `docker build` succeeds; curl prints `200`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "build: multi-stage Dockerfile + compose with /data volume"
git push
```

---

## Task 3: Vendor the deck engine and make it compile

**Files:**
- Create (copied): `engine/deck/*` (from `$MM_WEBSITE/lib/deck/`), `engine/sporekles.ts`, `engine/spore-palette.ts`, `engine/components/{Slide,ArtStage,Atmosphere,NoteField}.tsx`, `engine/components/layouts/*`, `engine/components/effects/*`
- Create: `tests/unit/flatten.test.ts`

> We do **not** vendor `Deck.tsx`, `DeckRoot.tsx`, `StoryRoot.tsx`, `PrintDeck.tsx`, `StoryReference.tsx` (present/print shells, replaced by `BeatStage`), nor `lib/audio/*` (only `Deck.tsx` used the audio bus).

- [ ] **Step 1: Copy the engine source**

```bash
cd /Users/chris/projects/morgana
mkdir -p engine/deck engine/components/layouts engine/components/effects
cp "$MM_WEBSITE"/lib/deck/*.ts engine/deck/
cp "$MM_WEBSITE"/lib/sporekles.ts engine/sporekles.ts
cp "$MM_WEBSITE"/lib/spore-palette.ts engine/spore-palette.ts
cp "$MM_WEBSITE"/components/deck/Slide.tsx engine/components/
cp "$MM_WEBSITE"/components/deck/ArtStage.tsx engine/components/
cp "$MM_WEBSITE"/components/deck/Atmosphere.tsx engine/components/
cp "$MM_WEBSITE"/components/deck/NoteField.tsx engine/components/
cp "$MM_WEBSITE"/components/deck/layouts/*.tsx engine/components/layouts/
cp "$MM_WEBSITE"/components/deck/effects/* engine/components/effects/
```
Expected: files present. (If `lib/deck/` contains `content.investor.ts`/`content.story.ts`, **delete them from the copy** — real decks are private and arrive later as JSON: `rm -f engine/deck/content.investor.ts engine/deck/content.story.ts engine/deck/content.public.ts engine/deck/intro.ts`. Keep `types.ts`, `flatten.ts`, `nav.ts`, `panel.ts`, `inline-links.ts`, `counter.ts`, `nightlight.ts`, `theme.ts`, `cinematic-style.ts`, `story-assets.ts`, `lock.ts`, `ramp.ts`, `orientation.ts`, `nav-art.ts`.)

- [ ] **Step 2: Rewrite import specifiers from `@/lib/deck` / `@/lib` / `./` to the vendored paths**

The vendored files import e.g. `@/lib/deck/types`, `@/lib/sporekles`, `@/lib/deck/panel`, and relative `../effects/cinematic-anim`. Rewrite the alias roots:

```bash
cd /Users/chris/projects/morgana/engine
# @/lib/deck/X  ->  @/engine/deck/X
grep -rl '@/lib/deck/' . | xargs sed -i '' 's#@/lib/deck/#@/engine/deck/#g'
# @/lib/sporekles -> @/engine/sporekles ; @/lib/spore-palette -> @/engine/spore-palette
grep -rl '@/lib/sporekles' . | xargs sed -i '' 's#@/lib/sporekles#@/engine/sporekles#g'
grep -rl '@/lib/spore-palette' . | xargs sed -i '' 's#@/lib/spore-palette#@/engine/spore-palette#g'
# components imported each other via "./X" and "./layouts/X" and "../effects/X" — those relative
# paths still resolve inside engine/components, so leave them. Verify no stray @/lib remain:
grep -rn '@/lib/' . || echo "no @/lib refs remain"
```
Expected: final `grep` prints `no @/lib refs remain`. Manually fix any remaining (e.g. `lib/audio` import in a vendored file → delete that import + its call; only expected in files we excluded).

- [ ] **Step 3: Add a flatten unit test (defines the engine compiles + round-trips)**

Create `tests/unit/flatten.test.ts`:
```ts
import { expect, test } from "vitest";
import { flattenStory } from "@/engine/deck/flatten";
import type { Scene } from "@/engine/deck/types";

const scenes: Scene[] = [
  { id: "s1", beats: [
    { id: "b1", timeline: [{ kind: "text", value: "Hello", in: "fade" }] },
    { id: "b2", timeline: [{ kind: "text", value: "World", in: "flyUp" }] },
  ] },
];

test("flattenStory yields one cinematic slide per beat", () => {
  const deck = flattenStory(scenes);
  expect(deck).toHaveLength(2);
  expect(deck[0].layout).toBe("cinematic");
  expect(deck[0].slots).toMatchObject({ sceneId: "s1", beat: { id: "b1" } });
});
```

- [ ] **Step 4: Run the test, fix compile errors until green**

```bash
cd /Users/chris/projects/morgana && npm test -- tests/unit/flatten.test.ts
npx tsc --noEmit
```
Expected: flatten test passes; `tsc --noEmit` has no errors in `engine/`. Fix any residual import/type errors (most likely: a vendored file importing a deleted `content.*`/`intro` or `lib/audio` — remove that import).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): vendor mm-website deck engine into engine/ (compiles + flatten test)"
git push
```

---

## Task 4: AssetResolver injection

**Goal:** Replace the engine's hardcoded asset URLs (`sporekleAsset(...)` for the intro logo; `storyAssetUrl(...)` in ArtStage/NoteField) with an injected resolver, so Morgana can point assets at the sporekles CDN, the local volume, or arbitrary URLs — and the default reproduces today's behavior.

**Files:**
- Create: `engine/asset-resolver.tsx`, `tests/unit/asset-resolver.test.tsx`
- Modify: `engine/components/layouts/CinematicSlide.tsx` (intro logo), `engine/components/ArtStage.tsx`, `engine/components/NoteField.tsx` (whichever call `storyAssetUrl`)

- [ ] **Step 1: Write the failing test for the resolver**

Create `tests/unit/asset-resolver.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { defaultAssetResolver, type AssetResolver } from "@/engine/asset-resolver";

test("default resolver reproduces current URLs", () => {
  const r = defaultAssetResolver;
  expect(r.story("3.02")).toBe("/storyboard/panels/3.02.jpg");
  expect(r.story("MusicScore")).toBe("/storyboard/overlays/MusicScore.png");
  expect(r.story("Notes1")).toBe("/storyboard/notes/Notes1.png");
  expect(r.brand("logo_day_angelring.png"))
    .toBe("https://design-assets.musicalmycology.org/assets/logo_day_angelring.png");
});

test("custom resolver overrides", () => {
  const r: AssetResolver = {
    story: (k) => `https://cdn.example/${k}`,
    brand: (f) => `https://cdn.example/${f}`,
  };
  expect(r.story("3.02")).toBe("https://cdn.example/3.02");
});
```

- [ ] **Step 2: Run it — verify it fails**

```bash
npm test -- tests/unit/asset-resolver.test.tsx
```
Expected: FAIL — `Cannot find module '@/engine/asset-resolver'`.

- [ ] **Step 3: Implement the resolver (context + default backed by current functions)**

Create `engine/asset-resolver.tsx`:
```tsx
"use client";
import { createContext, useContext } from "react";
import type { StoryAsset } from "@/engine/deck/story-assets";
import { storyAssetUrl } from "@/engine/deck/story-assets";
import { sporekleAsset, type SporekleAsset } from "@/engine/sporekles";

export interface AssetResolver {
  /** Storyboard panels / note glyphs / overlays. */
  story(key: StoryAsset): string;
  /** Brand assets (logos etc.) from the sporekles CDN. */
  brand(file: SporekleAsset): string;
}

/** Reproduces the engine's original hardcoded behavior. */
export const defaultAssetResolver: AssetResolver = {
  story: (key) => storyAssetUrl(key),
  brand: (file) => sporekleAsset(file),
};

const Ctx = createContext<AssetResolver>(defaultAssetResolver);

export function AssetResolverProvider({ value, children }: { value: AssetResolver; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssetResolver(): AssetResolver {
  return useContext(Ctx);
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
npm test -- tests/unit/asset-resolver.test.tsx
```
Expected: PASS (2 tests).

- [ ] **Step 5: Route the engine's call sites through the resolver**

In `engine/components/layouts/CinematicSlide.tsx`, replace the direct intro-logo call. Find:
```tsx
import { sporekleAsset } from "@/engine/sporekles";
```
Remove it and add `import { useAssetResolver } from "@/engine/asset-resolver";`. Inside `CinematicSlide`, near the other hooks (`const scope = useRef…`), add:
```tsx
const assets = useAssetResolver();
```
Then change the intro logo `src`:
```tsx
<img className="cin__logo" src={assets.brand("logo_day_angelring.png")} alt="Musical Mycology" />
```

In `engine/components/ArtStage.tsx` and `engine/components/NoteField.tsx`, wherever `storyAssetUrl(asset)` is called to build an `<img src>`, swap to the resolver. Add `const assets = useAssetResolver();` in the component body (these are client components) and replace `storyAssetUrl(x)` with `assets.story(x)`. (If `storyAssetUrl` is called in a non-component helper, pass the resolver in or call it from the component and hand the URL down.)

- [ ] **Step 6: Verify nothing broke**

```bash
npm test && npx tsc --noEmit
```
Expected: all unit tests pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(engine): inject AssetResolver; default reproduces current URLs"
git push
```

---

## Task 5: Brand + font CSS vars (vendor MM values, injectable)

**Goal:** The engine's CSS references `--font-display`, `--font-body`, `--font-cursive`, and `--color-mm-*`. Provide them in Morgana so vendored components render correctly, loading the same Google fonts mm-website uses.

**Files:**
- Create: `engine/engine-tokens.css`
- Modify: `app/globals.css`, `app/layout.tsx`
- Create: `tests/unit/engine-tokens.test.ts`

- [ ] **Step 1: Create the tokens CSS (copy MM literal values)**

Create `engine/engine-tokens.css`. Copy the concrete `--color-mm-*` custom properties from `$MM_WEBSITE/app/globals.css` (the `:root { … }` block of `--color-mm-…` values) verbatim, then add the font-var fallbacks:
```css
:root {
  /* --- Brand color tokens (copied verbatim from mm-website app/globals.css) --- */
  /* PASTE the --color-mm-* declarations here, e.g.: */
  --color-mm-cream: #fdf6ec;
  --color-mm-dark-brown: #2b1d14;
  --color-mm-mushroom: #8a6d5a;
  --color-mm-gold: #d4a843;
  --color-mm-terracotta: #c4623d;
  /* …copy the COMPLETE set from mm-website so no token is missing… */

  /* Font vars are assigned by next/font in app/layout.tsx; provide safe fallbacks. */
  --font-display: "Londrina Solid", system-ui, sans-serif;
  --font-body: "Atkinson Hyperlegible", system-ui, sans-serif;
  --font-cursive: "Dancing Script", cursive;
}
```
> During execution, open `$MM_WEBSITE/app/globals.css`, copy the entire `--color-mm-*` set so the spike renders on-brand. Missing tokens render as `inherit`/blank — not fatal for the spike, but copy them all.

- [ ] **Step 2: Load fonts and import tokens**

Replace `app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { Londrina_Solid, Atkinson_Hyperlegible, Dancing_Script } from "next/font/google";
import "./globals.css";

const display = Londrina_Solid({ subsets: ["latin"], weight: ["400", "900"], variable: "--font-display-src" });
const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-body-src" });
const cursive = Dancing_Script({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-cursive-src" });

export const metadata: Metadata = { title: "Morgana", description: "Cinematic deck editor" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${cursive.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

Update `app/globals.css` to import the tokens and bind the next/font sources to the engine's var names:
```css
@import "tailwindcss";
@import "../engine/engine-tokens.css";

:root {
  --font-display: var(--font-display-src), system-ui, sans-serif;
  --font-body: var(--font-body-src), system-ui, sans-serif;
  --font-cursive: var(--font-cursive-src), cursive;
}
```

- [ ] **Step 3: Add a test that the tokens file declares the required vars**

Create `tests/unit/engine-tokens.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("engine-tokens.css declares the engine's required CSS vars", () => {
  const css = readFileSync(new URL("../../engine/engine-tokens.css", import.meta.url), "utf8");
  for (const v of ["--color-mm-cream", "--color-mm-dark-brown", "--color-mm-gold", "--font-display", "--font-body", "--font-cursive"]) {
    expect(css).toContain(v);
  }
});
```

- [ ] **Step 4: Run test + build**

```bash
npm test -- tests/unit/engine-tokens.test.ts && npm run build
```
Expected: test passes; build succeeds (fonts fetched at build).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): brand tokens + next/font wiring for vendored CSS vars"
git push
```

---

## Task 6: Engine authoring mode — `BeatStage` host

**Goal:** A controlled host that renders ArtStage + NoteField + Atmosphere + one `CinematicSlide` with an **authoring runtime** that mirrors `Deck.tsx`'s runtime wiring but installs **no** global keyboard/touch handlers and **no** fullscreen — so the editor can render a beat without the present-mode shell hijacking input.

**Files:**
- Create: `engine/authoring/runtime.ts`, `engine/authoring/BeatStage.tsx`
- Create: `e2e/beatstage.spec.ts`, `app/_dev/beatstage/page.tsx` (a tiny harness page the e2e drives)

- [ ] **Step 1: Implement the authoring runtime factory**

Create `engine/authoring/runtime.ts`:
```ts
import type { CinematicRuntime } from "@/engine/components/layouts/CinematicSlide";
import type { ArtStageHandle } from "@/engine/components/ArtStage";
import type { NoteFieldHandle } from "@/engine/components/NoteField";
import type { StoryAsset } from "@/engine/deck/story-assets";

export interface AuthoringHooks {
  art: React.RefObject<ArtStageHandle | null>;
  notes: React.RefObject<NoteFieldHandle | null>;
  setNight: (n: number) => void;
  resolveEntry: () => StoryAsset[];
  resolveEnd: () => StoryAsset[];
  onGate: (resume: () => void) => void;
  onWaiting: (waiting: boolean) => void;
}

/** A CinematicRuntime with NO global input capture / fullscreen — for the editor. */
export function makeAuthoringRuntime(h: AuthoringHooks): CinematicRuntime {
  return {
    art: (layers, mode, ms) => h.art.current?.show(layers, mode, ms),
    applyArt: (t, ms) => h.art.current?.apply(t, ms),
    setNightlight: (to) => h.setNight(to),
    cue: () => {},
    emitter: (o) => h.notes.current?.startEmitter(o),
    noteCircle: (o) => h.notes.current?.startCircle(o),
    stopNotes: () => h.notes.current?.stopNotes(),
    stopCircles: () => h.notes.current?.stopCircles(),
    onGate: (resume) => h.onGate(resume),
    revealArrows: () => {},
    pulseArrow: () => {},
    onWaiting: (w) => h.onWaiting(w),
    resolveEntry: () => h.resolveEntry(),
    resolveEnd: () => h.resolveEnd(),
    jumpTo: () => {},
  };
}
```
> Verify the `ArtStageHandle` / `NoteFieldHandle` method names against the vendored `ArtStage.tsx` / `NoteField.tsx` (they expose `show/apply/snap` and `startEmitter/startCircle/stopNotes/stopCircles` per `Deck.tsx`'s usage). Fix names to match the actual exports.

- [ ] **Step 2: Implement BeatStage**

Create `engine/authoring/BeatStage.tsx`:
```tsx
"use client";
import { useMemo, useRef, useState } from "react";
import type { Beat } from "@/engine/deck/types";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { CinematicSlide } from "@/engine/components/layouts/CinematicSlide";
import { makeAuthoringRuntime } from "./runtime";

export function BeatStage({
  sceneId, beat, animate = true, entryLayers = [], endLayers = [],
}: {
  sceneId: string; beat: Beat; animate?: boolean;
  entryLayers?: import("@/engine/deck/story-assets").StoryAsset[];
  endLayers?: import("@/engine/deck/story-assets").StoryAsset[];
}) {
  const art = useRef<ArtStageHandle>(null);
  const notes = useRef<NoteFieldHandle>(null);
  const [night, setNight] = useState(beat.nightlight ?? 0);

  const runtime = useMemo(
    () => makeAuthoringRuntime({
      art, notes, setNight,
      resolveEntry: () => entryLayers,
      resolveEnd: () => endLayers,
      onGate: () => {},     // editor steps gates itself (Plan 3); no-op here
      onWaiting: () => {},
    }),
    [entryLayers, endLayers],
  );

  return (
    <div data-testid="beatstage" style={{ position: "fixed", inset: 0 }}>
      <ArtStage ref={art} nightlight={night} reduced={false} transparentBg />
      <NoteField ref={notes} reduced={false} />
      <div className="deck__stage" style={{ position: "absolute", inset: 0 }}>
        <CinematicSlide slots={{ sceneId, beat }} animate={animate} runtime={runtime} />
      </div>
    </div>
  );
}
```
> `BeatStage` installs no `window` listeners and never calls `requestFullscreen` — that is the whole point (contrast with `Deck.tsx` lines 239–280).

- [ ] **Step 3: Add a dev harness page + failing e2e**

Create `app/_dev/beatstage/page.tsx`:
```tsx
"use client";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Beat } from "@/engine/deck/types";

const beat: Beat = { id: "demo", timeline: [{ kind: "text", value: "Hello Morgana", in: "fade" }] };

export default function Page() {
  return <BeatStage sceneId="demo" beat={beat} />;
}
```

Create `e2e/beatstage.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("BeatStage renders the beat text and does not hijack ArrowRight", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/_dev/beatstage");
  await expect(page.getByText("Hello Morgana")).toBeVisible({ timeout: 5000 });
  // No global key handler should exist: pressing ArrowRight must not throw or navigate.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/_dev\/beatstage$/);
  expect(errors).toEqual([]);
});
```

Create `playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: { command: "npm run build && npm start", url: "http://localhost:3000", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  use: { baseURL: "http://localhost:3000" },
});
```

- [ ] **Step 4: Run e2e — expect it to pass once BeatStage works**

```bash
cd /Users/chris/projects/morgana && npm run test:e2e -- e2e/beatstage.spec.ts
```
Expected: PASS — text visible, URL unchanged, no page errors. If text isn't visible, debug the vendored `CinematicSlide`/`ArtStage` mount (most likely a missing CSS var or a `storyAssetUrl` call not yet routed through the resolver).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): BeatStage authoring host with input-free runtime"
git push
```

---

## Task 7: Seek contract + scrub spike

**Goal:** Prove a frame-accurate scrub. Implement `renderBeatAt(beat, t)` via **rebuild-to-time** (generalizing the engine's static end-state replay): for each action, compute its `[start, end)` window on the beat's timeline using the **same duration model** the engine reserves in `scheduleAction`; actions fully before `t` render settled, the action spanning `t` renders at local progress (tween effects frame-accurate), and particle effects are declared **non-seekable** (seeded/suppressed under scrub). A `/spike` page binds a slider to `renderBeatAt` over a beat with text + art + a note emitter.

**Files:**
- Create: `engine/authoring/seek.ts`, `engine/authoring/sample-beat.ts`
- Create: `tests/unit/seek.test.ts`, `e2e/spike.spec.ts`, `app/spike/page.tsx`

- [ ] **Step 1: Write the failing unit test for the duration model + seekability**

Create `tests/unit/seek.test.ts`:
```ts
import { expect, test } from "vitest";
import { actionDuration, isSeekable, beatTimeline } from "@/engine/authoring/seek";
import type { Action } from "@/engine/deck/types";

test("actionDuration mirrors the engine's reservations", () => {
  expect(actionDuration({ kind: "wait", ms: 400 })).toBeCloseTo(0.4);
  expect(actionDuration({ kind: "media", id: "m", pos: { x: 0, y: 0 }, durationMs: 600 })).toBeCloseTo(0.6);
  expect(actionDuration({ kind: "fade_out", durationMs: 500 })).toBeCloseTo(0.5);
  // a fade text line reserves introDuration("fade") = 0.8 / speed
  expect(actionDuration({ kind: "text", value: "hi", in: "fade" })).toBeCloseTo(0.8, 1);
});

test("seekability: tween effects are seekable, particles are not", () => {
  expect(isSeekable({ kind: "text", value: "x", in: "fade" })).toBe(true);
  expect(isSeekable({ kind: "art", art: { to: "3.02", mode: "fade" } })).toBe(true);
  expect(isSeekable({ kind: "note_emitter", color: "#fff", pos: { x: 0, y: 0 }, dir: 0, decay: 1000, freq: 5 })).toBe(false);
});

test("beatTimeline assigns sequential [start,end) windows", () => {
  const tl: Action[] = [
    { kind: "text", value: "a", in: "fade" },     // 0.8
    { kind: "wait", ms: 200 },                      // 0.2
    { kind: "art", art: { to: "3.02", mode: "fade" } }, // 0.7 default
  ];
  const win = beatTimeline(tl);
  expect(win[0].start).toBeCloseTo(0);
  expect(win[1].start).toBeCloseTo(0.8, 1);
  expect(win[2].start).toBeCloseTo(1.0, 1);
});
```

- [ ] **Step 2: Run it — verify it fails**

```bash
npm test -- tests/unit/seek.test.ts
```
Expected: FAIL — `Cannot find module '@/engine/authoring/seek'`.

- [ ] **Step 3: Implement the duration model + windows + seekability**

Create `engine/authoring/seek.ts`:
```ts
import type { Action, TextIn } from "@/engine/deck/types";

// Mirrors INTRO_DUR + introDuration() in CinematicSlide.tsx so windows match playback timing.
const INTRO_DUR: Record<TextIn, number> = {
  flyUp: 0.6, fade: 0.8, fadeSide: 0.7, cursive: 1.0,
  letterFly: 1.6, letterUp: 1.6, wordUp: 1.3, blurIn: 1.6, typewriter: 1.5,
};
const DOTFADE_TAIL = 2.02;

function introDuration(a: { in: TextIn; value: string; dots?: true; speed?: number }): number {
  const sp = a.speed ?? (a.in === "cursive" ? 0.2 : 1);
  const chars = a.value.length;
  const words = a.value.trim().split(/\s+/).length;
  let base: number;
  switch (a.in) {
    case "cursive":
    case "typewriter": base = 0.1 + chars * 0.045; break;
    case "letterFly":
    case "letterUp":
    case "blurIn": base = 0.5 + chars * 0.03; break;
    case "wordUp": base = 0.6 + words * 0.08; break;
    default: base = INTRO_DUR[a.in];
  }
  return (base + (a.dots ? DOTFADE_TAIL : 0)) / sp;
}

/** Seconds the engine reserves on the master timeline for this action. */
export function actionDuration(a: Action): number {
  switch (a.kind) {
    case "text": return introDuration(a);
    case "wait": return a.ms / 1000;
    case "fade_out": return (a.durationMs ?? 500) / 1000;
    case "counter_show": return 0.4;
    case "counter_to":
    case "counter_add": return (a.durationMs ?? 800) / 1000;
    case "media": return (a.durationMs ?? 600) / 1000;
    case "media_move": return (a.durationMs ?? 800) / 1000;
    case "media_out": return (a.durationMs ?? 500) / 1000;
    // instantaneous side-effects (engine reserves ~0)
    default: return 0;
  }
}

/** Tween effects can be rendered at arbitrary progress; particle/note sources cannot. */
export function isSeekable(a: Action): boolean {
  return a.kind !== "note_emitter" && a.kind !== "note_circle" && a.kind !== "cue";
}

export interface Window { action: Action; start: number; end: number; }

/** Assign sequential [start,end) seconds to each action (click_gate = zero-width boundary). */
export function beatTimeline(timeline: Action[]): Window[] {
  let cursor = 0;
  const out: Window[] = [];
  for (const action of timeline) {
    const dur = actionDuration(action);
    out.push({ action, start: cursor, end: cursor + dur });
    cursor += dur;
  }
  return out;
}

export function beatDuration(timeline: Action[]): number {
  return beatTimeline(timeline).reduce((m, w) => Math.max(m, w.end), 0);
}
```

- [ ] **Step 4: Run unit test — verify it passes**

```bash
npm test -- tests/unit/seek.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Add the rebuild-to-time renderer (DOM application)**

Append to `engine/authoring/seek.ts` a renderer that drives a host element. This reuses the engine's settled-state DOM construction conceptually; for the spike it covers `text` (fade/flyUp via opacity+y), `art` (ArtStage opacity), and `note_emitter` (non-seekable: render a single seeded glyph or skip). Keep it small and explicit:
```ts
import type { ArtStageHandle } from "@/engine/components/ArtStage";

export interface SeekCtx { textHost: HTMLElement; art: ArtStageHandle | null; }

/** Render the beat's visual state at absolute time `t` (seconds). Frame-accurate for tween
 *  effects; particle effects render a single seeded glyph (non-seekable). */
export function renderBeatAt(timeline: Action[], t: number, ctx: SeekCtx): void {
  ctx.textHost.innerHTML = "";
  for (const { action, start, end } of beatTimeline(timeline)) {
    if (start >= t) break;                      // not reached yet
    const dur = end - start;
    const p = dur <= 0 ? 1 : Math.min(1, (t - start) / dur); // local progress 0..1
    applyAt(action, p, ctx);
  }
}

function applyAt(a: Action, p: number, ctx: SeekCtx): void {
  switch (a.kind) {
    case "text": {
      const el = document.createElement("p");
      el.className = "cin__line cin__line--lg";
      el.textContent = a.value;
      el.style.opacity = String(p);
      el.style.transform = a.in === "flyUp" ? `translateY(${(1 - p) * 40}px)` : "";
      ctx.textHost.appendChild(el);
      break;
    }
    case "art": {
      const layers = Array.isArray(a.art.to) ? a.art.to : [a.art.to];
      if (p >= 1) ctx.art?.snap(layers); else ctx.art?.show(layers, "fade", 1);
      break;
    }
    case "note_emitter":
      // non-seekable: represent presence with a single static glyph (no live emission under scrub)
      break;
    default:
      break;
  }
}
```
> This is intentionally a **spike-scope** renderer (text + art + notes) — Plan 3 generalizes `applyAt` to every action kind and replaces the ad-hoc text DOM with the engine's own `appendText`. The spike's job is to prove the rebuild-to-time model is frame-accurate and crash-free with a particle source present.

- [ ] **Step 6: Build the sample beat + spike page**

Create `engine/authoring/sample-beat.ts`:
```ts
import type { Beat } from "@/engine/deck/types";

export const sampleBeat: Beat = {
  id: "spike",
  art: { to: "3.02", mode: "fade" },
  timeline: [
    { kind: "text", value: "We grow a network", in: "flyUp" },
    { kind: "wait", ms: 300 },
    { kind: "text", value: "to make music.", in: "fade" },
    { kind: "art", art: { to: "3.03", mode: "fade" } },
    { kind: "note_emitter", color: "#E3F84F", pos: { x: 0.5, y: 0.55 }, dir: 0, var: 40, decay: 1400, freq: 6 },
  ],
};
```

Create `app/spike/page.tsx`:
```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { sampleBeat } from "@/engine/authoring/sample-beat";
import { beatDuration, renderBeatAt } from "@/engine/authoring/seek";

export default function Spike() {
  const art = useRef<ArtStageHandle>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const total = beatDuration(sampleBeat.timeline);
  const [t, setT] = useState(0);

  useEffect(() => {
    if (textHost.current) renderBeatAt(sampleBeat.timeline, t, { textHost: textHost.current, art: art.current });
  }, [t]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--color-mm-dark-brown)" }}>
      <ArtStage ref={art} nightlight={0.6} reduced={false} transparentBg />
      <div className="cin"><div className="cin__stage"><div ref={textHost} className="cin__text" data-testid="spike-text" /></div></div>
      <input
        data-testid="scrub" type="range" min={0} max={total} step={0.01} value={t}
        onChange={(e) => setT(parseFloat(e.target.value))}
        style={{ position: "fixed", left: 24, right: 24, bottom: 24, width: "calc(100% - 48px)", zIndex: 10 }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Add the spike e2e (proves scrub renders partial state, no crash with notes)**

Create `e2e/spike.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("scrub renders progressive state and survives a particle source", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/spike");
  const scrub = page.getByTestId("scrub");

  // At t=0 the first line is present but fully transparent.
  await scrub.fill("0");
  const first = page.getByText("We grow a network");
  await expect(first).toHaveCSS("opacity", "0");

  // Mid-way the first line is partially/fully revealed and the second line has appeared.
  await scrub.fill("1.0");
  await expect(page.getByText("to make music.")).toBeVisible();

  // End: scrub past the note_emitter window — must not throw.
  await scrub.fill(String(await scrub.getAttribute("max")));
  expect(errors).toEqual([]);
});
```

- [ ] **Step 8: Run unit + e2e — verify green**

```bash
cd /Users/chris/projects/morgana
npm test
npm run test:e2e -- e2e/spike.spec.ts
```
Expected: all unit tests pass; spike e2e passes (opacity 0 at t=0, second line visible at t=1.0, no page errors at max). If the `art` snap/show signature differs, align with the vendored `ArtStageHandle`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(engine): rebuild-to-time seek + scrub spike (text+art+notes)"
git push
```

---

## Plan 1 Done — Definition of Done

- `Musical-Mycology/morgana` exists (public, MIT) and builds in Docker (`docker build` + curl 200).
- The mm-website engine is vendored under `engine/`, compiles (`tsc --noEmit`), and `flattenStory` round-trips.
- Assets resolve through an injectable `AssetResolver` (default reproduces current URLs); brand/font CSS vars are present.
- `BeatStage` renders a beat under external control with **no** global input capture or fullscreen.
- `/spike` proves a **frame-accurate scrub** of a beat containing text + art + a note emitter, crash-free.
- All unit tests (Vitest) and e2e (Playwright) pass.

---

## What follows (later plans — not in scope here)

- **Plan 2 — Backend & Bridges:** deck CRUD API against `/data/decks/*.json`, debounced autosave, the seed script (`content.investor.ts`/`content.story.ts` → deck JSON), and the export-to-`content.*.ts` bridge.
- **Plan 3 — Editor UI:** effect-descriptor registry (generalizing the spike's `applyAt` to every `Action` kind + a `seekable`/`renderAt` contract per descriptor), schema-driven inspector, filmstrip, canvas direct-manipulation, the per-beat timeline with the scrub playhead, play/pause, undo/redo, and a shipped sample/demo deck.

---

## Self-Review (completed during authoring)

- **Spec coverage:** Plan 1 covers spec checklist items 0–4 (repo, scaffold/Docker, vendor+generalize engine, authoring mode, scrub spike). Items 5–14 (CRUD, seed, export, registry, inspector, filmstrip, canvas, timeline, undo/redo, demo) are explicitly assigned to Plans 2–3. No spec item is dropped.
- **Placeholder scan:** the only deliberate "copy these values" step is the `--color-mm-*` paste in Task 5 (the source is named exactly: `$MM_WEBSITE/app/globals.css`); every code step ships real code.
- **Type consistency:** `AssetResolver.story/brand`, `makeAuthoringRuntime`/`AuthoringHooks`, `CinematicRuntime` (from the vendored engine), `actionDuration`/`isSeekable`/`beatTimeline`/`beatDuration`/`renderBeatAt`/`SeekCtx` are used consistently across tasks. `ArtStageHandle`/`NoteFieldHandle` method names are flagged for verification against the vendored exports at first use (Task 6 Step 1).
