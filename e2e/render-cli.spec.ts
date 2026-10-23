import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinary } from "../lib/render/ffmpeg";
import { runRender } from "../lib/render/run";
import { sineWav } from "./helpers/wav";

const id = "e2e-render-cli";
const ffmpeg = resolveBinary("ffmpeg", process.env);
const ffprobe = resolveBinary("ffprobe", process.env);
const works = (bin: string) => { const r = spawnSync(bin, ["-version"], { stdio: "ignore" }); return !r.error && r.status === 0; };
const hasFfmpeg = works(ffmpeg) && works(ffprobe);

let dir: string | undefined;

test.afterEach(async ({ request }) => {
  await request.delete(`/api/decks/${id}`);
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

test("runRender writes an H.264 + AAC MP4 of the deck's length", async ({ request, baseURL }) => {
  // CI installs ffmpeg, so a missing binary there is a broken job, not a reason to skip silently.
  if (process.env.CI) expect(hasFfmpeg, `ffmpeg/ffprobe not found (${ffmpeg}, ${ffprobe}) — the CI e2e job must install them`).toBe(true);
  test.skip(!hasFfmpeg, "ffmpeg not installed — the CI job installs it");
  test.setTimeout(120_000);

  await request.delete(`/api/decks/${id}`);
  await request.post("/api/decks", { data: { id, title: "Render CLI" } });
  const up = await request.post(`/api/decks/${id}/media`, { multipart: { file: { name: "tone.wav", mimeType: "audio/wav", buffer: sineWav(2) } } });
  expect(up.status()).toBe(201);
  const media = await up.json();
  const doc = { version: 1, meta: { id, title: "Render CLI", timing: { targetSec: 2 }, soundtrack: { media: media.id } }, scenes: [
    { id: "s", durationSec: 2, beats: [{ id: "b", timeline: [{ kind: "text", value: "Hello", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  ] };
  expect((await request.put(`/api/decks/${id}`, { data: doc })).status()).toBe(200);

  dir = mkdtempSync(join(tmpdir(), "morgana-render-e2e-"));
  const out = join(dir, "out.mp4");
  const res = await runRender({ deck: id, out, baseUrl: baseURL!, fps: 10, width: 320, height: 180, from: 0 }, { log: () => {} });
  expect(res.frames).toBe(20);
  expect(res.bytes).toBeGreaterThan(0);

  const probe = spawnSync(ffprobe, [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name,r_frame_rate",
    "-show_entries", "format=duration", "-of", "json", out,
  ], { encoding: "utf8" });
  expect(probe.status, probe.stderr).toBe(0);
  const info = JSON.parse(probe.stdout) as {
    streams: { codec_type: string; codec_name: string; r_frame_rate: string }[];
    format: { duration: string };
  };
  const video = info.streams.filter((s) => s.codec_type === "video");
  const audio = info.streams.filter((s) => s.codec_type === "audio");
  expect(video).toHaveLength(1);
  expect(video[0].codec_name).toBe("h264");
  expect(video[0].r_frame_rate).toBe("10/1");
  expect(audio).toHaveLength(1);
  expect(audio[0].codec_name).toBe("aac");
  expect(Math.abs(Number(info.format.duration) - 2.0)).toBeLessThanOrEqual(0.15);
});

test("renders a clip: the clip advances between sampled frames", async ({ request, baseURL }, info) => {
  if (process.env.CI) expect(hasFfmpeg, `ffmpeg/ffprobe not found (${ffmpeg}, ${ffprobe}) — the CI e2e job must install them`).toBe(true);
  test.skip(!hasFfmpeg, "ffmpeg not installed — the CI job installs it");
  test.setTimeout(120_000);

  // Per-worker deck id: parallel workers (--repeat-each) must not share a deck.
  const clipId = `e2e-render-cli-clip-${info.parallelIndex}`;
  try {
    await request.delete(`/api/decks/${clipId}`);
    await request.post("/api/decks", { data: { id: clipId, title: "Render CLI clip" } });
    const buffer = readFileSync(fileURLToPath(new URL("./fixtures/media/clip-h264.mp4", import.meta.url)));
    const up = await request.post(`/api/decks/${clipId}/media`, { multipart: { file: { name: "clip-h264.mp4", mimeType: "video/mp4", buffer } } });
    expect(up.status()).toBe(201);
    const clip = `media:${(await up.json()).id}`;
    // `cut`: the clip is fully opaque from T=0, so sampled frames can differ only by the clip's own content.
    const doc = { version: 1, meta: { id: clipId, title: "Render CLI clip", timing: { targetSec: 2 } }, scenes: [
      { id: "s", durationSec: 2, beats: [{ id: "b", art: { to: clip, mode: "cut" }, timeline: [{ kind: "wait", ms: 2000 }] }] },
    ] };
    expect((await request.put(`/api/decks/${clipId}`, { data: doc })).status()).toBe(200);

    dir = mkdtempSync(join(tmpdir(), "morgana-render-e2e-"));
    const out = join(dir, "clip.mp4");
    const warnings: string[] = [];
    const res = await runRender({ deck: clipId, out, baseUrl: baseURL!, fps: 10, width: 320, height: 180, from: 0 }, { log: (m) => { if (m.startsWith("warning") && m.includes("/media/")) warnings.push(m); } });
    expect(res.frames).toBe(20);
    expect(warnings).toEqual([]); // the clip itself never failed (storyboard glyphs may be absent from a dev checkout)

    const probe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", out], { encoding: "utf8" });
    expect(probe.status, probe.stderr).toBe(0);
    const video = (JSON.parse(probe.stdout) as { streams: { codec_type: string; codec_name: string }[] }).streams.filter((s) => s.codec_type === "video");
    expect(video).toHaveLength(1);
    expect(video[0].codec_name).toBe("h264");

    // Frames 5 and 15 (T = 0.5 s and 1.5 s at 10 fps) are one clip-second apart. Decode the fixture's
    // burned-in frame counter (top-left 100x40 px of the 320x180 frame) as 8-bit gray and compare.
    const counter = (t: number) => {
      const r = spawnSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", "crop=100:40:0:0,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 16 * 1024 * 1024 });
      expect(r.status, r.stderr?.toString()).toBe(0);
      expect(r.stdout.length).toBe(100 * 40);
      return r.stdout;
    };
    const a = counter(0.5);
    const b = counter(1.5);
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    const mad = sum / a.length;
    // Measured here: a moving clip ("15" -> "45" on the counter) gives a mean absolute difference of
    // ~22 gray levels per pixel; the same render with the clip frozen (in-point past its end, so it
    // holds) gives exactly 0. 5 sits well clear of both: encoder noise on a static region stays near
    // 0, while a changed counter flips a large share of the crop by ~200 levels.
    expect(mad, `counter region mean abs diff ${mad}`).toBeGreaterThan(5);
  } finally {
    await request.delete(`/api/decks/${clipId}`);
  }
});
