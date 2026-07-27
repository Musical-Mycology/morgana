import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { LintPanel } from "@/components/editor/LintPanel";
import type { LintIssue } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
  { id: "s2", beats: [{ id: "b", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
] });

beforeEach(() => useEditor.getState().load(deck()));
afterEach(cleanup);

test("renders one row per issue with its severity", () => {
  const issues: LintIssue[] = [
    { rule: "structure", severity: "error", message: "boom", at: { sceneIdx: 0, beatIdx: 0 } },
    { rule: "scene-empty", severity: "warning", message: "quiet", at: { sceneIdx: 1 } },
  ];
  render(<LintPanel issues={issues} />);
  const rows = screen.getAllByTestId("lint-issue");
  expect(rows).toHaveLength(2);
  expect(rows[0].getAttribute("data-severity")).toBe("error");
  expect(rows[1].getAttribute("data-severity")).toBe("warning");
});

test("shows a clean state when there are no issues", () => {
  render(<LintPanel issues={[]} />);
  expect(screen.queryAllByTestId("lint-issue")).toHaveLength(0);
  expect(screen.getByTestId("lint-panel").textContent).toContain("No issues");
});

test("clicking a located row selects that beat and action", () => {
  const issues: LintIssue[] = [
    { rule: "structure", severity: "error", message: "boom", at: { sceneIdx: 1, beatIdx: 0, actionIdx: 0 } },
  ];
  render(<LintPanel issues={issues} />);
  fireEvent.click(screen.getByTestId("lint-issue"));
  expect(useEditor.getState().selected).toBe(1);       // flat index of s2's only beat
  expect(useEditor.getState().selectedAction).toBe(0);
});

test("a deck-level row is not interactive", () => {
  const issues: LintIssue[] = [{ rule: "structure", severity: "error", message: "version must be 1" }];
  render(<LintPanel issues={issues} />);
  const row = screen.getByTestId("lint-issue");
  expect(row.tagName).not.toBe("BUTTON");
  expect(row.getAttribute("data-located")).toBe("false");
});

test("a scene-empty row (scene-only location, no beatIdx) is not interactive", () => {
  const issues: LintIssue[] = [
    { rule: "scene-empty", severity: "warning", message: 'scene "s2" has no beats', at: { sceneIdx: 1 } },
  ];
  render(<LintPanel issues={issues} />);
  const row = screen.getByTestId("lint-issue");
  expect(row.tagName).not.toBe("BUTTON");
  expect(row.getAttribute("data-located")).toBe("false");
  fireEvent.click(row);
  // clicking a non-interactive row must not change selection
  expect(useEditor.getState().selected).toBe(0);
});

test("a beat-located issue still renders as a button and still jumps", () => {
  const issues: LintIssue[] = [
    { rule: "slide", severity: "warning", message: "hollow", at: { sceneIdx: 1, beatIdx: 0 } },
  ];
  render(<LintPanel issues={issues} />);
  const row = screen.getByTestId("lint-issue");
  expect(row.tagName).toBe("BUTTON");
  expect(row.getAttribute("data-located")).toBe("true");
  fireEvent.click(row);
  expect(useEditor.getState().selected).toBe(1); // flat index of s2's only beat
});
