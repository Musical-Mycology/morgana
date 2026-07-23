// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOrCreateToken, regenerateToken, verifyToken } from "@/lib/store/mcp-auth";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

test("creates a token on first call and persists it across calls", async () => {
  const a = await getOrCreateToken();
  const b = await getOrCreateToken();
  expect(a).toBe(b);
  expect(a.length).toBeGreaterThan(20);
});

test("regenerateToken replaces the stored token", async () => {
  const original = await getOrCreateToken();
  const next = await regenerateToken();
  expect(next).not.toBe(original);
  expect(await getOrCreateToken()).toBe(next);
});

test("verifyToken checks against the current token", async () => {
  const token = await getOrCreateToken();
  expect(await verifyToken(token)).toBe(true);
  expect(await verifyToken("wrong")).toBe(false);
  expect(await verifyToken(null)).toBe(false);
});
