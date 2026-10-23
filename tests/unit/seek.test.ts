import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createElement, createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { renderBeatAt } from "@/engine/authoring/seek";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import type { Action, ArtTransition } from "@/engine/deck/types";

test("a text action with pos renders absolutely at its normalized point", () => {
  const host = document.createElement("div");
  renderBeatAt([{ kind: "text", value: "Placed", in: "fade", pos: { x: 0.5, y: 0.3 } }], 99, { textHost: host, art: null });
  const p = host.querySelector("p")!;
  expect(p.style.position).toBe("absolute");
  expect(p.style.left).toBe("50%");
  expect(p.style.top).toBe("30%");
});

test("art carries the transition's clip options through to ArtStage", () => {
  const host = document.createElement("div");
  const calls: unknown[][] = [];
  const art = {
    show: (...a: unknown[]) => calls.push(["show", ...a]),
    snap: (...a: unknown[]) => calls.push(["snap", ...a]),
    apply: () => {}, renderState: () => {},
  };
  const clips = { "media:a.mp4": { in: 2 } } as const;
  const tl = [{ kind: "art", art: { to: "media:a.mp4", mode: "fade", durationMs: 1000, clips } }, { kind: "wait", ms: 2000 }] as Parameters<typeof renderBeatAt>[0];
  renderBeatAt(tl, 0.5, { textHost: host, art }); // art is instantaneous on the beat clock: settled → snap
  expect(calls).toEqual([["snap", ["media:a.mp4"], clips]]);
});

// --- clip options follow the INTRODUCING transition (same rule as art-clock's artAt) ----------

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** The editor's setup: an ArtStage with clip playback off, painted through renderBeatAt. */
function editorStage() {
  const art = createRef<ArtStageHandle>();
  const { container } = render(createElement(ArtStage, { ref: art, nightlight: 0, clipPlayback: false }));
  const textHost = document.createElement("div");
  const video = () => container.querySelector<HTMLVideoElement>('video.artstage__layer[data-asset="media:a.mp4"]');
  return { art, textHost, video };
}

test("a clip brought in by entry art keeps the entry's in-point when a later art action re-lists it", () => {
  const { art, textHost, video } = editorStage();
  const entryArt: ArtTransition = { to: "media:a.mp4", mode: "cut", clips: { "media:a.mp4": { in: 2 } } };
  const tl: Action[] = [
    { kind: "wait", ms: 500 },
    { kind: "art", art: { to: ["media:a.mp4", "MusicScore"], mode: "cut" } }, // re-list: no clips entry
    { kind: "wait", ms: 1000 },
  ];
  renderBeatAt(tl, 1, { textHost, art: art.current, entryArt });
  expect(video()!.currentTime).toBe(2);
});

test("a clip brought in by a timeline art action keeps that in-point across a later keep", () => {
  const { art, textHost, video } = editorStage();
  const tl: Action[] = [
    { kind: "art", art: { to: "media:a.mp4", mode: "cut", clips: { "media:a.mp4": { in: 2 } } } },
    { kind: "wait", ms: 500 },
    { kind: "art", art: { to: ["media:a.mp4", "MusicScore"], mode: "cut", keep: ["media:a.mp4"] } },
    { kind: "wait", ms: 1000 },
  ];
  renderBeatAt(tl, 0.2, { textHost, art: art.current });
  expect(video()!.currentTime).toBe(2);
  renderBeatAt(tl, 1, { textHost, art: art.current });
  expect(video()!.currentTime).toBe(2);
});

test("removing the in-point from the introducing transition and redrawing shows in-point 0", () => {
  const { art, textHost, video } = editorStage();
  const tl: Action[] = [
    { kind: "wait", ms: 500 },
    { kind: "art", art: { to: ["media:a.mp4", "MusicScore"], mode: "cut" } },
    { kind: "wait", ms: 1000 },
  ];
  renderBeatAt(tl, 1, { textHost, art: art.current, entryArt: { to: "media:a.mp4", mode: "cut", clips: { "media:a.mp4": { in: 2 } } } });
  const v = video()!;
  expect(v.currentTime).toBe(2);
  renderBeatAt(tl, 1, { textHost, art: art.current, entryArt: { to: "media:a.mp4", mode: "cut" } });
  expect(video()).toBe(v);
  expect(v.currentTime).toBe(0);
});

test("a clip that left the stack and comes back takes the returning transition's options", () => {
  const { art, textHost, video } = editorStage();
  const tl: Action[] = [
    { kind: "art", art: { to: "media:a.mp4", mode: "cut", clips: { "media:a.mp4": { in: 2 } } } },
    { kind: "wait", ms: 500 },
    { kind: "art", art: { to: "1.01", mode: "cut" } },
    { kind: "wait", ms: 500 },
    { kind: "art", art: { to: "media:a.mp4", mode: "cut", clips: { "media:a.mp4": { in: 4 } } } },
    { kind: "wait", ms: 500 },
  ];
  renderBeatAt(tl, 1.2, { textHost, art: art.current });
  expect(video()!.currentTime).toBe(4);
});
