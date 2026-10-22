import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FlushSaveContext, PlayLink, playNavigation } from "@/components/editor/PlayLink";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderLink = (flush: () => Promise<void>) => render(
  <FlushSaveContext.Provider value={flush}>
    <PlayLink testId="play-deck" href="/play?deck=d">▶ Play deck</PlayLink>
  </FlushSaveContext.Provider>,
);

/** A stand-in for the blank tab window.open returns; the link navigates it via location.href. */
const fakeTab = () => ({ location: { href: "" }, opener: {} as unknown }) as unknown as Window;

test("the tab opens synchronously in the click (popup-safe), then navigates once the save settles", async () => {
  const order: string[] = [];
  let release!: () => void;
  const flush = vi.fn(() => { order.push("save"); return new Promise<void>((r) => { release = r; }); });
  const tab = fakeTab();
  const open = vi.spyOn(window, "open").mockImplementation(() => { order.push("open"); return tab; });
  renderLink(flush);
  const link = screen.getByTestId("play-deck");
  expect(link.getAttribute("href")).toBe("/play?deck=d");
  expect(fireEvent.click(link)).toBe(false); // the browser's own navigation is cancelled
  // Opened inside the user gesture, BEFORE the save — Safari blocks a window.open after an await.
  expect(order).toEqual(["open", "save"]);
  expect(open).toHaveBeenCalledWith("", "_blank");
  expect(tab.location.href).toBe(""); // not pointed at the player until the save settles
  await act(async () => { release(); });
  expect(tab.location.href).toBe("/play?deck=d");
  expect(tab.opener).toBeNull();
});

test("a failed save is logged and the player still opens", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const tab = fakeTab();
  vi.spyOn(window, "open").mockImplementation(() => tab);
  renderLink(() => Promise.reject(new Error("boom")));
  await act(async () => { fireEvent.click(screen.getByTestId("play-deck")); });
  expect(tab.location.href).toBe("/play?deck=d");
  expect(err).toHaveBeenCalled();
});

test("if the browser blocks the tab anyway, the player opens in this tab after the save", async () => {
  const order: string[] = [];
  vi.spyOn(window, "open").mockImplementation(() => null);
  const sameTab = vi.spyOn(playNavigation, "sameTab").mockImplementation(() => { order.push("same-tab"); });
  renderLink(async () => { order.push("save"); });
  await act(async () => { fireEvent.click(screen.getByTestId("play-deck")); });
  expect(order).toEqual(["save", "same-tab"]);
  expect(sameTab).toHaveBeenCalledWith("/play?deck=d");
});

test.each([
  ["metaKey", { metaKey: true }],
  ["ctrlKey", { ctrlKey: true }],
  ["shiftKey", { shiftKey: true }],
])("%s-click is left to the browser (background tab / new window) and still flushes", (_name, mods) => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  const flush = vi.fn(() => Promise.resolve());
  renderLink(flush);
  expect(fireEvent.click(screen.getByTestId("play-deck"), mods)).toBe(true); // not prevented
  expect(open).not.toHaveBeenCalled();
  expect(flush).toHaveBeenCalled();
});
