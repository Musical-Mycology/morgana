import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
