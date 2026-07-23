import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { McpPanel } from "@/components/editor/McpPanel";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const token = init?.method === "POST" ? "regenerated-token" : "initial-token";
    return { ok: true, json: async () => ({ token }) } as Response;
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("loads and displays a masked token, with the URL visible", async () => {
  render(<McpPanel />);
  await waitFor(() => expect((screen.getByTestId("mcp-token") as HTMLInputElement).value).toBe("initial-token"));
  expect((screen.getByTestId("mcp-token") as HTMLInputElement).type).toBe("password");
  expect((screen.getByTestId("mcp-url") as HTMLInputElement).value).toContain("/api/mcp");
});

test("Reveal toggles the token's visibility", async () => {
  render(<McpPanel />);
  await waitFor(() => expect((screen.getByTestId("mcp-token") as HTMLInputElement).value).toBe("initial-token"));
  fireEvent.click(screen.getByTestId("mcp-reveal"));
  expect((screen.getByTestId("mcp-token") as HTMLInputElement).type).toBe("text");
});

test("Regenerate fetches and displays a new token", async () => {
  render(<McpPanel />);
  await waitFor(() => expect((screen.getByTestId("mcp-token") as HTMLInputElement).value).toBe("initial-token"));
  fireEvent.click(screen.getByTestId("mcp-regenerate"));
  await waitFor(() => expect((screen.getByTestId("mcp-token") as HTMLInputElement).value).toBe("regenerated-token"));
});

test("Copy writes the current token to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<McpPanel />);
  await waitFor(() => expect((screen.getByTestId("mcp-token") as HTMLInputElement).value).toBe("initial-token"));
  fireEvent.click(screen.getByTestId("mcp-copy"));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("initial-token"));
});
