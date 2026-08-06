/** @type {import('next').NextConfig} */
// MORGANA_BASE_PATH serves Morgana under a sub-path (e.g. "/morgana") behind a
// reverse proxy. Next bakes basePath during `next build`, so this is a
// BUILD-time input, not a runtime one — see the Dockerfile's build arg.
//
// It is re-exported as NEXT_PUBLIC_BASE_PATH so client code (lib/base-path.ts)
// reads the same value without the operator setting two variables. `basePath`
// is omitted entirely when unset: Next treats basePath: "" as invalid.
const basePath = (process.env.MORGANA_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
export default nextConfig;
