import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { SoundtrackSettings } from "@/components/editor/SoundtrackSettings";
import { DeckMediaContext } from "@/lib/editor/use-deck-media";
import * as mediaClient from "@/lib/api/media-client";
import { __resetSoundtrackCache } from "@/lib/audio/use-soundtrack";
import type { DeckDoc } from "@/engine/deck-doc";

const ID = "0123456789abcdef.mp3";
const info = { id: ID, name: "mix.mp3", mime: "audio/mpeg", bytes: 3, uploadedAt: "2026-10-23T00:00:00Z" };
const deck = (withTrack: boolean): DeckDoc => ({ version: 1, meta: { id: "d", title: "D", ...(withTrack ? { soundtrack: { media: ID } } : {}) }, scenes: [] });
afterEach(() => { cleanup(); vi.restoreAllMocks(); __resetSoundtrackCache(); });

const renderWith = (media: typeof info[] | null, refresh = vi.fn(async () => {})) => render(
  <DeckMediaContext.Provider value={{ media, refresh }}>
    <SoundtrackSettings loadTrack={() => Promise.resolve({ duration: 120.4, peaks: new Float32Array(1) } as never)} />
  </DeckMediaContext.Provider>,
);

test("upload sets the soundtrack (undoable) and refreshes the media list", async () => {
  useEditor.getState().load(deck(false));
  vi.spyOn(mediaClient, "uploadMedia").mockResolvedValue(info);
  const refresh = vi.fn(async () => {});
  renderWith([], refresh);
  const input = screen.getByTestId("soundtrack-upload") as HTMLInputElement;
  await act(async () => { fireEvent.change(input, { target: { files: [new File(["abc"], "mix.mp3")] } }); });
  expect(useEditor.getState().doc!.meta.soundtrack).toEqual({ media: ID });
  expect(refresh).toHaveBeenCalled();
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.meta.soundtrack).toBeUndefined();
});

test("shows the file name and decoded duration; remove clears the reference only", async () => {
  useEditor.getState().load(deck(true));
  renderWith([info]);
  await act(async () => {});
  expect(screen.getByTestId("soundtrack-name").textContent).toBe("mix.mp3");
  expect(screen.getByTestId("soundtrack-duration").textContent).toBe("2:00");
  const del = vi.spyOn(globalThis, "fetch");
  fireEvent.click(screen.getByTestId("soundtrack-remove"));
  expect(useEditor.getState().doc!.meta.soundtrack).toBeUndefined();
  expect(del).not.toHaveBeenCalled(); // the file stays (undo-safe)
});

test("an upload error is shown inline and leaves the deck unchanged", async () => {
  useEditor.getState().load(deck(false));
  vi.spyOn(mediaClient, "uploadMedia").mockRejectedValue(new Error("unsupported file type: a.exe"));
  renderWith([]);
  await act(async () => { fireEvent.change(screen.getByTestId("soundtrack-upload"), { target: { files: [new File(["x"], "a.exe")] } }); });
  expect(screen.getByTestId("soundtrack-error").textContent).toContain("unsupported file type");
  expect(useEditor.getState().doc!.meta.soundtrack).toBeUndefined();
});
