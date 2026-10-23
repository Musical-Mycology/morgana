/** ffmpeg binary resolution and argument building for `npm run render`. Pure: reads only the env it is given. */

export const FFMPEG_MISSING =
  "ffmpeg not found — install it (macOS: brew install ffmpeg, Debian/Ubuntu/WSL: sudo apt install ffmpeg) or set FFMPEG_PATH.";

export function resolveBinary(name: "ffmpeg" | "ffprobe", env: Record<string, string | undefined>): string {
  const override = name === "ffmpeg" ? env.FFMPEG_PATH : env.FFPROBE_PATH;
  return override || name;
}

export function ffmpegArgs(o: {
  fps: number;
  out: string;
  duration: number;
  audioPath?: string;
  audioOffset: number;
}): string[] {
  const args = ["-y", "-f", "image2pipe", "-framerate", String(o.fps), "-i", "-"];
  if (o.audioPath) args.push("-ss", String(o.audioOffset), "-i", o.audioPath);
  args.push("-map", "0:v");
  if (o.audioPath) args.push("-map", "1:a");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium");
  if (o.audioPath) args.push("-c:a", "aac", "-b:a", "192k", "-af", "apad");
  args.push("-t", String(o.duration), "-movflags", "+faststart", o.out);
  return args;
}
