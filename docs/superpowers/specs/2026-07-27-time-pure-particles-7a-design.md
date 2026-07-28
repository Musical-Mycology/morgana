# Time-Pure Note Particles — Deterministic Particle Scrubbing — Design Spec (§7a)

- **Date:** 2026-07-27
- **Status:** Design spec (approved for planning)
- **Author of record:** Chris Oltyan (brainstormed with Claude)
- **Sub-project:** **§7a** of end-state design **§7** ("Preview fidelity & determinism"), the Tier 2 keystone.
- **Branch point:** `main` after Tier 1.5 (PRs #26, #27, #29 merged 2026-07-27).
- **Companion docs:**
  - [`../../2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md) — north star; §7 is the parent item, §16 the tier roadmap, §18 Q1 the `seek.ts` retirement decision.
  - [`2026-07-22-object-render-integration-3b-design.md`](2026-07-22-object-render-integration-3b-design.md) — the precedent this spec follows (pure reducer + shared stage, determinism without a runtime swap).
  - [`2026-07-22-object-action-binding-3a-design.md`](2026-07-22-object-action-binding-3a-design.md) — 3a's verbs and gating contract.

---

## 0. Context — how §7 decomposes, and why particles go first

§7 as written is one item. Exploration against the code showed it is too large for one spec and that
its two named pieces carry inverted risk from what §7 assumes. §7 is therefore split into three
sub-projects, each getting its own spec → plan → implementation cycle:

| Sub-project | Scope |
| --- | --- |
| **§7a** *(this spec)* | Time-pure note particles: a pure reducer, a reducer-driven `NoteField`, notes visible in the editor canvas, completed inspector descriptors. |
| **§7b** | The transport surface: restructure `CinematicSlide`'s master timeline so it is genuinely seekable, and expose `seek(t)`/`play()`/`pause()`/`duration()`. |
| **§7c** | Canvas swap onto the real engine, the parity gate + corpus, and deletion of `seek.ts` (§18 Q1). |

**Particles go first** because: (a) §7a is fully independent of the transport and follows a proven
in-repo precedent (3b's `objectStateAt`/`ObjectStage`); (b) it delivers visible value into *today's*
canvas immediately — particles currently draw nothing at all; (c) §7b's restructure must give
`note_emitter`/`note_circle` some seekable representation, so solving it first turns an open problem
discovered mid-rewrite into a unit-tested reducer to plug in; and (d) §7c's parity gate is required
to assert particles render at representative times, so it is literally unwritable until notes are
deterministic.

### 0.1 Two findings that reshaped §7 (verified against the code)

These are recorded here because they change what §7b and §7c must do, and the end-state doc's §7
wording predates them.

**Finding 1 — §7's premise "expose `seek(t)` over the GSAP master timeline" does not hold.**
`CinematicSlide`'s master is **not** a tweened representation of the beat; it is a **callback
scheduler with time spacers**. Every effect is scheduled as
`master.add(() => { …create DOM…; return flyUp(el) })` followed by a separate
`master.to({}, { duration: introDuration(a) })`
([`CinematicSlide.tsx:463-480`](../../../engine/components/layouts/CinematicSlide.tsx)). GSAP's
`.add(fn)` converts the function to a `delayedCall`, so the timeline returned by the effect builder
is **orphaned** — it plays on wall-clock from the moment the callback fires and is not a child of the
master. That is precisely why the durations have to be re-declared as spacers, and why `seek.ts` must
carry a *second copy* of `introDuration`.

Consequence: `master.seek(t)` today would fire nothing (seek suppresses callbacks), would not touch
the orphaned child tweens, and could not un-create DOM when seeking backwards. **§7b is not "surface a
control" — it is restructuring `scheduleAction` into a nested, tween-only master with DOM built up
front.** Larger than §7 states, but tractable. This spec does not do that work; it records the finding
so §7b's spec starts from the truth.

**Finding 2 — "time-pure particles" is smaller than §7 states.** The only `Math.random()` in the note
path is two calls in `launchNote`
([`effects/notes.ts:55-57`](../../../engine/components/effects/notes.ts)) — spread angle and distance
jitter. `note_circle` is *already* closed-form (`cx + cos(a)·rx`, `a = phase + 2π·t/dur`);
`randomGlyph` is `GLYPHS[i % n]`; `emitNote` and `swirl` contain no randomness at all. So the
"seeded, closed-form state at time *t*" §7 calls "the one genuinely new algorithmic piece" reduces to
a seeded PRNG plus a finite live-sprite window. Additionally, `Atmosphere`/tsParticles is **not**
mounted in `DeckCanvas` or `BeatStage`, so ambient spores are out of scope by construction.

### 0.2 Explicitly out of scope

- **The transport surface** (§7b) — no `seek(t)`/`pause()` over the GSAP master, no restructuring of
  `scheduleAction`.
- **The canvas swap, parity gate, and `seek.ts` deletion** (§7c). §7a leaves the seek-renderer as the
  canvas's text/art driver, untouched.
- **On-stage effect editors / drag handles** for emitters and rings (§4) — §7 states these depend on
  §7b landing first, since handles should overlay the true render.
- **Cross-beat continuous playback** in the editor. The scrubber stays per-beat; cross-beat note
  continuity comes from the reducer's fold (§3.4), not from a scene transport. (Same boundary 3b drew.)
- **Any other Tier 2 item** — rich timeline (§5), assets (§9), fonts (§10), plugin framework (§11),
  theme editor (§14b), a11y (§13), import round-trip (§14a), and open issues #11/#12.
- **New schema.** `DeckDoc.version` stays `1`. §7a is render + descriptor only; no persisted field is
  added, removed, or reinterpreted.

## 1. The problem, stated against today's code

Notes are invisible in the editor canvas for **two** independent reasons, and §7a fixes both:

1. **Not seekable.** `note_emitter`/`note_circle`/`cue` fall through `applyAt`'s `default` branch in
   [`seek.ts`](../../../engine/authoring/seek.ts), which documents them as "non-seekable, not rendered
   under scrub".
2. **Not mounted.** `DeckCanvas` never mounts `NoteField` at all — it mounts `ArtStage`, the text
   host, `ObjectStage`, and `ObjectsLayer`. `NoteField` exists only inside `BeatStage`, which in this
   repo is reachable only from the `/dev/beatstage` route.

Meanwhile the inspector *can* author a `note_emitter`. This is the same "edit what you cannot see"
gap §7 opens with, applied to particles.

## 2. Guiding decisions (locked during brainstorm)

| Decision | Choice | Rationale |
| --- | --- | --- |
| **Decomposition** | Three sub-projects; **particles first** (§0). | Independent of the transport, proven precedent, immediate visible value, and a prerequisite for §7c's gate. |
| **Renderer** | **Rewrite `NoteField` reducer-driven.** One implementation; both paths mount the same component and supply only a clock. | 3b's locked decision ("one reducer drives both paths… eliminates the drift risk of two animation implementations"). §7's own rationale for retiring `seek.ts` is that two renderers that can drift are a liability; adding a second note renderer would recreate it. `engine/` is vendored **from** mm-website, not to it, so no downstream consumer breaks. |
| **`cue`** | **Scoped out, and the dead legacy API is deleted.** | `runtime.cue` is a no-op in the only runtime in this repo, and `NoteField.emit`/`stopEmit`/`swirl` have **no callers anywhere**. Keeping them means shipping a hybrid component that is half closed-form reducer and half orphaned GSAP — exactly the drift liability the renderer decision rejects. Promoting `cue` to first-class instead would import MM coupling (`emit(panel: Panel, color: NoteColor)` keyed off `PANEL_ANCHORS` in `story-assets`) into a repo whose stated invariant is generic standalone OSS. |
| **Cross-beat** | **Fold prior beats, phase-continued.** | The exact analogue of `objectStateAt`'s fold — one cross-beat story in the codebase, not two — and faithful to the real runtime, where `NoteField` is mounted outside `CinematicSlide` and is not torn down per beat. |
| **Coordinates** | **Normalized 0–1 stage space**, px constants converted once against `REF_W = 1920`. | 3b's rule that the pure core must be jsdom-testable without layout; also makes note motion resolution-independent, which §7c's cross-path parity requires. |
| **Descriptors** | **Complete all four note descriptors.** | `registry.ts` must be edited anyway to correct the `seekable` flag; shipping visible-but-uneditable effects trades one fidelity gap for another. |
| **Versioning** | `DeckDoc.version` stays `1`. | Render + descriptor only. |

## 3. The pure reducer — `engine/components/effects/note-state.ts`

### 3.1 Location

Next to [`notes.ts`](../../../engine/components/effects/notes.ts), in `engine/`, **not** in
`lib/editor/`. `object-state.ts` can live in `lib/editor/` because its consumer
(`engine/authoring/BeatStage.tsx`) is the authoring shim layer; `NoteField` is a core
`engine/components/` component and must not import from `lib/editor/`. The asymmetry is deliberate.

### 3.2 Types and signature

```ts
/** One live note sprite at an absolute time. x/y are normalized 0–1 stage coordinates. */
export interface NoteSpriteState {
  key: string;      // stable pool slot, "srcIdx:slot" — drives DOM node reuse
  x: number; y: number;
  scale: number;
  opacity: number;  // 0–1, clamped
  hex: string;
  glyph: NoteGlyph;
}

export function noteFieldStateAt(
  scene: Scene, beatIndex: number, tLocal: number,
): NoteSpriteState[];
```

The `(scene, beatIndex, tLocal)` shape deliberately mirrors `objectStateAt` so there is one
cross-beat mental model in the codebase. Output is ordered deterministically (source index, then
sprite index) so equality assertions are stable.

### 3.3 Coordinate model, and a fidelity bug it fixes

Today's note math is raw pixels: `EMIT_SPEED = 130` px/s, `42px` sprites, origins at
`x * host.clientWidth`. The reducer normalizes once:

- `EMIT_SPEED_N = 130 / REF_W` (stage-widths per second), `NOTE_SIZE_N = 42 / REF_W`, `REF_W = 1920`.
- Because the stage is a fixed 16:9 box, a travel distance `d` in stage-width units maps to
  `dx = d·sin θ`, `dy = −d·cos θ·(16/9)`. Angles are preserved exactly under separate per-axis
  normalization.
- `note_circle` needs **no** aspect correction: its `width`/`height` are already per-axis fractions,
  so `rx = width/2` and `ry = height/2` are directly normalized.

This surfaces a real bug that §7a fixes: **`NoteField` anchors to its host, not to the 16:9 stage.**
Its root is `position: absolute; inset: 0` over the host, and the px math uses `host.clientWidth`. In
`DeckCanvas` the host *is* 16:9 (`aspectRatio: "16 / 9"`), but in `BeatStage` the host is
`position: fixed; inset: 0` — the whole viewport. The same emitter therefore lands in different
places in the two paths today. §7c's parity gate compares exactly those two paths, so §7a gives
`NoteField` a sprite host matching `.cin__stage`
(`width: min(100cqw, calc(100cqh * 16 / 9))`, centred). **This is a deliberate behavior change**, not
a refactor.

### 3.4 Algorithm

**1 — Fold prior beats.** Replay `scene.beats[0 .. beatIndex-1]` in document order at settled state,
maintaining the live source set: `note_emitter`/`note_circle` add a source; `stop_notes` clears all
sources; `stop_circle` clears rings only. Each surviving source records its start beat and its window
start within that beat.

**2 — Phase-continue carried sources.** For a source that started in beat `b < beatIndex`, its
elapsed time at the current beat's `tLocal` is

```
elapsed = (beatDuration(scene.beats[b].timeline) − windowStart)
        + Σ beatDuration(scene.beats[j].timeline)   for j in (b, beatIndex)
        + tLocal
```

reusing the pure `beatDuration` already exported from `seek.ts`. Sources started in the current beat
use `elapsed = tLocal − windowStart`, and are absent while that is negative.

**3 — Interpolate the current beat.** Build `[start, end)` windows with `beatTimeline(beat.timeline)`
— the same function 3b reused, so note windows match the timeline geometry the scrubber and the
rest of the editor already agree on. Apply each note action whose `start ≤ tLocal`, in document
order.

**4 — Resolve each live source to sprites** per §3.5 / §3.6, concatenate, clamp per §3.7, return.

**Determinism guarantees.** Prior beats are always settled, so there is no accumulation ambiguity;
the current beat is a pure function of `tLocal`; document order is the tie-breaker for
same-window actions; and every stochastic value is derived from a seeded hash of indices, never from
`Math.random()` or wall-clock.

### 3.5 `note_emitter` — closed form

**Units.** `note_emitter.decay` is **milliseconds** (`types.ts`: "decay = note lifetime ms"), and
`launchNote` clamps it: the reducer uses `D = max(0.1, decay / 1000)` seconds throughout. *This
exposes a latent bug the descriptor work fixes:* `registry.ts`'s `note_emitter` default is
`decay: 1` — one millisecond — so every emitter added through the inspector today is silently
clamped to 0.1 s notes. Phase 4 corrects the default to `decay: 1000` alongside adding the field.

`gsap.timeline({ repeat: -1, repeatDelay: 1/freq }).call(fn)` has a zero-duration body, so its cycle
length is exactly `1/freq`: note *i* is born at `i/freq` after the source's start and lives exactly
`D` seconds (`launchNote`'s master tween duration, after which `onComplete` removes the element).

At elapsed time `e`, the live set is the finite window

```
{ i ∈ ℕ : 0 ≤ e − i/freq < D }        →  at most ceil(D·freq) + 1 sprites
```

Each sprite's appearance is a pure function of its age `a = e − i/freq`, porting `launchNote`'s three
tweens exactly as named ease functions:

| Component | Source tween | Closed form |
| --- | --- | --- |
| scale, opacity in | `fromTo(scale .4→1, opacity 0→1, duration min(0.4, D·0.4), ease back.out(2))` | `tIn = min(0.4, D·0.4)`, `p = clamp01(a / tIn)`, `backOut(p) = (p−1)²·(3(p−1) + 2) + 1`; `scale = 0.4 + 0.6·backOut(p)`; `opacity = clamp01(backOut(p))` |
| travel | `to({x: dx, y: dy}, duration D, ease power1.out)` | `q = clamp01(a / D)`, `powerOut(q) = 1 − (1−q)²`; `x = x₀ + dx·powerOut(q)`, likewise `y` |
| fade out | `to({opacity: 0}, duration D·0.4, ease power1.in) at D·0.6` | for `a ≥ 0.6·D`: `r = (a − 0.6·D) / (0.4·D)`, multiply opacity by `1 − r²` |

`back.out(2)` overshoots above 1, so opacity is clamped — matching what the browser renders today.

**Seeded jitter.** The two `Math.random()` calls become `mulberry32(hash32(srcIdx, i))`, drawing the
spread angle within `±var` degrees and the distance multiplier in `[0.8, 1.2)`. Seeding on the
source's action index within its beat plus the note index keeps two emitters in one beat visually
distinct while remaining stateless and reproducible across sessions and across module reloads.
Reordering actions reshuffles decorative jitter, which is accepted and documented.

Direction is compass degrees (0 = up, clockwise), matching `types.ts`:
`θ = (dir + jitter) · π/180`, `dx = sin θ · d`, `dy = −cos θ · d · (16/9)`,
`d = EMIT_SPEED_N · D · mult`.

### 3.6 `note_circle` — transcription only

Already deterministic; only normalization and the removal of the GSAP wrapper are needed. For ring
note `k` of `N = max(1, round(notes ?? 8))`, with `dur = max(0.1, (speed ?? 6000)/1000)` seconds per
orbit:

```
a(e)    = (k/N)·2π + 2π·(e / dur)
x       = cx + cos(a)·rx
y       = cy + sin(a)·ry − bounce·ry·0.5·|sin(3a)|
hex     = colors[k % colors.length]        // colors = hex.length ? hex : ["#FFFFFF"]
glyph   = randomGlyph(k)                   // already deterministic: GLYPHS[k % GLYPHS.length]
```

Ring notes never expire: `opacity = 1`, `scale = 1`.

### 3.7 Bounds and pooling

- `MAX_SPRITES_PER_SOURCE = 256`, `MAX_SPRITES_TOTAL = 512`.
- A source's pool size is `P = min(ceil(D·freq) + 1, MAX_SPRITES_PER_SOURCE)`. When the natural live
  window exceeds `P`, the source keeps the **newest** `P` notes and drops the oldest (lowest `i`), so
  the visible leading edge — the part the eye tracks — is preserved.
- Pool slot is `i % P`, which is collision-free among the notes actually kept. Ring notes use
  `slot = k` with `P = N`. This makes DOM node reuse stable and flicker-free and keeps the node count
  constant across a `t` sweep.
- `MAX_SPRITES_TOTAL` is applied after concatenation, dropping whole trailing sources in reverse
  document order so a single runaway emitter cannot blank an entire scene's rings.
- Caps are clamps, not errors. Surfacing an over-budget emitter as a lint belongs to §8's
  action-level validators, not here.

### 3.8 Degenerate inputs — return empty, never throw

`freq ≤ 0`; `decay ≤ 0`; `beatIndex` negative or `≥ scene.beats.length`; an empty `timeline`; a
missing `scene.beats`; and — per the repo gotcha in `MM_MORGANA.md` — a **zero-beat scene**, which is
a legal, reachable authoring state that any new scene→beat index mapping must tolerate.

## 4. `NoteField` — reducer-driven

`NoteFieldHandle` collapses to a single method:

```ts
export interface NoteFieldHandle {
  renderAt(scene: Scene, beatIndex: number, t: number): void;
}
```

- Pre-creates a bounded pool of sprite nodes (`makeNoteHex` retained as the node builder) and writes
  closed-form style values. No per-sprite GSAP, no timelines, no `Math.random()`.
- **`applyNoteState(node, state)`** — a pure DOM writer, the only place reducer output touches a
  sprite node: `left`/`top` as percentages, `transform: scale()`, `opacity`, `display: none` for
  unused pool slots, and `background-color` + mask URL when the glyph or hex changes.
- Sprites live inside a `.cin__stage`-matching 16:9 letterbox (§3.3), sized in `cq` units so the
  effect is resolution-independent.
- `reduced` renders nothing, preserving today's reduced-motion behavior.
- Stateless with respect to time: the caller owns the clock, exactly as `ObjectStage` does.

## 5. Integration

### 5.1 Editor canvas (`DeckCanvas.tsx`)

- Mount `<NoteField ref={notes} reduced={false} />` between `<ArtStage>` and the `.cin` text div, so
  the DOM order matches `BeatStage`'s: art → notes → text → objects.
- Extend `draw()` with one line: `if (scene) notes.current?.renderAt(scene, beatIndex, t.current)`.
  The reducer is sampled at exactly the `t` the seek renderer and `ObjectStage` already use, so text,
  objects, and notes stay frame-aligned. **No new clock.**
- **No mode-swap.** Unlike objects, notes have no authoring overlay to swap against, so they render
  at every `t` including `0` — which is what playback does.

### 5.2 `BeatStage.tsx`

`NoteField` is already mounted. It gains `scene`/`beatIndex` and is driven from the **same** proxy
tween `onUpdate` that already drives `ObjectStage.renderAt`. `animate = false` (static / PDF /
reduced-motion / hidden tab) renders at `t = span`, the beat's settled state.

Because it rides the same proxy, §7a inherits 3b's documented `click_gate` desync limitation
verbatim (the proxy is an independent wall-clock timeline, not a child of `CinematicSlide`'s
segmented master). That is **§7b's** problem, and §7b's spec should treat both `ObjectStage` and
`NoteField` as its clock consumers.

### 5.3 Deletions

The reducer owns note sources, so the runtime plumbing that used to start them is dead — the same
move 3b made for objects ("renders via a parallel stage, not by teaching the runtime a new case"):

| File | Removed |
| --- | --- |
| `engine/components/NoteField.tsx` | `emit`, `stopEmit`, `swirl`, and the `emitTimer` / `swirlTl` / `swirlRadius` refs |
| `engine/components/effects/notes.ts` | `emitNote`, `makeNote`, `launchNote` (its math ports into `note-state.ts`); `makeNoteHex` is retained. `randomGlyph` moved to `note-state.ts` post-merge — it is pure, and leaving it here gave the pure core an import edge back into this DOM-touching module |
| `engine/components/layouts/CinematicSlide.tsx` | `CinematicRuntime.{cue, emitter, noteCircle, stopNotes, stopCircles}` and the five matching `scheduleAction` cases |
| `engine/authoring/runtime.ts` | the matching `AuthoringHooks` / `makeAuthoringRuntime` members |

Imports that become unused (`NOTE_TINTS`, `NoteColor`, `PANEL_ANCHORS`) are dropped at the use site;
the `story-assets` exports themselves are **left alone** — they are deck-format vocabulary.

The **`cue` action kind stays in `types.ts`** for deck-format compatibility (`version` stays `1`). It
becomes explicitly inert, documented as such at the type and in the deep-dive.

### 5.4 The `seekable` flag — an honesty note

`isSeekable` ([`seek.ts:48`](../../../engine/authoring/seek.ts)) and `EffectDescriptor.seekable`
([`registry.ts:5`](../../../lib/editor/registry.ts)) are referenced **only by tests** — no production
code reads either. Flipping them therefore changes no runtime behavior; it corrects declared
contract, which matters because §7b/§7c and the descriptor-owned plugin work (§11) will read it.

- `isSeekable` becomes `a.kind !== "cue"`.
- `GENERIC`'s `seekable` becomes `kind !== "cue"`.
- `note_emitter`'s descriptor flips to `seekable: true`.
- Three existing assertions update: `tests/unit/seek.test.ts:15` and `tests/unit/registry.test.ts:15`
  (both currently assert `false` for `note_emitter`).

### 5.5 Descriptors

`registry.ts` gains complete, real descriptors for all four note kinds:

- **`note_emitter`** — add the missing `dir`, `var`, `decay` fields to the existing partial schema
  (which today exposes only `color`, `pos.x`, `pos.y`, `freq`), and correct the `decay: 1` default to
  `decay: 1000` (§3.5).
- **`note_circle`** — a new descriptor replacing the empty-schema `GENERIC` fallback: `pos.x`,
  `pos.y`, `width`, `height`, `bounce`, `notes`, `speed`.
- **`stop_notes`, `stop_circle`** — real labels, icons, and `defaults()` instead of `GENERIC`.

Declarative data only; no runtime risk. Roughly a 30-line addition.

**Known gap — `note_circle.hex`.** `hex` is `string[]`, and `FieldType`
([`registry.ts:3`](../../../lib/editor/registry.ts)) has no array kind
(`text | textarea | number | select | range | checkbox | objectRef`). It is therefore **omitted from
the schema**, following the existing precedent that `rotateList`'s descriptor omits its `items: string[]`
for the same reason. The palette stays reachable via hand-edited JSON and the MCP tools, and a
`stringList` field type would close both gaps at once — recorded as a follow-on, deliberately not
taken here because adding a `FieldType` means touching the Inspector's rendering, which is outside
the "declarative data only" premise this decision was approved on.

## 6. Fixture deck and the §7c corpus

`scripts/prepare-standalone.sh` copies `samples/*.deck.json` into all three isolated e2e data dirs
(`.e2e/{default,standalone,library}/decks`), so a new `samples/notes.deck.json` seeds itself into
every e2e server with no config change. Shape it to exercise the fold:

- **beat 0** — `note_emitter` + `note_circle` started, with a `wait` so there is scrub range;
- **beat 1** — text only, no note actions (proves carried sources stay live across a beat);
- **beat 2** — `stop_circle`, a `wait`, then `stop_notes` (proves selective and total teardown).

This deck is recorded as the **seed of §7c's parity corpus**, partially closing §18's residual open
detail ("which decks and times the determinism e2e asserts against").

**Plan-time check:** adding a sample deck changes the deck list every e2e spec sees. Any spec that
asserts a deck count or "first deck" ordering (`library.spec.ts`, `editor.spec.ts`,
`persistence.spec.ts`) must be checked and updated in the same phase.

## 7. Testing — §7a's definition of done

**Unit (vitest) — the pure core, the determinism gate:**

- **Emitter windows:** sprite `i` absent just before `i/freq`, present at `i/freq`, gone at
  `i/freq + D`; steady-state count `= ceil(D·freq) + 1`.
- **Units:** `decay` is read as milliseconds and clamped to `D = max(0.1, decay/1000)` seconds — a
  `decay: 1` emitter yields 0.1 s notes, not 1 s.
- **Ease fidelity:** `scale`/`opacity`/position at known ages equal hand-computed `backOut(2)`,
  `power1.out`, `power1.in` values.
- **Seeding:** identical inputs produce deep-equal output across two calls and across a fresh module
  import; two emitters in one beat produce different jitter.
- **Ring:** positions at `t = 0`, ¼, ½, and a full orbit; `bounce = 0` traces an exact ellipse;
  `bounce = 1` matches the hop term; `N` notes evenly phased; colors cycle `k % hex.length`.
- **Fold:** a source started in beat 0 is live at beat 2 at phase `Σ beatDuration`; `stop_notes` in
  beat 1 removes it; `stop_circle` removes rings only and leaves emitters running.
- **Normalization:** a 45° emitter's `dx : dy` ratio equals `16/9` (angle preserved).
- **Caps:** a source over `MAX_SPRITES_PER_SOURCE` clamps and drops its oldest notes; the total cap
  is respected across multiple sources.
- **Guards (§3.8):** `freq ≤ 0`, `decay ≤ 0`, out-of-range `beatIndex`, empty timeline, missing
  `scene.beats`, and a **zero-beat scene** — each returns `[]` and does not throw.

**Component (jsdom + @testing-library/react):**

- `renderAt` writes the expected `left`/`top`/`opacity`/`transform` for a known state.
- `reduced` paints zero sprites.
- Node count is stable across a `t` sweep (pool reuse, no churn).
- The sprite host is the 16:9 letterbox, not the full component host.

**Parity (vitest, jsdom):** drive one scene through **both** integration entry points at sampled
times and assert identical `NoteSpriteState[]` — the in-scope echo of §7c's cross-path gate, matching
the parity test 3b shipped.

**E2E (Playwright — run as `npm run test:e2e`, default parallelism, no `--workers=1`):**

- **Editor:** open `notes.deck.json`, scrub to a fixed `t`, assert sprite count and a known position;
  then scrub away and back and assert **identical DOM** — the determinism assertion §7c generalizes
  across the corpus.
- **`beatstage.spec.ts`:** extend to assert notes paint on the dev route.

**Local gate:** `npm test` (Vitest) + `npx tsc --noEmit`. A fresh worktree may need `npm ci` before a
Playwright run; never block a task on a missing `next` install — rely on CI for e2e if needed.

## 8. Implementation phases (one PR, four review checkpoints)

1. **Reducer + TDD.** `engine/components/effects/note-state.ts` — `noteFieldStateAt`, the ease
   functions, `mulberry32`/`hash32`, the fold, caps, and guards, with the full §7 unit suite
   red→green. Pure; no rendering.
2. **`NoteField` rewrite.** Pool, `applyNoteState`, the 16:9 sprite host, `reduced` handling, and
   deletion of the dead legacy API (§5.3, `NoteField`/`notes.ts` rows). Component tests.
3. **Integration.** `DeckCanvas` mount + `draw()` wiring; `BeatStage` proxy-tween wiring; strip the
   note/`cue` cases from `CinematicSlide`, `CinematicRuntime`, and `makeAuthoringRuntime`. Parity
   test.
4. **Descriptors, fixture, e2e, docs.** Registry schemas (§5.5), the `seekable` flips plus the three
   test updates (§5.4), `samples/notes.deck.json` and the deck-count spec check (§6), the e2e specs,
   `MM_MORGANA.md` deep-dive sync, and an end-state-doc note recording the §7 decomposition, the two
   §0.1 findings, and the parity-corpus seed.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Visual regression in note motion after dropping GSAP tweens | Ease formulas are ported exactly (§3.5) and asserted numerically in unit tests, not eyeballed. |
| Adding `samples/notes.deck.json` perturbs existing e2e deck-list assertions | Explicit plan-time check across `library`/`editor`/`persistence` specs (§6). |
| Per-frame cost of up to 512 sprite style writes | Write only sprites whose state changed; caps bound the worst case. Treated as a **measurement point** in phase 3, not an assumption. |
| The `.cin__stage` anchoring change (§3.3) alters where existing decks' notes land | Deliberate and documented; no sample deck currently uses note actions, so no shipped content moves. |
| Engine deletions conflict with a future re-vendor of `engine/` back to mm-website | Accepted: the deleted methods are unreachable here, and the lineage is one-way (vendored **from** mm-website). Recorded in the deep-dive. |

## 10. Consequences & follow-ons

- **§7b** starts from §0.1's Finding 1 rather than §7's original premise, and treats both
  `ObjectStage` and `NoteField` as clock consumers when it attaches a real transport.
- **§7c** gains a writable parity gate: notes are deterministic, resolution-independent, and
  anchored identically in both paths, and `samples/notes.deck.json` seeds the corpus.
- **§4** (on-stage effect editors) inherits complete descriptors for the note kinds, which is the
  metadata its handles will bind against.
- **`seek.ts`** is untouched for text/art/nightlight; notes render via the parallel `NoteField`, not
  by teaching `applyAt` a new case — keeping the seek renderer's per-beat purity intact, exactly as
  3b did for objects.
- **A `stringList` `FieldType`** would close both `note_circle.hex` and `rotateList.items`
  (§5.5) — a small, self-contained follow-on that fits naturally with §4's effect-editor work.
- **No version bump; no MM coupling added.** Legacy and note-less decks render identically to today.
