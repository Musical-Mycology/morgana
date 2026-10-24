import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test } from "vitest";

const ROOT = resolve(__dirname, "../..");
const DOM_TOKENS = /\bdocument\.|\.innerHTML\b|createElement\(/;

/** Resolve one import specifier to a repo file, or null for bare package imports. */
function resolveImport(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/")
    ? resolve(ROOT, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) ? base : null;
}

/** Every repo file reachable from `entry` by a RUNTIME import (`import type` is erased). */
function runtimeGraph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = readFileSync(entry, "utf8");
  for (const m of src.matchAll(/^\s*import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/gm)) {
    if (/^\s*import\s+type\s/.test(m[0])) continue; // type-only: no runtime edge
    const next = resolveImport(m[1], entry);
    if (next) runtimeGraph(next, seen);
  }
  return seen;
}

// The pure cores. Their contract is "no DOM" — and nothing in CI can see a violation
// except this test (see docs/MM_MORGANA.md, note-state purity import rule).
test.each([
  "engine/components/effects/note-state.ts",
  "engine/components/effects/draw-state.ts",
  "lib/editor/object-state.ts",
  "engine/authoring/deck-clock.ts",
  "lib/timing/clock-format.ts",
  "engine/authoring/art-clock.ts",
  "engine/authoring/fade-clock.ts",
  "lib/store/media-sniff.ts",
  "engine/deck/media-ref.ts",
  "engine/deck/clip-clock.ts",
  "engine/deck/media-state.ts",
  "engine/authoring/camera-clock.ts",
  "engine/deck/credits.ts",
  "lib/editor/credits-text.ts",
])("%s has a DOM-free runtime import graph", (rel) => {
  const offenders = [...runtimeGraph(resolve(ROOT, rel))]
    .filter((f) => DOM_TOKENS.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(ROOT + "/", ""));
  expect(offenders).toEqual([]);
});

// Browser-reachable modules (the "use client" editor page imports them). A runtime edge to a Node
// builtin or to the fs-backed stores breaks the Next client bundle, which vitest (Node) cannot see.
const NODE_IMPORT = /^\s*import\s+(?!type\s)[\s\S]*?from\s+["'](?:node:[^"']+|fs|fs\/promises|path|crypto)["']/m;
test.each([
  "lib/editor/lint.ts",
  "lib/editor/media-refs.ts",
  "engine/authoring/camera-clock.ts",
  "engine/authoring/fade-clock.ts",
  "engine/deck/credits.ts",
])("%s has a browser-safe runtime import graph (no Node builtins)", (rel) => {
  const offenders = [...runtimeGraph(resolve(ROOT, rel))]
    .filter((f) => NODE_IMPORT.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(ROOT + "/", ""));
  expect(offenders).toEqual([]);
});
