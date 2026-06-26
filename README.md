# Morgana

> A web editor for cinematic, GSAP-driven slide decks. *(Early development — see `docs/`.)*

Morgana is an open-source visual editor for a data-driven cinematic presentation engine.
Decks are authored as data (`Scene → Beat → Action[]`) and interpreted by a GSAP + tsParticles
render engine; Morgana puts a WYSIWYG canvas, a schema-driven property inspector, and a hybrid
timeline (deck filmstrip + per-beat choreography track with a scrubbable playhead) on top of that
same engine — so what you edit is exactly what plays.

It runs locally in Docker and stores decks as portable JSON on a mounted volume.

## Status

Under active development. The design spec and all implementation plans live in
[`docs/`](docs/):

- [`2026-06-23-morgana-design.md`](docs/2026-06-23-morgana-design.md) — design spec

Implementation plans, in build order:

- [Plan 1 — Foundation & engine spike](docs/2026-06-23-morgana-plan-1-foundation-engine.md)
- [Plan 2 — Backend & bridges](docs/2026-06-23-morgana-plan-2-backend-bridges.md)
- [Plan 3a — Editor shell & read-only viewer](docs/2026-06-23-morgana-plan-3a-editor-shell.md)
- [Plan 3b — Sporekles dark theme + inspector core](docs/2026-06-23-morgana-plan-3b-theming-inspector.md)
- [Plan 3c — Structural editing & persistence](docs/2026-06-26-morgana-plan-3c-structural-editing.md)
- Deployment hardening — standalone server + Docker deck-loading: [spec](docs/2026-06-24-morgana-deploy-harden-standalone-api.md) · [plan](docs/2026-06-24-morgana-deploy-harden-plan.md)

## Run it

### Docker (recommended)

```bash
docker compose up --build
```

Open <http://localhost:3000/editor> — the bundled **demo deck** is auto-seeded into the
mounted `./data` volume on first run, so the editor works immediately. Your decks live as
JSON under `./data/decks/` (gitignored; never committed).

### Production server (standalone)

`docker compose` runs Next.js's standalone server (`output: "standalone"`). To run it
directly without Docker:

```bash
npm ci
npm run build
# the standalone server needs these copied beside it:
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
MORGANA_DATA_DIR="$PWD/data" node .next/standalone/server.js
```

### Local development

```bash
npm ci
npm run seed:demo   # copy the demo deck into ./data/decks/
npm run dev         # http://localhost:3000/editor
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `MORGANA_DATA_DIR` | `/data` (production), `./data` (dev) | Directory holding `decks/<id>.deck.json`. Use an absolute, writable path in production. |
| `PORT` | `3000` | Server port. |

In Docker the data dir is the mounted volume (`/data`). On first run the demo deck is
seeded only if no `*.deck.json` already exists — existing decks are never overwritten.

## Tests & checks

```bash
npm test             # unit (vitest)
npm run test:e2e     # Playwright — editor specs run against BOTH `next start` and the standalone server
npm run smoke:docker # build the image, run with an empty volume, assert /api/decks serves the auto-seeded demo
npm run build        # production build
```

## License

[MIT](LICENSE) © Musical Mycology
