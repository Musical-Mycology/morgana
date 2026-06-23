import { expect, test } from "vitest";
import { flattenStory } from "@/engine/deck/flatten";
import type { Scene } from "@/engine/deck/types";

const scenes: Scene[] = [
  { id: "s1", beats: [
    { id: "b1", timeline: [{ kind: "text", value: "Hello", in: "fade" }] },
    { id: "b2", timeline: [{ kind: "text", value: "World", in: "flyUp" }] },
  ] },
];

test("flattenStory yields one cinematic slide per beat", () => {
  const deck = flattenStory(scenes);
  expect(deck).toHaveLength(2);
  expect(deck[0].layout).toBe("cinematic");
  expect(deck[0].slots).toMatchObject({ sceneId: "s1", beat: { id: "b1" } });
});
