# Morgana MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Morgana's existing deck-editing mutation API as an MCP server so a user's own Claude (claude.ai Connectors or Claude Desktop) can read and edit a deck directly — with zero Anthropic credential handling inside Morgana — and have the open editor tab notice when an external client (Claude) changed the deck on disk.

**Architecture:** A hand-rolled JSON-RPC 2.0 / MCP dispatcher (`lib/mcp/`) sits behind a bearer-token-authenticated Next.js route (`app/api/mcp/route.ts`, Streamable HTTP, POST-only — no server-push/SSE needed since every tool call is a fast synchronous file read/write). Each MCP tool wraps one existing pure mutation from `lib/editor/mutations.ts` / `lib/editor/store.ts`'s `setPath`-based updates, applied against the on-disk `DeckDoc` via `lib/store/deck-store.ts` (`loadDeck` → mutate → `validateDeckDoc` → `saveDeck`) — the exact same functions the browser UI already calls, so every MCP edit is validated and would look identical to a human edit if replayed in the browser. A settings panel shows the server URL + bearer token (generate/regenerate, no persistence of any Anthropic credential — Morgana never talks to the Anthropic API). Because the browser's `useEditor` Zustand store only loads a deck once on mount and has no way to notice an external file write, a lightweight polling hook compares the deck file's on-disk `mtimeMs` and shows a non-destructive "reload?" prompt instead of silently overwriting local state.

**Tech Stack:** Next.js 15 App Router route handlers (Node runtime), TypeScript, Zustand (existing `useEditor` store, untouched), Vitest + Testing Library (existing test setup), no new npm dependencies (MCP's Streamable HTTP transport is implemented directly as JSON-RPC 2.0 over `fetch`/`Response.json`, avoiding a guess at any third-party MCP-server SDK's exact API surface).

## Global Constraints

- No new Anthropic credential (API key or OAuth) is ever stored, requested, or transmitted by Morgana — this feature does not call the Anthropic API at all (per the design spec's §0 rationale).
- Every MCP-driven mutation must go through the existing pure functions in `lib/editor/mutations.ts` / the same `setPath`-based update logic in `lib/editor/store.ts` and `validateDeckDoc` — no parallel mutation path.
- No new npm dependencies for the MCP transport itself (spec §1.2 — no stdio transport, no third-party MCP server SDK dependency; the protocol is implemented directly).
- Follow existing test conventions: unit/integration tests live in `tests/unit/*.test.ts(x)`, `// @vitest-environment node` at the top of any test that touches the filesystem or imports a route handler, `beforeEach`/`afterEach` create/clean up a `mkdtempSync` data dir via `MORGANA_DATA_DIR`.
- Match existing code style: no comments explaining *what* code does, TypeScript strict mode, `@/` path alias, `"use client"` for interactive components.

---

### Task 1: Bearer-token store + settings API route

**Files:**
- Create: `lib/store/mcp-auth.ts`
- Create: `app/api/mcp-token/route.ts`
- Test: `tests/unit/mcp-auth.test.ts`
- Test: `tests/unit/api-mcp-token.test.ts`

**Interfaces:**
- Produces: `getOrCreateToken(): Promise<string>`, `regenerateToken(): Promise<string>`, `verifyToken(candidate: string | null): Promise<boolean>` from `lib/store/mcp-auth.ts` — consumed by Task 5's `app/api/mcp/route.ts` and Task 7's settings panel (via the API route, not directly).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/mcp-auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/mcp-auth.test.ts`
Expected: FAIL — `Cannot find module '@/lib/store/mcp-auth'`.

- [ ] **Step 3: Implement the token store**

Create `lib/store/mcp-auth.ts`:

```ts
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const dataDir = () => resolve(process.env.MORGANA_DATA_DIR ?? (process.env.NODE_ENV === "production" ? "/data" : "./data"));
const tokenFile = () => join(dataDir(), "mcp-token.json");

interface TokenFile { token: string; }

async function readTokenFile(): Promise<TokenFile | null> {
  try {
    return JSON.parse(await readFile(tokenFile(), "utf8")) as TokenFile;
  } catch {
    return null;
  }
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

async function writeToken(token: string): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(tokenFile(), JSON.stringify({ token }, null, 2) + "\n", "utf8");
}

export async function getOrCreateToken(): Promise<string> {
  const existing = await readTokenFile();
  if (existing?.token) return existing.token;
  const token = newToken();
  await writeToken(token);
  return token;
}

export async function regenerateToken(): Promise<string> {
  const token = newToken();
  await writeToken(token);
  return token;
}

export async function verifyToken(candidate: string | null): Promise<boolean> {
  if (!candidate) return false;
  return candidate === (await getOrCreateToken());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/mcp-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

Create `tests/unit/api-mcp-token.test.ts`:

```ts
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/unit/api-mcp-token.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/mcp-token/route'`.

- [ ] **Step 7: Implement the route**

Create `app/api/mcp-token/route.ts`:

```ts
import { getOrCreateToken, regenerateToken } from "@/lib/store/mcp-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ token: await getOrCreateToken() });
}

export async function POST() {
  return Response.json({ token: await regenerateToken() });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/unit/api-mcp-token.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/store/mcp-auth.ts app/api/mcp-token/route.ts tests/unit/mcp-auth.test.ts tests/unit/api-mcp-token.test.ts
git commit -m "feat(mcp): bearer-token store + settings API route"
```

---

### Task 2: Deck mtime helper + meta API route

**Files:**
- Modify: `lib/store/deck-store.ts` (add `statDeck`)
- Create: `app/api/decks/[id]/meta/route.ts`
- Modify: `tests/unit/deck-store.test.ts` (append a test)
- Create: `tests/unit/api-decks-meta.test.ts`

**Interfaces:**
- Produces: `statDeck(id: string): Promise<{ mtimeMs: number }>` from `lib/store/deck-store.ts` — consumed by the new meta route and, indirectly (via `fetch`), by Task 8's polling hook.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/deck-store.test.ts` (this file already imports `* as store` and has the `dir`/`MORGANA_DATA_DIR` fixture — no new imports needed):

```ts
test("statDeck reports the file's mtime and updates it on save", async () => {
  await store.saveDeck(doc);
  const first = await store.statDeck("demo");
  expect(typeof first.mtimeMs).toBe("number");
  await new Promise((r) => setTimeout(r, 5));
  await store.saveDeck({ ...doc, meta: { ...doc.meta, title: "Demo 2" } });
  const second = await store.statDeck("demo");
  expect(second.mtimeMs).toBeGreaterThan(first.mtimeMs);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/deck-store.test.ts`
Expected: FAIL — `store.statDeck is not a function`.

- [ ] **Step 3: Implement `statDeck`**

In `lib/store/deck-store.ts`, change the import line:

```ts
import { mkdir, readFile, writeFile, readdir, unlink, access, stat } from "node:fs/promises";
```

and add, after `deleteDeck`:

```ts
export async function statDeck(id: string): Promise<{ mtimeMs: number }> {
  const s = await stat(fileFor(id));
  return { mtimeMs: s.mtimeMs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/deck-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

Create `tests/unit/api-decks-meta.test.ts`:

```ts
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/unit/api-decks-meta.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/decks/[id]/meta/route'`.

- [ ] **Step 7: Implement the route**

Create `app/api/decks/[id]/meta/route.ts`:

```ts
import { statDeck } from "@/lib/store/deck-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return Response.json(await statDeck(id));
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/unit/api-decks-meta.test.ts tests/unit/deck-store.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/store/deck-store.ts app/api/decks/[id]/meta/route.ts tests/unit/deck-store.test.ts tests/unit/api-decks-meta.test.ts
git commit -m "feat(mcp): deck mtime helper + meta API route"
```

---

### Task 3: MCP tool definitions (schemas)

**Files:**
- Create: `lib/mcp/tool-defs.ts`
- Test: `tests/unit/mcp-tool-defs.test.ts`

**Interfaces:**
- Consumes: `REGISTRY` from `lib/editor/registry.ts` (existing — `Record<string, EffectDescriptor>`, keys are action kinds).
- Produces: `interface ToolDef { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: { destructiveHint?: boolean } }` and `TOOL_DEFS: ToolDef[]` from `lib/mcp/tool-defs.ts` — consumed by Task 5's `dispatch.ts` (`tools/list`) and Task 6's route integration test.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp-tool-defs.test.ts`:

```ts
import { expect, test } from "vitest";
import { TOOL_DEFS } from "@/lib/mcp/tool-defs";

test("every tool has a unique name, a description, and an object input schema", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of TOOL_DEFS) {
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.inputSchema.type).toBe("object");
  }
});

