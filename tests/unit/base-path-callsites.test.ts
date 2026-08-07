import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { expect, test } from "vitest";

const ROOT = resolve(__dirname, "../..");
const DIRS = ["app", "components", "lib", "engine"];

// fetch("/…"), fetch('/…'), fetch(`/…`) — an app-absolute URL. Next does NOT
// rewrite these for basePath, so they must go through withBasePath(). \s* after
// fetch tolerates a stray space (`fetch (`) that plain fetch\( would miss.
const RAW_FETCH = /fetch\s*\(\s*[`"']\//;
// `${window.location.origin}/…` — the same problem for hand-built URLs.
const RAW_ORIGIN = /location\.origin\}\//;
// `return \`/…\`` or a ternary branch `? "/…"` / `: "/…"` — a function that hands
// back a hand-built app-absolute URL literal instead of routing it through
// withBasePath(). This is the exact shape of the story-assets.ts bug: a plain
// fetch()/location.origin scan (above) doesn't see it because the literal never
// appears next to either token — it surfaces only where a caller turns the
// return value into a DOM URL (img.src, mask-image, …).
const RAW_URL_LITERAL = /(?:return|[?:])\s*[`"']\/(?!\/)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

function allFiles(): string[] {
  return DIRS.flatMap((dir) => walk(resolve(ROOT, dir)));
}

function relPath(file: string): string {
  return file.slice(ROOT.length + 1);
}

/**
 * Strip block and line comments so a mention of `fetch(` in prose (e.g. this
 * very file's doc comments, or lib/base-path.ts's own explanatory comment)
 * doesn't register as a real call site. Naive but sufficient for this
 * codebase: nothing here embeds a comment delimiter inside a string literal
 * that itself contains `fetch(`.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Precisely what this test checks: raw fetch("/…") calls and hand-built
// `${location.origin}/…` strings. It does NOT catch every way to build an
// app-absolute URL without withBasePath() — see RAW_URL_LITERAL below for the
// complementary "returns a hand-built literal" shape it misses.
test("no app code calls fetch() or builds a location.origin URL with a raw app-absolute literal", () => {
  const offenders: string[] = [];
  for (const file of allFiles()) {
    const src = readFileSync(file, "utf8");
    if (RAW_FETCH.test(src) || RAW_ORIGIN.test(src)) {
      offenders.push(relPath(file));
    }
  }
  expect(offenders).toEqual([]);
});

/**
 * Files that legitimately return/branch on a hand-built app-absolute string
 * literal without going through withBasePath() themselves. Adding an entry
 * here is an exception, not the default — the default is to route the call
 * site through withBasePath(). Every entry needs a real reason; a stale entry
 * (file no longer matches RAW_URL_LITERAL) fails the test below on its own.
 */
const ALLOWED_RAW_URL_LITERAL: Record<string, string> = {
  "engine/deck/story-assets.ts":
    "Value-imported by engine/components/effects/note-state.ts (NOTE_GLYPHS), " +
    "which must keep a DOM-free runtime import graph free of lib/base-path.ts " +
    "(tests/unit/pure-import-graph.test.ts). Fixed downstream instead, at the " +
    "one seam DOM code actually reads through: engine/asset-resolver.ts wraps " +
    "storyAssetUrl(key) in withBasePath().",
  "lib/store/deck-store.ts":
    "\"/data\" is a server-side filesystem default (resolve()d, never sent to a " +
    "browser) — not a URL, so basePath is meaningless here.",
  "lib/store/mcp-auth.ts":
    "Same \"/data\" filesystem default as lib/store/deck-store.ts.",
};

test("every hand-built app-absolute URL literal is routed through withBasePath() or is explicitly allowlisted", () => {
  const offenders: string[] = [];
  for (const file of allFiles()) {
    const rel = relPath(file);
    if (rel === "lib/base-path.ts") continue; // the helper itself: normalises leading slashes by design
    const src = stripComments(readFileSync(file, "utf8"));
    if (!RAW_URL_LITERAL.test(src)) continue;
    if (rel in ALLOWED_RAW_URL_LITERAL) continue;
    offenders.push(rel);
  }
  expect(offenders).toEqual([]);
});

test("every ALLOWED_RAW_URL_LITERAL entry still matches RAW_URL_LITERAL", () => {
  const stale: string[] = [];
  for (const rel of Object.keys(ALLOWED_RAW_URL_LITERAL)) {
    let src: string;
    try {
      src = stripComments(readFileSync(resolve(ROOT, rel), "utf8"));
    } catch {
      stale.push(rel); // file no longer exists
      continue;
    }
    if (!RAW_URL_LITERAL.test(src)) stale.push(rel);
  }
  expect(stale).toEqual([]);
});

/**
 * Files whose fetch( calls are deliberately NOT base-path-relative — e.g. a
 * server-side route handler that calls an external/absolute URL, where
 * basePath is meaningless. Adding an entry here is an exception, not the
 * default: the default action for a new fetch( call site is to route it
 * through withBasePath(), not to allowlist it. Every entry needs a real
 * reason — a list of bare paths invites silent padding, and a stale entry
 * (file no longer contains fetch( at all) fails the test below on its own.
 */
const ALLOWED_RAW_FETCH: Record<string, string> = {
  // (none at present — every current fetch( call site imports withBasePath())
};

const BASE_PATH_IMPORT = /from\s+["']@\/lib\/base-path["']/;
// \s* tolerates a stray space (`fetch (`) that \bfetch\( would miss.
const FETCH_CALL = /\bfetch\s*\(/;

test("every fetch( call site imports withBasePath() or is explicitly allowlisted", () => {
  // Catches indirection the literal-pattern test above can't see, e.g. a
  // req(url) helper that calls fetch(url) with url built elsewhere — exactly
  // the shape lib/api/decks-client.ts had before it imported withBasePath().
  const missing: string[] = [];
  for (const file of allFiles()) {
    const rel = relPath(file);
    if (rel === "lib/base-path.ts") continue; // the helper itself; nothing to import
    const src = stripComments(readFileSync(file, "utf8"));
    if (!FETCH_CALL.test(src)) continue;
    if (BASE_PATH_IMPORT.test(src)) continue;
    if (rel in ALLOWED_RAW_FETCH) continue;
    missing.push(rel);
  }
  expect(missing).toEqual([]);
});

test("every ALLOWED_RAW_FETCH entry still contains a fetch( call", () => {
  // An allowlist entry for a file that no longer calls fetch( at all is dead
  // weight nobody will think to revisit — fail loudly so it gets deleted.
  const stale: string[] = [];
  for (const rel of Object.keys(ALLOWED_RAW_FETCH)) {
    let src: string;
    try {
      src = stripComments(readFileSync(resolve(ROOT, rel), "utf8"));
    } catch {
      stale.push(rel); // file no longer exists
      continue;
    }
    if (!FETCH_CALL.test(src)) stale.push(rel);
  }
  expect(stale).toEqual([]);
});
