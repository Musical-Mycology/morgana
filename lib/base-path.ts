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
 *
 * The normalisation below is duplicated in next.config.mjs's `normalizeBasePath`.
 * next.config.mjs runs before the TypeScript/bundler pipeline exists, so it
 * cannot import this module — the two copies must be kept identical by hand.
 * See tests/unit/base-path.test.ts's "next.config.mjs agrees with lib/base-path"
 * cases, which assert both resolve every input the same way.
 */
const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Normalise to "" or "/segment[/segment…]": trim whitespace, collapse any run
 * of slashes to one, guarantee a single leading slash, then drop a trailing
 * one. A bare "/" (or all-slash input) collapses to "/" and then to "".
 */
function normalizeBasePath(input: string): string {
  const collapsed = input.trim().replace(/\/+/g, "/");
  const leading = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  return leading === "/" ? "" : leading.replace(/\/$/, "");
}

/** Normalised base path: either "" or "/segment[/segment…]". */
export const BASE_PATH = normalizeBasePath(raw);

/** Prefix an app-absolute path with the configured base path. */
export function withBasePath(path: string): string {
  // Already a full URL (scheme://…) — nothing to prefix.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return `${BASE_PATH}${path}`;
}