test("includes the full mutation surface", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining([
    "list_decks", "read_deck",
    "insert_beat_after", "duplicate_beat_at", "delete_beat_at", "move_beat_by",
    "append_scene", "delete_scene_at",
    "insert_action_after", "duplicate_action_at", "delete_action_at", "move_action_by", "convert_action_kind",
    "update_action", "update_meta",
  ]));
});

test("delete_scene_at and delete_action_at are marked destructive", () => {
  const byName = Object.fromEntries(TOOL_DEFS.map((t) => [t.name, t]));
  expect(byName.delete_scene_at.annotations?.destructiveHint).toBe(true);
  expect(byName.delete_action_at.annotations?.destructiveHint).toBe(true);
});

test("convert_action_kind's new_kind enum matches the effect registry", () => {
  const tool = TOOL_DEFS.find((t) => t.name === "convert_action_kind")!;
  const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
  expect(props.new_kind.enum).toContain("text");
  expect(props.new_kind.enum).toContain("obj_reveal");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mcp-tool-defs.test.ts`
Expected: FAIL — `Cannot find module '@/lib/mcp/tool-defs'`.

- [ ] **Step 3: Implement the tool definitions**

Create `lib/mcp/tool-defs.ts`:

```ts
import { REGISTRY } from "@/lib/editor/registry";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { destructiveHint?: boolean };
}

const ACTION_KINDS = Object.keys(REGISTRY);

const DECK_ID = { deck_id: { type: "string", description: "Deck id, as returned by list_decks." } };
const BEAT_INDEX = { beat_index: { type: "number", description: "Flat (filmstrip-order) beat index, 0-based." } };
const ACTION_INDEX = { action_index: { type: "number", description: "Index of the action within the beat's timeline, 0-based." } };
const DIR = { dir: { type: "number", enum: [-1, 1], description: "-1 to move earlier/left, 1 to move later/right." } };

function schema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "list_decks",
    description: "List all decks in this Morgana instance, with id and title.",
    inputSchema: schema({}, []),
  },
  {
    name: "read_deck",
    description: "Read the full JSON document for one deck: all scenes, beats, and actions.",
    inputSchema: schema({ ...DECK_ID }, ["deck_id"]),
  },
  {
    name: "insert_beat_after",
    description: "Insert a new, empty beat immediately after the given beat.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX }, ["deck_id", "beat_index"]),
  },
  {
    name: "duplicate_beat_at",
    description: "Duplicate the given beat, inserting the copy immediately after it.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX }, ["deck_id", "beat_index"]),
  },
  {
    name: "delete_beat_at",
    description: "Delete the given beat.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX }, ["deck_id", "beat_index"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "move_beat_by",
    description: "Swap the given beat with its neighbor within the same scene (dir -1 = earlier, 1 = later). No-op at a scene boundary.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...DIR }, ["deck_id", "beat_index", "dir"]),
  },
  {
    name: "append_scene",
    description: "Append a new scene (with one empty beat) to the end of the deck.",
    inputSchema: schema({ ...DECK_ID }, ["deck_id"]),
  },
  {
    name: "delete_scene_at",
    description: "Delete the scene containing the given beat, including all of its beats.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX }, ["deck_id", "beat_index"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "insert_action_after",
    description: "Insert a new action of the given kind into a beat's timeline, immediately after action_index (or at the end if action_index is omitted).",
    inputSchema: schema({
      ...DECK_ID, ...BEAT_INDEX,
      action_index: { type: ["number", "null"], description: "Insert after this action index, or omit/null to append." },
      kind: { type: "string", enum: ACTION_KINDS, description: "Action kind to insert, with its registry defaults." },
    }, ["deck_id", "beat_index", "kind"]),
  },
  {
    name: "duplicate_action_at",
    description: "Duplicate the given action within its beat's timeline, inserting the copy immediately after it.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX }, ["deck_id", "beat_index", "action_index"]),
  },
  {
    name: "delete_action_at",
    description: "Delete the given action from its beat's timeline.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX }, ["deck_id", "beat_index", "action_index"]),
    annotations: { destructiveHint: true },
  },
  {
    name: "move_action_by",
    description: "Swap the given action with its neighbor within the same beat's timeline (dir -1 = earlier, 1 = later). No-op at a timeline boundary.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX, ...DIR }, ["deck_id", "beat_index", "action_index", "dir"]),
  },
  {
    name: "convert_action_kind",
    description: "Replace an action with a different kind's defaults (fields are not preserved across the conversion).",
    inputSchema: schema({
      ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX,
      new_kind: { type: "string", enum: ACTION_KINDS },
    }, ["deck_id", "beat_index", "action_index", "new_kind"]),
  },
  {
    name: "update_action",
    description: "Set a single field on an existing action, addressed by a dot-path (e.g. \"value\", \"pos.x\", \"art.mode\"). Use read_deck first to see current fields, or convert_action_kind/insert_action_after to see a kind's default field set.",
    inputSchema: schema({
      ...DECK_ID, ...BEAT_INDEX, ...ACTION_INDEX,
      path: { type: "string", description: "Dot-path into the action, e.g. \"value\" or \"pos.x\"." },
      value: { description: "New value for the field. Type depends on the field." },
    }, ["deck_id", "beat_index", "action_index", "path", "value"]),
  },
  {
    name: "update_meta",
    description: "Set a single field on the deck's metadata, addressed by a dot-path (e.g. \"title\", \"chrome.wordmark\").",
    inputSchema: schema({
      ...DECK_ID,
      path: { type: "string" },
      value: { description: "New value for the field." },
    }, ["deck_id", "path", "value"]),
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/mcp-tool-defs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/tool-defs.ts tests/unit/mcp-tool-defs.test.ts
git commit -m "feat(mcp): tool definitions generated from the existing mutation API"
```

---

### Task 4: MCP tool handlers (wrap the mutation API)

**Files:**
- Create: `lib/mcp/tool-handlers.ts`
- Test: `tests/unit/mcp-tool-handlers.test.ts`

**Interfaces:**
- Consumes: `loadDeck`, `saveDeck`, `listDecks` from `lib/store/deck-store.ts`; `validateDeckDoc`, `type DeckDoc` from `@/engine/deck-doc`; `insertBeatAfter`, `duplicateBeatAt`, `deleteBeatAt`, `moveBeatBy`, `appendScene`, `deleteSceneAt`, `insertActionAfter`, `duplicateActionAt`, `deleteActionAt`, `moveActionBy`, `convertActionKind` from `lib/editor/mutations.ts`; `beatLocation` from `lib/editor/flatten-beats.ts`; `setPath` from `lib/editor/paths.ts`.
- Produces: `class ToolCallError extends Error` and `async function callTool(name: string, rawArgs: unknown): Promise<DeckDoc | { decks: Awaited<ReturnType<typeof listDecks>> }>` from `lib/mcp/tool-handlers.ts` — consumed by Task 5's `dispatch.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp-tool-handlers.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeck, loadDeck } from "@/lib/store/deck-store";
import { callTool, ToolCallError } from "@/lib/mcp/tool-handlers";
import type { DeckDoc } from "@/engine/deck-doc";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

