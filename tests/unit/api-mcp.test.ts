// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST, GET } from "@/app/api/mcp/route";
import { getOrCreateToken } from "@/lib/store/mcp-auth";
import { createDeck } from "@/lib/store/deck-store";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

function rpc(token: string, body: unknown) {
  return new Request("http://t/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("rejects requests with no or wrong bearer token", async () => {
  const noAuth = await POST(new Request("http://t/api/mcp", { method: "POST", body: "{}" }));
  expect(noAuth.status).toBe(401);
  const wrongAuth = await POST(rpc("wrong-token", { jsonrpc: "2.0", id: 1, method: "tools/list" }));
  expect(wrongAuth.status).toBe(401);
});

test("initialize → tools/list → tools/call round-trip with a valid token", async () => {
  const token = await getOrCreateToken();
  await createDeck({ id: "demo", title: "Demo" });

  const init = await (await POST(rpc(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }))).json();
  expect(init.result.serverInfo.name).toBe("morgana");

  const list = await (await POST(rpc(token, { jsonrpc: "2.0", id: 2, method: "tools/list" }))).json();
  expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("append_scene");

  const call = await (await POST(rpc(token, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "append_scene", arguments: { deck_id: "demo" } },
  }))).json();
  const doc = JSON.parse(call.result.content[0].text);
  expect(doc.scenes.length).toBe(1);
});

test("malformed JSON body returns a JSON-RPC parse error, not a 500", async () => {
  const token = await getOrCreateToken();
  const res = await POST(new Request("http://t/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{not json" }));
  const body = await res.json();
  expect(body.error.code).toBe(-32700);
});

test("GET is not supported (no server-initiated stream)", async () => {
  expect((await GET()).status).toBe(405);
});
