// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, POST } from "@/app/api/mcp-token/route";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

test("GET returns a token; POST regenerates it", async () => {
  const first = await (await GET()).json();
  expect(typeof first.token).toBe("string");
  const regenerated = await (await POST()).json();
  expect(regenerated.token).not.toBe(first.token);
  const after = await (await GET()).json();
  expect(after.token).toBe(regenerated.token);
});
