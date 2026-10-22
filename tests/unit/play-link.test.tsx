import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FlushSaveContext, PlayLink } from "@/components/editor/PlayLink";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderLink = (flush: () => Promise<void>) => render(
  <FlushSaveContext.Provider value={flush}>
    <PlayLink testId="play-deck" href="/play?deck=d">▶ Play deck</PlayLink>
  </FlushSaveContext.Provider>,
);

test("clicking play-deck saves pending edits before opening the player", async () => {
  const order: string[] = [];
  let release!: () => void;
  const flush = vi.fn(() => { order.push("save"); return new Promise<void>((r) => { release = r; }); });
  const open = vi.spyOn(window, "open").mockImplementation(() => { order.push("open"); return null; });
  renderLink(flush);
  const link = screen.getByTestId("play-deck");
  expect(link.getAttribute("href")).toBe("/play?deck=d");
  expect(fireEvent.click(link)).toBe(false); // the browser's own navigation is cancelled
  expect(order).toEqual(["save"]); // not opened until the save settles
  await act(async () => { release(); });
  expect(order).toEqual(["save", "open"]);
  expect(open).toHaveBeenCalledWith("/play?deck=d", "_blank");
});

test("a failed save is logged and the player still opens", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  renderLink(() => Promise.reject(new Error("boom")));
  await act(async () => { fireEvent.click(screen.getByTestId("play-deck")); });
  expect(open).toHaveBeenCalledWith("/play?deck=d", "_blank");
  expect(err).toHaveBeenCalled();
});
