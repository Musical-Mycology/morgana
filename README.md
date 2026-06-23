# Morgana

> A web editor for cinematic, GSAP-driven slide decks. *(Early development — see `docs/`.)*

Morgana is an open-source visual editor for a data-driven cinematic presentation engine.
Decks are authored as data (`Scene → Beat → Action[]`) and interpreted by a GSAP + tsParticles
render engine; Morgana puts a WYSIWYG canvas, a schema-driven property inspector, and a hybrid
timeline (deck filmstrip + per-beat choreography track with a scrubbable playhead) on top of that
same engine — so what you edit is exactly what plays.

It runs locally in Docker and stores decks as portable JSON on a mounted volume.

## Status

Under active development. The design spec and the first implementation plan live in
[`docs/`](docs/):

- [`docs/2026-06-23-morgana-design.md`](docs/2026-06-23-morgana-design.md) — design spec
- [`docs/2026-06-23-morgana-plan-1-foundation-engine.md`](docs/2026-06-23-morgana-plan-1-foundation-engine.md) — Plan 1: foundation & engine spike

## License

[MIT](LICENSE) © Musical Mycology
