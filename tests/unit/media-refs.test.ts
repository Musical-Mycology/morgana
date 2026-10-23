import { expect, test } from "vitest";
import { findMediaRefs } from "@/lib/editor/media-refs";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D" },
  scenes: [{ id: "s", beats: [
    { id: "a", art: { to: ["media:a.mp4", "3.02"], keep: ["media:k.png"], out: ["media:o.jpg"], mode: "fade",
        clips: { "media:a.mp4": { in: 1 } } }, timeline: [] },
    { id: "b", timeline: [
      { kind: "art", art: { to: "media:b.webm", mode: "cut" } },
      { kind: "media", id: "m1", pos: { x: 0.1, y: 0.1 }, src: "media:t.mp4", clip: { in: 1 } },
      { kind: "media", id: "m2", pos: { x: 0.1, y: 0.1 }, src: "https://example.com/x.mp4" },
      { kind: "media", id: "m3", pos: { x: 0.1, y: 0.1 }, src: "3.02" },
    ] },
  ] }],
});

test("finds media refs in beat art, art actions and media tile src", () => {
  const uses = findMediaRefs(doc());
  expect(uses).toEqual([
    { ref: "media:a.mp4", sceneIdx: 0, beatIdx: 0, where: "art" },
    { ref: "media:k.png", sceneIdx: 0, beatIdx: 0, where: "art" },
    { ref: "media:o.jpg", sceneIdx: 0, beatIdx: 0, where: "art" },
    { ref: "media:a.mp4", sceneIdx: 0, beatIdx: 0, where: "clip-opts" },
    { ref: "media:b.webm", sceneIdx: 0, beatIdx: 1, actionIdx: 0, where: "art" },
    { ref: "media:t.mp4", sceneIdx: 0, beatIdx: 1, actionIdx: 1, where: "tile" },
  ]);
});

test("string art.to and no refs", () => {
  const d = doc();
  d.scenes[0].beats = [{ id: "a", art: { to: "media:x.png", mode: "cut" }, timeline: [] }, { id: "b", art: { to: "3.02", mode: "cut" }, timeline: [] }];
  expect(findMediaRefs(d)).toEqual([{ ref: "media:x.png", sceneIdx: 0, beatIdx: 0, where: "art" }]);
});
