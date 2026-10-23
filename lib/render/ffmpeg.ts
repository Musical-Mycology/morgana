/** ffmpeg binary resolution and argument building for `npm run render`. Pure: reads only the env it is given. */

export const FFMPEG_MISSING =
  "ffmpeg not found — install it (macOS: brew install ffmpeg, Debian/Ubuntu/WSL: sudo apt install ffmpeg) or set FFMPEG_PATH.";

export function resolveBinary(name: "ffmpeg" | "ffprobe", env: Record<string, string | undefined>): string {
  const override = name === "ffmpeg" ? env.FFMPEG_PATH : env.FFPROBE_PATH;
  return override || name;
}

/** The demuxer ffmpeg must use for each soundtrack extension the media store accepts (keys mirror
 *  `AUDIO_TYPES`). Pinned with `-f` because ffmpeg otherwise picks a demuxer by sniffing content:
 *  an uploaded "soundtrack" whose bytes are an HLS or concat playlist would make ffmpeg read
 *  local files or fetch URLs and bake them into the rendered video. */
export const AUDIO_DEMUXERS: Record<string, string> = {
  mp3: "mp3", m4a: "mov", aac: "aac", wav: "wav", ogg: "ogg", flac: "flac",
};

export function audioDemuxer(path: string): string | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(path);
  return (m && AUDIO_DEMUXERS[m[1].toLowerCase()]) ?? null;
}

export function ffmpegArgs(o: {
  fps: number;
  out: string;
  duration: number;
  audioPath?: string;
  audioOffset: number;
}): string[] {
  const args = ["-y", "-f", "image2pipe", "-framerate", String(o.fps), "-i", "-"];
  if (o.audioPath) {
    const demuxer = audioDemuxer(o.audioPath);
    if (!demuxer) throw new Error(`no pinned demuxer for soundtrack ${o.audioPath}`);
    // -protocol_whitelist file: the soundtrack may only ever open itself, never a nested URL.
    args.push("-ss", String(o.audioOffset), "-protocol_whitelist", "file", "-f", demuxer, "-i", o.audioPath);
  }
  args.push("-map", "0:v");
  if (o.audioPath) args.push("-map", "1:a");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium");
  if (o.audioPath) args.push("-c:a", "aac", "-b:a", "192k", "-af", "apad");
  args.push("-t", String(o.duration), "-movflags", "+faststart", o.out);
  return args;
}
