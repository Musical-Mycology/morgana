/** Orchestration for `npm run render` (spec §4): fetch the deck, drive the /render page frame by
 *  frame in headless Chromium, pipe PNGs into ffmpeg, mux the soundtrack. Node-only. Every side
 *  effect is an injectable dep so the cleanup paths (Review Focus #4) are unit-testable. */
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DeckDoc } from "@/engine/deck-doc";
import { frameTimes, RenderArgError, type RenderOptions } from "./args";
import { ffmpegArgs, resolveBinary } from "./ffmpeg";

/** Setup/usage failures (deck missing, page not ready, …): the CLI exits 2. */
export class RenderSetupError extends Error {
  constructor(message: string) { super(message); this.name = "RenderSetupError"; }
}

export class RenderAbortedError extends Error {
  constructor() { super("render aborted"); this.name = "RenderAbortedError"; }
}

/** CLI exit code: 2 usage/setup, 1 anything else (render failure, abort). */
export function exitCodeFor(err: unknown): 1 | 2 {
  return err instanceof RenderArgError || err instanceof RenderSetupError ? 2 : 1;
}

export interface RenderPage {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => unknown, options: { timeout: number }): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  screenshot(): Promise<Buffer>;
}

export interface RenderBrowser {
  newPage(o: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<RenderPage>;
  close(): Promise<void>;
}

/** The subset of a spawned ChildProcess (stdio ["pipe","ignore","pipe"]) the renderer uses. */
export interface FfmpegProcess {
  stdin: { write(chunk: Buffer): boolean; end(): void; once(ev: "drain", cb: () => void): unknown; on(ev: "error", cb: (e: Error) => void): unknown };
  stderr: { on(ev: "data", cb: (chunk: Buffer) => void): unknown };
  on(ev: "close", cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(ev: "error", cb: (e: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface RenderDeps {
  launchBrowser(): Promise<RenderBrowser>;
  spawnFfmpeg(args: string[]): FfmpegProcess;
  fetch: typeof fetch;
  log(line: string): void;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
  now(): number;
  /** Ctrl-C: checked between frames; an abort runs the same cleanup as a failure. */
  signal?: AbortSignal;
}

/** Playwright's own SIGINT/SIGTERM/SIGHUP handlers close the browser and then process.exit(),
 *  which would skip our cleanup (orphan ffmpeg, half-written MP4). The CLI handles signals itself. */
export const CHROMIUM_LAUNCH_OPTIONS = { headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false } as const;

const READY_TIMEOUT_MS = 30_000;
const STDERR_TAIL_LINES = 15;

async function launchChromium(): Promise<RenderBrowser> {
  // Lazy: only the real CLI pays for loading Playwright. `@playwright/test` is the declared dependency.
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
  return {
    async newPage(o) {
      const p = await browser.newPage(o);
      return {
        goto: (url) => p.goto(url),
        waitForFunction: (fn, options) => p.waitForFunction(fn, undefined, options),
        evaluate: <R, A>(fn: (arg: A) => R | Promise<R>, arg: A) =>
          p.evaluate(fn as (arg: unknown) => R | Promise<R>, arg as unknown) as Promise<R>,
        screenshot: () => p.screenshot({ type: "png" }),
      };
    },
    close: () => browser.close(),
  };
}

const defaultDeps: RenderDeps = {
  launchBrowser: launchChromium,
  spawnFfmpeg: (args) => spawn(resolveBinary("ffmpeg", process.env), args, { stdio: ["pipe", "ignore", "pipe"] }),
  fetch: (...a) => fetch(...a),
  log: (line) => { process.stderr.write(`${line}\n`); },
  unlink: (p) => unlink(p),
  stat: (p) => stat(p),
  now: () => Date.now(),
};

const fmtT = (T: number) => `${Number(T.toFixed(3))}s`;
const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export async function runRender(
  opts: RenderOptions,
  depsIn: Partial<RenderDeps> = {},
): Promise<{ out: string; frames: number; seconds: number; bytes: number }> {
  const deps: RenderDeps = { ...defaultDeps, ...depsIn };
  const { baseUrl, deck, fps, out } = opts;
  const checkAbort = () => { if (deps.signal?.aborted) throw new RenderAbortedError(); };

  let browser: RenderBrowser | undefined;
  let ff: FfmpegProcess | undefined;
  let ffClosed = false;
  let tmpDir: string | undefined;
  let ok = false;
  let stderr = "";
  const stderrTail = () => stderr.trimEnd().split("\n").slice(-STDERR_TAIL_LINES).join("\n");

  try {
    checkAbort();
    const deckUrl = `${baseUrl}/api/decks/${encodeURIComponent(deck)}`;
    let res: Response;
    try { res = await deps.fetch(deckUrl); }
    catch (e) { throw new RenderSetupError(`could not reach ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`); }
    if (res.status === 404) throw new RenderSetupError(`deck ${deck} not found at ${baseUrl}`);
    if (!res.ok) throw new RenderSetupError(`deck ${deck}: GET ${deckUrl} returned ${res.status}`);
    const doc = (await res.json()) as DeckDoc;

    let audioPath: string | undefined;
    const media = doc.meta?.soundtrack?.media;
    if (media) {
      const mediaUrl = `${baseUrl}/api/decks/${encodeURIComponent(deck)}/media/${encodeURIComponent(media)}`;
      const mres = await deps.fetch(mediaUrl).catch(() => undefined);
      if (!mres?.ok) {
        throw new RenderSetupError(`soundtrack ${media} could not be downloaded from ${mediaUrl} (${mres ? mres.status : "unreachable"})`);
      }
      tmpDir = await mkdtemp(join(tmpdir(), "morgana-render-"));
      audioPath = join(tmpDir, basename(media));
      await writeFile(audioPath, Buffer.from(await mres.arrayBuffer()));
    }

    checkAbort();
    browser = await deps.launchBrowser();
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
    const renderUrl = `${baseUrl}/render?deck=${encodeURIComponent(deck)}`;
    await page.goto(renderUrl);
    try {
      // Wait for a DECIDED state (ready true or false), not just ready, so a page error surfaces fast.
      await page.waitForFunction(() => window.__morganaRender, { timeout: READY_TIMEOUT_MS });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new RenderSetupError(`render page did not become ready within ${READY_TIMEOUT_MS / 1000}s at ${renderUrl}`);
      }
      throw e;
    }
    const state = await page.evaluate(() => {
      const r = window.__morganaRender;
      return r?.ready ? { ready: true as const, total: r.total } : { ready: false as const, error: r?.error ?? "unknown error" };
    }, undefined);
    if (!state.ready) throw new RenderSetupError(`render page for deck ${deck}: ${state.error}`);

    const to = opts.to ?? state.total;
    const times = frameTimes(opts.from, to, fps);
    if (times.length === 0) throw new RenderSetupError(`--from ${opts.from} is at or past the deck's end (${state.total}s)`);
    const N = times.length;
    checkAbort();

    const proc = deps.spawnFfmpeg(ffmpegArgs({ fps, out, duration: to - opts.from, audioPath, audioOffset: opts.from }));
    ff = proc;
    proc.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-16_384); });
    let stdinError: Error | undefined;
    proc.stdin.on("error", (e) => { stdinError = e; }); // EPIPE when ffmpeg dies: surfaced via `closed`
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; err?: Error }>((resolve) => {
      proc.on("close", (code, signal) => { ffClosed = true; resolve({ code, signal }); });
      proc.on("error", (err) => { ffClosed = true; resolve({ code: null, signal: null, err }); });
    });
    const ffmpegFailure = (r: { code: number | null; signal: NodeJS.Signals | null; err?: Error }) => new Error(
      r.err ? `ffmpeg failed: ${r.err.message}`
        : `ffmpeg exited with code ${r.code ?? r.signal}${stderrTail() ? `:\n${stderrTail()}` : ""}`,
    );
    const ffmpegDied = closed.then((r) => { throw ffmpegFailure(r); });
    ffmpegDied.catch(() => {}); // observed via the races below

