import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AssetPicker } from "@/components/editor/AssetPicker";
import { Field } from "@/components/editor/Field";
import { Inspector } from "@/components/editor/Inspector";
import { DeckMediaContext } from "@/lib/editor/use-deck-media";
import { useEditor } from "@/lib/editor/store";
import { REGISTRY } from "@/lib/editor/registry";
import { PANELS } from "@/engine/deck/story-assets";
import type { DeckDoc } from "@/engine/deck-doc";
import type { MediaInfo } from "@/lib/store/media-store";

const IMG = "0123456789abcdef.png";
const VID = "1123456789abcdef.mp4";
const AUD = "2123456789abcdef.mp3";
const IMG_REF = `media:${IMG}`;
const VID_REF = `media:${VID}`;
const at = "2026-10-23T00:00:00Z";
const items: MediaInfo[] = [
  { id: IMG, name: "pic.png", mime: "image/png", bytes: 2048, uploadedAt: at },
  { id: VID, name: "clip.mp4", mime: "video/mp4", bytes: 4096, uploadedAt: at, durationSec: 2 },
  { id: AUD, name: "mix.mp3", mime: "audio/mpeg", bytes: 3, uploadedAt: at, durationSec: 61 },
];
const ART_ACCEPT = ["panel", "overlay", "image", "video"] as const;
const TILE_ACCEPT = ["image", "video"] as const;

const withMedia = (ui: React.ReactElement) =>
  render(<DeckMediaContext.Provider value={{ media: items, refresh: async () => {} }}>{ui}</DeckMediaContext.Provider>);

const open = () => fireEvent.click(screen.getByTestId("asset-picker-toggle"));

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("the popover lists built-in panels + MusicScore and this deck's image/video uploads (never audio)", () => {
  withMedia(<AssetPicker value="1.01" multiple accept={[...ART_ACCEPT]} onChange={() => {}} />);
  expect(screen.queryByTestId("asset-picker-popover")).toBeNull();
  open();
  const builtIn = screen.getByTestId("asset-section-builtin");
  expect(builtIn.textContent).toContain("Built-in");
  for (const p of PANELS) expect(within(builtIn).getByTestId(`asset-option-${p}`)).toBeTruthy();
  expect(within(builtIn).getByTestId("asset-option-MusicScore")).toBeTruthy();
  const deck = screen.getByTestId("asset-section-deck");
  expect(deck.textContent).toContain("This deck");
  expect(within(deck).getByTestId(`asset-option-${IMG_REF}`).textContent).toContain("pic.png");
  expect(within(deck).getByTestId(`asset-option-${VID_REF}`).textContent).toContain("clip.mp4");
  expect(screen.queryByTestId(`asset-option-media:${AUD}`)).toBeNull();
});

test("tile accept (image/video) hides the built-in section", () => {
  withMedia(<AssetPicker value={undefined} accept={[...TILE_ACCEPT]} onChange={() => {}} />);
  open();
  expect(screen.queryByTestId("asset-section-builtin")).toBeNull();
  expect(screen.getByTestId(`asset-option-${VID_REF}`)).toBeTruthy();
});

test("multiple mode: choosing appends in order; one item is a string, more is an array", () => {
  const onChange = vi.fn();
  const { rerender } = withMedia(<AssetPicker value="1.01" multiple accept={[...ART_ACCEPT]} onChange={onChange} />);
  open();
  fireEvent.click(screen.getByTestId("asset-option-MusicScore"));
  expect(onChange).toHaveBeenLastCalledWith(["1.01", "MusicScore"]);
  rerender(<DeckMediaContext.Provider value={{ media: items, refresh: async () => {} }}>
    <AssetPicker value={["1.01", "MusicScore"]} multiple accept={[...ART_ACCEPT]} onChange={onChange} />
  </DeckMediaContext.Provider>);
  fireEvent.click(screen.getByTestId(`asset-option-${VID_REF}`));
  expect(onChange).toHaveBeenLastCalledWith(["1.01", "MusicScore", VID_REF]);
});

test("multiple mode: chips show labels; remove and up/down reorder", () => {
  const onChange = vi.fn();
  withMedia(<AssetPicker value={["1.01", VID_REF, "MusicScore"]} multiple accept={[...ART_ACCEPT]} onChange={onChange} />);
  expect(screen.getByTestId(`asset-chip-${VID_REF}`).textContent).toContain("clip.mp4");
  expect(screen.getByTestId("asset-chip-1.01").textContent).toContain("1.01");
  fireEvent.click(screen.getByTestId(`asset-chip-remove-${VID_REF}`));
  expect(onChange).toHaveBeenLastCalledWith(["1.01", "MusicScore"]);
  fireEvent.click(screen.getByTestId("asset-chip-up-MusicScore"));
  expect(onChange).toHaveBeenLastCalledWith(["1.01", "MusicScore", VID_REF]);
  fireEvent.click(screen.getByTestId("asset-chip-down-1.01"));
  expect(onChange).toHaveBeenLastCalledWith([VID_REF, "1.01", "MusicScore"]);
});

