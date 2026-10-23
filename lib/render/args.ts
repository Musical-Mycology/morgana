/** Pure argument parsing and frame math for `npm run render` (no Node-only imports). */

export interface RenderOptions {
  deck: string;
  out: string;
  baseUrl: string;
  fps: number;
  width: number;
  height: number;
  from: number;
  to?: number;
}

const USAGE = [
  "Usage: npm run render -- --deck <id> --out <file.mp4>",
  "                        [--base-url http://localhost:3000] [--fps 30]",
  "                        [--width 1920 --height 1080] [--from 0] [--to <seconds>]",
].join("\n");

export class RenderArgError extends Error {
  constructor(message: string) {
    super(`${message}\n${USAGE}`);
    this.name = "RenderArgError";
  }
}

const FLAGS = new Set([
  "--deck", "--out", "--base-url", "--fps", "--width", "--height", "--from", "--to",
]);

function num(flag: string, raw: string): number {
  const n = raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) throw new RenderArgError(`${flag} must be a finite number (got "${raw}").`);
  return n;
}

function posInt(flag: string, raw: string): number {
  const n = num(flag, raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new RenderArgError(`${flag} must be a positive integer (got "${raw}").`);
  }
  return n;
}

export function parseRenderArgs(argv: string[]): RenderOptions {
  const raw = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!FLAGS.has(flag)) throw new RenderArgError(`Unknown argument: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined) throw new RenderArgError(`${flag} requires a value.`);
    raw.set(flag, value);
    i++;
  }

  const deck = raw.get("--deck");
  if (!deck) throw new RenderArgError("Missing required --deck.");
  const out = raw.get("--out");
  if (!out) throw new RenderArgError("Missing required --out.");

  const baseUrl = (raw.get("--base-url") ?? "http://localhost:3000").replace(/\/+$/, "");

  const fpsRaw = raw.get("--fps");
  const fps = fpsRaw === undefined ? 30 : num("--fps", fpsRaw);
  if (fps <= 0) throw new RenderArgError(`--fps must be greater than 0 (got "${fpsRaw}").`);

  const widthRaw = raw.get("--width");
  const width = widthRaw === undefined ? 1920 : posInt("--width", widthRaw);
  const heightRaw = raw.get("--height");
  const height = heightRaw === undefined ? 1080 : posInt("--height", heightRaw);

  const fromRaw = raw.get("--from");
  const from = fromRaw === undefined ? 0 : num("--from", fromRaw);
  if (from < 0) throw new RenderArgError(`--from must be >= 0 (got "${fromRaw}").`);

  const toRaw = raw.get("--to");
  const to = toRaw === undefined ? undefined : num("--to", toRaw);
  if (to !== undefined && to <= from) {
    throw new RenderArgError(`--to (${to}) must be greater than --from (${from}).`);
  }

  return { deck, out, baseUrl, fps, width, height, from, to };
}

/** Deck times to render: T = from + i/fps for i < ceil((to - from) * fps). The 1e-9 guards float
 *  drift (e.g. (0.3 - 0.1) * 10 = 2.0000000000000004) from adding a phantom frame. */
export function frameTimes(from: number, to: number, fps: number): number[] {
  const n = Math.max(0, Math.ceil((to - from) * fps - 1e-9));
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = from + i / fps;
  return out;
}
