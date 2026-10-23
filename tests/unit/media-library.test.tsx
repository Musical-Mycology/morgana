import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { MediaLibrary } from "@/components/editor/MediaLibrary";
import { SoundtrackSettings } from "@/components/editor/SoundtrackSettings";
import { DeckMediaContext } from "@/lib/editor/use-deck-media";
import * as mediaClient from "@/lib/api/media-client";
import * as mediaDuration from "@/lib/editor/media-duration";
import type { DeckDoc } from "@/engine/deck-doc";
import type { MediaInfo } from "@/lib/store/media-store";

const IMG = "0123456789abcdef.png";
const VID = "1123456789abcdef.mp4";
const AUD = "2123456789abcdef.mp3";
const at = "2026-10-23T00:00:00Z";
const items: MediaInfo[] = [
  { id: IMG, name: "pic.png", mime: "image/png", bytes: 2048, uploadedAt: at },
  { id: VID, name: "clip.mp4", mime: "video/mp4", bytes: 1536 * 1024, uploadedAt: at, durationSec: 2.4 },
  { id: AUD, name: "mix.mp3", mime: "audio/mpeg", bytes: 3, uploadedAt: at, durationSec: 61 },
];
const deck = (use: boolean): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D" },
  scenes: [{ id: "intro", title: "Intro", beats: [{ id: "b1", timeline: use ? [{ kind: "media", src: `media:${IMG}` }] : [] }] }],
} as unknown as DeckDoc);

const renderLib = (media: MediaInfo[] | null = items, refresh = vi.fn(async () => {})) => ({
  refresh,
  ...render(<DeckMediaContext.Provider value={{ media, refresh }}><MediaLibrary /></DeckMediaContext.Provider>),
});

