/** @type {import('next').NextConfig} */
// MORGANA_BASE_PATH serves Morgana under a sub-path (e.g. "/morgana") behind a
// reverse proxy. Next bakes basePath during `next build`, so this is a
// BUILD-time input, not a runtime one — see the Dockerfile's build arg.
//
// It is re-exported as NEXT_PUBLIC_BASE_PATH so client code (lib/base-path.ts)
// reads the same value without the operator setting two variables. `basePath`
// is omitted entirely when unset: Next treats basePath: "" as invalid.
//
// normalizeBasePath is duplicated from lib/base-path.ts: this file runs
// before the TypeScript/bundler pipeline exists, so it cannot import that
// module — the two copies must be kept identical by hand. See
// tests/unit/base-path.test.ts's "next.config.mjs agrees with lib/base-path"
// cases, which assert both resolve every input the same way.
//
// Backslashes are collapsed alongside slashes: WHATWG URL treats `\` as `/`
// for special schemes, so an unescaped "/\evil.com" would otherwise resolve
// off-origin wherever a caller does `new URL(BASE_PATH + path, origin)`.
function normalizeBasePath(input) {
  const collapsed = input.trim().replace(/[\\/]+/g, "/");
  const leading = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  return leading.replace(/\/$/, "");
}

const basePath = normalizeBasePath(process.env.MORGANA_BASE_PATH ?? "");

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
export default nextConfig;
