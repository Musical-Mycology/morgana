import { describe, expect, test } from "vitest";
import { AUDIO_DEMUXERS, audioDemuxer, ffmpegArgs, FFMPEG_MISSING, resolveBinary } from "@/lib/render/ffmpeg";
import { AUDIO_TYPES } from "@/lib/store/media-store";

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
      "-ss", "10", "-protocol_whitelist", "file", "-f", "wav", "-i", "a.wav",
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

describe("audio demuxer pinning (no content-sniffed playlists)", () => {
  test("every soundtrack extension the media store accepts has a pinned demuxer", () => {
    expect(Object.keys(AUDIO_DEMUXERS).sort()).toEqual(Object.keys(AUDIO_TYPES).sort());
  });
  test("m4a uses the mov demuxer; unknown extensions have none", () => {
    expect(audioDemuxer("/t/x.m4a")).toBe("mov");
    expect(audioDemuxer("/t/x.MP3")).toBe("mp3");
    expect(audioDemuxer("/t/x.m3u8")).toBeNull();
    expect(audioDemuxer("/t/noext")).toBeNull();
  });
  test("ffmpegArgs refuses an audio path without a pinned demuxer", () => {
    expect(() => ffmpegArgs({ fps: 30, out: "o.mp4", duration: 1, audioPath: "a.m3u8", audioOffset: 0 })).toThrow(/demuxer/);
  });
});
