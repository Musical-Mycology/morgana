/** `npm run render -- --deck <id> --out <file.mp4> [...]` — frame-stepped MP4 export (spec §4).
 *  Exit codes: 0 ok, 1 render failure (incl. Ctrl-C), 2 usage/setup (bad args, ffmpeg missing, deck not found). */
import { spawnSync } from "node:child_process";
import { parseRenderArgs, RenderArgError } from "@/lib/render/args";
import { FFMPEG_MISSING, resolveBinary } from "@/lib/render/ffmpeg";
import { exitCodeFor, runRender } from "@/lib/render/run";

async function main(argv: string[]): Promise<number> {
  let opts;
  try {
    opts = parseRenderArgs(argv);
  } catch (e) {
    if (e instanceof RenderArgError) { console.error(e.message); return 2; }
    throw e;
  }

  const ffmpeg = resolveBinary("ffmpeg", process.env);
  const probe = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    console.error(FFMPEG_MISSING);
    return 2;
  }

  // First Ctrl-C aborts cleanly (between frames; Chromium + ffmpeg closed, partial MP4 removed).
  // A second one exits immediately.
  const ac = new AbortController();
  const onSignal = () => {
    if (ac.signal.aborted) process.exit(1);
    console.error("\naborting — cleaning up (Ctrl-C again to force)…");
    ac.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const r = await runRender(opts, { signal: ac.signal });
    console.log(`wrote ${r.out} — ${Number(r.seconds.toFixed(3))}s, ${r.frames} frames, ${(r.bytes / 1e6).toFixed(1)} MB`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return exitCodeFor(e);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => { console.error(e); process.exit(1); },
);
