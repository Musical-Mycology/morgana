import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CHROMIUM_LAUNCH_OPTIONS, exitCodeFor, FRAME_TIMEOUT_MS, KILL_WAIT_MS, RenderAbortedError, RenderPageError, RenderSetupError, runRender,
  type FfmpegProcess, type RenderBrowser, type RenderDeps, type RenderPage,
} from "@/lib/render/run";
import { ffmpegArgs } from "@/lib/render/ffmpeg";
import { RenderArgError, type RenderOptions } from "@/lib/render/args";

const BASE = "http://host:3000/morgana";
const OPTS: RenderOptions = { deck: "d1", out: "/tmp/out.mp4", baseUrl: BASE, fps: 10, width: 320, height: 180, from: 0 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

type RenderGlobal = NonNullable<Window["__morganaRender"]>;

/** The temp soundtrack path ffmpeg was given (the `-i` input after `-ss <offset>`). */
function audioArg(args: string[]): string {
  const i = args.indexOf("-ss");
  expect(i).toBeGreaterThan(-1);
  const j = args.indexOf("-i", i);
  expect(j).toBeGreaterThan(i);
  return args[j + 1];
}

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
function fakeBrowser(render: RenderGlobal | undefined, o: { hangReady?: boolean } = {}) {
  const calls = { goto: [] as string[], newPage: [] as unknown[], waitTimeout: 0, screenshots: 0, rendered: [] as number[] };
  const errorListeners: ((message: string) => void)[] = [];
  /** Simulate Playwright's `pageerror` (an uncaught exception in the page) or `crash`. */
  const pageError = (message: string) => errorListeners.forEach((cb) => cb(message));
  const page: RenderPage = {
    goto: async (url) => { calls.goto.push(url); window.__morganaRender = render; },
    waitForFunction: async (fn, opts) => {
      calls.waitTimeout = opts.timeout;
      if (o.hangReady) return new Promise(() => {});
      if (!fn()) throw Object.assign(new Error("Timeout 30000ms exceeded."), { name: "TimeoutError" });
    },
    onError: (cb) => { errorListeners.push(cb); },
    evaluate: async (fn, arg) => fn(arg),
    screenshot: async () => { calls.screenshots++; return PNG; },
  };
  const browser: RenderBrowser & { close: ReturnType<typeof vi.fn> } = {
    newPage: async (o) => { calls.newPage.push(o); return page; },
    close: vi.fn(async () => {}),
  };
  return { browser, calls, pageError };
}

function readyRender(total: number, onFrame?: (T: number) => void | string[] | Promise<void | string[]>): RenderGlobal {
  return { ready: true, total, renderFrame: async (T: number) => ({ failed: (await onFrame?.(T)) ?? [] }) };
}

function deckResponse(meta: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ version: 1, meta: { id: "d1", title: "D", ...meta }, scenes: [] }), { status: 200 });
}

