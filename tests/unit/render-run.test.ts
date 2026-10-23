import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CHROMIUM_LAUNCH_OPTIONS, exitCodeFor, RenderAbortedError, RenderSetupError, runRender,
  type FfmpegProcess, type RenderBrowser, type RenderDeps, type RenderPage,
} from "@/lib/render/run";
import { ffmpegArgs } from "@/lib/render/ffmpeg";
import { RenderArgError, type RenderOptions } from "@/lib/render/args";

const BASE = "http://host:3000/morgana";
const OPTS: RenderOptions = { deck: "d1", out: "/tmp/out.mp4", baseUrl: BASE, fps: 10, width: 320, height: 180, from: 0 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

type RenderGlobal = NonNullable<Window["__morganaRender"]>;

/** A child-process stand-in: stdin captures writes; end() makes ffmpeg "exit" with `exitCode`. */
class FakeFfmpeg extends EventEmitter implements FfmpegProcess {
  writes: Buffer[] = [];
  writeResults: boolean[] = [];
  exitCode = 0;
  stderrOnExit = "";
  ended = false;
  kill = vi.fn((_sig?: NodeJS.Signals) => { setImmediate(() => this.emit("close", null, "SIGKILL")); return true; });
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), {
    write: (chunk: Buffer) => { this.writes.push(chunk); return this.writeResults.shift() ?? true; },
    end: () => {
      this.ended = true;
      setImmediate(() => {
        if (this.stderrOnExit) this.stderr.emit("data", Buffer.from(this.stderrOnExit));
        this.emit("close", this.exitCode, null);
      });
    },
  });
}

/** A page that runs the page functions against jsdom's `window`, so the real evaluate bodies execute. */
function fakeBrowser(render: RenderGlobal | undefined) {
  const calls = { goto: [] as string[], newPage: [] as unknown[], waitTimeout: 0, screenshots: 0, rendered: [] as number[] };
  const page: RenderPage = {
    goto: async (url) => { calls.goto.push(url); window.__morganaRender = render; },
    waitForFunction: async (fn, opts) => {
      calls.waitTimeout = opts.timeout;
      if (!fn()) throw Object.assign(new Error("Timeout 30000ms exceeded."), { name: "TimeoutError" });
    },
    evaluate: async (fn, arg) => fn(arg),
    screenshot: async () => { calls.screenshots++; return PNG; },
  };
  const browser: RenderBrowser & { close: ReturnType<typeof vi.fn> } = {
    newPage: async (o) => { calls.newPage.push(o); return page; },
    close: vi.fn(async () => {}),
  };
  return { browser, calls };
}

function readyRender(total: number, onFrame?: (T: number) => void | Promise<void>): RenderGlobal {
  return { ready: true, total, renderFrame: async (T: number) => { await onFrame?.(T); } };
}

function deckResponse(meta: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ version: 1, meta: { id: "d1", title: "D", ...meta }, scenes: [] }), { status: 200 });
}

function setup(opts: { render?: RenderGlobal; meta?: Record<string, unknown>; deckStatus?: number } = {}) {
  const ff = new FakeFfmpeg();
  const { browser, calls } = fakeBrowser(opts.render ?? readyRender(0.3));
  const spawnArgs: string[][] = [];
  const logs: string[] = [];
  const fetched: string[] = [];
  let clock = 0;
  const deps: Partial<RenderDeps> = {
    launchBrowser: vi.fn(async () => browser),
    spawnFfmpeg: (args) => { spawnArgs.push(args); return ff; },
    fetch: (async (url: string) => {
      fetched.push(url);
      if (url.endsWith("/api/decks/d1")) {
        return opts.deckStatus ? new Response("{}", { status: opts.deckStatus }) : deckResponse(opts.meta);
      }
      if (url.includes("/media/")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return new Response("", { status: 404 });
    }) as typeof fetch,
    log: (l) => logs.push(l),
    unlink: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ size: 2_500_000 })),
    now: () => (clock += 1100),
  };
  return { ff, browser, calls, spawnArgs, logs, fetched, deps };
}

afterEach(() => { delete window.__morganaRender; });

