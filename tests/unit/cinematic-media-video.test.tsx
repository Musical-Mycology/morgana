// @vitest-environment jsdom
// Media tiles (CinematicSlide's positioned `media` action) with uploaded media refs (spec §4):
// a video ref becomes a muted clip <video> whose time follows the beat clock through syncVideo,
// an image ref an <img>; every removed tile video is released.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef, useImperativeHandle, forwardRef } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { DeckAssetsProvider } from "@/engine/asset-resolver-react";
import { useDeckStage } from "@/components/player/DeckStage";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat } from "@/engine/deck/types";
import { mediaUrl } from "@/lib/api/media-client";

vi.mock("@/engine/components/video-sync", async (orig) => {
  const m = await orig<typeof import("@/engine/components/video-sync")>();
  return { ...m, releaseVideo: vi.fn(m.releaseVideo) };
});
import { releaseVideo, type ClipMode } from "@/engine/components/video-sync";

let play: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(10);
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.mocked(releaseVideo).mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const tile = { kind: "media", id: "t", src: "media:c.mp4", pos: { x: 0.5, y: 0.5 }, clip: { in: 1 } } as const;
const beat: Beat = { id: "b", timeline: [tile, { kind: "wait", ms: 3000 }] };
// Variant: the media action starts at 0.5 s, so seeking to 0 is before it.
const lateBeat: Beat = { id: "late", timeline: [{ kind: "wait", ms: 500 }, tile, { kind: "wait", ms: 3000 }] };

function setup(b: Beat, opts: { autoplay?: boolean; mode?: ClipMode } = {}) {
  const transport = createRef<SlideTransport>();
  const clipModeRef = { current: opts.mode ?? "seek" } as React.RefObject<ClipMode>;
  const utils = render(
    <DeckAssetsProvider deckId="d1">
      <BeatStage sceneId="s" beat={b} autoplay={opts.autoplay ?? false} transport={transport} clipModeRef={clipModeRef} contained />
    </DeckAssetsProvider>,
  );
  const video = () => utils.container.querySelector<HTMLVideoElement>(".cin__media video");
  return { transport, clipModeRef, video, ...utils };
}

describe("CinematicSlide media tiles — clips and uploaded images", () => {
  it("a video ref tile is a muted clip video, seeked to in + (t - since)", () => {
    const { transport, video } = setup(beat);
    act(() => { transport.current!.seek(2); });
    const v = video()!;
    expect(v).not.toBeNull();
    expect(v.muted).toBe(true);
    expect(v.autoplay).toBe(false);
    expect(v.getAttribute("src")).toBe(mediaUrl("d1", "c.mp4"));
    expect(v.classList.contains("cin__media-img")).toBe(true);
    expect(v.currentTime).toBe(3);
    expect(play).not.toHaveBeenCalled();
  });

  it("host clip mode \"play\" plays the tile video", () => {
    const { transport, clipModeRef, video } = setup(beat);
    clipModeRef.current = "play";
    act(() => { transport.current!.seek(2.5); });
    expect(play.mock.contexts).toContain(video());
    expect(video()!.currentTime).toBe(3.5);
  });

  it("a backward seek before the media action removes the tile and releases its video", () => {
    const { transport, video } = setup(lateBeat);
    act(() => { transport.current!.seek(2); });
    const v = video()!;
    expect(v).not.toBeNull();
    expect(v.currentTime).toBe(2.5); // in 1 + (2 - 0.5)
    act(() => { transport.current!.seek(0); });
    expect(video()).toBeNull();
    expect(v.isConnected).toBe(false);
    expect(releaseVideo).toHaveBeenCalledWith(v);
  });

  it("unmount releases a tile video", () => {
    const { transport, video, unmount } = setup(beat);
    act(() => { transport.current!.seek(2); });
    const v = video()!;
    unmount();
    expect(releaseVideo).toHaveBeenCalledWith(v);
  });

  it("an image ref tile is an <img> resolved through assets.media", () => {
    const b: Beat = { id: "img", timeline: [{ ...tile, src: "media:p.png", clip: undefined }, { kind: "wait", ms: 1000 }] };
    const { transport, container } = setup(b);
    act(() => { transport.current!.seek(1); });
    const img = container.querySelector<HTMLImageElement>(".cin__media img.cin__media-img")!;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe(mediaUrl("d1", "p.png"));
    expect(container.querySelector(".cin__media video")).toBeNull();
  });

  it("autoplay plays a video tile, whatever the host clip mode says", () => {
    const { transport, video } = setup(beat, { autoplay: true, mode: "seek" });
    act(() => { transport.current!.seek(2); });
    expect(play.mock.contexts).toContain(video());
  });

  it("two tiles of the same clip are two elements, each at its own clip time", () => {
    const b: Beat = { id: "two", timeline: [
      tile, { ...tile, id: "u", clip: { in: 4 } }, { kind: "wait", ms: 3000 },
    ] };
    const { transport, container } = setup(b);
    act(() => { transport.current!.seek(2); });
    const vids = Array.from(container.querySelectorAll<HTMLVideoElement>(".cin__media video"));
    expect(vids).toHaveLength(2);
    expect(vids[0]).not.toBe(vids[1]);
    // tile t starts at 0 (in 1); tile u starts at 0.6 (in 4)
    expect(vids.map((v) => v.currentTime)).toEqual([3, 5.4]);
  });
});

// Review Focus #2: the same clip as the art layer AND a tile — the host-driven configuration the
// timed Player / renderer use (one deck-owned ArtStage, BeatStage autoplay={false}).
const Harness = forwardRef<{ apply: (T: number) => void }, { doc: DeckDoc }>(function Harness({ doc }, ref) {
  const s = useDeckStage(doc, 0);
  useImperativeHandle(ref, () => ({ apply: s.apply }), [s.apply]);
  return <>{s.stage}</>;
});

describe("Review Focus #2 — same clip as art layer and tile", () => {
  it("gives two independent video elements, each at its own clip time", () => {
    const doc: DeckDoc = { version: 1, meta: { id: "v", title: "V" }, scenes: [{ id: "s", beats: [
      { id: "a", art: { to: "media:c.mp4", mode: "cut" }, timeline: [tile, { kind: "wait", ms: 3000 }] },
    ] }] };
    const h = createRef<{ apply: (T: number) => void }>();
    const { container } = render(<DeckAssetsProvider deckId="d1"><Harness ref={h} doc={doc} /></DeckAssetsProvider>);
    act(() => { h.current!.apply(2); });
    const art = container.querySelector<HTMLVideoElement>("video.artstage__layer")!;
    const tileV = container.querySelector<HTMLVideoElement>(".cin__media video")!;
    expect(art).not.toBeNull();
    expect(tileV).not.toBeNull();
    expect(art).not.toBe(tileV);
    expect(art.getAttribute("src")).toBe(mediaUrl("d1", "c.mp4"));
    expect(tileV.getAttribute("src")).toBe(mediaUrl("d1", "c.mp4"));
    expect(art.currentTime).toBe(2); // art: in 0, shown from T=0
    expect(tileV.currentTime).toBe(3); // tile: in 1, shown from beat-local 0
  });
});