    const start = deps.now();
    let lastLog = start;
    for (let i = 0; i < N; i++) {
      checkAbort();
      if (ffClosed || stdinError) await ffmpegDied;
      const T = times[i];
      let png: Buffer;
      try {
        await page.evaluate((t) => {
          const r = window.__morganaRender;
          if (!r?.ready) throw new Error("render page is not ready");
          return r.renderFrame(t);
        }, T);
        png = await page.screenshot();
      } catch (e) {
        checkAbort(); // Ctrl-C also SIGINTs Chromium; report the abort, not the dead page
        throw new Error(`render failed at frame ${i} (T=${fmtT(T)}): ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!proc.stdin.write(png)) {
        await Promise.race([new Promise<void>((r) => proc.stdin.once("drain", r)), ffmpegDied]);
      }
      const now = deps.now();
      if (now - lastLog >= 1000 || i === N - 1) {
        lastLog = now;
        const done = i + 1;
        const rate = done / Math.max((now - start) / 1000, 1e-6);
        deps.log(`frame ${done}/${N} · ${rate.toFixed(1)} fps · ETA ${fmtClock((N - done) / rate)}`);
      }
    }

    proc.stdin.end();
    const r = await closed;
    if (r.err || r.code !== 0) throw ffmpegFailure(r);
    const { size } = await deps.stat(out);
    ok = true;
    return { out, frames: N, seconds: to - opts.from, bytes: size };
  } finally {
    await browser?.close().catch(() => {});
    if (!ok && ff) {
      if (!ffClosed) {
        const exited = new Promise<void>((r) => ff!.on("close", () => r()));
        ff.kill("SIGKILL");
        // Wait (bounded) so ffmpeg can't recreate the file after we delete it.
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      }
      await deps.unlink(out).catch(() => {});
    }
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
