# Transport Surface — A Seekable Cinematic Runtime — Design Spec (§7b)

**Status:** designed, not yet implemented
**Date:** 2026-07-28
**Tier:** 2 (Depth) — the second of §7's three sub-efforts
**Predecessor:** [§7a — time-pure note particles](2026-07-27-time-pure-particles-7a-design.md)
**North star:** [end-state design §7](../../2026-06-29-morgana-end-state-design.md) — "Preview fidelity & determinism"

---

## 0. Context — where §7b sits

§7 ("real-engine canvas + deterministic particle scrubbing") is the keystone of Tier 2 and
decomposes into three sub-efforts:

| | | Status |
| --- | --- | --- |
| **§7a** | Time-pure note particles | **Landed** (PR #30; follow-up cleanup #31) |
| **§7b** | **This spec** — a seekable transport over the cinematic runtime | designed |
| **§7c** | Canvas swap, parity gate, `seek.ts` deletion | open, blocked on §7b |

### 0.1 The principle §7a actually established

The end-state design frames §7 as *"the canvas drives the **actual** GSAP runtime — the same
code that runs production playback."* §7a appears to contradict that: it made notes a **pure
`stateAt(t)` reducer** with a stateless renderer, not a GSAP timeline.

The two reconcile, and the reconciliation is the load-bearing idea of this spec:

> **One renderer, two clocks.** §7a did not build a second renderer. It built *one* stateless,
> time-indexed renderer and mounted it in both `BeatStage` and `DeckCanvas`, each supplying its
> own clock — a ticker in playback, a scrub position in the editor.

What removes drift is not "use GSAP everywhere." It is *having one implementation whose output
is a function of time*. §7b extends that shape from note particles to the rest of the cinematic
runtime.

### 0.2 Findings verified against the code

Four facts about today's code shaped this design. All were checked, not assumed.

1. **The consumer interface already exists.** `components/editor/DeckCanvas.tsx:13` exports
   `CanvasHandle { seek, play, pause }`, already driven by the editor's scrub bar against
   `seek.ts`'s rAF loop. §7b is not inventing an API; it supplies a second implementation of a
   contract already in use.

2. **`masterRef` is not a beat master — it is the *current segment*.**
   `CinematicSlide.tsx:186` reassigns it inside `playSegment()`. There is no whole-beat timeline
   object anywhere today, which is why `master.seek(t)` cannot work.

3. **Every visual step is a destructive imperative mutation.** `appendText` mutates the DOM,
   `clear` wipes `innerHTML`, `fade_out` kills tweens. Nothing is idempotent, so seeking
   *backwards* is impossible without a rebuild.

4. **Both pure reducers reach a DOM-touching module.** `engine/components/effects/note-state.ts`
   and `lib/editor/object-state.ts` are both DOM-free by contract, and both import
   `beatTimeline`/`beatDuration` from `engine/authoring/seek.ts` — which calls
   `document.createElement` and assigns `innerHTML`. This is the same contract breach PR #31
   fixed on the `notes.ts` edge, on an edge the §7a review never named. It is weaker (no import
   cycle — `seek.ts` does not import back) but it is the same violation, and §7b's clock
   extraction (§2) fixes it as a side effect rather than as separate work.

### 0.3 Explicitly out of scope

Deferred to **§7c**, and this spec must not drift into them:

- Swapping `DeckCanvas` from `seek.ts` onto `CinematicSlide`.
- The **parity gate** across the deck corpus.
- Deleting `seek.ts`.

Also out of scope: any change to the deck format, the MCP tool surface, or the effect-descriptor
registry. §7b is an engine-internal restructure with no authored-document consequences.

---

## 1. The problem, stated against today's code

`CinematicSlide` schedules a beat by splitting its timeline into segments at `click_gate`
boundaries, then playing one segment at a time:

```ts
// CinematicSlide.tsx — today
master.add(() => { /* create DOM, start an orphaned tween */ });
master.to({}, { duration: introDuration(a) });   // reserve time
```

The timelines the effect builders return are **orphaned**: `timeline.add(fn)` ignores a callback's
return value, so those tweens run on wall-clock. The `master.to({}, {duration})` calls are pure
time *spacers* that reserve room so `onComplete` fires after a line settles. The master is
therefore a **callback scheduler with time spacers, not a seekable representation of the beat**.

Three consequences:

- `master.seek(t)` does nothing useful — seeking the master moves through spacers without
  re-running or rewinding the callbacks that produce the visuals.
- The editor cannot use the real runtime, so it uses `seek.ts` — a second, lo-fi renderer that
  approximates text with `translateY` and **draws nothing at all** for particles, counters, and
  media. Those three kinds are editable in the inspector and invisible on the canvas.
- `seek.ts` carries its own copy of `introDuration` to compute the same time axis, so the two
  renderers can silently disagree about when anything happens.

There is a fourth, already documented in `BeatStage.tsx:42-54`: the object and note stages ride an
**independent proxy timeline** on wall-clock from mount, so a beat combining a `click_gate` with
`obj_*` or note actions shows objects and notes desynchronised from the gated text. §7b fixes
this as a direct consequence of its design, and that bug is the acceptance signal.

---

## 2. Guiding decisions (locked during brainstorm)

| # | Decision | Rationale |
| --- | --- | --- |
| **D1** | **`click_gate` is flattened on the editor's time axis; it still blocks in playback.** A beat is one continuous axis for authoring; gates render as zero-width markers. | This is already what the editor does — `actionDuration` returns `0` for `click_gate`, so `beatDuration` and the Timeline panel assume it today. It also gives §7c's parity gate a deterministic per-beat duration; an indefinite pause has no defined `t` to compare renderers at. |
| **D2** | **`beatTimeline()` stays canonical.** `CinematicSlide` is restructured to honour the computed table exactly — each action occupies precisely `actionDuration` seconds — and the duplicated `introDuration` collapses into one shared module. | Text, notes, and objects then share one clock *by construction* rather than by luck. The alternative (read durations off the built GSAP timeline) would make durations require a built DOM, poisoning the purity contract that `note-state.ts` and `object-state.ts` depend on. |
| **D3** | **Time-indexed render, not a declarative seekable master.** `CinematicSlide` gains `renderAt(t)` folding the timeline to its state at `t`, using the **real** effect builders. | Extends §7a's precedent instead of introducing a competing model. Crucially, art, nightlight, and notes live in *sibling* stages (`ArtStage`, `NoteField`), not in `CinematicSlide`'s DOM — a single GSAP master could not own them without restructuring `ArtStage` too. It also leaves the forward playback path largely intact, which matters because §7b lands *before* §7c's parity gate exists to catch regressions. |

**Rejected:** a monotonic-forward fast path (replay only the delta on forward seeks). It optimises
a cost nobody has measured. Revisit only if scrubbing a text-heavy beat actually stutters.

---

## 3. The canonical clock — `engine/authoring/beat-clock.ts`

**New module. Pure: no DOM, no GSAP, no React.** It receives, unchanged, from `seek.ts`:

`INTRO_DUR`, `DOTFADE_TAIL`, `introDuration`, `actionDuration`, `isSeekable`, `Window`,
`beatTimeline`, `beatDuration`.

`seek.ts` shrinks to only `SeekCtx`, `renderBeatAt`, `applyAt` — the lo-fi renderer — and imports
its time math from `beat-clock.ts` like everyone else.

**Importers move as follows.** Pure/time-only consumers point at `beat-clock.ts`:

| Module | Imports | Note |
| --- | --- | --- |
| `engine/components/effects/note-state.ts` | `beatTimeline`, `beatDuration` | fixes the §0.2(4) purity breach |
| `lib/editor/object-state.ts` | `beatTimeline` | fixes the same breach |
| `engine/authoring/BeatStage.tsx` | `beatTimeline` | |
| `components/editor/Timeline.tsx` | `actionDuration` | |
| `engine/components/layouts/CinematicSlide.tsx` | `introDuration`, `beatTimeline` | **deletes its duplicate copy** |

Renderer consumers stay on `seek.ts` until §7c deletes it: `components/editor/DeckCanvas.tsx`,
`components/library/BeatThumbnail.tsx`, `app/spike/page.tsx`.

**Why this is the right seam.** After the split, deleting `seek.ts` in §7c removes *only* the lo-fi
renderer. The time axis — which the note reducer, the object reducer, and the Timeline UI all
depend on — survives untouched in a module that never had a reason to touch the DOM.

---

## 4. `CinematicSlide` — `renderAt(t)` and the transport

### 4.1 The transport interface

```ts
export interface SlideTransport {
  seek(t: number): void;      // beat-local seconds, clamped to [0, duration()]
  play(): void;
  pause(): void;
  duration(): number;         // === beatDuration(beat.timeline)
}
```

Deliberately the same shape as the existing `CanvasHandle`, plus `duration()`. Exposed via
`useImperativeHandle` on a forwarded ref, matching `ArtStage`, `NoteField`, and `ObjectStage`.

### 4.2 The fold

`renderAt(t)` computes the beat's visual state at `t`:

```
windows = beatTimeline(beat.timeline)          // canonical, per D2
for each window (action, start, end) where start <= t:
    p = (end - start) <= 0 ? 1 : clamp01((t - start) / (end - start))
    p >= 1  → settled:   built timeline .progress(1)
    p <  1  → in-flight: built timeline .time(t - start)
windows with start > t are not built at all
```

At most one action is in-flight at a time, because `beatTimeline` lays actions out sequentially;
at a boundary, or at `t >= duration()`, every reached action is settled and none is in-flight.
Built timelines are created **paused** and never allowed to run on wall-clock — the only thing that
advances them is `renderAt`.

### 4.3 Caching and rebuild boundaries

Built timelines and their elements cache by action index. A drag therefore builds each action at
most once, which is what keeps SplitText affordable.

Two events invalidate the cache:

1. **Backward seek past a destructive op.** `clear` and `fade_out` delete nodes, and deletion
   cannot be undone. Track destructive action indices as **rebuild boundaries**; a seek to `t`
   below the current position tears down and rebuilds from the greatest boundary `≤ t`. This is
   safe by definition — a `clear` wipes all prior text state anyway, so nothing before the
   boundary is observable.
2. **Timeline mutation.** Any edit to `beat.timeline` invalidates everything. Same trigger shape
   as today's `useGSAP` dependency array.

### 4.4 Gates replace segments

`segments`, `playSegment`, and the per-segment `masterRef` are **deleted**. One time axis remains,
with gate boundaries recorded as times:

- **Playback:** a ticker advances `t` and calls `renderAt(t)`. On reaching a gate boundary it
  pauses and hands `resume` to `runtime.onGate`, exactly as today. At `duration()` it calls
  `runtime.onWaiting(true)`.
- **Editor:** gates are zero-width markers (D1); scrubbing passes straight through them.

Observable playback behaviour is unchanged. The machinery underneath collapses from N segment
timelines to one axis, which is what makes a single `t` meaningful to the sibling stages.

### 4.5 Static mode folds in

The `staticMode` block (`CinematicSlide.tsx:131-160`) is a hand-written fold over the timeline to
its end state — a *third* copy of the same idea, alongside `renderBeatAt` and `noteFieldStateAt`.
It becomes `renderAt(duration())`.

**This item is separable.** It is on the PDF/print path, and if it looks risky during
implementation it can stay as-is without affecting anything else in §7b. Treat it as the last
task, not a prerequisite.

---

## 5. Per-action treatment

The fold is only as good as its per-kind behaviour. Every kind `CinematicSlide` handles today:

| Kind | Under `renderAt(t)` |
| --- | --- |
| `text` | Build the element and its real effect timeline (`flyUp`, `letterFly`, `typewriter`, …) **paused**; `.time(t - start)`. `instantText` and `reveal` collapse to "build at progress 1, skip the reveal" — simpler than today's special-cased branch. |
| `clear`, `fade_out` | Destructive; also rebuild boundaries (§4.3). `fade_out`'s opacity ramp is scrubbable; its terminal clear snaps at `p >= 1`. |
| `counter_show`, `counter_to`, `counter_add`, `counter_hide` | **Behaviour change.** These fire wall-clock `gsap.from`/`gsap.to` today. They become built-and-scrubbed timelines; the displayed value at `t` is `v0 + (v1 - v0) * ease(p)`. |
| `media`, `media_move`, `media_out` | **Behaviour change**, same reason and same treatment. |
| `art`, `nightlight` | External and imperative — `ArtStage.show()` runs its own crossfade, so calling it every frame would restart it constantly. `renderAt` computes the **desired** layer set / nightlight value at `t` and calls the runtime **only when it differs** from what is currently applied. Settled → `snap()`, in-flight → `show()` once. `seek.ts:100-103` already does the settled/in-flight split; the diffing against applied state is the new part. |
| `rotateList` | **Behaviour change.** An infinite `repeat: -1` loop is not seekable as a tween. Render item `floor((t - start) / STEP) % items.length`, where `STEP` is the per-item dwell time currently baked into `rotateList()` in `engine/components/effects/cinematic-anim.ts` — the implementation must hoist it into a named shared constant rather than re-deriving it, since this is a second consumer of a value that has so far had only one. Note `actionDuration` returns `0` for `rotateList`, so it occupies no time on the axis and its phase is measured from its own `start`. Same treatment §7a gave notes. Deletes the `loopers` ref: items step on the same schedule but derived rather than tween-driven. |
| `wait` | Pure time; nothing to render. |
| `click_gate` | Boundary marker (§4.4), never a visual. |
| `reveal_arrows`, `pulse_arrow`, `reveal_again` | One-shot runtime side effects. Fire once when crossed forward; re-armed by a rebuild. Not meaningfully scrubbable and not worth making so. |
| `note_*`, `cue` | Untouched — already the §7a reducer, rendered by `NoteField` from the clock `BeatStage` supplies. `cue` remains inert. |

**Estimation note.** Text is the obvious work; counter and media are the quiet half. Three of the
rows above are genuine behaviour changes (counter/media scrubbable, `rotateList` derived) and must
be called out in review rather than buried in a refactor diff.

---

## 6. `BeatStage` — one clock for three stages

`BeatStage` holds the transport ref and drives all three stages from the same `t`:

```
transport.seek(t)  →  CinematicSlide.renderAt(t)          // text, art, counters, media
                   →  NoteField.renderAt(scene, beatIndex, t)
                   →  ObjectStage.renderAt(scene, beatIndex, t)
```

`t` is beat-local throughout, which is already what the note and object reducers take.

The independent proxy timeline (`BeatStage.tsx:55-72`) is **deleted**, and with it the
KNOWN LIMITATION comment at lines 42-54 — deleted, not amended. That comment names this work as
its fix; §7b either earns the deletion or has not landed.

---

## 7. Testing — §7b's definition of done

### 7.1 The load-bearing property

> **Seek symmetry.** Reaching time `t` by forward play, by backward seek, and by direct jump
> must produce the same DOM.

That single property is what makes scrubbing trustworthy, and it is precisely what today's
architecture cannot satisfy. Write it first, and treat a failure of it as blocking — every other
test in §7b can be renegotiated during implementation; this one cannot.

### 7.2 Unit (vitest / jsdom)

- `beat-clock.ts` computes without a DOM; the existing `beatTimeline`/`beatDuration`/
  `actionDuration`/`isSeekable` tests move over unchanged (`tests/unit/seek.test.ts`,
  `action-duration-obj.test.ts`, `registry-notes.test.ts`).
- **Import-graph guard:** assert that the transitive imports of `note-state.ts` and
  `object-state.ts` contain no DOM-touching module. This is the one test that catches the class of
  regression the deep-dive records as invisible to CI, and it now covers the `notes.ts` edge
  (fixed in #31) and the `seek.ts` edge (fixed here) with one assertion.
- Fold determinism: `renderAt(t)` twice at the same `t` yields identical DOM.
- Counter and media values at arbitrary `t`.
- `rotateList` item index at arbitrary `t`.
- Art diffing: scrubbing within one art window issues **no** repeated `show()` calls.

### 7.3 e2e

- Existing `e2e/beatstage.spec.ts` stays green — playback is unchanged.
- **New gate-sync regression:** a beat combining `click_gate`, `obj_*`, and note actions; assert
  text, notes, and objects agree across the gate. This is the `BeatStage.tsx:42-54` bug getting an
  explicit test.
- Playback still gates: ArrowRight steps through segments rather than running past them.

Run e2e as `npm run test:e2e` — never a bare `npx playwright test`, and never with `--workers=1`
(see the deep-dive's globalSetup gotcha).

---

## 8. Implementation phases

Sequenced so each phase is independently reviewable and the suite stays green throughout.

1. **Extract `beat-clock.ts`.** Pure move, no behaviour change. Repoint all importers, delete
   `CinematicSlide`'s duplicate `introDuration`, add the import-graph guard. Green suite before
   anything else moves.
2. **`renderAt(t)` for text.** The fold, the cache, rebuild boundaries, seek symmetry tests. Text
   only; other kinds keep their current path so the suite stays green.
3. **Counter, media, art, nightlight, `rotateList`.** The remaining kinds, per §5. Largest phase.
4. **Transport + gates replace segments.** Expose `SlideTransport`; delete `segments`/
   `playSegment`; ticker-driven playback with gate pauses.
5. **Re-point `BeatStage`.** Delete the proxy timeline and the KNOWN LIMITATION comment; add the
   gate-sync e2e.
6. **Fold in static mode** (§4.5). Optional; drop it if phase 3 revealed risk on the print path.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| `CinematicSlide` renders **production decks**, and §7c's parity gate — the thing designed to catch exactly this — does not exist yet. | Keep forward playback visually identical; lean on the existing `beatstage` e2e; accept this deliberately rather than discovering it later. This is the single largest risk in §7b. |
| Counter/media conversion (§5) is larger than it looks. | Phase 3 is scoped alone for this reason. |
| Backward scrub past many destructive ops re-splits SplitText. | Bounded by actions since the last boundary. Measure before optimising — the rejected monotonic fast path is the remedy if it ever bites. |
| Three genuine behaviour changes hide inside a large refactor diff. | Enumerated in §5 and called out in review explicitly. |

---

## 10. Consequences & follow-ons

- **§7c is unblocked.** Its canvas swap becomes "mount `CinematicSlide` in `DeckCanvas` and drive
  it from the existing `CanvasHandle`", because §7b makes the two contracts the same shape.
- **`seek.ts` is reduced to a deletable shell** — only `renderBeatAt`/`applyAt` remain, so §7c's
  deletion no longer threatens the time axis.
- **Three folds collapse toward one.** `staticMode`, `renderBeatAt`, and `noteFieldStateAt` are
  three hand-written folds over the same timeline today; §7b removes one outright and makes the
  second deletable.
- **Two duplicated constant tables collapse to one**, closing the `introDuration` drift the
  deep-dive flags.
- **The purity contract is enforced, not just documented.** The import-graph guard (§7.2) turns an
  invariant that CI currently cannot see into one it can.