beforeEach(() => { useEditor.getState().load(deck(false)); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("renders image, video and audio items with name, size and duration", () => {
  const { container } = renderLib();
  expect(screen.getByTestId("media-library")).toBeTruthy();
  const img = screen.getByTestId(`media-item-${IMG}`);
  expect(img.querySelector("img")).toBeTruthy();
  expect(img.textContent).toContain("pic.png");
  expect(img.textContent).toContain("2.0 KB");
  const vid = screen.getByTestId(`media-item-${VID}`);
  const v = vid.querySelector("video")!;
  expect(v.getAttribute("preload")).toBe("metadata");
  expect(v.muted).toBe(true);
  expect(vid.textContent).toContain("clip.mp4");
  expect(vid.textContent).toContain("0:02");
  const aud = screen.getByTestId(`media-item-${AUD}`);
  expect(aud.querySelector("audio, img, video")).toBeNull();
  expect(aud.textContent).toContain("mix.mp3");
  expect(aud.textContent).toContain("1:01");
  expect(container.querySelectorAll("[data-testid^='media-item-']").length).toBe(3);
});

test("Copy ref writes media:<id> to the clipboard", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  renderLib();
  await act(async () => { fireEvent.click(screen.getByTestId(`media-copy-${VID}`)); });
  expect(writeText).toHaveBeenCalledWith(`media:${VID}`);
});

test("uploading two files passes durationSec from readMediaDuration, then refreshes", async () => {
  vi.spyOn(mediaDuration, "readMediaDuration").mockResolvedValueOnce(2.5).mockResolvedValueOnce(undefined);
  const up = vi.spyOn(mediaClient, "uploadMedia").mockResolvedValue(items[0]);
  const { refresh } = renderLib();
  const a = new File(["a"], "a.mp4", { type: "video/mp4" });
  const b = new File(["b"], "b.png", { type: "image/png" });
  await act(async () => { fireEvent.change(screen.getByTestId("media-upload"), { target: { files: [a, b] } }); });
  expect(up).toHaveBeenCalledTimes(2);
  expect(up).toHaveBeenNthCalledWith(1, "d", a, 2.5);
  expect(up).toHaveBeenNthCalledWith(2, "d", b, undefined);
  expect(refresh).toHaveBeenCalled();
});

test("drag-drop uploads the dropped files", async () => {
  vi.spyOn(mediaDuration, "readMediaDuration").mockResolvedValue(undefined);
  const up = vi.spyOn(mediaClient, "uploadMedia").mockResolvedValue(items[0]);
  renderLib();
  const f = new File(["a"], "a.png", { type: "image/png" });
  const zone = screen.getByTestId("media-library");
  const over = fireEvent.dragOver(zone, { dataTransfer: { files: [f] } });
  expect(over).toBe(false); // preventDefault called
  await act(async () => { fireEvent.drop(zone, { dataTransfer: { files: [f] } }); });
  expect(up).toHaveBeenCalledWith("d", f, undefined);
});

test("a failed upload shows the server message next to the file name; others still upload", async () => {
  const hevc = 'unsupported video codec (hvc1) — convert with: ffmpeg -i "bad.mp4" -c:v libx264 -crf 18 -pix_fmt yuv420p -an out.mp4';
  vi.spyOn(mediaDuration, "readMediaDuration").mockResolvedValue(undefined);
  const up = vi.spyOn(mediaClient, "uploadMedia").mockRejectedValueOnce(new Error(hevc)).mockResolvedValueOnce(items[0]);
  renderLib();
  const bad = new File(["a"], "bad.mp4", { type: "video/mp4" });
  const ok = new File(["b"], "ok.png", { type: "image/png" });
  await act(async () => { fireEvent.change(screen.getByTestId("media-upload"), { target: { files: [bad, ok] } }); });
  expect(up).toHaveBeenCalledTimes(2);
  const errs = screen.getAllByTestId("media-error");
  expect(errs).toHaveLength(1);
  expect(errs[0].textContent).toContain("bad.mp4");
  expect(errs[0].textContent).toContain(hevc);
});

test("deleting an unreferenced item deletes without confirming", async () => {
  const del = vi.spyOn(mediaClient, "deleteMedia").mockResolvedValue();
  const { refresh } = renderLib();
  await act(async () => { fireEvent.click(screen.getByTestId(`media-delete-${VID}`)); });
  expect(screen.queryByTestId("media-confirm")).toBeNull();
  expect(del).toHaveBeenCalledWith("d", VID);
  expect(refresh).toHaveBeenCalled();
});

test("deleting a referenced item lists the referencing beats; cancel does not delete, confirm does", async () => {
  useEditor.getState().load(deck(true));
  const del = vi.spyOn(mediaClient, "deleteMedia").mockResolvedValue();
  renderLib();
  await act(async () => { fireEvent.click(screen.getByTestId(`media-delete-${IMG}`)); });
  const dlg = screen.getByTestId("media-confirm");
  expect(within(dlg).getByTestId("media-confirm-ref").textContent).toContain("intro");
  expect(within(dlg).getByTestId("media-confirm-ref").textContent).toContain("b1");
  expect(del).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("media-confirm-cancel"));
  expect(screen.queryByTestId("media-confirm")).toBeNull();
  expect(del).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByTestId(`media-delete-${IMG}`)); });
  await act(async () => { fireEvent.click(screen.getByTestId("media-confirm-ok")); });
  expect(del).toHaveBeenCalledWith("d", IMG);
});

test("the soundtrack picker lists only audio items", () => {
  render(
    <DeckMediaContext.Provider value={{ media: items, refresh: async () => {} }}>
      <SoundtrackSettings loadTrack={() => Promise.resolve({ duration: 1, peaks: new Float32Array(1) } as never)} />
    </DeckMediaContext.Provider>,
  );
  const pick = screen.getByTestId("soundtrack-pick") as HTMLSelectElement;
  const opts = Array.from(pick.options).map((o) => o.value).filter(Boolean);
  expect(opts).toEqual([AUD]);
});
