import { expect, test } from "vitest";
import { lintDeck } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const ID = "0123456789abcdef.mp3";
const deck = (): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D", timing: { targetSec: 10 }, soundtrack: { media: ID },
    markers: [{ id: "m1", label: "drop", t: 4 }, { id: "m2", label: "late", t: 99 }] },
  scenes: [{ id: "s", durationSec: 10, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] }],
});
const rule = (d: DeckDoc, r: string, ctx?: Parameters<typeof lintDeck>[1]) => lintDeck(d, ctx).filter((i) => i.rule === r);

test("soundtrack-missing only when the media list is known and lacks the id", () => {
  expect(rule(deck(), "soundtrack-missing")).toEqual([]);                       // no ctx → skipped
  expect(rule(deck(), "soundtrack-missing", { mediaIds: [ID] })).toEqual([]);
  const [i] = rule(deck(), "soundtrack-missing", { mediaIds: [] });
  expect(i).toMatchObject({ severity: "warning" });
  expect(i.message).toBe("the soundtrack file is missing from this deck's media — upload it again");
});

test("soundtrack-length compares the track with the deck total beyond 0.5 s", () => {
  expect(rule(deck(), "soundtrack-length", { soundtrackSec: 10.4 })).toEqual([]);
  expect(rule(deck(), "soundtrack-length", { soundtrackSec: 12 })[0].message)
    .toBe("track is 0:12, deck is 0:10 — 2.0s of music would play past the last frame");
  expect(rule(deck(), "soundtrack-length", { soundtrackSec: 7 })[0].message)
    .toBe("track is 0:07, deck is 0:10 — the video would end 3.0s in silence");
  expect(rule(deck(), "soundtrack-length")).toEqual([]);                        // duration unknown → skipped
});

test("marker-out-of-range flags markers past the deck total", () => {
  const issues = rule(deck(), "marker-out-of-range");
  expect(issues).toHaveLength(1);
  expect(issues[0].message).toBe('marker "late" at 1:39 is past the end of the deck (0:10)');
});

test("no soundtrack → no soundtrack rules even with ctx", () => {
  const d = deck(); delete d.meta.soundtrack;
  expect(rule(d, "soundtrack-missing", { mediaIds: [] })).toEqual([]);
  expect(rule(d, "soundtrack-length", { soundtrackSec: 99 })).toEqual([]);
});
