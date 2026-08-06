/**
 * Sub-path support for deployments that serve Morgana under a path of a larger
 * site (e.g. https://example.com/morgana/) behind a reverse proxy.
 *
 * Next.js rewrites <Link>, <Image>, and /_next/* for `basePath` automatically.
 * It does NOT rewrite raw fetch() URLs or URLs we build by hand — every such
 * call site must go through withBasePath().
 *
 * The value is inlined at build time (see next.config.mjs): Next bakes
 * `basePath` during `next build`, so it cannot be changed at container runtime.
 */
const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Normalised base path: either "" or "/segment" — leading slash, no trailing slash. */
export const BASE_PATH = raw === "/" ? "" : raw.replace(/\/+$/, "");

/** Prefix an app-absolute path with the configured base path. */
export function withBasePath(path: string): string {
  // Already a full URL (scheme://…) — nothing to prefix.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return `${BASE_PATH}${path}`;
}