test("list_decks returns deck metadata", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const result = await callTool("list_decks", {}) as { decks: { id: string }[] };
  expect(result.decks.map((d) => d.id)).toEqual(["demo"]);
});

test("read_deck returns the full document", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const doc = await callTool("read_deck", { deck_id: "demo" }) as DeckDoc;
  expect(doc.meta.title).toBe("Demo");
});

test("append_scene and delete_scene_at mutate and persist via the real store", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const afterAppend = await callTool("append_scene", { deck_id: "demo" }) as DeckDoc;
  expect(afterAppend.scenes.length).toBe(1);
  expect((await loadDeck("demo")).scenes.length).toBe(1);

  const afterDelete = await callTool("delete_scene_at", { deck_id: "demo", beat_index: 0 }) as DeckDoc;
  expect(afterDelete.scenes.length).toBe(0);
});

test("insert_action_after, update_action, and convert_action_kind round-trip", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("insert_action_after", { deck_id: "demo", beat_index: 0, action_index: null, kind: "wait" });

  const updated = await callTool("update_action", { deck_id: "demo", beat_index: 0, action_index: 1, path: "ms", value: 900 }) as DeckDoc;
  expect(updated.scenes[0].beats[0].timeline[1]).toMatchObject({ kind: "wait", ms: 900 });

  const converted = await callTool("convert_action_kind", { deck_id: "demo", beat_index: 0, action_index: 1, new_kind: "clear" }) as DeckDoc;
  expect(converted.scenes[0].beats[0].timeline[1]).toEqual({ kind: "clear" });
});

