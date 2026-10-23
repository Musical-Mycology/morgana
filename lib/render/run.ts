/** Orchestration for `npm run render` (spec §4): fetch the deck, drive the /render page frame by
 *  frame in headless Chromium, pipe PNGs into ffmpeg, mux the soundtrack. Node-only. Every side
 *  effect is an injectable dep so the cleanup paths (Review Focus #4) are unit-testable. */
import { spawn } from "node:child_process";
import { rmSync, unlinkSync } from "node:fs";
import { mkdtemp, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DeckDoc } from "@/engine/deck-doc";
import { frameTimes, RenderArgError, type RenderOptions } from "./args";
import { MEDIA_ID_RE } from "@/lib/store/media-store";
import { audioDemuxer, ffmpegArgs, resolveBinary } from "./ffmpeg";

/** Setup/usage failures (deck missing, soundtrack missing, nothing to render, …): the CLI exits 2. */
export class RenderSetupError extends Error {
  constructor(message: string) { super(message); this.name = "RenderSetupError"; }
}

/** The /render page reported `ready: false` (spec §4 step 3): a render failure, the CLI exits 1. */
export class RenderPageError extends Error {
  constructor(message: string) { super(message); this.name = "RenderPageError"; }
}

export class RenderAbortedError extends Error {
  constructor() { super("render aborted"); this.name = "RenderAbortedError"; }
}

/** CLI exit code: 2 usage/setup, 130 aborted (Ctrl-C), 1 anything else (render failure). */
export function exitCodeFor(err: unknown): 1 | 2 | 130 {
  if (err instanceof RenderAbortedError) return 130;
  return err instanceof RenderArgError || err instanceof RenderSetupError ? 2 : 1;
}

export interface RenderPage {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => unknown, options: { timeout: number }): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  screenshot(): Promise<Buffer>;
  /** An uncaught page exception (Playwright `pageerror`) or a renderer crash (`crash`). */
  onError(cb: (message: string) => void): void;
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
  unlinkSync(path: string): void;
  stat(path: string): Promise<{ size: number }>;
  now(): number;
  /** Ctrl-C: checked between frames; an abort runs the same cleanup as a failure and always
   *  surfaces as RenderAbortedError (whatever the dying Chromium/ffmpeg reported). */
  signal?: AbortSignal;
  /** Receives a SYNCHRONOUS emergency cleanup (SIGKILL ffmpeg, delete the partial output and temp
   *  audio) for a forced exit — the CLI calls it on a second Ctrl-C right before process.exit. */
  onEmergencyCleanup?(cleanup: () => void): void;
}

/** Playwright's own SIGINT/SIGTERM/SIGHUP handlers close the browser and then process.exit(),
 *  which would skip our cleanup (orphan ffmpeg, half-written MP4). The CLI handles signals itself. */
export const CHROMIUM_LAUNCH_OPTIONS = { headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false } as const;

const READY_TIMEOUT_MS = 30_000;
/** Per-frame budget for renderFrame + screenshot; a hung frame fails with its frame number and T. */
export const FRAME_TIMEOUT_MS = 60_000;
/** How long cleanup waits for a SIGKILLed ffmpeg to exit before deleting its output anyway. */
export const KILL_WAIT_MS = 5_000;
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
        onError: (cb) => {
          p.on("pageerror", (e) => cb(e.message));
          p.on("crash", () => cb("the page crashed"));
        },
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
  unlinkSync: (p) => unlinkSync(p),
  stat: (p) => stat(p),
  now: () => Date.now(),
};

const fmtT = (T: number) => `${Number(T.toFixed(3))}s`;
const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** What a run has acquired so far — everything cleanup must release. */
interface Session {
  browser?: RenderBrowser;
  ff?: FfmpegProcess;
  ffClosed: boolean;
  ffExited?: Promise<void>;
  tmpDir?: string;
  /** A frame reached ffmpeg's stdin. Until then ffmpeg has not opened `out` (image2pipe probes its
   *  input first), so a failure must not delete what may be the user's previous render. */
  wroteFrame: boolean;
  ok: boolean;
}

type RenderResult = { out: string; frames: number; seconds: number; bytes: number };

