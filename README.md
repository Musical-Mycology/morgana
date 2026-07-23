# Morgana

> A web editor for cinematic, data-driven slide decks. *(Early development — see [`docs/`](docs/).)*

**Morgana** is an open-source, self-hostable visual editor for a cinematic presentation
engine. Decks are authored as **data** — `Scene → Beat → Action[]` — and interpreted by a
vendored GSAP + tsParticles render engine. Morgana puts a four-zone editor on top of that
same data model: a **filmstrip** of beats, a **WYSIWYG canvas**, a **schema-driven property
inspector**, and a **per-beat timeline** with a scrubbable playhead — so what you edit maps
directly onto what the engine plays.

It runs as a single Node container, needs no database, and stores every deck as portable
JSON on a mounted volume. It is a **generic, easy-to-deploy tool** — there is no
infrastructure-specific coupling in this repo.

The name: *Morgana* (Fata Morgana — the mirage that builds castles in the air).

---

## The deck format

A deck is one JSON document. The shape is the engine's own data model, so loading a deck is
just `JSON.parse` — no transform step:

```jsonc
{
  "version": 1,
  "meta": { "id": "demo", "title": "Morgana Demo" },
  "scenes": [
    { "id": "open", "beats": [
      { "id": "b1", "timeline": [
        { "kind": "text", "value": "Welcome to Morgana", "in": "flyUp" }
      ] },
      { "id": "b2", "timeline": [
        { "kind": "text", "value": "Build shows as data.", "in": "fade" },
        { "kind": "wait", "ms": 300 },
        { "kind": "text", "value": "Scrub the timeline.", "in": "fade" }
      ] }
    ] }
  ]
}
```

- **`Scene`** groups beats and can carry a visual `treatment`.
- **`Beat`** is the unit of interaction (one click to advance). Its `timeline` is an array of
  **`Action`s** that auto-plays and is segmented at `click_gate` boundaries into pause points.
- **`Action`** is a tagged union keyed on `kind`. The engine supports a broad action set —
  text reveals (`text`, `rotateList`), background `nightlight` gradient tweens, `art` panel
  transitions, running-total counters (`counter_show` / `counter_to` / `counter_add`),
  positioned `media` tiles (`media` / `media_move`), note/particle emitters
  (`note_emitter`, `note_circle`), flow control (`wait`, `click_gate`, `clear`, `fade_out`),
  and more. The editable fields for each kind come from the **effect-descriptor registry**
  ([`lib/editor/registry.ts`](lib/editor/registry.ts)), which is the single source of truth
  for the inspector.

Text is positioned with a normalized `pos` point `{ x, y }` (0–1) on a fixed 16:9 stage.

---

## What's in the editor today

Open `/editor`. The bundled **demo deck** is auto-seeded on first run, so it works
immediately. The editor loads `demo` by default; append `?deck=<id>` to open another deck.

**Filmstrip (left).** Beats grouped by scene. Select any beat; on the selected beat you can
**add** a beat after it, **duplicate**, **delete**, or **move it up/down** within its scene.
**Add scene** appends a new empty scene. *(Cross-scene moves, scene reordering, and a
delete-scene button are not yet wired into the UI.)*

**Canvas (center).** Renders the selected beat — text, `art` panels, and the `nightlight`
background gradient. Drag the on-stage **position handle** to set the selected action's `pos`.
**Play/pause** and a **scrub slider** (in the timeline) drive the preview.

> **Preview fidelity (v1).** The canvas uses a lightweight, dependency-free **seek
> renderer** ([`engine/authoring/seek.ts`](engine/authoring/seek.ts)) so scrubbing is
> deterministic and instant. Text reveals and art/nightlight are **approximated**, and
> particle/note, counter, and media effects are **not drawn** under the canvas preview —
> they are authored via the inspector and run with full fidelity in the engine's GSAP
> runtime ([`engine/authoring/BeatStage.tsx`](engine/authoring/BeatStage.tsx)). Running the
> full runtime in the canvas, and deterministic particle scrubbing, are roadmap items (see
> the design doc §7.2 / §11).

**Timeline (bottom).** The selected beat's actions as chips, each showing its kind and
computed duration. Click a chip to select that action (highlighting it in the inspector and
showing its position handle on the canvas). *(Adding, deleting, reordering, or converting
actions from the timeline is not yet implemented — edit actions through the inspector and
JSON for now.)*

**Inspector (right).** Schema-driven fields generated from the selected action's descriptor —
inputs render as text/textarea/number/select/range/checkbox based on the schema. Toggle
**Deck settings** to edit deck-level `meta` (title, splash tagline/logo, footer wordmark).

**Export.** The **Export** toolbar button opens a panel with the deck serialized to a TS module
(`export const scenes: Scene[]`), with **Copy** and **Download** — the same `deckDocToModule`
bridge, now reachable from the UI. (Emits `scenes` only; import/round-trip is on the roadmap.)

**Undo/redo.** Toolbar buttons plus ⌘Z / Ctrl+Z (⇧ to redo); a 50-step history.

**Autosave.** Edits persist automatically, ~700ms after you stop typing, via the deck API to
JSON on disk. The toolbar shows the save status.