test("multiple mode: removing down to one item yields a string", () => {
  const onChange = vi.fn();
  withMedia(<AssetPicker value={["1.01", "1.02"]} multiple accept={[...ART_ACCEPT]} onChange={onChange} />);
  fireEvent.click(screen.getByTestId("asset-chip-remove-1.02"));
  expect(onChange).toHaveBeenLastCalledWith("1.01");
});

test("multiple mode: a hand-typed key is appended on Enter and on blur", () => {
  const onChange = vi.fn();
  withMedia(<AssetPicker value="1.01" multiple accept={[...ART_ACCEPT]} onChange={onChange} />);
  const text = screen.getByTestId("asset-picker-text") as HTMLInputElement;
  fireEvent.change(text, { target: { value: "3.02" } });
  fireEvent.keyDown(text, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith(["1.01", "3.02"]);
  fireEvent.change(text, { target: { value: "4" } });
  fireEvent.blur(text);
  expect(onChange).toHaveBeenLastCalledWith(["1.01", "4"]);
});

test("single mode (tile) replaces the value and closes; free text (a URL) commits on blur/Enter", () => {
  const onChange = vi.fn();
  withMedia(<AssetPicker value="https://x.test/a.png" accept={[...TILE_ACCEPT]} onChange={onChange} />);
  open();
  fireEvent.click(screen.getByTestId(`asset-option-${IMG_REF}`));
  expect(onChange).toHaveBeenLastCalledWith(IMG_REF);
  expect(screen.queryByTestId("asset-picker-popover")).toBeNull();
  const text = screen.getByTestId("asset-picker-text") as HTMLInputElement;
  expect(text.value).toBe("https://x.test/a.png");
  fireEvent.change(text, { target: { value: "https://x.test/b.png" } });
  fireEvent.blur(text);
  expect(onChange).toHaveBeenLastCalledWith("https://x.test/b.png");
  fireEvent.change(text, { target: { value: "https://x.test/c.png" } });
  fireEvent.keyDown(text, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith("https://x.test/c.png");
});

test("clip controls appear only for video refs (art): In-point merges per ref, Loop toggles", () => {
  const onClipsChange = vi.fn();
  const other = { "media:aaaa.webm": { loop: true } };
  withMedia(<AssetPicker value={["1.01", VID_REF]} multiple accept={[...ART_ACCEPT]} clips={other} onChange={() => {}} onClipsChange={onClipsChange} />);
  expect(screen.queryByTestId("clip-in-1.01")).toBeNull();
  const inp = screen.getByTestId(`clip-in-${VID_REF}`) as HTMLInputElement;
  expect(inp.type).toBe("number");
  expect(inp.min).toBe("0");
  expect(inp.step).toBe("0.1");
  fireEvent.change(inp, { target: { value: "1.5" } });
  expect(onClipsChange).toHaveBeenLastCalledWith({ ...other, [VID_REF]: { in: 1.5 } });
  fireEvent.click(screen.getByTestId(`clip-loop-${VID_REF}`));
  expect(onClipsChange).toHaveBeenLastCalledWith({ ...other, [VID_REF]: { loop: true } });
});

test("art: clearing both In-point and Loop deletes that ref's entry, leaving others alone", () => {
  const onClipsChange = vi.fn();
  const clips = { [VID_REF]: { in: 1.5 }, "media:aaaa.webm": { loop: true } };
  withMedia(<AssetPicker value={VID_REF} multiple accept={[...ART_ACCEPT]} clips={clips} onChange={() => {}} onClipsChange={onClipsChange} />);
  const inp = screen.getByTestId(`clip-in-${VID_REF}`) as HTMLInputElement;
  expect(inp.value).toBe("1.5");
  fireEvent.change(inp, { target: { value: "" } });
  expect(onClipsChange).toHaveBeenLastCalledWith({ "media:aaaa.webm": { loop: true } });
});

test("art: clearing the only entry clears clips entirely", () => {
  const onClipsChange = vi.fn();
  withMedia(<AssetPicker value={VID_REF} multiple accept={[...ART_ACCEPT]} clips={{ [VID_REF]: { loop: true } }} onChange={() => {}} onClipsChange={onClipsChange} />);
  const loop = screen.getByTestId(`clip-loop-${VID_REF}`) as HTMLInputElement;
  expect(loop.checked).toBe(true);
  fireEvent.click(loop);
  expect(onClipsChange).toHaveBeenLastCalledWith(undefined);
});

test("tile: clip controls write a single ClipOpts; clearing both gives undefined", () => {
  const onClipsChange = vi.fn();
  const { rerender } = withMedia(<AssetPicker value={VID_REF} accept={[...TILE_ACCEPT]} onChange={() => {}} onClipsChange={onClipsChange} />);
  fireEvent.change(screen.getByTestId(`clip-in-${VID_REF}`), { target: { value: "1.5" } });
  expect(onClipsChange).toHaveBeenLastCalledWith({ in: 1.5 });
  rerender(<DeckMediaContext.Provider value={{ media: items, refresh: async () => {} }}>
    <AssetPicker value={VID_REF} accept={[...TILE_ACCEPT]} clips={{ in: 1.5 }} onChange={() => {}} onClipsChange={onClipsChange} />
  </DeckMediaContext.Provider>);
  fireEvent.change(screen.getByTestId(`clip-in-${VID_REF}`), { target: { value: "" } });
  expect(onClipsChange).toHaveBeenLastCalledWith(undefined);
});

test("tile: an image ref shows no clip controls", () => {
  withMedia(<AssetPicker value={IMG_REF} accept={[...TILE_ACCEPT]} onChange={() => {}} onClipsChange={() => {}} />);
  expect(screen.queryByTestId(`clip-in-${IMG_REF}`)).toBeNull();
});

test("registry: art.to and media src are asset fields with the right accept/clipKey", () => {
  expect(REGISTRY.art.schema.find((f) => f.key === "art.to")).toEqual(
    { key: "art.to", label: "Panel(s)", type: "asset", multiple: true, accept: ["panel", "overlay", "image", "video"], clipKey: "art.clips" });
  expect(REGISTRY.media.schema.find((f) => f.key === "src")).toEqual(
    { key: "src", label: "Source", type: "asset", accept: ["image", "video"], clipKey: "clip" });
});

test("Field with type asset renders the AssetPicker and forwards extra clip props", () => {
  const onClipsChange = vi.fn();
  withMedia(<Field spec={{ key: "src", label: "Source", type: "asset", accept: ["image", "video"], clipKey: "clip" }}
    value={VID_REF} onChange={() => {}} extra={{ clips: { in: 0.5 }, onClipsChange }} />);
  expect(screen.getByTestId("field-src").querySelector("[data-testid='asset-picker']")).toBeTruthy();
  expect((screen.getByTestId(`clip-in-${VID_REF}`) as HTMLInputElement).value).toBe("0.5");
});

const artDoc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [
    { kind: "art", art: { to: VID_REF, mode: "fade", clips: { "media:aaaa.webm": { loop: true } } } },
    { kind: "media", id: "m-1", pos: { x: 0.5, y: 0.5 }, src: VID_REF, clip: { in: 0.25 } },
  ] }] },
] } as unknown as DeckDoc);

