# Morgana MCP Server — Design Spec

- **Date:** 2026-07-23
- **Status:** Design spec (approved for planning)
- **Author of record:** Chris Oltyan (brainstormed with Claude)
- **Companion docs:**
  - `MM_MORGANA.md` (the cross-repo deep-dive, in the private `mm-documents` repo — not linkable from this public repo) — positioning and cross-repo contracts.
  - [`../2026-06-29-morgana-end-state-design.md`](../2026-06-29-morgana-end-state-design.md) — north star; §12 sketched an "in-app AI assistant" whose architecture this spec **supersedes** (see §0 below).
  - [`../../lib/editor/mutations.ts`](../../lib/editor/mutations.ts), [`../../lib/editor/registry.ts`](../../lib/editor/registry.ts), [`../../lib/editor/store.ts`](../../lib/editor/store.ts) — the existing mutation API and descriptor registry this spec exposes.

---

## 0. Context — why this supersedes §12

The end-state design's §12 ("In-app AI assistant") sketched a **docked chat panel** where Morgana itself runs the agentic loop server-side, holding either a short-lived OAuth bearer token (via a "Log in with Claude" flow) or a bring-your-own Anthropic API key, and streaming Claude's tool calls into the UI.

That design assumed a public third-party "Sign in with Claude" OAuth product exists. It does not: Anthropic's current API surface has no client-registration/authorization-server mechanism for third-party apps to let a user "sign in with their Claude account" the way Sign-in-with-Google works. The OAuth flows that do exist (`ant auth login`, the CLI's bearer-token path) authenticate a specific pre-registered Anthropic client (the CLI / Claude Code), not an extensible pattern Morgana could register against.

Given that, and given the explicit preference to have **no Anthropic credential of any kind pass through or rest in Morgana**, this spec replaces §12's architecture entirely:

**Morgana becomes an MCP server.** The user's own Claude client — claude.ai (Connectors) or Claude Desktop — connects to it directly, authenticated with their own Claude subscription on Anthropic's side. Morgana exposes its existing mutation API as MCP tools; it never calls the Anthropic API, never proxies model traffic, and never sees an Anthropic credential. This is a much smaller build than §12 — no agentic loop, no streaming UI, no credential custody — and it fits the "standalone OSS, no infra-specific coupling" positioning better than a server-side AI integration would.

§12 is retired by this spec for the "AI assistant" feature area. If an in-app docked chat panel becomes desirable later, it would need its own spec once (if ever) a real third-party sign-in product exists.

## 1. Scope

### 1.1 In scope

1. A Streamable HTTP MCP server mounted in the Next.js app, exposing:
   - A read tool for current deck state, plus a `list_decks` tool.
   - One MCP tool per existing pure mutation in `lib/editor/mutations.ts` and the relevant `store.ts` update methods. Since the server is stateless per HTTP request (no session tying a connection to "the current deck"), every tool takes a `deck_id` argument directly rather than modeling deck switching as server-side state — simpler than the "switch_deck" sketch below and needs no new backend concept beyond what `list_decks` already exposes.
2. Bearer-token auth for the MCP endpoint: generated on first run, viewable/regenerable from a settings panel, required on every MCP request.
3. A minimal settings/status panel in the editor UI: server URL + token display, regenerate action, connection status if the transport exposes it. **Not** a chat UI.
4. MCP tool annotations (`destructiveHint` etc.) on destructive tools so the connecting host (claude.ai/Desktop) applies its own confirmation UX.
5. Docs: a short in-repo guide for connecting claude.ai/Desktop to a running Morgana instance.

### 1.2 Out of scope

- Any in-app chat/dock UI. The user talks to Claude in Claude's own client; Morgana's UI is the live canvas that reflects the resulting edits, same as it reflects a human editing.
- Any Anthropic API key or OAuth handling inside Morgana.
- Any server-side agentic loop, streaming, or Messages API usage.
- Generative "draft a 5-beat intro"-style prompting UX — this is free (Claude composes multiple tool calls on its own), so there's no additional design surface for it here.
- Per-deck scoped tokens (§4 records this as a possible future refinement, not part of this spec).
- stdio transport / local-process MCP config. Streamable HTTP is the only transport this spec builds, since it's what both claude.ai connectors and a container-deployed instance need; Desktop users on the same machine can use the same HTTP endpoint at `localhost`.

## 2. Architecture

```
                    ┌─────────────────────────────┐
 claude.ai (web) ───┤                             │
   or               │   Morgana container         │
 Claude Desktop ─────►  /api/mcp  (Streamable HTTP)│
  (user's own        │       │                     │
   subscription,     │       ▼                     │
   their own login)  │  MCP tool handlers           │
                    │       │                       │
                    │       ▼                       │
                    │  lib/editor/mutations.ts       │
                    │  lib/editor/store.ts           │
                    │       │                        │
                    │       ▼                        │
                    │  DeckDoc (validated,            │
                    │   persisted to MORGANA_DATA_DIR)│
                    │       │                         │
                    │       ▼                         │
                    │  Existing editor UI              │
                    │  (filmstrip/canvas/timeline)      │
                    │  — reloads when it polls and       │
                    │    notices the file changed        │
                    └─────────────────────────────┘
```

Key property: **the MCP tool handlers are a second caller of the exact same mutation functions the UI already calls**, but against the *persisted* `DeckDoc` (`lib/store/deck-store.ts`), not the browser's in-memory `useEditor` Zustand store — that store is browser-only, loaded once on mount, with no existing mechanism to notice an external file write. There is no parallel mutation path or new persistence format, but there **is** a small new sync mechanism: the editor polls the deck's on-disk mtime and offers a non-destructive "reload?" prompt when it moves without a matching local save (§6). This was not obvious going in — an earlier draft of this spec assumed the browser would "just" pick up external edits, which isn't true given how `app/editor/page.tsx` loads a deck.

