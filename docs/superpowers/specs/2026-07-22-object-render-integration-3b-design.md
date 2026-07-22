# Object Render Integration — Deterministic Engine Playback of Scene Objects — Design Spec (3b)

- **Date:** 2026-07-22
- **Status:** Design spec (approved for planning)
- **Author of record:** Chris Oltyan (brainstormed with Claude)
- **Sub-project:** **3b** of sub-project **#3** ("object ↔ action binding + engine playback rendering") in the first-class object-model effort.
- **Branch point:** Branched from `main` — **#3a (PR #20) is merged**, so 3b builds on 3a's verbs/gating from `main`.
- **Companion docs:**
  - [`2026-07-22-object-action-binding-3a-design.md`](2026-07-22-object-action-binding-3a-design.md) — #3a, the verbs, gating contract, validation, binding UI (esp. §0.1/§0.2/§3/§4).
  - [`2026-07-21-object-layer-model-design.md`](2026-07-21-object-layer-model-design.md) — #1, the static object data model.
  - [`../../2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md) — north star (§7 real-runtime/seek — **deferred**, §8 validation).

---

## 0. Context — what 3b is, and what it deliberately is not

#3a shipped the **static, authorable, validatable** binding layer: the `obj_reveal`/`obj_move`/`obj_out` verbs (`engine/deck/types.ts`), their durations in `actionDuration` (`engine/authoring/seek.ts`), the gating contract (`lib/editor/object-gating.ts` — `revealedObjectIds`/`isGated`), dangling-target validation, and the object-centric "Animations" binding UI. **But objects are still inert in playback**: after authoring an `obj_reveal`, the action validates and shows in the timeline, yet nothing new animates under playback/scrub. Objects are drawn only by #2a's static editor overlay (`components/editor/ObjectsLayer.tsx`).

**3b makes objects render deterministically at their timeline-derived state at any time `t`, in the engine's real render paths.** It delivers a pure `objectStateAt` reducer as the single source of visual truth, rendered into both existing paths.

### 0.1 Explicitly out of scope (deferred to north-star §7)

Confirmed during brainstorm — the §7 deferral from 3a **still holds**:

- **No** driving the real GSAP `CinematicSlide` runtime as the editor canvas.
- **No** `seek(t)` transport surface over the GSAP master timeline.
- **No** time-pure particle rework (`note_emitter`/`note_circle`/`cue`).
- **No** retiring `seek.ts` behind a parity gate.

3b achieves object determinism **without** §7, by rendering a pure reducer into today's two paths. §7 remains an independent Tier-2 keystone.

### 0.2 Also out of scope for 3b

- **Cross-beat continuous playback in the editor** (auto-advance through beats). The editor scrubber remains per-beat; cross-beat object continuity comes from the reducer's fold (§3), not from a scene transport. If auto-advance is wanted later, it is a separate scrubber/transport change.
- **New schema.** 3b is render-only. `DeckDoc.version` stays `1`; no new persisted fields. All plumbing (scene objects + prior-beat context into the render components) is in-memory props.
- **New verbs, easing fields, or entrance/exit vocabulary** beyond what 3a shipped.

## 1. The topology 3b integrates into (verified against the code)

| Path | Where it is wired | How it renders today | Cross-beat context |
| --- | --- | --- | --- |
| **seek.ts** (`renderBeatAt`) | The **editor canvas**: `app/editor/page.tsx` → `components/editor/DeckCanvas.tsx`. Primary interactive surface; play/pause/scrub via `Timeline.tsx` drive it. | Pure DOM opacity/transform, **no GSAP**; renders **one beat at a time** (`flat.beat.timeline`) via `applyAt`. Objects fall to the `default` branch → drawn nothing. Mounts the #2a `ObjectsLayer` static overlay (z-index 10). | ❌ receives only the selected `FlatBeat`. |
| **CinematicSlide** (via **`BeatStage`**) | `engine/authoring/BeatStage.tsx` → `engine/components/layouts/CinematicSlide.tsx`. In **this repo** reachable only through dev routes (`app/dev/beatstage`, `app/dev/chrome`) + `e2e/beatstage.spec.ts`. The multi-beat production `<Slide>` sequencer lives downstream (mm-website), **not here**. | Real GSAP master timeline, **torn down + rebuilt per `beat.id`**. `media`/`media_move`/`media_out` use an id-keyed `Map<id,HTMLElement>` wiped per beat. | ❌ `CinematicSlideSlots = { sceneId, beat }` carries **no `scene.objects`** and no prior-beat state. |

**Consequences that shape the design:**

1. Neither path receives `scene.objects` today, and neither sees more than the current beat. 3b must plumb the scene's objects + prior-beat context into both render components (additive in-memory props — no schema change).
2. Cross-beat persistence is provided by the **reducer's fold of prior beats** (§3), not by DOM nodes surviving teardown. This sidesteps the "survive per-beat teardown" problem entirely: every mount computes object state from scratch as a pure function of `(scene, beatIndex, tLocal)`.

## 2. Guiding decisions (locked during brainstorm)

| Decision | Choice | Rationale |
| --- | --- | --- |
| **§7** | **Deferred** (see §0.1). | §7 is a large, orthogonal Tier-2 keystone (transport surface + time-pure particles). Objects reach determinism without it. |
| **Decomposition** | **One spec, one phased plan, one PR.** | The reducer's output shape is *defined by* what the two renderers need; splitting into separate PRs ships a reducer with no consumer or forces interface churn. Phases give clean review checkpoints without artificial seams. |
| **Time model** | **Per-beat-local `t` + folded prior beats.** `objectStateAt(scene, beatIndex, tLocal)`. | Matches today's per-beat scrubber and CinematicSlide's per-beat teardown; determinism is trivial because prior beats are always settled. Neither path has a scene-global clock. |
| **Source of truth** | **One reducer drives both paths.** Each path supplies only a clock (editor rAF/seek; production a proxy tween on the GSAP master). No per-object GSAP tweens. | Eliminates the drift risk of two animation implementations; playback stays gate/wait-synced because the proxy tween lives on the master. |
| **Overlay reconciliation** | **Mode-swap.** At rest → #2a overlay (all objects editable, gated badged); on play or scrub-off-rest → overlay hides, engine `ObjectStage` shows true state. | Smallest change; preserves 3a's direct-manipulation authoring exactly; playback shows truth. The correct "pop" when a gated object disappears on scrub is the intended semantics. |
| **Group semantics** | **Mirror #2a.** `obj_move` on a leaf moves only that leaf; on a group applies the x/y delta to the group box + all descendants; w/h/rot apply to the group box only. | Matches shipped authoring (`translateObjectBy`); objects are stored absolute in stage-space; invents no nested-coordinate math the codebase lacks. |
| **Entrances/exit** | Reuse 3a's `MediaIn` vocab (`fade`/`flyUp`/`pop`/`fadeSide`) for `obj_reveal.in`; `obj_out.out = "fade"`. Implemented as **pure math** in the reducer (mirroring the media tween *values*), not GSAP. Fixed smooth ease. | Single source of truth requires pure, seekable entrance math; no `ease` field (matches 3a's `media_move` fixed ease). |
| **Versioning** | Render-only; `DeckDoc.version` stays `1`. | No new persisted fields. |

## 3. The pure reducer — `lib/editor/object-state.ts` (the determinism gate)

The heart of 3b. A pure, exhaustively unit-tested function; jsdom cannot do real layout, so the reducer works entirely in the normalized 0–1 stage-space math the object model already uses.

### 3.1 Types

```ts
/** Resolved playback state of one object at an absolute time. All fields in the same
 *  0–1 stage-space as ObjectTransform; rot in degrees; opacity 0–1. */
export interface ObjectRenderState {
  x: number; y: number; w: number; h: number; rot: number;
  opacity: number;
  visible: boolean;   // false = do not paint (gated-and-unrevealed, or fully exited)
}

/** Object id → resolved state. Absent id = object not in this scene. */
export type ObjectStateMap = Map<string, ObjectRenderState>;
```

### 3.2 Signature & algorithm

```ts
export function objectStateAt(scene: Scene, beatIndex: number, tLocal: number): ObjectStateMap;
```

1. **Seed** every object (flattened depth-first, incl. group children) from its declared transform/opacity. `visible = !isGated(scene, id)` — gated objects start hidden (reuse `revealedObjectIds` from `object-gating.ts`).
2. **Fold prior beats** `scene.beats[0 .. beatIndex-1]`: for each, apply every `obj_*` action **at progress 1** in document order (settled end-state). This yields the current beat's **entry snapshot**.
3. **Interpolate the current beat** `scene.beats[beatIndex]`: build `[start,end)` windows with `beatTimeline(beat.timeline)` (reused from seek.ts so windows match timeline geometry), then for each `obj_*` window with `start ≤ tLocal`, apply it at local progress `p = clamp01((tLocal − start) / (end − start))` (windows with `end ≤ start` apply at `p = 1`).
4. Return the map.

**Determinism guarantees:** prior beats are always "done" (no accumulation ambiguity); the current beat is a pure function of `tLocal`; document order is the tie-breaker for same-window actions; `obj_move`'s absolute `to` interpolates from the object's *current* state (entry snapshot or a prior same-beat move), never from a delta.

### 3.3 Per-verb resolution

- **`obj_reveal`** (`in`, default `fade`): at `p`, `visible = true`, `opacity = easeIn(p)`, plus an entrance offset applied to `{x,y}` or scale:
  - `fade` — opacity only.
  - `flyUp` — `y += (1 − p) * FLY_DY` (mirrors CinematicSlide's `gsap.from({y:40})`, expressed in stage fraction).
  - `pop` — uniform scale `0.8 → 1` about the object center (applied as an effective w/h scale, or a CSS `scale()` the renderer maps — see §4), opacity in.
  - `fadeSide` — `x += (1 − p) * SIDE_DX`.
  At `p = 1` the object rests exactly at its (possibly moved) transform. A second `obj_reveal` on an already-visible object re-plays the entrance from its current state (fold makes this deterministic).
- **`obj_move`** (`to: ObjectMoveTarget`, absolute partial): interpolate each present axis of `{x,y,w,h,rot}` from current → `to` over `p` with a smooth ease; unspecified axes hold. **Group target:** compute the x/y delta `(to.x − boxX, to.y − boxY)` and add it to the group box **and every descendant's** `{x,y}`; apply present `w/h/rot` to the group box only.
- **`obj_out`** (`out = "fade"`): `opacity = 1 − easeOut(p)`; at `p = 1`, `visible = false`. A later `obj_reveal` re-reveals (fold order handles it).

Easing constants and `FLY_DY`/`SIDE_DX`/pop-scale live as named constants in `object-state.ts`, chosen to visually match the media tweens; they are asserted in unit tests, not tuned live.

## 4. Shared render component — `ObjectStage`

A new component (`components/editor/ObjectStage.tsx` or `engine/authoring/ObjectStage.tsx` — final location chosen in the plan; must be importable by both the editor and the engine authoring wrapper without a circular dep) that turns an `ObjectStateMap` into DOM.

- **Renders** one absolutely-positioned node per object, painted **back-to-front in depth-first document order** (index 0 backmost), reusing #2a's `renderContent(obj)` for text/image/shape (extracted/shared so the two layers cannot diverge on how an object looks). Group nodes paint nothing themselves (their children are flattened siblings), matching #2a.
- **`applyObjectState(node, state)`** — a pure DOM writer: sets `left/top/width/height` from `{x,y,w,h}`, `transform: rotate()` (and the pop scale during entrance), `opacity`, and `display:none` when `!visible`. This is the only place reducer output touches the DOM; both paths call it.
- **Stateless w.r.t. time**: `ObjectStage` holds refs to its object nodes and exposes an imperative `renderAt(scene, beatIndex, t)` that samples `objectStateAt` and applies. The caller owns the clock.
- **Z-band:** mounted above `ArtStage` (background) in the same band as the #2a overlay content, so objects sit over art and with/above the cinematic text layer. Exact ordering finalized in the plan against `.cin__stage`.

## 5. Editor canvas integration (seek path)

`components/editor/DeckCanvas.tsx`:

- Mount `<ObjectStage>` inside the canvas host, above `<ArtStage>`, resolving the scene from the current `flat` (the store already exposes `doc.scenes`; `flat.sceneId` + the beat's index within its scene give `(scene, beatIndex)`).
- Extend the existing `draw()` (and thus `seek`/`play`'s rAF step) to also call `objectStage.renderAt(scene, beatIndex, t.current)`. The reducer is sampled at exactly the same `t` the seek renderer uses, so text and objects stay frame-aligned.
- **Mode-swap** between the #2a overlay and `ObjectStage`:
  - **At rest** (not playing AND `t === 0`): render the #2a `ObjectsLayer` overlay (unchanged — all objects editable, gated badged); hide/omit `ObjectStage`.
  - **On play OR scrub-off-rest** (`playing || t > 0`): hide the overlay's content + handles; show `ObjectStage` at the reducer state.
  - The swap keys on DeckCanvas's existing play state + `t.current`. Returning the scrubber to `t = 0` while paused restores the authoring overlay.

## 6. Production preview integration (CinematicSlide via BeatStage)

Keeps the real engine truthful for downstream sequencing, exercised in-repo via a dev route + e2e.

- **Plumb scene context** into `BeatStage`: add optional props for the scene's `objects` and the prior beats (or the whole `Scene` + `beatIndex`). Additive; existing callers pass nothing and get today's behavior. `CinematicSlide`'s `slots` may be extended similarly, or `ObjectStage` may be mounted as a **sibling** of `CinematicSlide` inside `BeatStage` (preferred — keeps `CinematicSlide` untouched; final choice in the plan).
- **Clock:** mount `<ObjectStage>` as a sibling above `ArtStage`. Drive it from **one proxy tween** `{p:0}→{p:1}` added to the beat's GSAP master timeline (duration = the beat's object-animation span), whose `onUpdate` computes `tLocal = p * span` and calls `objectStage.renderAt(scene, beatIndex, tLocal)`. Because the proxy rides the master timeline, objects honor `wait`, `click_gate` pauses, and segment stepping automatically — with **zero per-object tweens**.
- On beat change the master rebuilds (existing behavior); `ObjectStage` re-derives from the reducer. No id-keyed persistence Map needed.
- The **static/reduced-motion path** in `CinematicSlide` (and BeatStage `animate=false`) renders objects at their **settled end-state** for the beat: `objectStateAt(scene, beatIndex, +∞)` (i.e., all current-beat windows at `p=1`).

## 7. Testing — 3b's definition of done

**Unit (vitest) — the pure core (the MM determinism gate):**

- **Fold / cross-beat:** object revealed in beat 0 is visible when `beatIndex=1,t=0`; gated object is hidden at `beatIndex=0,t=0` before its reveal window and visible after; `obj_out` in beat 1 → hidden at `beatIndex=2`; re-reveal after out → visible again.
- **Gating:** non-gated object visible from `t=0` at declared transform; gated object hidden until its reveal window opens.
- **Entrances/exit:** each `MediaIn` (`fade`/`flyUp`/`pop`/`fadeSide`) yields the asserted opacity + offset at `p∈{0,0.5,1}`; `obj_out` fades to `opacity 0`, `visible=false` at `p=1`.
- **obj_move:** absolute partial `to` interpolates present axes and holds absent ones; `p=0` = current state, `p=1` = `to`; interpolation base is the entry snapshot (and a prior same-beat move stacks correctly).
- **Groups:** `obj_move` on a group translates box + all descendants by the x/y delta; w/h/rot touch only the box; leaf `obj_move` leaves siblings untouched.
- **Boundaries:** `tLocal` before the first window, exactly on a boundary, past the last window; empty timeline; scene with no `obj_*`; unknown/dangling target (validated out by 3a, but reducer must not throw).
- **Determinism:** `objectStateAt` called twice with identical inputs returns identical maps (pure).

**Parity (vitest, jsdom):** a test that drives a small scene through **both** integration entry points at sampled times and asserts the resolved `ObjectStateMap` / applied DOM state is identical — the smaller in-scope echo of §7's parity gate (full cross-path pixel parity remains §7).

**Component (jsdom + @testing-library/react):**

- DeckCanvas mode-swap: overlay shown at rest; `ObjectStage` shown (overlay hidden) on play/scrub; a gated object is absent at `t=0` under scrub and present after its reveal window.
- `applyObjectState` writes the expected `left/top/width/height/transform/opacity/display` for a given `ObjectRenderState`.

**E2E (Playwright, CI-verified):**

- **Editor:** author a scene with a gated object + `obj_reveal`/`obj_move`/`obj_out`; scrub/play and assert the object appears/moves/disappears at the right times and is absent before its reveal.
- **BeatStage dev route:** a spec (new or extending `beatstage.spec.ts`) rendering a beat with objects, asserting the object paints at the settled state and animates under `animate`.

**Local gate:** `npm test` (vitest) + `npx tsc --noEmit -p .`. A fresh worktree may need `npm ci` before `next build`/Playwright run locally; never block a task on the missing `next` install — rely on CI for e2e if needed.

## 8. Implementation phases (one PR)

1. **Reducer + TDD.** `lib/editor/object-state.ts` (`objectStateAt`, `ObjectRenderState`, entrance/exit math, group rule) with the full §7 unit suite red→green. Pure; no rendering.
2. **`ObjectStage` + editor (seek) integration.** Extract/share `renderContent`; build `ObjectStage` + `applyObjectState`; mount in `DeckCanvas`; wire `draw`/`seek`/`play` to sample the reducer; implement the mode-swap. Component tests + editor e2e.
3. **CinematicSlide / BeatStage integration.** Plumb scene context; mount `ObjectStage` sibling; proxy-tween clock on the master; static/reduced end-state. BeatStage e2e.
4. **Reconciliation polish + parity.** Finalize overlay hide/show edge cases and z-order; parity test; docs/deep-dive sync.

## 9. Consequences & follow-ons

- **North star:** 3b is the object-model half of §7's determinism story delivered *without* §7 — a pure reducer proves objects can scrub deterministically. When §7 lands (real engine in canvas), `ObjectStage`'s pure-reducer pattern and `applyObjectState` transfer directly, and `objectStateAt` can feed the parity corpus.
- **`seek.ts`:** untouched for text/art/nightlight; objects render via the parallel `ObjectStage`, not by teaching `applyAt` a new case (keeps the seek renderer's per-beat purity intact and avoids entangling object cross-beat state into a per-beat function).
- **No version bump:** render-only; additive in-memory props; legacy/object-less decks render byte-identical to today.
- **Legacy coexistence:** `text`/`art`/`media`/`counter` render via their existing paths unchanged; objects are a parallel foreground layer.
