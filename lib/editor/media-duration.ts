/** Reads a video/audio file's duration from a hidden element's metadata (client only). Resolves
 *  `undefined` for images, on error, on a non-finite/zero duration, or after 5 s. Lint/display only. */
export function readMediaDuration(file: File, timeoutMs = 5000): Promise<number | undefined> {
  const tag = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
  if (!tag || typeof document === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const el = document.createElement(tag);
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (v: number | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      try { el.load(); } catch { /* jsdom */ }
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    el.preload = "metadata";
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined);
    el.onerror = () => finish(undefined);
    el.src = url;
  });
}