test("update_meta sets a nested field", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const doc = await callTool("update_meta", { deck_id: "demo", path: "chrome.wordmark", value: "Acme" }) as DeckDoc;
  expect(doc.meta.chrome?.wordmark).toBe("Acme");
});

test("missing required args raise a ToolCallError, not a generic throw", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await expect(callTool("insert_beat_after", { deck_id: "demo" })).rejects.toThrow(ToolCallError);
});

test("an unknown tool name raises a ToolCallError", async () => {
  await expect(callTool("not_a_real_tool", {})).rejects.toThrow(ToolCallError);
});

test("a mutation that would invalidate the deck is rejected before saving", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await expect(callTool("update_meta", { deck_id: "demo", path: "id", value: "BAD ID" })).rejects.toThrow(ToolCallError);
  expect((await loadDeck("demo")).meta.id).toBe("demo");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mcp-tool-handlers.test.ts`
Expected: FAIL — `Cannot find module '@/lib/mcp/tool-handlers'`.

- [ ] **Step 3: Implement the tool handlers**

Create `lib/mcp/tool-handlers.ts`:

```ts
import { loadDeck, saveDeck, listDecks } from "@/lib/store/deck-store";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import {
  insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy,
  appendScene, deleteSceneAt,
  insertActionAfter, duplicateActionAt, deleteActionAt, moveActionBy, convertActionKind,
} from "@/lib/editor/mutations";
import { beatLocation } from "@/lib/editor/flatten-beats";
import { setPath } from "@/lib/editor/paths";

export class ToolCallError extends Error {}

function args(rawArgs: unknown): Record<string, unknown> {
  return (rawArgs ?? {}) as Record<string, unknown>;
}

function requireString(a: Record<string, unknown>, key: string): string {
  const v = a[key];
  if (typeof v !== "string") throw new ToolCallError(`"${key}" must be a string`);
  return v;
}

function requireNumber(a: Record<string, unknown>, key: string): number {
  const v = a[key];
  if (typeof v !== "number") throw new ToolCallError(`"${key}" must be a number`);
  return v;
}

function optionalNumber(a: Record<string, unknown>, key: string): number | null {
  const v = a[key];
  if (v == null) return null;
  if (typeof v !== "number") throw new ToolCallError(`"${key}" must be a number or omitted`);
  return v;
}

function requireDir(a: Record<string, unknown>, key: string): -1 | 1 {
  const v = requireNumber(a, key);
  if (v !== -1 && v !== 1) throw new ToolCallError(`"${key}" must be -1 or 1`);
  return v;
}

async function mutate(deckId: string, f: (doc: DeckDoc) => DeckDoc): Promise<DeckDoc> {
  const doc = await loadDeck(deckId);
  const next = f(doc);
  const v = validateDeckDoc(next);
  if (!v.ok) throw new ToolCallError(`resulting deck would be invalid: ${v.errors.join(", ")}`);
  await saveDeck(next);
  return next;
}

export async function callTool(name: string, rawArgs: unknown): Promise<DeckDoc | { decks: Awaited<ReturnType<typeof listDecks>> }> {
  const a = args(rawArgs);

  if (name === "list_decks") return { decks: await listDecks() };

  const deckId = requireString(a, "deck_id");

  switch (name) {
    case "read_deck":
      return loadDeck(deckId);
    case "insert_beat_after":
      return mutate(deckId, (doc) => insertBeatAfter(doc, requireNumber(a, "beat_index")));
    case "duplicate_beat_at":
      return mutate(deckId, (doc) => duplicateBeatAt(doc, requireNumber(a, "beat_index")));
    case "delete_beat_at":
      return mutate(deckId, (doc) => deleteBeatAt(doc, requireNumber(a, "beat_index")));
    case "move_beat_by":
      return mutate(deckId, (doc) => moveBeatBy(doc, requireNumber(a, "beat_index"), requireDir(a, "dir")));
    case "append_scene":
      return mutate(deckId, (doc) => appendScene(doc));
    case "delete_scene_at":
      return mutate(deckId, (doc) => deleteSceneAt(doc, requireNumber(a, "beat_index")));
    case "insert_action_after":
      return mutate(deckId, (doc) =>
        insertActionAfter(doc, requireNumber(a, "beat_index"), optionalNumber(a, "action_index"), requireString(a, "kind")));
    case "duplicate_action_at":
      return mutate(deckId, (doc) => duplicateActionAt(doc, requireNumber(a, "beat_index"), requireNumber(a, "action_index")));
    case "delete_action_at":
      return mutate(deckId, (doc) => deleteActionAt(doc, requireNumber(a, "beat_index"), requireNumber(a, "action_index")));
    case "move_action_by":
      return mutate(deckId, (doc) => moveActionBy(doc, requireNumber(a, "beat_index"), requireNumber(a, "action_index"), requireDir(a, "dir")));
    case "convert_action_kind":
      return mutate(deckId, (doc) => convertActionKind(doc, requireNumber(a, "beat_index"), requireNumber(a, "action_index"), requireString(a, "new_kind")));
    case "update_action":
      return mutate(deckId, (doc) => {
        const beatIndex = requireNumber(a, "beat_index");
        const actionIndex = requireNumber(a, "action_index");
        const loc = beatLocation(doc, beatIndex);
        if (!loc) throw new ToolCallError(`no beat at index ${beatIndex}`);
        const path = requireString(a, "path");
        const value = a.value;
        return {
          ...doc,
          scenes: doc.scenes.map((s, si) => si !== loc.sceneIdx ? s : {
            ...s,
            beats: s.beats.map((b, bi) => bi !== loc.beatIdx ? b : {
              ...b,
              timeline: b.timeline.map((act, ai) => ai !== actionIndex ? act : setPath(act, path, value)),
            }),
          }),
        };
      });
    case "update_meta":
      return mutate(deckId, (doc) => ({ ...doc, meta: setPath(doc.meta, requireString(a, "path"), a.value) }));
    default:
      throw new ToolCallError(`unknown tool: ${name}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/mcp-tool-handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/tool-handlers.ts tests/unit/mcp-tool-handlers.test.ts
git commit -m "feat(mcp): tool handlers wrapping the existing mutation API"
```

---

### Task 5: JSON-RPC dispatch layer

**Files:**
- Create: `lib/mcp/jsonrpc.ts`
- Create: `lib/mcp/dispatch.ts`
- Test: `tests/unit/mcp-dispatch.test.ts`

**Interfaces:**
- Consumes: `TOOL_DEFS` (Task 3), `callTool`/`ToolCallError` (Task 4).
- Produces: from `lib/mcp/jsonrpc.ts` — `interface JsonRpcRequest { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown }`, `type JsonRpcResponse` (success or error), `errorResponse(id, code, message)`, `successResponse(id, result)`, error-code constants `PARSE_ERROR`, `INVALID_REQUEST`, `METHOD_NOT_FOUND`, `INVALID_PARAMS`, `INTERNAL_ERROR`. From `lib/mcp/dispatch.ts` — `async function dispatch(msg: JsonRpcRequest): Promise<JsonRpcResponse | null>` — consumed by Task 6's route handler.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp-dispatch.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mcp-dispatch.test.ts`
Expected: FAIL — `Cannot find module '@/lib/mcp/dispatch'`.

- [ ] **Step 3: Implement the JSON-RPC types**

Create `lib/mcp/jsonrpc.ts`:

```ts
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcErrorResponse;

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export function errorResponse(id: string | number | null, code: number, message: string): JsonRpcErrorResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function successResponse(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}
```

- [ ] **Step 4: Implement the dispatcher**

Create `lib/mcp/dispatch.ts`:

```ts
import { TOOL_DEFS } from "./tool-defs";
import { callTool, ToolCallError } from "./tool-handlers";
import {
  errorResponse, successResponse,
  INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR,
  type JsonRpcRequest, type JsonRpcResponse,
} from "./jsonrpc";

const SERVER_INFO = { name: "morgana", version: "0.1.0" };

/** Handle one parsed JSON-RPC message. Returns null for notifications (no response expected). */
export async function dispatch(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;

  if (msg.method === "notifications/initialized") return null;

  if (typeof msg.method !== "string") {
    return errorResponse(id, INVALID_REQUEST, "missing method");
  }

  if (msg.method === "initialize") {
    const params = (msg.params ?? {}) as { protocolVersion?: string };
    return successResponse(id, {
      protocolVersion: params.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (msg.method === "tools/list") {
    return successResponse(id, { tools: TOOL_DEFS });
  }

  if (msg.method === "tools/call") {
    const params = (msg.params ?? {}) as { name?: string; arguments?: unknown };
    if (typeof params.name !== "string") {
      return errorResponse(id, INVALID_REQUEST, 'tools/call requires a string "name"');
    }
    try {
      const result = await callTool(params.name, params.arguments);
      return successResponse(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (err) {
      if (err instanceof ToolCallError) {
        return successResponse(id, { content: [{ type: "text", text: err.message }], isError: true });
      }
      return errorResponse(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
    }
  }

  return errorResponse(id, METHOD_NOT_FOUND, `unknown method: ${msg.method}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/mcp-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/jsonrpc.ts lib/mcp/dispatch.ts tests/unit/mcp-dispatch.test.ts
git commit -m "feat(mcp): JSON-RPC dispatch layer (initialize/tools-list/tools-call)"
```

---

### Task 6: MCP HTTP route (Streamable HTTP, bearer auth)

**Files:**
- Create: `app/api/mcp/route.ts`
- Test: `tests/unit/api-mcp.test.ts`

**Interfaces:**
- Consumes: `dispatch` (Task 5), `errorResponse`/`INVALID_REQUEST`/`PARSE_ERROR`/`type JsonRpcRequest` (Task 5), `verifyToken` (Task 1).
- Produces: `POST`/`GET` route handlers at `/api/mcp` — this is the externally-facing endpoint the user configures in claude.ai/Desktop.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api-mcp.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/api-mcp.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/mcp/route'`.

- [ ] **Step 3: Implement the route**

Create `app/api/mcp/route.ts`:

```ts
import { dispatch } from "@/lib/mcp/dispatch";
import { verifyToken } from "@/lib/store/mcp-auth";
import { errorResponse, INVALID_REQUEST, PARSE_ERROR, type JsonRpcRequest } from "@/lib/mcp/jsonrpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerFrom(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function POST(req: Request) {
  if (!(await verifyToken(bearerFrom(req)))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(errorResponse(null, PARSE_ERROR, "invalid JSON body"), { status: 200 });
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const raw of messages) {
    const msg = raw as JsonRpcRequest;
    if (msg?.jsonrpc !== "2.0" || typeof msg?.method !== "string") {
      responses.push(errorResponse(msg?.id ?? null, INVALID_REQUEST, "invalid JSON-RPC message"));
      continue;
    }
    const res = await dispatch(msg);
    if (res) responses.push(res);
  }

  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? responses : responses[0]);
}

export async function GET() {
  return Response.json({ error: "this MCP server does not support server-initiated streams" }, { status: 405 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/api-mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite + type-check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/mcp/route.ts tests/unit/api-mcp.test.ts
git commit -m "feat(mcp): Streamable HTTP route with bearer auth"
```

---

### Task 7: Settings panel — server URL + token

**Files:**
- Create: `components/editor/McpPanel.tsx`
- Modify: `app/editor/page.tsx`
- Test: `tests/unit/mcp-panel.test.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/mcp-token` (Task 1, via `fetch`).
- Produces: `McpPanel` component, exported for use in `app/editor/page.tsx`'s panel switch.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp-panel.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { McpPanel } from "@/components/editor/McpPanel";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const token = init?.method === "POST" ? "regenerated-token" : "initial-token";
    return { ok: true, json: async () => ({ token }) } as Response;
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("loads and displays a masked token, with the URL visible", async () => {
  render(<McpPanel />);
  await waitFor(() => expect(screen.getByTestId("mcp-token")).toHaveValue("initial-token"));
  expect(screen.getByTestId("mcp-token")).toHaveAttribute("type", "password");
  expect((screen.getByTestId("mcp-url") as HTMLInputElement).value).toContain("/api/mcp");
});

test("Reveal toggles the token's visibility", async () => {
  render(<McpPanel />);
  await waitFor(() => expect(screen.getByTestId("mcp-token")).toHaveValue("initial-token"));
  fireEvent.click(screen.getByTestId("mcp-reveal"));
  expect(screen.getByTestId("mcp-token")).toHaveAttribute("type", "text");
});

test("Regenerate fetches and displays a new token", async () => {
  render(<McpPanel />);
  await waitFor(() => expect(screen.getByTestId("mcp-token")).toHaveValue("initial-token"));
  fireEvent.click(screen.getByTestId("mcp-regenerate"));
  await waitFor(() => expect(screen.getByTestId("mcp-token")).toHaveValue("regenerated-token"));
});

test("Copy writes the current token to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<McpPanel />);
  await waitFor(() => expect(screen.getByTestId("mcp-token")).toHaveValue("initial-token"));
  fireEvent.click(screen.getByTestId("mcp-copy"));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("initial-token"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/mcp-panel.test.tsx`
Expected: FAIL — `Cannot find module '@/components/editor/McpPanel'`.

- [ ] **Step 3: Implement the panel**

Create `components/editor/McpPanel.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/mcp-token");
  return (await res.json()).token as string;
}

async function regenerateToken(): Promise<string> {
  const res = await fetch("/api/mcp-token", { method: "POST" });
  return (await res.json()).token as string;
}

export function McpPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy");

  useEffect(() => { fetchToken().then(setToken); }, []);

  const url = typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "/api/mcp";

  const onRegenerate = async () => {
    setToken(await regenerateToken());
    setRevealed(true);
  };

  const onCopy = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopyLabel("Copied");
    setTimeout(() => setCopyLabel("Copy"), 1500);
  };

  return (
    <div className="ed__inspector" data-testid="mcp-panel">
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14, marginBottom: 11 }}>Connect Claude</div>
      <p style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
        Add this as an MCP connector in claude.ai or Claude Desktop to let Claude read and edit this deck,
        using your own Claude account. Morgana never sees or stores your Anthropic credentials.
      </p>
      <label style={{ fontSize: 12, opacity: 0.75 }}>Server URL</label>
      <input readOnly value={url} data-testid="mcp-url" style={{ width: "100%", fontFamily: "var(--ed-mono)", fontSize: 12, marginBottom: 8 }} />
      <label style={{ fontSize: 12, opacity: 0.75 }}>Token</label>
      <input
        readOnly
        type={revealed ? "text" : "password"}
        value={token ?? ""}
        data-testid="mcp-token"
        style={{ width: "100%", fontFamily: "var(--ed-mono)", fontSize: 12, marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="ed__pill ed__pill--ghost" data-testid="mcp-reveal" onClick={() => setRevealed((r) => !r)}>{revealed ? "Hide" : "Reveal"}</button>
        <button className="ed__pill ed__pill--ghost" data-testid="mcp-copy" onClick={onCopy}>{copyLabel}</button>
        <button className="ed__pill ed__pill--ghost" data-testid="mcp-regenerate" onClick={onRegenerate}>Regenerate</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/mcp-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the panel into the editor toolbar**

In `app/editor/page.tsx`:

1. Add the import:

```ts
import { McpPanel } from "@/components/editor/McpPanel";
```

2. Extend the `Panel` type and add a toggle button — change:

```ts
type Panel = "inspector" | "settings" | "export";
```

to:

```ts
type Panel = "inspector" | "settings" | "export" | "mcp";
```

3. Add a toggle button next to the existing "Export" button (find the line `<button className="ed__pill ed__pill--ghost" data-testid="export-toggle" ...>Export</button>` and add immediately after it):

```tsx
<button className="ed__pill ed__pill--ghost" data-testid="mcp-toggle" onClick={() => togglePanel("mcp")}>Connect Claude</button>
```

4. Extend the panel switch — change:

```tsx
{panel === "settings" ? <DeckSettings /> : panel === "export" ? <ExportPanel /> : <Inspector />}
```

to:

```tsx
{panel === "settings" ? <DeckSettings /> : panel === "export" ? <ExportPanel /> : panel === "mcp" ? <McpPanel /> : <Inspector />}
```

- [ ] **Step 6: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/editor/McpPanel.tsx app/editor/page.tsx tests/unit/mcp-panel.test.tsx
git commit -m "feat(mcp): settings panel for the MCP server URL + token"
```

---

### Task 8: External-change polling + non-destructive reload prompt

**Files:**
- Create: `lib/editor/use-external-change-poll.ts`
- Modify: `app/editor/page.tsx`
- Test: `tests/unit/use-external-change-poll.test.ts`

**Interfaces:**
- Consumes: `GET /api/decks/[id]/meta` (Task 2, via `fetch`).
- Produces: `function useExternalChangePoll(deckId: string | null, intervalMs?: number): { changed: boolean; dismiss(): void; resync(): void }` — consumed by `app/editor/page.tsx`.

**Note on scope:** this is a best-effort notice, not a conflict-resolution system (matches the spec's single-user/linear-history positioning — no real-time merge). There's a small window where the polling hook can show a transient false-positive right as a local autosave lands (its own `resync()` call race with an in-flight poll tick); it self-corrects within one poll interval. This is an accepted trade-off, not a bug to chase further.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-external-change-poll.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useExternalChangePoll } from "@/lib/editor/use-external-change-poll";

let mtime = 1000;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mtime = 1000;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ mtimeMs: mtime }) } as Response)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("flags changed once the polled mtime moves", async () => {
  const { result } = renderHook(() => useExternalChangePoll("demo", 100));
  await waitFor(() => expect(result.current.changed).toBe(false));

  mtime = 2000;
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(result.current.changed).toBe(true);
});

test("dismiss clears the flag without changing the baseline", async () => {
  const { result } = renderHook(() => useExternalChangePoll("demo", 100));
  await waitFor(() => expect(result.current.changed).toBe(false));
  mtime = 2000;
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(result.current.changed).toBe(true);
  act(() => result.current.dismiss());
  expect(result.current.changed).toBe(false);
});

test("resync adopts the current mtime as the new baseline", async () => {
  const { result } = renderHook(() => useExternalChangePoll("demo", 100));
  await waitFor(() => expect(result.current.changed).toBe(false));
  mtime = 2000;
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(result.current.changed).toBe(true);

  await act(async () => { result.current.resync(); await Promise.resolve(); await Promise.resolve(); });
  expect(result.current.changed).toBe(false);

  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(result.current.changed).toBe(false);
});

test("does nothing when deckId is null", async () => {
  const { result } = renderHook(() => useExternalChangePoll(null, 100));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(result.current.changed).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/use-external-change-poll.test.ts`
Expected: FAIL — `Cannot find module '@/lib/editor/use-external-change-poll'`.

- [ ] **Step 3: Implement the hook**

Create `lib/editor/use-external-change-poll.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";

export interface ExternalChangeState {
  changed: boolean;
  dismiss: () => void;
  resync: () => void;
}

/** Polls a deck's on-disk mtime and flags when it moves without going through `resync()` —
 *  i.e., something other than this tab's own autosave wrote the file (an MCP-driven edit).
 *  Never reloads on its own; the caller decides what "changed" means (e.g. a reload prompt). */
export function useExternalChangePoll(deckId: string | null, intervalMs = 4000): ExternalChangeState {
  const [changed, setChanged] = useState(false);
  const knownMtime = useRef<number | null>(null);
  const resyncing = useRef(false);

  const fetchMtime = useCallback(async (): Promise<number | null> => {
    if (!deckId) return null;
    try {
      const res = await fetch(`/api/decks/${deckId}/meta`);
      if (!res.ok) return null;
      return (await res.json()).mtimeMs as number;
    } catch {
      return null;
    }
  }, [deckId]);

  const resync = useCallback(() => {
    resyncing.current = true;
    fetchMtime().then((mtimeMs) => {
      if (mtimeMs != null) knownMtime.current = mtimeMs;
      setChanged(false);
      resyncing.current = false;
    });
  }, [fetchMtime]);

  useEffect(() => {
    knownMtime.current = null;
    setChanged(false);
  }, [deckId]);

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    const tick = async () => {
      if (resyncing.current) return;
      const mtimeMs = await fetchMtime();
      if (mtimeMs == null || cancelled) return;
      if (knownMtime.current == null) knownMtime.current = mtimeMs;
      else if (mtimeMs !== knownMtime.current) setChanged(true);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [deckId, intervalMs, fetchMtime]);

  return { changed, dismiss: () => setChanged(false), resync };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/use-external-change-poll.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the hook into the editor page**

In `app/editor/page.tsx`:

1. Add the import:

```ts
import { useExternalChangePoll } from "@/lib/editor/use-external-change-poll";
```

2. Track the current deck id in state. Change the deck-load effect — find:

```ts
useEffect(() => {
  const id = new URLSearchParams(window.location.search).get("deck") ?? "demo";
  loadDeck(id).then(load).catch((e) => { console.error("failed to load deck", e); setLoadError(true); });
}, [load]);
```

to:

```ts
const [deckId, setDeckId] = useState<string | null>(null);
useEffect(() => {
  const id = new URLSearchParams(window.location.search).get("deck") ?? "demo";
  setDeckId(id);
  loadDeck(id).then(load).catch((e) => { console.error("failed to load deck", e); setLoadError(true); });
}, [load]);
```

3. Call the polling hook and resync it after a local save completes. Change:

```ts
const onStatus = useCallback((s: SaveStatus) => setStatus(s), []);
useAutosave(doc, revision, onStatus);
```

to:

```ts
const externalChange = useExternalChangePoll(deckId);
const onStatus = useCallback((s: SaveStatus) => {
  setStatus(s);
  if (s === "saved") externalChange.resync();
}, [externalChange]);
useAutosave(doc, revision, onStatus);
```

4. Add a reload handler and the banner. After the `onTime` callback definition (`const onTime = useCallback(...)`), add:

```ts
const onReloadExternal = useCallback(() => {
  if (!deckId) return;
  loadDeck(deckId).then(load).then(() => externalChange.resync());
}, [deckId, load, externalChange]);
```

Then, immediately inside the returned JSX's top-level `<div className="ed">`, before `<div className="ed__bar">`, add:

```tsx
{externalChange.changed && (
  <div className="ed__pill ed__pill--ghost" data-testid="external-change-banner" style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
    Deck changed externally.{" "}
    <button data-testid="external-change-reload" onClick={onReloadExternal}>Reload</button>{" "}
    <button data-testid="external-change-dismiss" onClick={externalChange.dismiss}>Dismiss</button>
  </div>
)}
```

- [ ] **Step 6: Run the full unit suite + type-check**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all PASS, no type errors.

- [ ] **Step 7: Manual verification**

Run `npm run dev`, open the editor for a deck in two ways at once: the browser tab, and a `curl` POST against `/api/mcp` (using the token from the settings panel) calling `append_scene`. Confirm the banner appears in the browser tab within the poll interval, and that clicking Reload picks up the new scene without a full page refresh.

- [ ] **Step 8: Commit**

```bash
git add lib/editor/use-external-change-poll.ts app/editor/page.tsx tests/unit/use-external-change-poll.test.ts
git commit -m "feat(mcp): poll for external deck changes and prompt to reload"
```

---

### Task 9: Docs — connecting Claude to Morgana

**Files:**
- Modify: `README.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add the meta endpoint to the existing API table**

In `README.md`, find:

```
| `DELETE /api/decks/[id]` | Delete a deck. |
```

and add immediately after it:

```
| `GET /api/decks/[id]/meta` | Deck file's on-disk `mtimeMs` (used to detect external changes). |
```

- [ ] **Step 2: Note the token file in the storage layout**

Find:

```
<MORGANA_DATA_DIR>/
  decks/      <id>.deck.json     # one file per deck (gitignored; never committed)
```

and change to:

```
<MORGANA_DATA_DIR>/
  decks/      <id>.deck.json     # one file per deck (gitignored; never committed)
  mcp-token.json                 # bearer token for the MCP server (gitignored; never committed)
```

- [ ] **Step 3: Add a new "Connect Claude (MCP)" section**

Find the `---` line immediately before `## Tests & checks` and insert this new section before it:

```markdown
## Connect Claude (MCP)

Morgana exposes its editing API as an MCP server at `/api/mcp` (Streamable HTTP, JSON-RPC 2.0),
so your own Claude — claude.ai (Connectors) or Claude Desktop — can read and edit a deck directly,
using your own Claude subscription. Morgana never calls the Anthropic API and never stores an
Anthropic credential: the only secret involved is a bearer token Morgana generates for itself, to
decide who's allowed to hit `/api/mcp`.

1. Open a deck in the editor and click **Connect Claude** in the toolbar.
2. Copy the **Server URL** and **Token** shown there (regenerate the token any time — this
   immediately invalidates the old one).
3. In claude.ai, add a connector pointing at the server URL, using the token as its bearer
   credential (Claude Desktop: add it under MCP servers, same URL + token). Consult Anthropic's
   current documentation for the exact steps in your client, since connector UI changes over time.
4. Ask Claude to read or edit the deck — e.g. "read the deck and summarize its beats" or "add a new
   scene." Every edit lands as one ordinary undo entry, exactly like a change made in the UI, and is
   validated the same way; destructive actions (deleting a scene or action) are flagged to your
   Claude client so it can confirm with you before applying them.
5. If you have the deck open in a browser tab while Claude edits it, Morgana polls for the change
   and offers a "reload" prompt rather than overwriting either side silently.

Tool surface: `list_decks`, `read_deck`, beat operations (`insert_beat_after`, `duplicate_beat_at`,
`delete_beat_at`, `move_beat_by`), scene operations (`append_scene`, `delete_scene_at`), and action
operations (`insert_action_after`, `duplicate_action_at`, `delete_action_at`, `move_action_by`,
`convert_action_kind`, `update_action`, `update_meta`) — see [`lib/mcp/tool-defs.ts`](lib/mcp/tool-defs.ts)
for the exact schemas.

---

```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document connecting Claude to Morgana via MCP"
```

---

### Task 10: Deep-dive doc sync (closeout)

**Files:** None owned by this plan — this task is a pointer to a cross-repo doc.

**Interfaces:** None.

- [ ] **Step 1: Invoke the deep-dive sync skill**

At the end of this plan's execution, invoke the `mm-deepdive-sync` skill for this repo. The branch adds a new cross-repo-relevant capability (an MCP server other MM tooling could theoretically point at, though none currently does) and retires the end-state design's §12 in-app-assistant sketch — both are the kind of change `MM_MORGANA.md` is meant to capture. Let the skill decide whether the deep-dive needs an edit or whether a "no change needed" note in the PR body is sufficient; do not fabricate a doc change if the skill determines none is needed.

- [ ] **Step 2: Note the §12 supersession in the end-state design**

In `docs/2026-06-29-morgana-end-state-design.md`, find §12's heading:

```
## 12. In-app AI assistant (authenticated, tool-driven)
```

and insert immediately after it (before the existing `**Vision.**` paragraph):

```markdown
> **Superseded 2026-07-23** — see [`docs/superpowers/specs/2026-07-23-morgana-mcp-server-design.md`](superpowers/specs/2026-07-23-morgana-mcp-server-design.md).
> The auth model this section assumed ("Log in with Claude" OAuth for third-party apps) does not
> exist as a public Anthropic product. The shipped design instead makes Morgana an MCP server that
> the user's own Claude client (claude.ai/Desktop) connects to directly — no Anthropic credential
> ever passes through Morgana. The rest of this section is kept for its guardrail/UX thinking
> (batched undo, confirm-gated destructive ops), which may still be relevant if a public third-party
> Claude sign-in product appears and an in-app docked assistant becomes buildable.
```

- [ ] **Step 3: Commit**

```bash
git add docs/2026-06-29-morgana-end-state-design.md
git commit -m "docs: mark end-state §12 as superseded by the MCP server design"
```
