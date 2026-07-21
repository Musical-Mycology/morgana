# In-App TS Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing `deckDocToModule` serializer through the editor UI as an **Export** panel with Copy + Download, so a deck can be exported to a TS module without touching code.

**Architecture:** A new client-side `ExportPanel` component reads the in-memory `doc` from the editor store and calls the pure `deckDocToModule(doc)` in the browser (no API). It lives in the existing bottom-right panel slot; the slot's `showSettings` boolean generalizes to a three-way `panel` enum (`inspector | settings | export`) driven by an added toolbar pill.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Zustand editor store, vitest + @testing-library/react (jsdom), Playwright.

**Spec:** [`docs/superpowers/specs/2026-07-20-in-app-ts-export-design.md`](../specs/2026-07-20-in-app-ts-export-design.md)

## Global Constraints

- **Client-side only** — no API route; the panel calls `deckDocToModule(doc)` in the browser on the store's in-memory deck.
- **Do NOT change** `lib/bridge/export-ts.ts`, the engine, or the deck format. The serializer is used as-is.
- **Defaults only** — emit with `deckDocToModule(doc)` (no `constName`/`typesImport` args, no UI fields).
- **Panel state** — replace the `showSettings: boolean` in `app/editor/page.tsx` with `panel: "inspector" | "settings" | "export"`; panels are mutually exclusive in the bottom-right slot.
- **Test-ids (exact):** toolbar pill `export-toggle`; panel container `export-panel`; code textarea `export-code`; buttons `export-copy` and `export-download`.
- **Download filename:** `${doc.meta.id}.ts`.
- The existing `deck-settings.spec.ts` and `inspector.spec.ts` must still pass (the panel refactor must not regress them).

---

### Task 1: `ExportPanel` component + unit tests

Build the standalone, store-connected panel and its unit tests. It is fully testable in isolation (rendered directly with a seeded store) before any wiring.

**Files:**
- Create: `components/editor/ExportPanel.tsx`
- Create: `tests/unit/export-panel.test.tsx`

**Interfaces:**
- Consumes: `useEditor` from `@/lib/editor/store` (`doc: DeckDoc | null`, `load(doc)`); `deckDocToModule` from `@/lib/bridge/export-ts` (signature `deckDocToModule(doc: DeckDoc): string`); `DeckDoc` from `@/engine/deck-doc`.
- Produces: `export function ExportPanel(): JSX.Element` — rendered by `app/editor/page.tsx` in Task 2 when `panel === "export"`.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/export-panel.test.tsx`:

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { ExportPanel } from "@/components/editor/ExportPanel";
import type { DeckDoc } from "@/engine/deck-doc";

const deck: DeckDoc = {
  version: 1,
  meta: { id: "unit-export", title: "Unit Export" },
  scenes: [{ id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "hello", in: "fade" }] }] }],
};

afterEach(() => {
  cleanup();
  useEditor.setState({ doc: null });
});

test("renders the generated module for the loaded deck", () => {
  useEditor.getState().load(deck);
  render(<ExportPanel />);
  const code = screen.getByTestId("export-code") as HTMLTextAreaElement;
  expect(code.value).toContain("export const scenes: Scene[]");
  expect(code.value).toContain('"kind": "text"');
  expect(code.value).toContain("hello");
});

test("shows the no-deck guard when no deck is loaded", () => {
  useEditor.setState({ doc: null });
  render(<ExportPanel />);
  expect(screen.getByTestId("export-panel").textContent).toContain("No deck.");
  expect(screen.queryByTestId("export-code")).toBeNull();
  expect(screen.queryByTestId("export-copy")).toBeNull();
});

test("Copy writes the module text to the clipboard", async () => {
  useEditor.getState().load(deck);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<ExportPanel />);
  const expected = (screen.getByTestId("export-code") as HTMLTextAreaElement).value;
  fireEvent.click(screen.getByTestId("export-copy"));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/export-panel.test.tsx`
