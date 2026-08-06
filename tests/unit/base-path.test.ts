import { afterEach, describe, expect, test, vi } from "vitest";

// BASE_PATH is read once at module load (the value is inlined at build time in
// a real build), so each case re-imports the module under a stubbed env.
async function loadWith(basePath: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
  return import("@/lib/base-path");
}

// next.config.mjs computes the same normalised value independently (it can't
// import lib/base-path.ts — see the "must agree" comments in both files).
async function loadConfigWith(basePath: string) {
  vi.resetModules();
  vi.stubEnv("MORGANA_BASE_PATH", basePath);
  const { default: nextConfig } = await import("../../next.config.mjs");
  return nextConfig;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// Every row this module must normalise correctly, including the pathological
// inputs that caused a real bug: "//foo" is a protocol-relative URL (silently
// sends fetch() to a different origin) and "foo" (no leading slash) breaks
// relative resolution.
const TABLE: Array<[input: string, expected: string]> = [
  ["", ""],
  ["/", ""],
  ["///", ""],
  ["/morgana", "/morgana"],
  ["morgana", "/morgana"],
  ["//morgana", "/morgana"],
  ["/morgana/", "/morgana"],
  ["/deep/path/", "/deep/path"],
  ["/deep//path", "/deep/path"],
  ["  /morgana  ", "/morgana"],
];

describe.each(TABLE)("normalises %j", (input, expected) => {
  test(`to BASE_PATH ${JSON.stringify(expected)}`, async () => {
    const { BASE_PATH } = await loadWith(input);
    expect(BASE_PATH).toBe(expected);
  });
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

test("collapses a protocol-relative double slash into a single segment", async () => {
  const { BASE_PATH, withBasePath } = await loadWith("//foo");
  expect(BASE_PATH).toBe("/foo");
  expect(withBasePath("/api/decks")).toBe("/foo/api/decks");
});

test("adds a missing leading slash", async () => {
  const { BASE_PATH, withBasePath } = await loadWith("foo");
  expect(BASE_PATH).toBe("/foo");
  expect(withBasePath("/api/decks")).toBe("/foo/api/decks");
});

test("leaves an already-absolute URL untouched", async () => {
  const { withBasePath } = await loadWith("/morgana");
  expect(withBasePath("https://example.test/api/mcp")).toBe(
    "https://example.test/api/mcp",
  );
});

describe.each(TABLE)("next.config.mjs agrees with lib/base-path for %j", (input, expected) => {
  test(`both resolve to ${JSON.stringify(expected)}`, async () => {
    const nextConfig = await loadConfigWith(input);
    expect(nextConfig.env.NEXT_PUBLIC_BASE_PATH).toBe(expected);

    const { BASE_PATH } = await loadWith(input);
    expect(BASE_PATH).toBe(expected);

    expect(nextConfig.env.NEXT_PUBLIC_BASE_PATH).toBe(BASE_PATH);
  });
});
