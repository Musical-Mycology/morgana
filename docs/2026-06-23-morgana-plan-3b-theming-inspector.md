# Morgana — Plan 3b: Sporekles Dark Theme + Inspector Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor (a) *look* like Musical Mycology's Sporekles **dark mode**, and (b) *edit* — a schema-driven Inspector that edits the selected action's properties live, backed by an **effect-descriptor registry** that also generalizes the canvas to render every action kind (closing the Plan-3a `clear`/all-kinds carry-in). Structural editing (drag, beat add/dupe/delete/reorder, undo/redo, autosave) is **Plan 3c**.

**Architecture:**
- **Theme:** vendor the Sporekles `--mm-*` token system into morgana + an editor "dark-surface" layer (`app/editor/theme.css`) that maps the Sporekles dark-surface semantics (`--mm-bg-deepest`/`--mm-fg-on-dark`/`--mm-accent-on-dark` = gold) into a tool-appropriate surface hierarchy. Restyle the existing shell + components from ad-hoc colors to the tokens. The deck **canvas content is never re-themed** — only the editor chrome wears Sporekles dark.
- **Registry:** `lib/editor/registry.ts` — one `EffectDescriptor` per `Action.kind` (label, icon, a `schema` of editable fields, `seekable`). The Inspector form is generated from `schema`; the canvas render dispatches per-kind through the registry (generalizing Plan 1's `renderBeatAt`, and finally handling `clear`).
- **Editing:** the store gains action-level selection + an in-memory `updateAction` (and `updateChrome`/`updateMeta`); the Inspector reads/writes the selected action via the schema. Edits update the store → the canvas re-renders live. **No persistence yet** (autosave is 3c) — edits are in-memory this plan.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zustand, Vitest, Playwright. Builds on Plan 3a (`DeckCanvas`, `useEditor`, 4-zone shell) + the engine `seek.ts`.

**Working dir:** `/Users/chris/projects/morgana` (`MG`). > **RUN ON: MYCOLOGICAL** for shell blocks.

---

## File Structure
```
morgana/
  app/mm-tokens.css                  # NEW: vendored Sporekles --mm-* token system (T1)
  app/editor/theme.css               # NEW: editor dark-surface hierarchy from the tokens (T1)
  app/editor/editor.css              # MODIFY: retheme to tokens (T2)
  components/editor/{Filmstrip,Timeline,Inspector}.tsx  # MODIFY: retheme (T2) + Inspector rebuild (T5)
  components/editor/Field.tsx        # NEW: themed form primitives (T2)
  lib/editor/registry.ts             # NEW: EffectDescriptor registry + schema (T3)
  lib/editor/paths.ts                # NEW: get/set "pos.x" path helpers (T3)
  lib/editor/render-action.ts        # NEW: registry-driven per-kind render (T4)
  engine/authoring/seek.ts           # MODIFY: renderBeatAt delegates to render-action + handles `clear` (T4)
  lib/editor/store.ts                # MODIFY: selectedAction + updateAction/updateChrome/updateMeta (T5/T6)
  components/editor/DeckSettings.tsx # NEW: edit DeckChrome/meta (T6)
  components/editor/DeckCanvas.tsx   # MODIFY: onTime useCallback note + re-render on action edits (T5)
  tests/unit/{registry,paths,render-action,store-edit}.test.ts
  e2e/{theme,inspector,deck-settings}.spec.ts
```

---

## Task 0: Branch
- [ ] `cd /Users/chris/projects/morgana && git checkout main && git pull --ff-only origin main && git checkout -b plan-3b-theming-inspector && git push -u origin plan-3b-theming-inspector`

---

## Task 1: Sporekles dark tokens + editor theme layer

**Files:** Create `app/mm-tokens.css`, `app/editor/theme.css`, `tests/unit/theme.test.ts`; Modify `app/globals.css`

- [ ] **Step 1: vendor the Sporekles `--mm-*` token system → `app/mm-tokens.css`**
Copy the `:root { … }` token block (color/type/space/radius/border/shadow/motion tokens) from mm-website's `app/sporekles-tokens.css` verbatim (the canonical seed). During execution, read `/Users/chris/projects/mm-website/.claude/worktrees/exciting-matsumoto-40d82f/app/sporekles-tokens.css` and copy its `:root` block (lines ~34–145). Keep the `.mm-*` component classes out for now (we only need the tokens).

- [ ] **Step 2: editor dark-surface layer → `app/editor/theme.css`**
Map Sporekles dark-surface semantics into a tool surface hierarchy (the confirmed mockup look):
```css
:root {
  --ed-bg-0: #231712;            /* app frame / toolbar / timeline base */
  --ed-bg-1: #2d1e15;            /* side panels: filmstrip / inspector */
  --ed-bg-2: #17110d;            /* canvas stage well (deck pops) */
  --ed-surface: var(--mm-mushroom);          /* #5c3d2e raised */
  --ed-fg: var(--mm-cream);                  /* #fdf3e4 */
  --ed-fg-muted: rgba(253,243,228,0.58);
  --ed-accent: var(--mm-gold);               /* #d4a843 selection / active / primary */
  --ed-accent-2: var(--mm-terracotta);       /* #c07850 sparing */
  --ed-line: rgba(253,243,228,0.12);
  --ed-line-2: rgba(253,243,228,0.22);
  --ed-disp: var(--mm-font-display);         /* Londrina Solid */
  --ed-body: var(--mm-font-body);            /* Atkinson Hyperlegible */
  --ed-mono: var(--mm-font-mono);
  --ed-radius: 10px; --ed-radius-pill: 999px;
  --ed-shadow: 0 8px 30px rgba(0,0,0,0.4);
}
```

- [ ] **Step 3: import both in `app/globals.css`** (after tailwind + engine tokens):
```css
@import "tailwindcss";
@import "../engine/engine-tokens.css";
@import "./mm-tokens.css";
@import "./editor/theme.css";
```
(`/editor/page.tsx` also imports `./editor.css` for the layout.)

- [ ] **Step 4: test the tokens exist** — `tests/unit/theme.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
test("mm-tokens + editor theme declare the editor's key vars", () => {
  const mm = readFileSync(join(process.cwd(), "app/mm-tokens.css"), "utf8");
  const ed = readFileSync(join(process.cwd(), "app/editor/theme.css"), "utf8");
  for (const v of ["--mm-mushroom", "--mm-cream", "--mm-gold", "--mm-font-display"]) expect(mm).toContain(v);
  for (const v of ["--ed-bg-0", "--ed-fg", "--ed-accent", "--ed-line"]) expect(ed).toContain(v);
});
```
- [ ] **Step 5:** `npm test -- tests/unit/theme.test.ts && npm run build`; commit `feat(editor): vendor Sporekles --mm-* tokens + dark editor theme layer`.

---

## Task 2: Retheme the shell + components + form primitives

**Files:** Modify `app/editor/editor.css`, `components/editor/{Filmstrip,Timeline}.tsx`, `app/editor/page.tsx` toolbar; Create `components/editor/Field.tsx`

- [ ] **Step 1: retheme `app/editor/editor.css`** — replace the ad-hoc colors (`#1c130d`, `rgba(255,255,255,…)`, `var(--color-mm-dark-brown)`) with the `--ed-*` tokens:
```css
.ed { position: fixed; inset: 0; display: grid; grid-template-columns: 200px 1fr 280px; grid-template-rows: 48px 1fr 180px;
  grid-template-areas: "bar bar bar" "film canvas inspector" "film timeline timeline"; background: var(--ed-bg-0); color: var(--ed-fg); font-family: var(--ed-body); }
.ed__bar { grid-area: bar; display: flex; align-items: center; gap: 12px; padding: 0 14px; background: var(--ed-bg-2); border-bottom: 1px solid var(--ed-line); }
.ed__brand { font-family: var(--ed-disp); font-size: 21px; color: var(--ed-accent); line-height: 1; }
.ed__film { grid-area: film; overflow: auto; background: var(--ed-bg-1); border-right: 1px solid var(--ed-line); }
.ed__canvas { grid-area: canvas; display: flex; align-items: center; justify-content: center; padding: 16px; overflow: hidden; min-height: 0; min-width: 0; background: var(--ed-bg-0); }
.ed__inspector { grid-area: inspector; overflow: auto; background: var(--ed-bg-1); border-left: 1px solid var(--ed-line); padding: 12px; }
.ed__timeline { grid-area: timeline; background: var(--ed-bg-2); border-top: 1px solid var(--ed-line); padding: 12px 14px; }
.ed__lbl { font-family: var(--ed-disp); letter-spacing: 0.06em; font-size: 11px; color: var(--ed-fg-muted); text-transform: uppercase; padding: 9px 12px 4px; }
.ed__pill { font-family: var(--ed-disp); letter-spacing: 0.04em; font-size: 12px; border-radius: var(--ed-radius-pill); padding: 7px 15px; border: 1.5px solid transparent; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.ed__pill--gold { background: var(--ed-accent); color: #3a2318; }
.ed__pill--ghost { background: transparent; color: var(--ed-fg); border-color: var(--ed-line-2); }
.ed__beat { display: block; width: 100%; text-align: left; padding: 9px 12px; border: 0; border-left: 3px solid transparent; cursor: pointer; background: transparent; color: var(--ed-fg); font-family: var(--ed-body); font-size: 12.5px; }
.ed__beat[aria-current="true"] { border-left-color: var(--ed-accent); background: rgba(212,168,67,0.14); }
.ed__chip { font-family: var(--ed-body); font-size: 11px; padding: 4px 9px; border-radius: 6px; background: rgba(253,243,228,0.08); border: 1px solid var(--ed-line); cursor: pointer; }
.ed__chip[aria-current="true"] { border-color: var(--ed-accent); color: var(--ed-accent); }
```

- [ ] **Step 2: themed form primitives `components/editor/Field.tsx`** — a single component rendering a labeled field from a registry `Field` (text/textarea/number/select/range), styled with `--ed-*`:
```tsx
"use client";
import type { Field as FieldSpec } from "@/lib/editor/registry";

const base: React.CSSProperties = { background: "var(--ed-bg-2)", border: "1px solid var(--ed-line)", borderRadius: 8, color: "var(--ed-fg)", fontFamily: "var(--ed-body)", fontSize: 12.5, padding: "7px 9px", width: "100%" };

export function Field({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 11, color: "var(--ed-fg-muted)", marginBottom: 4 }}>{spec.label}</span>
      {spec.type === "textarea" ? (
        <textarea style={{ ...base, minHeight: 48, resize: "vertical" }} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      ) : spec.type === "select" ? (
        <select style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {spec.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : spec.type === "range" || spec.type === "number" ? (
        <input type={spec.type === "range" ? "range" : "number"} style={spec.type === "range" ? { width: "100%" } : base}
          min={spec.min} max={spec.max} step={spec.step} value={Number(value ?? 0)} onChange={(e) => onChange(parseFloat(e.target.value))} />
      ) : (
        <input style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
```

- [ ] **Step 3: apply `ed__*` classes** in `Filmstrip.tsx` (use `.ed__beat`/`.ed__lbl`), `Timeline.tsx` (use `.ed__chip` for blocks + `.ed__pill` buttons + `--ed-*` colors), and the `page.tsx` toolbar (`.ed__brand`, `.ed__pill`s). Replace inline ad-hoc colors with the tokens / classes. (Match the confirmed mockup: gold selection, pill buttons, cream-on-brown.)

- [ ] **Step 4: e2e `e2e/theme.spec.ts`** — sanity that the editor renders in the dark theme:
```ts
import { expect, test } from "@playwright/test";
test("editor chrome uses the Sporekles dark surfaces", async ({ page }) => {
  await page.goto("/editor");
  const bar = page.locator(".ed__bar");
  // toolbar background is the deep brown well (rgb of #17110d), not transparent/white
  await expect(bar).toHaveCSS("background-color", "rgb(23, 17, 13)");
  const brand = page.locator(".ed__brand");
  await expect(brand).toHaveText("Morgana");
});
```
- [ ] **Step 5:** `npm run seed:demo && npx tsc --noEmit && npm test && npm run test:e2e -- e2e/theme.spec.ts`; commit `feat(editor): retheme shell + components to Sporekles dark`.

---

## Task 3: Effect-descriptor registry + path helpers

**Files:** Create `lib/editor/paths.ts`, `lib/editor/registry.ts`, `tests/unit/{paths,registry}.test.ts`

- [ ] **Step 1 (TDD): `tests/unit/paths.test.ts`**
```ts
import { expect, test } from "vitest";
import { getPath, setPath } from "@/lib/editor/paths";
test("get/set nested dotted paths immutably", () => {
  const a = { value: "hi", pos: { x: 0.1, y: 0.2 } };
  expect(getPath(a, "value")).toBe("hi");
  expect(getPath(a, "pos.x")).toBe(0.1);
  const b = setPath(a, "pos.x", 0.5);
  expect(getPath(b, "pos.x")).toBe(0.5);
  expect(a.pos.x).toBe(0.1);            // original unmutated
  expect(setPath(a, "size", "lg")).toMatchObject({ size: "lg" });
});
```
- [ ] **Step 2: `lib/editor/paths.ts`**
```ts
export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const clone: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = { ...((cur[keys[i]] as Record<string, unknown>) ?? {}) };
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return clone as T;
}
```
- [ ] **Step 3 (TDD): `tests/unit/registry.test.ts`**
```ts
import { expect, test } from "vitest";
import { descriptorFor, REGISTRY } from "@/lib/editor/registry";
test("text descriptor exposes the editable fields", () => {
  const d = descriptorFor({ kind: "text", value: "x", in: "fade" });
  expect(d.kind).toBe("text");
  expect(d.schema.map((f) => f.key)).toEqual(expect.arrayContaining(["value", "in", "speed", "pos.x", "pos.y"]));
  expect(d.seekable).toBe(true);
});
test("every Action kind resolves to a descriptor (generic fallback)", () => {
  for (const kind of ["text","wait","art","nightlight","click_gate","clear","fade_out","note_emitter","counter_show","media"] as const) {
    expect(descriptorFor({ kind } as never).kind).toBeDefined();
  }
});
test("note_emitter is non-seekable", () => {
  expect(descriptorFor({ kind: "note_emitter" } as never).seekable).toBe(false);
});
```
- [ ] **Step 4: `lib/editor/registry.ts`**
```ts
import type { Action, TextIn } from "@/engine/deck/types";

export type FieldType = "text" | "textarea" | "number" | "select" | "range";
export interface Field { key: string; label: string; type: FieldType; options?: { value: string; label: string }[]; min?: number; max?: number; step?: number; }
export interface EffectDescriptor { kind: string; label: string; icon: string; schema: Field[]; seekable: boolean; }

const opts = (...vs: string[]) => vs.map((v) => ({ value: v, label: v }));
const TEXT_INS: TextIn[] = ["flyUp", "fade", "fadeSide", "cursive", "letterFly", "letterUp", "wordUp", "blurIn", "typewriter"];
const ART_MODES = ["cut", "fade", "crossfade", "morph", "dissolve"];

export const REGISTRY: Record<string, EffectDescriptor> = {
  text: { kind: "text", label: "Text", icon: "ti-text-caption", seekable: true, schema: [
    { key: "value", label: "Value", type: "textarea" },
    { key: "in", label: "Effect", type: "select", options: TEXT_INS.map((v) => ({ value: v, label: v })) },
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
    { key: "align", label: "Align", type: "select", options: opts("left", "center", "right") },
    { key: "speed", label: "Speed", type: "range", min: 0.2, max: 3, step: 0.1 },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
  ] },
  wait: { kind: "wait", label: "Wait", icon: "ti-clock", seekable: true, schema: [{ key: "ms", label: "Milliseconds", type: "number", min: 0, step: 50 }] },
  art: { kind: "art", label: "Art", icon: "ti-photo", seekable: true, schema: [
    { key: "art.to", label: "Panel(s)", type: "text" },
    { key: "art.mode", label: "Transition", type: "select", options: ART_MODES.map((v) => ({ value: v, label: v })) },
    { key: "art.durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  nightlight: { kind: "nightlight", label: "Nightlight", icon: "ti-moon", seekable: true, schema: [
    { key: "to", label: "Level (0–1)", type: "range", min: 0, max: 1, step: 0.05 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  click_gate: { kind: "click_gate", label: "Click gate", icon: "ti-hand-click", seekable: true, schema: [] },
  clear: { kind: "clear", label: "Clear", icon: "ti-eraser", seekable: true, schema: [] },
  fade_out: { kind: "fade_out", label: "Fade out", icon: "ti-square-rounded-x", seekable: true, schema: [{ key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 }] },
  note_emitter: { kind: "note_emitter", label: "Note emitter", icon: "ti-music", seekable: false, schema: [
    { key: "color", label: "Color", type: "text" }, { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 }, { key: "freq", label: "Notes/sec", type: "number", min: 0, step: 0.5 },
  ] },
};

const GENERIC = (kind: string): EffectDescriptor => ({ kind, label: kind, icon: "ti-square", seekable: kind !== "note_circle" && kind !== "cue", schema: [] });

export function descriptorFor(a: Pick<Action, "kind">): EffectDescriptor {
  return REGISTRY[a.kind] ?? GENERIC(a.kind);
}
```
- [ ] **Step 5:** `npm test -- tests/unit/paths.test.ts tests/unit/registry.test.ts && npx tsc --noEmit`; commit `feat(editor): effect-descriptor registry + path helpers`.

---

## Task 4: Registry-driven canvas render (closes the `clear`/all-kinds carry-in)

**Files:** Create `lib/editor/render-action.ts`, `tests/unit/render-action.test.ts`; Modify `engine/authoring/seek.ts`

- [ ] **Step 1: `lib/editor/render-action.ts`** — a per-kind `applyAt(action, p, ctx)` covering text (all `in` at progress: opacity + the transform per effect), art (snap/show), wait/gate (no-op), `clear` (reset textHost), `fade_out` (opacity ramp), nightlight (`ctx.setNight`), note_* (non-seekable: no-op under scrub). This GENERALIZES the spike's text+art `applyAt`. (Full code: extend the existing `applyAt` in `seek.ts` to a `switch` over all kinds; particle kinds early-return.)

- [ ] **Step 2: make `renderBeatAt` `clear`-aware in `engine/authoring/seek.ts`** — during the replay loop, when the action at/under `t` is `clear` (or `fade_out` completed), reset `ctx.textHost.innerHTML = ""` before applying later actions, so a `clear → text` sequence doesn't stack. Add a `SeekCtx.setNight?: (n: number) => void` so nightlight renders. Delegate per-kind work to `render-action.ts`.

- [ ] **Step 3 (TDD): `tests/unit/render-action.test.ts`** — assert (jsdom) that rendering a beat `[text A, clear, text B]` at the end shows ONLY "B" (not "A B"); and a `nightlight` action calls `setNight`. (Drive `renderBeatAt` against a jsdom `textHost` + a stub `setNight`/`art`.)
```ts
import { expect, test } from "vitest";
import { renderBeatAt } from "@/engine/authoring/seek";
import type { Action } from "@/engine/deck/types";
test("clear resets text so a clear→text sequence doesn't stack", () => {
  const host = document.createElement("div");
  const tl: Action[] = [{ kind: "text", value: "A", in: "fade" }, { kind: "clear" }, { kind: "text", value: "B", in: "fade" }];
  renderBeatAt(tl, 99, { textHost: host, art: null });
  expect(host.textContent).toContain("B");
  expect(host.textContent).not.toContain("A");
});
```
- [ ] **Step 4: verify the existing scrub + canvas e2e still pass** (the generalization must not regress text/art): `npm test && npm run test:e2e -- e2e/spike.spec.ts e2e/deck-canvas.spec.ts`. Both green.
- [ ] **Step 5:** commit `feat(canvas): registry-driven render — all action kinds + clear handling`.

---

## Task 5: Action selection + schema-driven Inspector (live edit)

**Files:** Modify `lib/editor/store.ts`, `components/editor/{Timeline,Inspector,DeckCanvas}.tsx`, `app/editor/page.tsx`; Create `tests/unit/store-edit.test.ts`, `e2e/inspector.spec.ts`

- [ ] **Step 1 (TDD): store gains `selectedAction` + `updateAction`** — `tests/unit/store-edit.test.ts`:
```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";
const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] }] };
beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null }));
test("updateAction edits the selected action immutably and refreshes beats", () => {
  useEditor.getState().load(doc);
  useEditor.getState().updateAction(0, 0, "value", "bye");
  const a = useEditor.getState().beats[0].beat.timeline[0];
  expect(a).toMatchObject({ value: "bye" });
  // the underlying doc scene is updated too
  expect(useEditor.getState().doc!.scenes[0].beats[0].timeline[0]).toMatchObject({ value: "bye" });
});
```
- [ ] **Step 2: extend `lib/editor/store.ts`** — add `selectedAction: number | null`, `selectAction(i)`, and `updateAction(beatIdx, actionIdx, path, value)` that uses `setPath` to immutably patch `doc.scenes[*].beats[*].timeline[actionIdx]`, then re-derives `beats` via `flattenBeats`. (Map the flat beat index back to scene/beat — reuse the flatten order.)
- [ ] **Step 3: Timeline chips select an action** — clicking a chip calls `selectAction(i)`; the selected chip gets `aria-current` (gold via `.ed__chip[aria-current]`).
- [ ] **Step 4: rebuild `components/editor/Inspector.tsx`** — when an action is selected, look up `descriptorFor(action)`, render its `schema` via `<Field>`, wiring each field's value (`getPath(action, key)`) and `onChange` → `updateAction(selected, selectedAction, key, v)`. Header shows the descriptor `label` + icon. No selection → the placeholder.
- [ ] **Step 5: canvas re-renders on edit** — `DeckCanvas`'s `flat` prop is the selected beat from the store; since `updateAction` produces a new `beats` array (new `flat` object), the `useEffect([flat])` redraws. Also wrap the shell's `onTime` in `useCallback` (closes the Plan-3a carry-in: avoids rebuilding the handle each frame) and add it to `DeckCanvas`'s effect deps.
- [ ] **Step 6: e2e `e2e/inspector.spec.ts`** — select beat 2 → select its text chip → the inspector shows a "Value" field → edit it → the canvas text updates live:
```ts
import { expect, test } from "@playwright/test";
test("editing a text action's value updates the canvas live", async ({ page }) => {
  await page.goto("/editor");
  await page.getByTestId("filmstrip").getByRole("button").nth(1).click();   // beat 2
  await page.getByTestId("timeline").locator(".ed__chip").first().click();  // select first action
  const value = page.getByTestId("inspector").locator("textarea").first();
  await value.fill("Edited live");
  await page.getByTestId("scrub").evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, "99"); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByText("Edited live")).toBeVisible();
});
```
- [ ] **Step 7:** `npm test && npm run test:e2e -- e2e/inspector.spec.ts`; commit `feat(editor): action selection + schema-driven inspector (live edit)`.

---

## Task 6: Deck Settings panel (chrome + meta)

**Files:** Create `components/editor/DeckSettings.tsx`; Modify `lib/editor/store.ts` (`updateMeta`/`updateChrome`), `app/editor/page.tsx` (a "Deck settings" toggle in the toolbar/timeline → shows the panel in the inspector zone)

- [ ] **Step 1: store `updateMeta(patchPath, value)`** — immutably patch `doc.meta` (e.g. `title`, `chrome.splash.tagline`, `chrome.wordmark`); add a unit assertion mirroring `updateAction`.
- [ ] **Step 2: `components/editor/DeckSettings.tsx`** — themed fields for `meta.title`, `meta.chrome.splash.tagline`, `meta.chrome.splash.logo`, `meta.chrome.wordmark`, and a small editor for `meta.chrome.ending.ctas` (label/href rows). Each wired to `updateMeta`. Renders in the inspector zone when "Deck settings" is active.
- [ ] **Step 3: toggle** — a `.ed__pill--ghost` "Deck settings" button (toolbar) flips a local `showSettings`; the inspector zone renders `<DeckSettings>` when on, else `<Inspector>`.
- [ ] **Step 4: e2e `e2e/deck-settings.spec.ts`** — open Deck settings → edit the title → toolbar title text updates. `npm test && npm run test:e2e -- e2e/deck-settings.spec.ts`.
- [ ] **Step 5:** commit `feat(editor): deck settings panel (chrome + meta, in-memory)`.

---

## Task 7: Full suite + carry-in cleanups

**Files:** Modify `engine/deck/cinematic-style.ts` (stale comment), `engine/authoring/BeatStage.tsx` (the `deck__stage` class), `playwright.config.ts` (standalone server)

- [ ] **Step 1: tidy the Plan-3a carry-ins** — fix the stale "vmin/window" doc comment in `engine/deck/cinematic-style.ts` to say container-query units; rename/justify the `deck__stage` wrapper class in `BeatStage.tsx` (or drop it — confirm nothing queries it); switch `playwright.config.ts` `webServer.command` to `npm run seed:demo && npm run build && node .next/standalone/server.js` to silence the `next start` + standalone warning (copy `public/` + `.next/static` into standalone if needed, or keep `npm start` — the simplest reliable form that runs; do whichever keeps all e2e green).
- [ ] **Step 2: full suite**
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 | xargs kill -9 2>/dev/null || true
npm run seed:demo && npx tsc --noEmit && npm test && npm run test:e2e
```
Expected: tsc clean; all units green; ALL e2e pass (beatstage, spike, chrome, deck-canvas, editor, theme, inspector, deck-settings).
- [ ] **Step 3:** commit `chore(editor): Plan-3a carry-in cleanups + full suite green`.

---

## Plan 3b Done — Definition of Done
- The editor wears **Sporekles dark mode** (tokens + dark-surface chrome; deck content untouched).
- An **effect-descriptor registry** drives a schema-generated **Inspector** that edits the selected action's properties **live** (canvas updates in-memory); a **Deck Settings** panel edits `DeckMeta.chrome`/title.
- The canvas renders **all action kinds** and finally honors `clear` (Plan-3a carry-in closed); the `onTime`/comment/`deck__stage`/standalone carry-ins are tidied.
- All unit + e2e green; `npm run build` succeeds. (Persistence/undo/structural editing/drag = Plan 3c.)

## Self-Review (completed during authoring)
- **Spec coverage:** implements the registry + inspector + Deck-Settings + theming halves of spec items 7/9 and the 3a carry-ins. Drag-placement, structural mutations, undo/redo, autosave = **Plan 3c**.
- **Placeholder scan:** real code throughout; the one "copy from source" is the Sporekles token block (named exactly: mm-website `app/sporekles-tokens.css` `:root`).
- **Type consistency:** `EffectDescriptor`/`Field`/`descriptorFor` (T3) feed `Field.tsx` (T2) + Inspector (T5); `getPath`/`setPath` (T3) feed `updateAction`/`updateMeta` (T5/T6); `renderBeatAt` (T4) keeps Plan 1's signature plus an optional `setNight`. `--ed-*`/`--mm-*` tokens are used consistently across editor.css + components.

## What follows — Plan 3c (Structural Editing)
Canvas drag-placement (text `pos` handles overlaid on the in-DOM stage) · filmstrip + store structural mutations (add/dupe/delete/reorder beats & scenes) · undo/redo (Zustand history of `doc`) · debounced autosave via `PUT /api/decks/:id` (persist edits) · richer per-kind inspector schemas (counter/media/rotateList) + on-stage handles for notes/counter/media.
