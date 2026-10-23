import { describe, expect, test } from "vitest";
import { ffmpegArgs, FFMPEG_MISSING, resolveBinary } from "@/lib/render/ffmpeg";

describe("ffmpegArgs", () => {
  test("video only", () => {
    expect(ffmpegArgs({ fps: 30, out: "o.mp4", duration: 120, audioOffset: 0 })).toEqual([
      "-y", "-f", "image2pipe", "-framerate", "30", "-i", "-",
      "-map", "0:v",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
      "-t", "120", "-movflags", "+faststart", "o.mp4",
    ]);
  });

  test("with audio", () => {
    expect(
      ffmpegArgs({ fps: 30, out: "o.mp4", duration: 120, audioPath: "a.wav", audioOffset: 10 }),
    ).toEqual([
      "-y", "-f", "image2pipe", "-framerate", "30", "-i", "-",
      "-ss", "10", "-i", "a.wav",
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
      "-c:a", "aac", "-b:a", "192k", "-af", "apad",
      "-t", "120", "-movflags", "+faststart", "o.mp4",
    ]);
  });
});

describe("resolveBinary", () => {
  test("uses env override or bare name", () => {
    expect(resolveBinary("ffmpeg", { FFMPEG_PATH: "/opt/ff" })).toBe("/opt/ff");
    expect(resolveBinary("ffmpeg", {})).toBe("ffmpeg");
    expect(resolveBinary("ffprobe", { FFPROBE_PATH: "/opt/fp" })).toBe("/opt/fp");
    expect(resolveBinary("ffprobe", {})).toBe("ffprobe");
    expect(resolveBinary("ffmpeg", { FFMPEG_PATH: "" })).toBe("ffmpeg");
  });
});

test("FFMPEG_MISSING message", () => {
  expect(FFMPEG_MISSING).toBe(
    "ffmpeg not found — install it (macOS: brew install ffmpeg, Debian/Ubuntu/WSL: sudo apt install ffmpeg) or set FFMPEG_PATH.",
  );
});