export async function runRender(opts: RenderOptions, depsIn: Partial<RenderDeps> = {}): Promise<RenderResult> {
  const deps: RenderDeps = { ...defaultDeps, ...depsIn };
  const s: Session = { ffClosed: false, wroteFrame: false, ok: false };
  deps.onEmergencyCleanup?.(() => emergencyCleanup(s, opts.out, deps));
  try {
    try {
      const r = await renderSteps(opts, deps, s);
      s.ok = true;
      return r;
    } finally {
      await cleanup(s, opts.out, deps);
    }
  } catch (e) {
    // A terminal Ctrl-C also SIGINTs Chromium and ffmpeg, so the failure usually arrives as
    // "Target closed" or "ffmpeg exited with code 255": the signal, not the error, decides.
    if (deps.signal?.aborted && !(e instanceof RenderAbortedError)) throw new RenderAbortedError();
    throw e;
  }
}

/** Release everything; never throws, so the original error is never masked. ffmpeg is killed
 *  FIRST so a hung browser.close() cannot delay it. */
async function cleanup(s: Session, out: string, deps: RenderDeps): Promise<void> {
  const failed = !s.ok && s.ff !== undefined;
  let killWait: Promise<void> = Promise.resolve();
  if (failed && !s.ffClosed) {
    try { s.ff!.kill("SIGKILL"); } catch { /* already gone */ }
    // Wait (bounded) so a dying ffmpeg can't recreate the file after we delete it.
    killWait = boundedWait(s.ffExited!, KILL_WAIT_MS);
  }
  await Promise.all([s.browser?.close().catch(() => {}), killWait]);
  if (failed && s.wroteFrame) await deps.unlink(out).catch(() => {});
  if (s.tmpDir) await rm(s.tmpDir, { recursive: true, force: true }).catch(() => {});
}

function emergencyCleanup(s: Session, out: string, deps: RenderDeps): void {
  if (s.ff && !s.ffClosed) { try { s.ff.kill("SIGKILL"); } catch { /* already gone */ } }
  if (s.ff && !s.ok && s.wroteFrame) { try { deps.unlinkSync(out); } catch { /* never written */ } }
  if (s.tmpDir) { try { rmSync(s.tmpDir, { recursive: true, force: true }); } catch { /* best effort */ } }
}

/** `p`, or a rejection with `message` after `ms`. The timer is always cleared. */
async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expire = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  try { return await Promise.race([p, expire]); } finally { clearTimeout(timer); }
}

async function boundedWait(p: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((r) => {
    timer = setTimeout(r, ms);
    (timer as { unref?: () => void }).unref?.();
  });
  try { await Promise.race([p, bound]); } finally { clearTimeout(timer); }
}