## 3. Tool surface

Each tool wraps one existing pure function. `input_schema` is generated from the same field descriptors that drive the inspector (`lib/editor/registry.ts`) wherever a mutation's arguments map onto action/beat fields already described there; mutations with primitive args (indices, ids) get a small hand-written schema.

| Tool | Wraps | Notes |
| --- | --- | --- |
| `read_deck` | current `DeckDoc` (via store), given `deck_id` | Full JSON; a later refinement could add scoped `get_scene`/`get_beat` if payload size becomes an issue — not needed for the initial deck sizes Morgana targets. |
| `list_decks` | existing deck listing | Every other tool also takes `deck_id` directly (see §2) — there's no separate "switch" tool or server-side current-deck state. |
| `insert_beat_after`, `duplicate_beat_at`, `delete_beat_at`, `move_beat_by` | `mutations.ts` | |
| `append_scene`, `delete_scene_at` | `mutations.ts` | `delete_scene_at` marked `destructiveHint`. |
| `insert_action_after`, `insert_action_at`, `duplicate_action_at`, `delete_action_at`, `move_action_by`, `convert_action_kind` | `mutations.ts` | `delete_action_at` marked `destructiveHint`. |
| `update_action`, `update_meta` | `store.ts` | |

Every tool call is applied through the store exactly as a UI action would be, so it lands as one ordinary undo/redo entry and runs through `validateDeckDoc` like any human edit. No new safety mechanism is built for this — it rides entirely on what Tier 1.5 already shipped.

## 4. Auth

- On first run (no token on disk under `MORGANA_DATA_DIR`), Morgana generates a random bearer token and persists it alongside deck data.
- The settings panel displays the token (with a copy affordance) and a "regenerate" action that invalidates the old token immediately.
- Every request to `/api/mcp` must carry `Authorization: Bearer <token>`; a missing/invalid token is a 401, no partial access.
- **Recorded as a future refinement, not in scope now:** per-deck tokens, for multi-tenant or shared-instance scenarios. Out of scope per §1.2 — the instance-wide token matches Morgana's single-user positioning.

## 5. Guardrails

- **Undo/redo:** free — every tool call is a normal mutation call, so it's a normal undo entry, tagged the same as any other edit (no separate "AI-authored" marker is planned; if that provenance turns out to matter later, it's a small addition to the mutation call site, not an architecture change).
- **Validation:** free — `validateDeckDoc` already runs after every mutation; an MCP-driven edit that would produce an invalid deck fails the same way a UI-driven one would.
- **Destructive-action confirmation:** delegated to the connecting host via MCP tool annotations (`destructiveHint: true` on `delete_scene_at` and `delete_action_at`). Morgana does not build its own confirm-gate UI — claude.ai and Claude Desktop already have their own per-tool-call approval UX, and building a second one in Morgana would duplicate that without adding safety (the mutation is still just one undo entry either way).

## 6. UI surface (the "shell")

A new settings section (not a new top-level page) showing:
- MCP server URL (`http(s)://<host>/api/mcp`)
- Bearer token, masked by default, with reveal/copy/regenerate
- A short "how to connect" blurb linking to the in-repo guide (§8)

No chat transcript, no message history, no streaming — Claude's own client is where the conversation happens. What **is** new: since the browser's editor state doesn't otherwise notice an MCP-driven edit landing on disk, the open tab polls the deck's mtime (a small new endpoint, `GET /api/decks/[id]/meta`) and shows a "deck changed externally — reload?" banner rather than silently clobbering either side. This is deliberately non-destructive rather than an auto-reload, so a human mid-edit in the browser is never silently overwritten by a Claude-driven change landing at the same time.

## 7. Testing

- **Unit:** each MCP tool handler → thin wrapper test asserting it calls the right mutation with the right args and returns the right shape; no need to re-test the mutations themselves (already covered).
- **Auth:** request with no/expired/wrong token → 401; correct token → 200.
- **Integration:** a small in-process MCP client (or raw HTTP against the Streamable HTTP endpoint) driving a couple of tool calls end-to-end against a fixture deck, asserting the resulting `DeckDoc` and that it round-trips through `validateDeckDoc`.
- **Manual/e2e:** connect an actual Claude Desktop instance to a locally running Morgana and drive a real edit — recorded as a manual verification step, not automated (no CI harness for driving claude.ai/Desktop exists in this repo).

## 8. Docs

A short section (README or `docs/`) on: starting Morgana, finding the token in settings, adding it as a connector in claude.ai / Claude Desktop, and what Claude can and can't do (the tool list above).

## 9. Consequences & follow-ons

- §12 in the end-state design is superseded for the "AI assistant" area; a follow-up edit to that doc (or a note in the MM deep-dive) should point here. Not done as part of this spec — flagged for whoever picks up the implementation plan to include as a doc-sync step.
- If Anthropic ships a public third-party "Sign in with Claude" product later, an in-app docked assistant becomes buildable without violating "no credential in Morgana" — that would be a new spec, not a revival of the old §12 sketch, since the guardrail/UX thinking in §12 (batched undo for generative turns, confirm cards) may still be reusable even though the auth model changes.
- Per-deck tokens, scoped `get_scene`/`get_beat` reads, and an "AI-authored" undo-entry tag are recorded above as possible future refinements, explicitly deferred.
