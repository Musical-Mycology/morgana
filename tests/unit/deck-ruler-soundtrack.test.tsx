import { afterEach, expect, test } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { useEditor } from "@/lib/editor/store";
import { DeckRuler } from "@/components/editor/DeckRuler";
import { __resetSoundtrackCache } from "@/lib/audio/use-soundtrack";
import type { DeckDoc } from "@/engine/deck-doc";

const ID = "0123456789abcdef.mp3";
const deck: DeckDoc = { version: 1, meta: { id: "d", title: "D", timing: { targetSec: 12 }, soundtrack: { media: ID }, markers: [{ id: "m1", label: "Drop", t: 5 }] }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "wait", ms: 2000 }] }] },
] };
afterEach(() => { cleanup(); __resetSoundtrackCache(); });

test("the ruler draws the soundtrack waveform and cue markers", async () => {
  useEditor.getState().load(deck);
  const peaks = new Float32Array([0.2, 0.8, 0.5, 0.9]);
  render(<DeckRuler canvasRef={createRef()} beatT={0} loadTrack={() => Promise.resolve({ duration: 10, peaks } as never)} />);
  await act(async () => {});
  const ruler = screen.getByTestId("deck-ruler");
  expect(within(ruler).getByTestId("timebar-waveform")).toBeTruthy();
  expect(within(ruler).getAllByTestId("timebar-marker")).toHaveLength(1);
});