async function renderSteps(opts: RenderOptions, deps: RenderDeps, s: Session): Promise<RenderResult> {
  const { baseUrl, deck, fps, out } = opts;
  const checkAbort = () => { if (deps.signal?.aborted) throw new RenderAbortedError(); };
  let stderr = "";
  const stderrTail = () => stderr.trimEnd().split("\n").slice(-STDERR_TAIL_LINES).join("\n");

  checkAbort();
  const deckUrl = `${baseUrl}/api/decks/${encodeURIComponent(deck)}`;
  let res: Response;
  try { res = await deps.fetch(deckUrl); }
  catch (e) { throw new RenderSetupError(`could not reach ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`); }
  if (res.status === 404) throw new RenderSetupError(`deck ${deck} not found at ${baseUrl}`);
  if (!res.ok) throw new RenderSetupError(`deck ${deck}: GET ${deckUrl} returned ${res.status}`);
  const notMorgana = () => new RenderSetupError(`${baseUrl} does not look like a Morgana server`);
  let doc: DeckDoc;
  try { doc = (await res.json()) as DeckDoc; } catch { throw notMorgana(); }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.scenes)) throw notMorgana();

  let audioPath: string | undefined;
  const media = doc.meta?.soundtrack?.media;
  if (media) {
    // The id comes from the server's deck JSON: only a media-store id with a pinned demuxer may
    // reach the filesystem or ffmpeg (see AUDIO_DEMUXERS).
    if (typeof media !== "string" || !MEDIA_ID_RE.test(media) || !audioDemuxer(media)) {
      throw new RenderSetupError(`${JSON.stringify(media)} is not a valid soundtrack media id`);
    }
    const mediaUrl = `${baseUrl}/api/decks/${encodeURIComponent(deck)}/media/${encodeURIComponent(media)}`;
    const mres = await deps.fetch(mediaUrl).catch(() => undefined);
    if (!mres?.ok) {
      throw new RenderSetupError(`soundtrack ${media} could not be downloaded from ${mediaUrl} (${mres ? mres.status : "unreachable"})`);
    }
    s.tmpDir = await mkdtemp(join(tmpdir(), "morgana-render-"));
    audioPath = join(s.tmpDir, basename(media));
    await writeFile(audioPath, Buffer.from(await mres.arrayBuffer()));
  }

  checkAbort();
  s.browser = await deps.launchBrowser();
  const page = await s.browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
  // A page crash / uncaught exception fails fast, instead of waiting out the ready or frame timeout.
  let pageFailed!: (e: Error) => void;
  const pageError = new Promise<never>((_, reject) => { pageFailed = reject; });
  pageError.catch(() => {}); // observed via the races below
  page.onError((message) => pageFailed(new RenderPageError(`render page error: ${message}`)));
  const renderUrl = `${baseUrl}/render?deck=${encodeURIComponent(deck)}`;
  await page.goto(renderUrl);
  try {
    // Wait for a DECIDED state (ready true or false), not just ready, so a page error surfaces fast.
    await Promise.race([page.waitForFunction(() => window.__morganaRender, { timeout: READY_TIMEOUT_MS }), pageError]);
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
  if (!state.ready) throw new RenderPageError(`render page for deck ${deck}: ${state.error}`);

  const total = state.total;
  if (opts.from >= total) {
    throw new RenderSetupError(`--from ${opts.from}s is at or past the deck's end (${total}s) — nothing to render`);
  }
  let to = opts.to ?? total;
  if (to > total) {
    deps.log(`warning: --to ${to}s is past the deck's end (${total}s); rendering to ${total}s`);
    to = total;
  }
  const times = frameTimes(opts.from, to, fps);
  if (times.length === 0) throw new RenderSetupError(`--from ${opts.from}s to ${to}s spans no frames at ${fps} fps`);
  const N = times.length;
  checkAbort();

  const proc = deps.spawnFfmpeg(ffmpegArgs({ fps, out, duration: to - opts.from, audioPath, audioOffset: opts.from }));
  s.ff = proc;
  proc.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-16_384); });
  let stdinError: Error | undefined;
  proc.stdin.on("error", (e) => { stdinError = e; }); // EPIPE when ffmpeg dies: surfaced via `closed`
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; err?: Error }>((resolve) => {
    proc.on("close", (code, signal) => { s.ffClosed = true; resolve({ code, signal }); });
    proc.on("error", (err) => { s.ffClosed = true; resolve({ code: null, signal: null, err }); });
  });
  s.ffExited = closed.then(() => {});
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
    if (s.ffClosed || stdinError) await ffmpegDied;
    const T = times[i];
    let png: Buffer;
    let failed: string[];
    try {
      const frame = (async () => {
        const r = await page.evaluate((t) => {
          const r = window.__morganaRender;
          if (!r?.ready) throw new Error("render page is not ready");
          return r.renderFrame(t);
        }, T);
        return { failed: r?.failed ?? [], png: await page.screenshot() };
      })();
      ({ png, failed } = await withTimeout(Promise.race([frame, pageError]), FRAME_TIMEOUT_MS, `frame timed out after ${FRAME_TIMEOUT_MS / 1000}s`));
    } catch (e) {
      throw new Error(`render failed at frame ${i} (T=${fmtT(T)}): ${e instanceof Error ? e.message : String(e)}`);
    }
    // Spec §3/§5: a broken image is tolerated (the frame shows what the browser shows), warned once.
    for (const src of failed) deps.log(`warning: frame ${i} (T=${fmtT(T)}): image failed to decode: ${src}`);
    s.wroteFrame = true;
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
  return { out, frames: N, seconds: to - opts.from, bytes: size };
}
