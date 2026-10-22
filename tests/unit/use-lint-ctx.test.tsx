import { expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { useLint } from "@/lib/editor/use-lint";
import type { DeckDoc } from "@/engine/deck-doc";

const deck: DeckDoc = { version: 1, meta: { id: "d", title: "D", soundtrack: { media: "0123456789abcdef.mp3" } }, scenes: [] };

test("lint context feeds soundtrack-missing; no context means no soundtrack warnings", () => {
  useEditor.getState().load(deck);
  const withCtx = renderHook(() => useLint({ mediaIds: [] }));
  expect(withCtx.result.current.some((i) => i.rule === "soundtrack-missing")).toBe(true);
  const without = renderHook(() => useLint());
  expect(without.result.current.some((i) => i.rule === "soundtrack-missing")).toBe(false);
});