function setup(opts: { render?: RenderGlobal; meta?: Record<string, unknown>; deckStatus?: number } = {}) {
  const ff = new FakeFfmpeg();
  const { browser, calls, pageError } = fakeBrowser(opts.render ?? readyRender(0.3));
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
    unlinkSync: vi.fn(),
    stat: vi.fn(async () => ({ size: 2_500_000 })),
    now: () => (clock += 1100),
  };
  return { ff, browser, calls, pageError, spawnArgs, logs, fetched, deps };
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
    expect(s.logs.some((l) => l.startsWith("warning"))).toBe(false);
  });

  test("--to past the deck's end is clamped to the total, with a one-line warning", async () => {
    const rendered: number[] = [];
    const s = setup({ render: readyRender(0.3, (T) => { rendered.push(T); }) });
    const res = await runRender({ ...OPTS, to: 5 }, s.deps);
    expect(rendered).toEqual([0, 0.1, 0.2]);
    expect(s.spawnArgs[0]).toEqual(ffmpegArgs({ fps: 10, out: OPTS.out, duration: 0.3, audioOffset: 0 }));
    expect(res.seconds).toBe(0.3);
    expect(s.logs.filter((l) => l.startsWith("warning"))).toEqual(["warning: --to 5s is past the deck's end (0.3s); rendering to 0.3s"]);
  });

  test("progress is logged at most once per second", async () => {
    const s = setup({ render: readyRender(1) });
    s.deps.now = () => 0; // the clock never advances: only the final frame logs
    await runRender(OPTS, s.deps);
    expect(s.logs.filter((l) => l.startsWith("frame "))).toEqual([expect.stringMatching(/^frame 10\/10 /)]);
  });

  test("a deck with meta.soundtrack downloads the media to a temp file, maps it into ffmpeg, then deletes it", async () => {
    const s = setup({ meta: { soundtrack: { media: "0123456789abcdef.wav" } } });
    await runRender(OPTS, s.deps);
    expect(s.fetched).toEqual([`${BASE}/api/decks/d1`, `${BASE}/api/decks/d1/media/0123456789abcdef.wav`]);
    const args = s.spawnArgs[0];
    const audioPath = audioArg(args);
    expect(audioPath).toMatch(/0123456789abcdef\.wav$/);
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
      meta: { soundtrack: { media: "0123456789abcdef.wav" } },
      render: readyRender(0.3, (T) => { if (T > 0.15) throw new Error("boom"); }),
    });
    await expect(runRender(OPTS, s.deps)).rejects.toThrow(/frame 2.*T=0\.2.*boom/);
    expect(s.browser.close).toHaveBeenCalledTimes(1);
    expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
    const args = s.spawnArgs[0];
    expect(existsSync(audioArg(args))).toBe(false);
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
    const s = setup({ meta: { soundtrack: { media: "0123456789abcdef.wav" } }, render: readyRender(1, (T) => { rendered.push(T); if (T > 0.05) ac.abort(); }) });
    const err = await runRender(OPTS, { ...s.deps, signal: ac.signal }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RenderAbortedError);
    expect(rendered).toHaveLength(2); // stopped right after the frame during which the signal fired
    expect(s.browser.close).toHaveBeenCalledTimes(1);
    expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
    const args = s.spawnArgs[0];
    expect(existsSync(audioArg(args))).toBe(false);
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
    const s = setup({ meta: { soundtrack: { media: "fedcba9876543210.mp3" } } });
    const base = s.deps.fetch!;
    s.deps.fetch = (async (url: string) => (url.includes("/media/") ? new Response("", { status: 404 }) : base(url))) as typeof fetch;
    await expect(runRender(OPTS, s.deps)).rejects.toThrow(/soundtrack fedcba9876543210\.mp3/);
    expect(s.deps.launchBrowser).not.toHaveBeenCalled();
  });

  test("ready: false rejects with RenderPageError (exit 1) carrying the page's error; browser closed, ffmpeg never spawned", async () => {
    const s = setup({ render: { ready: false, error: "deck has no duration" } });
    const err = await runRender(OPTS, s.deps).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RenderPageError);
    expect(exitCodeFor(err)).toBe(1);
    expect((err as Error).message).toContain("deck has no duration");
    expect(s.browser.close).toHaveBeenCalledTimes(1);
    expect(s.spawnArgs).toHaveLength(0);
    expect(s.deps.unlink).not.toHaveBeenCalled();
  });

  test("the render page never deciding (timeout) is a RenderSetupError", async () => {
    const s = setup();
    const { browser } = fakeBrowser(undefined);
    s.deps.launchBrowser = async () => browser;
    const err = await runRender(OPTS, s.deps).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RenderSetupError);
    expect((err as Error).message).toMatch(/did not become ready within 30s/);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  test("--from at or past the deck's end is a RenderSetupError (exit 2) with a clear message", async () => {
    for (const from of [0.3, 1]) {
      const s = setup({ render: readyRender(0.3) });
      const err = await runRender({ ...OPTS, from }, s.deps).catch((e: Error) => e);
      expect(err).toBeInstanceOf(RenderSetupError);
      expect((err as Error).message).toBe(`--from ${from}s is at or past the deck's end (0.3s) — nothing to render`);
      expect(s.spawnArgs).toHaveLength(0);
      expect(s.browser.close).toHaveBeenCalledTimes(1);
    }
  });

  test("an abort coinciding with a rejecting renderFrame (Chromium SIGINTed: 'Target closed') is RenderAbortedError", async () => {
    const ac = new AbortController();
    const s = setup({ render: readyRender(1, (T) => {
      if (T > 0.05) { ac.abort(); throw new Error("Target page, context or browser has been closed"); }
    }) });
    const err = await runRender(OPTS, { ...s.deps, signal: ac.signal }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RenderAbortedError);
    expect(exitCodeFor(err)).toBe(130);
    expect(s.browser.close).toHaveBeenCalledTimes(1);
    expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
  });

  test("an abort coinciding with ffmpeg exiting 255 (ffmpeg SIGINTed) is RenderAbortedError", async () => {
    const ac = new AbortController();
    const s = setup({ render: readyRender(0.3, (T) => { if (T > 0.15) ac.abort(); }) }); // during the LAST frame
    s.ff.exitCode = 255;
    s.ff.stderrOnExit = "Exiting normally, received signal 2.\n";
    const err = await runRender(OPTS, { ...s.deps, signal: ac.signal }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RenderAbortedError);
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
    expect(s.browser.close).toHaveBeenCalledTimes(1);
  });

  test("a stdin EPIPE (ffmpeg dying) stops feeding frames and fails with ffmpeg's exit — no hang, no crash", async () => {
    const s = setup({ render: readyRender(1) });
    const write = s.ff.stdin.write;
    s.ff.stdin.write = (chunk: Buffer) => {
      const r = write(chunk);
      if (s.ff.writes.length === 1) s.ff.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      return r;
    };
    const done = runRender(OPTS, s.deps).catch((e: Error) => e);
    await vi.waitFor(() => expect(s.ff.writes).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(s.ff.writes).toHaveLength(1); // nothing more pushed into the broken pipe
    s.ff.stderr.emit("data", Buffer.from("av_interleaved_write_frame(): Broken pipe\n"));
    s.ff.emit("close", 1, null);
    const err = await done;
    expect((err as Error).message).toMatch(/ffmpeg exited with code 1[\s\S]*Broken pipe/);
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
  });

  test("if the SIGKILLed ffmpeg never reports close, cleanup still deletes the output after KILL_WAIT_MS", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s = setup({ render: readyRender(0.3, (T) => { if (T > 0.15) throw new Error("boom"); }) });
      s.ff.kill.mockImplementation(() => true); // never emits close
      const done = runRender(OPTS, s.deps).catch((e: Error) => e);
      for (let i = 0; i < 100 && s.ff.kill.mock.calls.length === 0; i++) await new Promise((r) => setImmediate(r));
      expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
      await vi.advanceTimersByTimeAsync(KILL_WAIT_MS - 1);
      expect(s.deps.unlink).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(((await done) as Error).message).toMatch(/frame 2.*boom/);
      expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  test("the bounded kill wait clears its timer as soon as ffmpeg exits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s = setup({ render: readyRender(0.3, (T) => { if (T > 0.15) throw new Error("boom"); }) });
      await expect(runRender(OPTS, s.deps)).rejects.toThrow(/boom/);
      expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
      expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  test("ffmpeg is killed before a hung browser.close() resolves", async () => {
    const s = setup({ render: readyRender(0.3, (T) => { if (T > 0.15) throw new Error("boom"); }) });
    let releaseClose!: () => void;
    s.browser.close.mockImplementation(() => new Promise<void>((r) => { releaseClose = r; }));
    const done = runRender(OPTS, s.deps).catch((e: Error) => e);
    await vi.waitFor(() => expect(s.browser.close).toHaveBeenCalled());
    expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
    releaseClose();
    expect(((await done) as Error).message).toMatch(/frame 2.*boom/);
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
  });

  test("a failing browser.close() never masks the original error", async () => {
    const s = setup({ render: readyRender(0.3, (T) => { if (T > 0.15) throw new Error("boom"); }) });
    s.browser.close.mockRejectedValue(new Error("close failed"));
    await expect(runRender(OPTS, s.deps)).rejects.toThrow(/frame 2.*boom/);
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
  });

  test("the synchronous emergency cleanup (forced second signal) SIGKILLs ffmpeg and deletes the output and temp audio", async () => {
    let emergency: (() => void) | undefined;
    const seen = { killed: false, unlinked: false, audioLeft: true };
    const s = setup({ meta: { soundtrack: { media: "0123456789abcdef.wav" } }, render: readyRender(1, (T) => {
      if (T < 0.05) return;
      const audio = audioArg(s.spawnArgs[0]);
      emergency!();
      // Everything happened synchronously — nothing was awaited since emergency() was called.
      seen.killed = s.ff.kill.mock.calls.some(([sig]) => sig === "SIGKILL");
      seen.unlinked = (s.deps.unlinkSync as ReturnType<typeof vi.fn>).mock.calls.some(([p]) => p === OPTS.out);
      seen.audioLeft = existsSync(audio);
      throw new Error("stop");
    }) });
    await runRender(OPTS, { ...s.deps, onEmergencyCleanup: (fn) => { emergency = fn; } }).catch(() => {});
    expect(seen).toEqual({ killed: true, unlinked: true, audioLeft: false });
  });

  test("the emergency cleanup before ffmpeg starts deletes nothing (the user's existing file is safe)", async () => {
    let emergency: (() => void) | undefined;
    const s = setup({ deckStatus: 404 });
    await runRender(OPTS, { ...s.deps, onEmergencyCleanup: (fn) => { emergency = fn; } }).catch(() => {});
    emergency!();
    expect(s.deps.unlinkSync).not.toHaveBeenCalled();
  });
});

describe("runRender — final-review hardening", () => {
  test("image decode failures reported by the page are warned once each, with the frame and T; the render continues", async () => {
    const s = setup({ render: readyRender(0.3, (T) => (T === 0 ? ["/a.png"] : T === 0.1 ? ["/b.jpg", "/c.png"] : [])) });
    const res = await runRender(OPTS, s.deps);
    expect(res.frames).toBe(3);
    expect(s.logs.filter((l) => l.startsWith("warning"))).toEqual([
      "warning: frame 0 (T=0s): image failed to decode: /a.png",
      "warning: frame 1 (T=0.1s): image failed to decode: /b.jpg",
      "warning: frame 1 (T=0.1s): image failed to decode: /c.png",
    ]);
    expect(s.ff.writes).toHaveLength(3);
  });

  test("an existing --out survives a failure before any frame reached ffmpeg (frame 0)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "morgana-run-test-"));
    try {
      const out = join(dir, "existing.mp4");
      writeFileSync(out, "the user's previous render");
      const s = setup({ render: readyRender(0.3, () => { throw new Error("boom"); }) });
      const err = await runRender({ ...OPTS, out }, { ...s.deps, unlink: (p) => unlink(p) }).catch((e: Error) => e);
      expect((err as Error).message).toMatch(/frame 0.*boom/);
      expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
      expect(existsSync(out)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("the emergency cleanup before any frame reached ffmpeg leaves an existing --out alone", async () => {
    let emergency: (() => void) | undefined;
    const s = setup({ render: readyRender(0.3, () => { emergency!(); throw new Error("stop"); }) });
    await runRender(OPTS, { ...s.deps, onEmergencyCleanup: (fn) => { emergency = fn; } }).catch(() => {});
    expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
    expect(s.deps.unlinkSync).not.toHaveBeenCalled();
  });

  test("a deck response that is not JSON (wrong --base-url) is a RenderSetupError naming the base URL (exit 2)", async () => {
    for (const body of ["<!doctype html><title>Some other app</title>", JSON.stringify({ hello: "world" })]) {
      const s = setup();
      s.deps.fetch = (async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
      const err = await runRender(OPTS, s.deps).catch((e: Error) => e);
      expect(err).toBeInstanceOf(RenderSetupError);
      expect(exitCodeFor(err)).toBe(2);
      expect((err as Error).message).toBe(`${BASE} does not look like a Morgana server`);
      expect(s.deps.launchBrowser).not.toHaveBeenCalled();
    }
  });

  test("FRAME_TIMEOUT_MS is 60 s", () => { expect(FRAME_TIMEOUT_MS).toBe(60_000); });

  test("a frame that never resolves times out with the frame and T (exit 1) and cleans up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s = setup({ render: readyRender(0.3, (T) => (T > 0.15 ? new Promise<never>(() => {}) : undefined)) });
      const done = runRender(OPTS, s.deps).catch((e: Error) => e);
      // (not vi.waitFor: under fake timers it advances the clock itself)
      for (let i = 0; i < 100 && s.ff.writes.length < 2; i++) await new Promise((r) => setImmediate(r));
      expect(s.ff.writes).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS - 1);
      expect(s.ff.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const err = await done;
      expect((err as Error).message).toBe("render failed at frame 2 (T=0.2s): frame timed out after 60s");
      expect(exitCodeFor(err)).toBe(1);
      expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
      expect(s.browser.close).toHaveBeenCalledTimes(1);
      expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  test("successful frames leave no frame-timeout timers behind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s = setup();
      await runRender(OPTS, s.deps);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  test("a page error before ready fails fast with its message (exit 1), not after the ready timeout", async () => {
    const s = setup();
    const fb = fakeBrowser(undefined, { hangReady: true });
    s.deps.launchBrowser = async () => fb.browser;
    const done = runRender(OPTS, s.deps).catch((e: Error) => e);
    await vi.waitFor(() => expect(fb.calls.waitTimeout).toBe(30_000));
    fb.pageError("TypeError: x is undefined");
    const err = await done;
    expect(err).toBeInstanceOf(RenderPageError);
    expect(exitCodeFor(err)).toBe(1);
    expect((err as Error).message).toBe("render page error: TypeError: x is undefined");
    expect(fb.browser.close).toHaveBeenCalledTimes(1);
  });

  test("a page error mid-render fails the pending frame fast with its message, frame and T (exit 1)", async () => {
    let s!: ReturnType<typeof setup>;
    s = setup({ render: readyRender(0.3, (T) => {
      if (T < 0.05) return;
      setImmediate(() => s.pageError("RangeError: boom"));
      return new Promise<never>(() => {}); // the page died mid-frame: renderFrame never settles
    }) });
    const err = await runRender(OPTS, s.deps).catch((e: Error) => e);
    expect((err as Error).message).toBe("render failed at frame 1 (T=0.1s): render page error: RangeError: boom");
    expect(exitCodeFor(err)).toBe(1);
    expect(s.ff.kill).toHaveBeenCalledWith("SIGKILL");
    expect(s.deps.unlink).toHaveBeenCalledWith(OPTS.out);
  });
});

describe("exitCodeFor", () => {
  test("usage/setup errors exit 2, aborts 130, everything else (incl. a page error) exits 1", () => {
    expect(exitCodeFor(new RenderArgError("x"))).toBe(2);
    expect(exitCodeFor(new RenderSetupError("x"))).toBe(2);
    expect(exitCodeFor(new RenderPageError("x"))).toBe(1);
    expect(exitCodeFor(new RenderAbortedError())).toBe(130);
    expect(exitCodeFor(new Error("x"))).toBe(1);
  });
});

describe("soundtrack id validation", () => {
  test.each(["../../etc/passwd", "x.m3u8", "0123456789abcdef.m3u8", "evil.wav"])(
    "a soundtrack id %s that is not a media-store id is a RenderSetupError before any download",
    async (media) => {
      const s = setup({ meta: { soundtrack: { media } } });
      const err = await runRender(OPTS, s.deps).catch((e) => e);
      expect(err).toBeInstanceOf(RenderSetupError);
      expect(err.message).toMatch(/not a valid soundtrack/);
      expect(s.fetched).toEqual([`${BASE}/api/decks/d1`]);
    },
  );
});