describe("runRender — happy path", () => {
  test("renders 3 frames at fps 10, pipes each PNG to ffmpeg, logs progress and returns stats", async () => {
    const rendered: number[] = [];
    const s = setup({ render: readyRender(0.3, (T) => { rendered.push(T); }) });
    const res = await runRender(OPTS, s.deps);

    expect(rendered).toEqual([0, 0.1, 0.2]);
    expect(s.ff.writes).toEqual([PNG, PNG, PNG]);
    expect(s.ff.ended).toBe(true);
    expect(s.spawnArgs).toEqual([ffmpegArgs({ fps: 10, out: OPTS.out, duration: 0.3, audioOffset: 0 })]);
    expect(s.calls.goto).toEqual([`${BASE}/render?deck=d1`]);
    expect(s.calls.newPage).toEqual([{ viewport: { width: 320, height: 180 }, deviceScaleFactor: 1 }]);
    expect(s.calls.waitTimeout).toBe(30_000);
    expect(s.fetched).toEqual([`${BASE}/api/decks/d1`]);
    expect(s.logs.some((l) => /^frame 3\/3 · \d+\.\d fps · ETA \d+:\d\d$/.test(l))).toBe(true);
    expect(s.browser.close).toHaveBeenCalledTimes(1);
    expect(s.ff.kill).not.toHaveBeenCalled();
    expect(s.deps.unlink).not.toHaveBeenCalled();
    expect(res).toEqual({ out: OPTS.out, frames: 3, seconds: 0.3, bytes: 2_500_000 });
  });

  test("--from/--to select the frame window and offset the audio", async () => {
    const rendered: number[] = [];
    const s = setup({ render: readyRender(5, (T) => { rendered.push(T); }) });
    const res = await runRender({ ...OPTS, from: 1, to: 1.3 }, s.deps);
    expect(rendered.map((t) => +t.toFixed(9))).toEqual([1, 1.1, 1.2]);
    expect(s.spawnArgs[0]).toEqual(ffmpegArgs({ fps: 10, out: OPTS.out, duration: 1.3 - 1, audioOffset: 1 }));
    expect(res.frames).toBe(3);
  });

  test("progress is logged at most once per second", async () => {
    const s = setup({ render: readyRender(1) });
    s.deps.now = () => 0; // the clock never advances: only the final frame logs
    await runRender(OPTS, s.deps);
    expect(s.logs.filter((l) => l.startsWith("frame "))).toEqual([expect.stringMatching(/^frame 10\/10 /)]);
  });

  test("a deck with meta.soundtrack downloads the media to a temp file, maps it into ffmpeg, then deletes it", async () => {
    const s = setup({ meta: { soundtrack: { media: "abc123.wav" } } });
    await runRender(OPTS, s.deps);
    expect(s.fetched).toEqual([`${BASE}/api/decks/d1`, `${BASE}/api/decks/d1/media/abc123.wav`]);
    const args = s.spawnArgs[0];
    const audioPath = args[args.indexOf("-ss") + 3];
    expect(audioPath).toMatch(/abc123\.wav$/);
    expect(args).toEqual(ffmpegArgs({ fps: 10, out: OPTS.out, duration: 0.3, audioPath, audioOffset: 0 }));
    expect(existsSync(audioPath)).toBe(false);
  });

  test("backpressure: when stdin.write returns false, the next frame waits for 'drain'", async () => {
    const s = setup();
    s.ff.writeResults = [false];
    const done = runRender(OPTS, s.deps);
    await vi.waitFor(() => expect(s.ff.writes).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(s.calls.screenshots).toBe(1); // stalled on drain
    s.ff.stdin.emit("drain");
    await done;
    expect(s.ff.writes).toHaveLength(3);
  });

  test("Chromium is launched headless without Playwright's own signal handlers (they would process.exit and skip cleanup)", () => {
    expect(CHROMIUM_LAUNCH_OPTIONS).toEqual({ headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  });
});

describe("runRender — failures clean up", () => {
  test("a frame failure at frame 2 rejects with the frame number and T; closes the browser, kills ffmpeg, removes the output and temp audio", async () => {
    const s = setup({
      meta: { soundtrack: { media: "abc123.wav" } },
      render: readyRender(0.3, (T) => { if (T > 0.15) throw new Error("boom"); }),
    });
    await expect(runRender(OPTS, s.deps)).rejects.toThrow(/frame 2.*T=0\.2.*boom/);
    expect(s.browser.close).toHaveBeenCalledTimes(1);
    expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
    const args = s.spawnArgs[0];
    expect(existsSync(args[args.indexOf("-ss") + 3])).toBe(false);
  });

  test("a non-zero ffmpeg exit rejects with the stderr tail and removes the output", async () => {
    const s = setup();
    s.ff.exitCode = 1;
    s.ff.stderrOnExit = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\nUnknown encoder 'libx264'\n";
    const err = await runRender(OPTS, s.deps).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ffmpeg exited with code 1/);
    expect((err as Error).message).toContain("Unknown encoder 'libx264'");
    expect((err as Error).message).not.toContain("line 0\n");
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
    expect(s.browser.close).toHaveBeenCalledTimes(1);
  });

  test("ffmpeg dying mid-render fails the next frame instead of hanging on drain", async () => {
    const s = setup();
    s.ff.writeResults = [false];
    const done = runRender(OPTS, s.deps).catch((e: Error) => e);
    await vi.waitFor(() => expect(s.ff.writes).toHaveLength(1));
    s.ff.stderr.emit("data", Buffer.from("Broken pipe\n"));
    s.ff.emit("close", 1, null);
    const err = await done;
    expect((err as Error).message).toMatch(/ffmpeg exited with code 1[\s\S]*Broken pipe/);
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
  });

  test("abort (Ctrl-C) mid-render stops between frames and runs the same cleanup", async () => {
    const ac = new AbortController();
    const rendered: number[] = [];
    const s = setup({ meta: { soundtrack: { media: "abc123.wav" } }, render: readyRender(1, (T) => { rendered.push(T); if (T > 0.05) ac.abort(); }) });
    const err = await runRender(OPTS, { ...s.deps, signal: ac.signal }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RenderAbortedError);
    expect(rendered).toHaveLength(2); // stopped right after the frame during which the signal fired
    expect(s.browser.close).toHaveBeenCalledTimes(1);
    expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
    const args = s.spawnArgs[0];
    expect(existsSync(args[args.indexOf("-ss") + 3])).toBe(false);
  });

  test("an already-aborted signal never launches Chromium or ffmpeg", async () => {
    const s = setup();
    const ac = new AbortController(); ac.abort();
    await expect(runRender(OPTS, { ...s.deps, signal: ac.signal })).rejects.toBeInstanceOf(RenderAbortedError);
    expect(s.deps.launchBrowser).not.toHaveBeenCalled();
    expect(s.spawnArgs).toHaveLength(0);
    expect(s.deps.unlink).not.toHaveBeenCalled();
  });

  test("deck 404 rejects with RenderSetupError naming the deck id; nothing launched or deleted", async () => {
    const s = setup({ deckStatus: 404 });
    const err = await runRender(OPTS, s.deps).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RenderSetupError);
    expect((err as Error).message).toBe(`deck d1 not found at ${BASE}`);
    expect(s.deps.launchBrowser).not.toHaveBeenCalled();
    expect(s.deps.unlink).not.toHaveBeenCalled();
  });

  test("an unreachable server is a RenderSetupError", async () => {
    const s = setup();
    s.deps.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(runRender(OPTS, s.deps)).rejects.toThrow(RenderSetupError);
  });

  test("a missing soundtrack file is a RenderSetupError (not a silent render)", async () => {
    const s = setup({ meta: { soundtrack: { media: "gone.mp3" } } });
    const base = s.deps.fetch!;
    s.deps.fetch = (async (url: string) => (url.includes("/media/") ? new Response("", { status: 404 }) : base(url))) as typeof fetch;
    await expect(runRender(OPTS, s.deps)).rejects.toThrow(/soundtrack gone\.mp3/);
    expect(s.deps.launchBrowser).not.toHaveBeenCalled();
  });

  test("ready: false rejects with RenderSetupError carrying the page's error; browser closed, ffmpeg never spawned", async () => {
    const s = setup({ render: { ready: false, error: "deck has no duration" } });
    const err = await runRender(OPTS, s.deps).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RenderSetupError);
    expect((err as Error).message).toContain("deck has no duration");
    expect(s.browser.close).toHaveBeenCalledTimes(1);
    expect(s.spawnArgs).toHaveLength(0);
    expect(s.deps.unlink).not.toHaveBeenCalled();
  });

  test("the render page never deciding (timeout) is a RenderSetupError", async () => {
    const s = setup();
    s.calls.goto = [];
    const { browser } = fakeBrowser(undefined);
    s.deps.launchBrowser = async () => browser;
    const err = await runRender(OPTS, s.deps).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RenderSetupError);
    expect((err as Error).message).toMatch(/did not become ready within 30s/);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  test("--from at or past the deck's end is a RenderSetupError", async () => {
    const s = setup({ render: readyRender(0.3) });
    await expect(runRender({ ...OPTS, from: 0.3 }, s.deps)).rejects.toThrow(RenderSetupError);
    expect(s.spawnArgs).toHaveLength(0);
  });
});

describe("exitCodeFor", () => {
  test("usage/setup errors exit 2, everything else exits 1", () => {
    expect(exitCodeFor(new RenderArgError("x"))).toBe(2);
    expect(exitCodeFor(new RenderSetupError("x"))).toBe(2);
    expect(exitCodeFor(new RenderAbortedError())).toBe(1);
    expect(exitCodeFor(new Error("x"))).toBe(1);
  });
});
