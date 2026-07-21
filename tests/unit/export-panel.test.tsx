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