Expected: FAIL — cannot resolve `@/components/editor/ExportPanel` (module doesn't exist yet).

- [ ] **Step 3: Implement `ExportPanel.tsx`**

Create `components/editor/ExportPanel.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { deckDocToModule } from "@/lib/bridge/export-ts";

export function ExportPanel() {
  const doc = useEditor((s) => s.doc);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const code = useMemo(() => (doc ? deckDocToModule(doc) : ""), [doc]);

  if (!doc) {
    return (
      <div className="ed__inspector" data-testid="export-panel">
        <p style={{ opacity: 0.6 }}>No deck.</p>
      </div>
    );
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyLabel("Copied");
      setTimeout(() => setCopyLabel("Copy"), 1500);
    } catch {
      // Fallback for insecure context / denied permission: select the text so the user can ⌘C.
      document.querySelector<HTMLTextAreaElement>('[data-testid="export-code"]')?.select();
      setCopyLabel("Copy failed — select + ⌘C");
      setTimeout(() => setCopyLabel("Copy"), 2500);
    }
  };

  const onDownload = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.meta.id}.ts`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ed__inspector" data-testid="export-panel">
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14, marginBottom: 11 }}>Export</div>
      <textarea
        data-testid="export-code"
        readOnly
        value={code}
        style={{ width: "100%", height: 260, fontFamily: "var(--ed-mono)", fontSize: 12, resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="ed__pill ed__pill--ghost" data-testid="export-copy" onClick={onCopy}>{copyLabel}</button>
        <button className="ed__pill ed__pill--ghost" data-testid="export-download" onClick={onDownload}>Download .ts</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/export-panel.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/editor/ExportPanel.tsx tests/unit/export-panel.test.tsx
git commit -m "feat(editor): add ExportPanel (deck → TS module, copy + download)"
```

---

### Task 2: Wire Export into the editor toolbar + e2e

Add the toolbar pill, generalize the panel state to a three-way enum, render `ExportPanel`, and cover the flow end-to-end.

**Files:**
- Modify: `app/editor/page.tsx` (import + panel state + pill + slot render)
- Create: `e2e/export-ts.spec.ts`

**Interfaces:**
- Consumes: `ExportPanel` from `@/components/editor/ExportPanel` (Task 1); existing `DeckSettings`, `Inspector`; the deck API (`POST`/`PUT`/`DELETE /api/decks`).
- Produces: nothing downstream (final task).

- [ ] **Step 1: Add the import**

In `app/editor/page.tsx`, after the existing `import { DeckSettings } from "@/components/editor/DeckSettings";` line, add:

```tsx
import { ExportPanel } from "@/components/editor/ExportPanel";
```

- [ ] **Step 2: Replace the `showSettings` state with a three-way panel enum**

In `app/editor/page.tsx`, replace this line:

```tsx
  const [showSettings, setShowSettings] = useState(false);
```

with:

```tsx
  type Panel = "inspector" | "settings" | "export";
  const [panel, setPanel] = useState<Panel>("inspector");
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? "inspector" : p));
```

- [ ] **Step 3: Update the Deck-settings pill and add the Export pill**

In `app/editor/page.tsx`, replace this line:

```tsx
        <button className="ed__pill ed__pill--ghost" data-testid="deck-settings-toggle" onClick={() => setShowSettings(v => !v)}>Deck settings</button>
```

with these two lines:

```tsx
        <button className="ed__pill ed__pill--ghost" data-testid="deck-settings-toggle" onClick={() => togglePanel("settings")}>Deck settings</button>
        <button className="ed__pill ed__pill--ghost" data-testid="export-toggle" onClick={() => togglePanel("export")}>Export</button>
```

- [ ] **Step 4: Update the slot render**

In `app/editor/page.tsx`, replace this line:

```tsx
      {showSettings ? <DeckSettings /> : <Inspector />}
```

with:

```tsx
      {panel === "settings" ? <DeckSettings /> : panel === "export" ? <ExportPanel /> : <Inspector />}
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Write the e2e spec**

