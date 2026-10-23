// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import { render, cleanup } from "@testing-library/react";
import gsap from "gsap";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import type { ArtLayerState } from "@/engine/authoring/art-clock";
import { DeckAssetsProvider } from "@/engine/asset-resolver-react";
import { mediaUrl } from "@/lib/api/media-client";

vi.mock("@/engine/components/video-sync", async (orig) => {
  const m = await orig<typeof import("@/engine/components/video-sync")>();
  return { ...m, syncVideo: vi.fn(m.syncVideo), releaseVideo: vi.fn(m.releaseVideo) };
});
import { MIN_VIDEO_OPACITY, releaseVideo, syncVideo } from "@/engine/components/video-sync";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.mocked(syncVideo).mockClear(); vi.mocked(releaseVideo).mockClear(); });

function setup() {
  const ref = createRef<ArtStageHandle>();
  const { container } = render(<ArtStage ref={ref} nightlight={0} reduced={false} />);
  const root = container.querySelector<HTMLElement>(".artstage")!;
  const layers = () => Array.from(root.querySelectorAll<HTMLImageElement>(".artstage__layer"));
  return { ref, root, layers };
}

const two: ArtLayerState[] = [
  { asset: "1.01", opacity: 0.4, scale: 1, z: 1, overlay: false, since: 0 },
  { asset: "MusicScore", opacity: 0.8, scale: 0.95, z: 2, overlay: true, since: 0 },
];

describe("ArtStage.renderState", () => {
  it("paints exactly the given layers in array order with opacity/scale/z", () => {
    const { ref, layers } = setup();
    ref.current!.renderState(two, 1);
    const els = layers();
    expect(els.map((e) => e.dataset.asset)).toEqual(["1.01", "MusicScore"]);
    expect(els.map((e) => e.style.opacity)).toEqual(["0.4", "0.8"]);
    expect(els.map((e) => e.style.zIndex)).toEqual(["1", "2"]);
    expect(els[0].style.transform).toBe("none");
    expect(els[1].style.transform).toBe("scale(0.95)");
    expect(els[1].style.mixBlendMode).toBe("screen");
    expect(els[1].dataset.overlay).toBe("1");
  });

  it("reuses matching elements and removes layers no longer present", () => {
    const { ref, layers } = setup();
    ref.current!.renderState(two, 1);
    const first = layers()[0];
    ref.current!.renderState([{ asset: "1.01", opacity: 1, scale: 1, z: 1, overlay: false, since: 0 }], 1);
    const els = layers();
    expect(els).toHaveLength(1);
    expect(els[0]).toBe(first);
    expect(els[0].style.opacity).toBe("1");
  });

  it("z is authoritative for stacking while DOM order follows the array", () => {
    const { ref, layers } = setup();
    ref.current!.renderState([
      { asset: "1.01", opacity: 0.5, scale: 1, z: 3, overlay: false, since: 0 },
      { asset: "1.02", opacity: 1, scale: 1, z: 1, overlay: false, since: 0 },
    ], 0);
    expect(layers().map((e) => [e.dataset.asset, e.style.zIndex])).toEqual([["1.01", "3"], ["1.02", "1"]]);
  });

  it("applies night to the glow (no transition) and the root filter", () => {
    const { ref, root } = setup();
    ref.current!.renderState([], 0.5);
    const glow = root.querySelector<HTMLElement>(".artstage__glow")!;
    expect(glow.style.transition).toBe("none");
    expect(parseFloat(glow.style.opacity)).toBeCloseTo(0.15 + 0.45 * 0.5, 6);
    expect(root.style.filter).toBe(`saturate(${0.85 + 0.3 * 0.5}) brightness(${0.9 + 0.15 * 0.5})`);
    ref.current!.renderState([], 3); // clamps at 1
    expect(parseFloat(glow.style.opacity)).toBeCloseTo(0.6, 6);
  });

  it("creates no GSAP tweens", () => {
    const to = vi.spyOn(gsap, "to");
    const fromTo = vi.spyOn(gsap, "fromTo");
    const { ref } = setup();
    ref.current!.renderState(two, 1);
    ref.current!.renderState([], 0);
    expect(to).not.toHaveBeenCalled();
    expect(fromTo).not.toHaveBeenCalled();
  });
});

describe("ArtStage.renderState — interplay with tweened show()", () => {
  it("kills an in-flight show() tween on a reused layer (advancing GSAP time leaves it put)", () => {
    const { ref, layers } = setup();
    ref.current!.show(["1.01"], "fade"); // a 700 ms opacity 0 → 1 tween
    ref.current!.renderState([{ asset: "1.01", opacity: 0.5, scale: 1, z: 1, overlay: false, since: 0 }], 0);
    const el = layers()[0];
    expect(el.style.opacity).toBe("0.5");
    gsap.globalTimeline.time(gsap.globalTimeline.time() + 5); // far past the fade's end
    expect(layers()[0]).toBe(el);
    expect(el.style.opacity).toBe("0.5");
  });

  it("keeps .artstage__glow as the root's first element child", () => {
    const { ref, root } = setup();
    ref.current!.renderState(two, 0.5);
    expect(root.firstElementChild!.classList.contains("artstage__glow")).toBe(true);
    ref.current!.renderState([two[1], two[0]], 0.2);
    expect(root.firstElementChild!.classList.contains("artstage__glow")).toBe(true);
  });
});

