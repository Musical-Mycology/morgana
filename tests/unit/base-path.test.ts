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
