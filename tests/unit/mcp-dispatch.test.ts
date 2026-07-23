// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "@/lib/mcp/dispatch";
import { createDeck } from "@/lib/store/deck-store";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

test("initialize echoes back the requested protocol version and advertises tools", async () => {
  const res = await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  expect(res).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "morgana" } } });
});

test("notifications/initialized returns null (no response)", async () => {
  expect(await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
});

test("tools/list returns the full tool set", async () => {
  const res = await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (res as { result: { tools: { name: string }[] } }).result.tools;
  expect(tools.map((t) => t.name)).toContain("append_scene");
});

test("tools/call executes the tool and wraps the result as text content", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const res = await dispatch({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "append_scene", arguments: { deck_id: "demo" } } });
  const content = (res as { result: { content: { type: string; text: string }[] } }).result.content;
  const doc = JSON.parse(content[0].text);
  expect(doc.scenes.length).toBe(1);
});

test("tools/call with a bad tool name returns isError content, not a JSON-RPC error", async () => {
  const res = await dispatch({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } });
  expect((res as { result: { isError?: boolean } }).result.isError).toBe(true);
});

test("an unknown method returns a JSON-RPC method-not-found error", async () => {
  const res = await dispatch({ jsonrpc: "2.0", id: 5, method: "not/a/method" });
  expect((res as { error: { code: number } }).error.code).toBe(-32601);
});