describe("ArtStage.renderState — media refs", () => {
  /** jsdom media: a decoded frame (readyState 2, 10 s long); play/pause/load are not implemented. */
  function stubMedia() {
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2); // a decoded frame: seeks apply at once (a fresh element defers to its preroll frame)
    vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(10);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  }
  function setupDeck() {
    const ref = createRef<ArtStageHandle>();
    const { container } = render(<DeckAssetsProvider deckId="d1"><ArtStage ref={ref} nightlight={0} reduced={false} /></DeckAssetsProvider>);
    const root = container.querySelector<HTMLElement>(".artstage")!;
    return { ref, root, videos: () => Array.from(root.querySelectorAll<HTMLVideoElement>("video.artstage__layer")) };
  }
  const vid: ArtLayerState = { asset: "media:a.mp4", opacity: 1, scale: 1, z: 1, overlay: false, since: 2 };

  it("a video ref becomes a muted <video> synced to its clip time at deck time T", () => {
    stubMedia();
    const { ref, videos } = setupDeck();
    ref.current!.renderState([vid], 0, 3.5, "seek");
    const [v] = videos();
    expect(videos()).toHaveLength(1);
    expect(v.className).toBe("artstage__layer");
    expect(v.dataset.asset).toBe("media:a.mp4");
    expect(v.getAttribute("src")).toBe(mediaUrl("d1", "a.mp4"));
    expect(v.muted).toBe(true);
    expect(syncVideo).toHaveBeenCalledTimes(1);
    const [el, clipT, mode, opts] = vi.mocked(syncVideo).mock.calls[0];
    expect(el).toBe(v);
    expect(clipT(10)).toBeCloseTo(1.5, 9);
    expect(mode).toBe("seek");
    expect(opts).toEqual({ loop: undefined });
    expect(v.currentTime).toBeCloseTo(1.5, 9);
  });

  it("passes the layer's clip options (in-point, loop) and the mode through", () => {
    stubMedia();
    const { ref } = setupDeck();
    ref.current!.renderState([{ ...vid, clip: { in: 4, loop: true } }], 0, 3.5, "play");
    const [, clipT, mode, opts] = vi.mocked(syncVideo).mock.calls[0];
    expect(clipT(10)).toBeCloseTo(5.5, 9);
    expect(mode).toBe("play");
    expect(opts).toEqual({ loop: true });
  });

  it("T and mode default to 0 and seek", () => {
    stubMedia();
    const { ref } = setupDeck();
    ref.current!.renderState([{ ...vid, since: 0 }], 0);
    const [, clipT, mode] = vi.mocked(syncVideo).mock.calls[0];
    expect(clipT(10)).toBe(0);
    expect(mode).toBe("seek");
  });

  it("a second renderState with the same asset reuses the element", () => {
    stubMedia();
    const { ref, videos } = setupDeck();
    ref.current!.renderState([vid], 0, 3.5, "seek");
    const first = videos()[0];
    ref.current!.renderState([vid], 0, 4, "seek");
    expect(videos()).toEqual([first]);
    expect(first.currentTime).toBeCloseTo(2, 9);
  });

  it("removing the layer releases its video", () => {
    stubMedia();
    const { ref, videos } = setupDeck();
    ref.current!.renderState([vid], 0, 3.5, "seek");
    const v = videos()[0];
    ref.current!.renderState([], 0, 4, "seek");
    expect(v.isConnected).toBe(false);
    expect(releaseVideo).toHaveBeenCalledWith(v);
    expect(v.hasAttribute("src")).toBe(false);
  });

  it("a video layer at opacity 0 is painted at MIN_VIDEO_OPACITY (stays composited) and still synced; an image layer stays at 0", () => {
    stubMedia();
    const { ref, root } = setupDeck();
    expect(MIN_VIDEO_OPACITY).toBe(1 / 1024);
    ref.current!.renderState([{ ...vid, opacity: 0 }, { ...vid, asset: "media:p.png", opacity: 0 }, { ...vid, asset: "1.01", opacity: 0 }], 0, 2, "seek");
    const v = root.querySelector<HTMLVideoElement>("video.artstage__layer")!;
    expect(Number(v.style.opacity)).toBe(1 / 1024);
    expect(syncVideo).toHaveBeenCalledTimes(1);
    for (const img of root.querySelectorAll<HTMLImageElement>("img.artstage__layer")) expect(img.style.opacity).toBe("0");
    ref.current!.renderState([{ ...vid, opacity: 0.5 }], 0, 3, "seek");
    expect(v.style.opacity).toBe("0.5"); // above the floor: painted as-is
  });

  it("an image media ref becomes an <img> with the assets.media src (no video sync)", () => {
    const { ref, root } = setupDeck();
    ref.current!.renderState([{ ...vid, asset: "media:p.png" }], 0, 3.5, "seek");
    const img = root.querySelector<HTMLImageElement>("img.artstage__layer")!;
    expect(img.dataset.asset).toBe("media:p.png");
    expect(img.getAttribute("src")).toBe(mediaUrl("d1", "p.png"));
    expect(root.querySelector("video")).toBeNull();
    expect(syncVideo).not.toHaveBeenCalled();
  });
});
