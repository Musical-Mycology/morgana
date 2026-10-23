import { expect, test } from "vitest";
import { lintDeck, type LintContext } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Action, ArtTransition } from "@/engine/deck/types";

const media: NonNullable<LintContext["media"]> = [
  { id: "a.mp4", name: "a.mp4", mime: "video/mp4", bytes: 1, uploadedAt: "", durationSec: 2 },
  { id: "s.mp3", name: "s.mp3", mime: "audio/mpeg", bytes: 1, uploadedAt: "" },
  { id: "i.png", name: "i.png", mime: "image/png", bytes: 1, uploadedAt: "" },
];
const deck = (art?: ArtTransition, timeline: Action[] = [{ kind: "wait", ms: 500 }]): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D" },
  scenes: [{ id: "s", beats: [{ id: "a", art, timeline }] }],
});
const rules = (d: DeckDoc, ctx?: LintContext) => lintDeck(d, ctx).filter((i) => /^(media-|clip-)/.test(i.rule));

test("media-missing at the beat", () => {
  const [i] = rules(deck({ to: "media:zzz.mp4", mode: "cut" }), { media });
  expect(i).toMatchObject({ rule: "media-missing", severity: "warning", at: { sceneIdx: 0, beatIdx: 0 },
    message: 'media "zzz.mp4" is not in this deck\'s media — upload it again' });
});

test("media-missing at the action for a tile", () => {
  const [i] = rules(deck(undefined, [{ kind: "media", id: "m", pos: { x: 0.1, y: 0.1 }, src: "media:zzz.png" }]), { media });
  expect(i).toMatchObject({ rule: "media-missing", at: { sceneIdx: 0, beatIdx: 0, actionIdx: 0 } });
});

test("media-kind for audio used as art", () => {
  const [i] = rules(deck({ to: "media:s.mp3", mode: "cut" }), { media });
  expect(i).toMatchObject({ rule: "media-kind", severity: "warning", message: 'media "s.mp3" is audio — art and tiles take images or video' });
});

test("clip-in-past-end for art clips", () => {
  const art = (inSec: number): ArtTransition => ({ to: "media:a.mp4", mode: "cut", clips: { "media:a.mp4": { in: inSec } } });
  const [i] = rules(deck(art(2)), { media });
  expect(i).toMatchObject({ rule: "clip-in-past-end", severity: "warning", at: { sceneIdx: 0, beatIdx: 0 },
    message: "clip in-point 2s is at or past the clip's end (2s)" });
  expect(rules(deck(art(1.5)), { media })).toEqual([]);
});

test("clip-in-past-end for a media tile", () => {
  const d = deck(undefined, [{ kind: "media", id: "m", pos: { x: 0.1, y: 0.1 }, src: "media:a.mp4", clip: { in: 3 } }]);
  expect(rules(d, { media })).toMatchObject([{ rule: "clip-in-past-end", at: { sceneIdx: 0, beatIdx: 0, actionIdx: 0 } }]);
});

test("a non-media key in clip options is flagged; valid refs are clean", () => {
  const d = deck({ to: "media:i.png", mode: "cut", clips: { "3.02": { in: 1 } } as never });
  expect(rules(d, { media })).toMatchObject([{ rule: "media-kind", message: 'clip options key "3.02" is not a media: ref' }]);
  expect(rules(deck({ to: ["media:i.png", "media:a.mp4"], mode: "cut" }), { media })).toEqual([]);
});

test("no ctx.media -> none of the media rules fire", () => {
  const d = deck({ to: "media:zzz.mp4", mode: "cut", clips: { "media:a.mp4": { in: 9 } } });
  expect(rules(d)).toEqual([]);
  expect(rules(d, { mediaIds: [] })).toEqual([]);
});