---

## Run it

### Docker (recommended)

```bash
docker compose up --build
```

Open <http://localhost:3000/editor>. The demo deck is auto-seeded into the mounted `./data`
volume on first run, so the editor works out of the box. Your decks live as JSON under
`./data/decks/` (gitignored — real decks are never committed).

### Local development

```bash
npm ci
npm run seed:demo   # copy the bundled sample decks into ./data/decks/
npm run dev         # http://localhost:3000/editor
```

### Production server (standalone, no Docker)

`docker compose` runs Next.js's standalone server (`output: "standalone"`). To run it
directly:

```bash
npm ci
npm run build
# the standalone server needs these copied beside it:
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
MORGANA_DATA_DIR="$PWD/data" node .next/standalone/server.js
```

---

## Storage & configuration

One JSON document per deck on the data volume:

```
<MORGANA_DATA_DIR>/
  decks/      <id>.deck.json     # one file per deck (gitignored; never committed)
  mcp-token.json                 # bearer token for the MCP server (gitignored; never committed)
```

> The design also reserves an `assets/` directory for future local-asset support, but asset
> upload/serving is **not implemented yet** — only `decks/` is used today.

The deck API is filesystem-backed ([`lib/store/deck-store.ts`](lib/store/deck-store.ts)):

| Method & path | Purpose |
| --- | --- |
| `GET /api/decks` | List deck metadata. |
| `POST /api/decks` | Create a new deck (`{ id, title, treatment? }`). |
| `GET /api/decks/[id]` | Load a deck document. |
| `PUT /api/decks/[id]` | Save a deck (validated; autosave uses this). |
| `DELETE /api/decks/[id]` | Delete a deck. |
| `GET /api/decks/[id]/meta` | Deck file's on-disk `mtimeMs` (used to detect external changes). |

| Env var | Default | Purpose |
| --- | --- | --- |
| `MORGANA_DATA_DIR` | `/data` (production), `./data` (dev) | Directory holding `decks/<id>.deck.json`. Resolved to an absolute path; use a writable path in production. |
| `PORT` | `3000` | Server port. |

In Docker the data dir is the mounted volume (`/data`). On first run the demo deck is seeded
**only if** no `*.deck.json` already exists — existing decks are never overwritten
([`docker-entrypoint.sh`](docker-entrypoint.sh)).

---

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

## Tests & checks

```bash
npm test             # unit tests (vitest)
npm run test:e2e     # end-to-end (Playwright)
npm run smoke:docker # build the image, run with an empty volume, assert the demo auto-seeds
npm run build        # production build
```

The e2e suite runs against **three** production servers from a single build, each with its own
isolated, freshly-seeded data directory (`.e2e/{default,standalone,library}`) so specs never
contend on shared state:

- the regular `next start` server on `:3000` (`.e2e/default`) — runs all specs except the
  destructive library spec;
- the **standalone** server on `:3100` (`.e2e/standalone`) — the Docker/deploy target, runs
  `editor.spec.ts` to guard deck-loading;
- a second `next start` on `:3200` (`.e2e/library`) — runs `library.spec.ts` alone, so its
  empty-state test can empty the decks dir without racing another spec.

Each server is considered ready only once `GET /api/decks` responds. Because state is isolated
per server, the suite passes under Playwright's **default** parallel workers — `--workers=1` is
a safety net, not a requirement:

```bash
npm run test:e2e
```

CI runs the unit and e2e suites on every push and pull request via
[GitHub Actions](.github/workflows/ci.yml). (`npm run smoke:docker` stays a manual local check.)

---

## Status & roadmap

Under active development. The design spec and implementation plans live in [`docs/`](docs/):

- [`2026-06-23-morgana-design.md`](docs/2026-06-23-morgana-design.md) — design spec
  (goals/non-goals, architecture, the effect-descriptor registry, the v1 scrub compromise,
  and the Tier 2/3 roadmap).

Implementation plans, in build order:

- [Plan 1 — Foundation & engine spike](docs/2026-06-23-morgana-plan-1-foundation-engine.md)
- [Plan 2 — Backend & bridges](docs/2026-06-23-morgana-plan-2-backend-bridges.md)
- [Plan 3a — Editor shell & read-only viewer](docs/2026-06-23-morgana-plan-3a-editor-shell.md)
- [Plan 3b — Theming + inspector core](docs/2026-06-23-morgana-plan-3b-theming-inspector.md)
- [Plan 3c — Structural editing & persistence](docs/2026-06-26-morgana-plan-3c-structural-editing.md)
- Deployment hardening — standalone server + Docker deck-loading:
  [spec](docs/2026-06-24-morgana-deploy-harden-standalone-api.md) ·
  [plan](docs/2026-06-24-morgana-deploy-harden-plan.md)

For the full intended shape of the editor — bespoke effect editors, timeline editing,
asset/font management, the plugin framework, deterministic preview, an optional in-app AI
assistant, and the platform tier — see the
[end-state ("north star") design doc](docs/2026-06-29-morgana-end-state-design.md).

## License

[MIT](LICENSE) © Musical Mycology
