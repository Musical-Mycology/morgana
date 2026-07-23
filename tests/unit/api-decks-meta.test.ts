// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeck } from "@/lib/store/deck-store";
import { GET } from "@/app/api/decks/[id]/meta/route";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test("returns mtimeMs for an existing deck", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const body = await (await GET(new Request("http://t"), ctx("demo"))).json();
  expect(typeof body.mtimeMs).toBe("number");
});

test("404s for a missing deck", async () => {
  const res = await GET(new Request("http://t"), ctx("missing"));
  expect(res.status).toBe(404);
});