Create `e2e/export-ts.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// Uses a THROWAWAY deck so the seeded demo stays pristine.
test("exports the current deck as a TS module and downloads it", async ({ page, request }) => {
  const id = "e2e-export";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Export" }, scenes: [
    { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "exported", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Export" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);

  // Open the Export panel — the generated module reflects the deck.
  await page.getByTestId("export-toggle").click();
  await expect(page.getByTestId("export-panel")).toBeVisible();
  const code = page.getByTestId("export-code");
  await expect(code).toHaveValue(/export const scenes: Scene\[\]/);
  await expect(code).toHaveValue(/exported/);

  // Panels are mutually exclusive: Inspector is gone; switching to Deck settings swaps panels.
  await expect(page.getByTestId("inspector")).toHaveCount(0);
  await page.getByTestId("deck-settings-toggle").click();
  await expect(page.getByTestId("deck-settings")).toBeVisible();
  await expect(page.getByTestId("export-panel")).toHaveCount(0);

  // Re-open Export and download — the file is named after the deck id.
  await page.getByTestId("export-toggle").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-download").click(),
  ]);
  expect(download.suggestedFilename()).toBe("e2e-export.ts");

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 7: Run the new e2e spec**

Run: `CI=1 npx playwright test export-ts.spec.ts`
Expected: PASS under `[default]` (:3000). (`CI=1` triggers global-setup's `next build`, ~2 min — expected.)

- [ ] **Step 8: Run the specs the refactor could regress**

Run: `CI=1 npx playwright test deck-settings.spec.ts inspector.spec.ts export-ts.spec.ts`
Expected: all PASS — the `showSettings` → `panel` refactor keeps Deck settings and the default Inspector working.

- [ ] **Step 9: Commit**

```bash
git add app/editor/page.tsx e2e/export-ts.spec.ts
git commit -m "feat(editor): add Export toolbar pill + panel; e2e for deck→TS export"
```

---

### Task 3: Docs — README feature list

Reflect the now-reachable export in the user-facing README so it isn't described as code-only.

**Files:**
- Modify: `README.md` (the "What's in the editor today" section — the toolbar/panel description)

**Interfaces:** none.

- [ ] **Step 1: Locate the editor-features description**

Run: `grep -n "Deck settings\|Export\|deckDocToModule\|export" README.md`
Expected: shows where the editor's toolbar/panels are described (and confirms whether export is mentioned as lib-only).

- [ ] **Step 2: Add a one-line mention of the Export panel**

In `README.md`, in the section describing the editor toolbar/panels (near the "Deck settings" description), add a sentence such as:

```
**Export.** The **Export** toolbar button opens a panel with the deck serialized to a TS module
(`export const scenes: Scene[]`), with **Copy** and **Download** — the same `deckDocToModule`
bridge, now reachable from the UI. (Emits `scenes` only; import/round-trip is on the roadmap.)
```

Match the surrounding wording/format; if the README already has a note that export is "lib, no UI" or a roadmap caveat about export, update it to reflect that the UI now exists.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note the in-app Export panel in the README"
```

---

## Notes for the implementer

- **This branch (`claude/in-app-ts-export`) is stacked on the e2e-determinism branch (PR #13).** The three-server e2e setup and the throwaway-deck pattern are already present here — `export-ts.spec.ts` runs in the normal `[default]` project with no special isolation, and uses distinct deck id `e2e-export` (no collision with the other specs' ids).
- **Download in jsdom:** the download path (`URL.createObjectURL` + anchor click) is verified in the **e2e** test via `page.waitForEvent("download")`, not the unit test — jsdom doesn't implement real downloads. The unit test covers render, the no-deck guard, and the clipboard call only.
- **Do not add `@testing-library/jest-dom`** — the unit test uses plain vitest assertions (`.textContent`, `queryByTestId(...)` returning null) to avoid a new matcher dependency.
- **Clipboard in e2e** is intentionally not asserted (permission/context-gated across browsers); the `writeText` call is covered by the unit test.
