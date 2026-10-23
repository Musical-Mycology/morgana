// @vitest-environment jsdom
// ArtStage's autoplay paths (show / apply / snap) with media refs: a video layer plays from its
// in-point (spec §4), the editor (clipPlayback=false) and snap() hold it paused at the in-point,
// and every removed video is released (paused, src cleared) whichever path removes it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import gsap from "gsap";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { DeckAssetsProvider } from "@/engine/asset-resolver-react";
import { mediaUrl } from "@/lib/api/media-client";

vi.mock("@/engine/components/video-sync", async (orig) => {
  const m = await orig<typeof import("@/engine/components/video-sync")>();
  return { ...m, releaseVideo: vi.fn(m.releaseVideo) };
});
import { releaseVideo } from "@/engine/components/video-sync";

let play: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.mocked(releaseVideo).mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(props: { clipPlayback?: boolean } = {}) {
  const ref = createRef<ArtStageHandle>();
  const utils = render(
    <DeckAssetsProvider deckId="d1"><ArtStage ref={ref} nightlight={0} reduced={false} {...props} /></DeckAssetsProvider>,
  );
  const root = utils.container.querySelector<HTMLElement>(".artstage")!;
  const video = () => root.querySelector<HTMLVideoElement>("video.artstage__layer");
  return { ref, root, video, unmount: utils.unmount };
}

const playedOn = () => play.mock.contexts as HTMLMediaElement[];

describe("ArtStage autoplay — video layers", () => {
  it("show() creates a muted clip video and plays it from in-point 0", () => {
    const { ref, video } = setup();
    ref.current!.show(["media:a.mp4"], "fade");
    const v = video()!;
    expect(v).not.toBeNull();
    expect(v.dataset.asset).toBe("media:a.mp4");
    expect(v.dataset.video).toBe("1");
    expect(v.getAttribute("src")).toBe(mediaUrl("d1", "a.mp4"));
    expect(v.muted).toBe(true);
    expect(v.autoplay).toBe(false);
    expect(v.currentTime).toBe(0);
    expect(playedOn()).toEqual([v]);
  });

  it("show() with clips starts from the clip's in-point", () => {
    const { ref, video } = setup();
    ref.current!.show(["media:a.mp4"], "fade", undefined, { "media:a.mp4": { in: 2 } });
    expect(video()!.currentTime).toBe(2);
    expect(playedOn()).toEqual([video()]);
  });

  it("apply() takes the in-point from the transition's clips and plays", () => {
    const { ref, video } = setup();
    ref.current!.apply({ to: "media:a.mp4", mode: "cut", clips: { "media:a.mp4": { in: 1.5 } } });
    expect(video()!.currentTime).toBe(1.5);
    expect(playedOn()).toEqual([video()]);
  });

  it("a kept video layer is not restarted by a later show()", () => {
    const { ref, video } = setup();
    ref.current!.show(["media:a.mp4"], "cut");
    const v = video()!;
    ref.current!.show(["media:a.mp4", "MusicScore"], "fade");
    expect(video()).toBe(v);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("snap() never plays: the clip waits at its in-point", () => {
    const { ref, video } = setup();
    ref.current!.snap(["media:a.mp4"], { "media:a.mp4": { in: 3 } });
    expect(video()!.currentTime).toBe(3);
    expect(play).not.toHaveBeenCalled();
  });

  it("clipPlayback={false} (the editor): show() leaves a new clip paused at its in-point", () => {
    const { ref, video } = setup({ clipPlayback: false });
    ref.current!.show(["media:a.mp4"], "fade", 1, { "media:a.mp4": { in: 2 } });
    expect(video()!.currentTime).toBe(2);
    ref.current!.apply({ to: "media:b.webm", mode: "cut" });
    expect(play).not.toHaveBeenCalled();
  });

  it("an image media ref becomes an <img> resolved through assets.media", () => {
    const { ref, root } = setup();
    ref.current!.show(["media:p.png"], "cut");
    const img = root.querySelector<HTMLImageElement>("img.artstage__layer")!;
    expect(img.dataset.asset).toBe("media:p.png");
    expect(img.getAttribute("src")).toBe(mediaUrl("d1", "p.png"));
    expect(root.querySelector("video")).toBeNull();
  });
});

describe("ArtStage autoplay — releasing removed video layers", () => {
  it("a cut removal releases the video immediately", () => {
    const { ref, video } = setup();
    ref.current!.show(["media:a.mp4"], "cut");
    const v = video()!;
    ref.current!.show(["1.01"], "cut");
    expect(v.isConnected).toBe(false);
    expect(releaseVideo).toHaveBeenCalledWith(v);
    expect(v.hasAttribute("src")).toBe(false);
  });

  it("a faded-out video is released when its fade completes", () => {
    const { ref, video } = setup();
    ref.current!.show(["media:a.mp4"], "cut");
    const v = video()!;
    ref.current!.show(["1.01"], "fade");
    expect(v.isConnected).toBe(true); // still fading
    expect(releaseVideo).not.toHaveBeenCalled();
    gsap.globalTimeline.time(gsap.globalTimeline.time() + 5);
    expect(v.isConnected).toBe(false);
    expect(releaseVideo).toHaveBeenCalledWith(v);
  });

  it("a fading video that is reused (its fade cancelled) is neither removed nor released", () => {
    const { ref, video } = setup();
    ref.current!.show(["media:a.mp4"], "cut");
    const v = video()!;
    ref.current!.show(["1.01"], "fade");
    ref.current!.show(["media:a.mp4"], "fade"); // back before the fade-out finished
    gsap.globalTimeline.time(gsap.globalTimeline.time() + 5);
    expect(video()).toBe(v);
    expect(v.isConnected).toBe(true);
    expect(releaseVideo).not.toHaveBeenCalled();
  });

  it("renderState removing a video layer that show() created releases it", () => {
    const { ref, video } = setup();
    ref.current!.show(["media:a.mp4"], "fade");
    const v = video()!;
    ref.current!.renderState([], 0);
    expect(v.isConnected).toBe(false);
    expect(releaseVideo).toHaveBeenCalledWith(v);
  });

  it("unmounting the stage releases its videos", () => {
    const { ref, video, unmount } = setup();
    ref.current!.show(["media:a.mp4"], "cut");
    const v = video()!;
    unmount();
    expect(releaseVideo).toHaveBeenCalledWith(v);
  });
});