test("Inspector wires art clips as a whole object at art.clips (media ids contain a dot)", () => {
  useEditor.getState().load(artDoc());
  useEditor.getState().selectAction(0);
  withMedia(<Inspector />);
  fireEvent.change(screen.getByTestId(`clip-in-${VID_REF}`), { target: { value: "0.5" } });
  const a = useEditor.getState().doc!.scenes[0].beats[0].timeline[0] as { art: { clips: Record<string, unknown> } };
  expect(a.art.clips).toEqual({ "media:aaaa.webm": { loop: true }, [VID_REF]: { in: 0.5 } });
});

test("Inspector wires the tile clip at clip", () => {
  useEditor.getState().load(artDoc());
  useEditor.getState().selectAction(1);
  withMedia(<Inspector />);
  const inp = screen.getByTestId(`clip-in-${VID_REF}`) as HTMLInputElement;
  expect(inp.value).toBe("0.25");
  fireEvent.click(screen.getByTestId(`clip-loop-${VID_REF}`));
  const m = useEditor.getState().doc!.scenes[0].beats[0].timeline[1] as { clip?: unknown };
  expect(m.clip).toEqual({ in: 0.25, loop: true });
});

test("Escape closes the popover and does not reach the editor's window handler (final review T12)", () => {
  withMedia(<AssetPicker value={undefined} accept={[...TILE_ACCEPT]} onChange={() => {}} />);
  const editorKey = vi.fn();
  window.addEventListener("keydown", editorKey);
  try {
    open();
    const option = screen.getByTestId(`asset-option-${VID_REF}`);
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { option.dispatchEvent(ev); });
    expect(screen.queryByTestId("asset-picker-popover")).toBeNull();
    expect(editorKey).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
    // Closed: Escape is the editor's again.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(editorKey).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("keydown", editorKey);
  }
});
