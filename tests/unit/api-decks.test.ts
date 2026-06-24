// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as listGET, POST as createPOST } from "@/app/api/decks/route";
import { GET as oneGET, PUT as onePUT, DELETE as oneDELETE } from "@/app/api/decks/[id]/route";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test("create → list → load → save → delete via handlers", async () => {
  const created = await createPOST(new Request("http://t/api/decks", { method: "POST", body: JSON.stringify({ id: "d1", title: "D1" }) }));
  expect(created.status).toBe(201);

  const list = await (await listGET()).json();
  expect(list.map((m: { id: string }) => m.id)).toEqual(["d1"]);

  const loaded = await (await oneGET(new Request("http://t"), ctx("d1"))).json();
  loaded.scenes.push({ id: "s1", beats: [] });
  const put = await onePUT(new Request("http://t", { method: "PUT", body: JSON.stringify(loaded) }), ctx("d1"));
  expect(put.status).toBe(200);

  const del = await oneDELETE(new Request("http://t", { method: "DELETE" }), ctx("d1"));
  expect(del.status).toBe(200);
  expect(await (await listGET()).json()).toEqual([]);
});

test("load of missing deck → 404; invalid create → 400", async () => {
  expect((await oneGET(new Request("http://t"), ctx("missing"))).status).toBe(404);
  expect((await createPOST(new Request("http://t", { method: "POST", body: JSON.stringify({ id: "BAD ID", title: "x" }) }))).status).toBe(400);
});

test("PUT: invalid JSON → 400; write failure → 500", async () => {
  // Malformed body: must be a clean 400, not an unhandled throw.
  const bad = await onePUT(new Request("http://t", { method: "PUT", body: "{not json" }), ctx("d1"));
  expect(bad.status).toBe(400);

  // Write failure: point the data dir at a FILE so mkdir(<dir>/decks) throws ENOTDIR.
  writeFileSync(join(dir, "blocker"), "x");
  process.env.MORGANA_DATA_DIR = join(dir, "blocker");
  const doc = { version: 1, meta: { id: "d1", title: "D1" }, scenes: [] };
  const res = await onePUT(new Request("http://t", { method: "PUT", body: JSON.stringify(doc) }), ctx("d1"));
  expect(res.status).toBe(500);
});
