import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { expect, test } from "vitest";

const ROOT = resolve(__dirname, "../..");
const DIRS = ["app", "components", "lib", "engine"];

// fetch("/…"), fetch('/…'), fetch(`/…`) — an app-absolute URL. Next does NOT
// rewrite these for basePath, so they must go through withBasePath().
const RAW_FETCH = /fetch\(\s*[`"']\//;
// `${window.location.origin}/…` — the same problem for hand-built URLs.
const RAW_ORIGIN = /location\.origin\}\//;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

test("no app code builds an app-absolute URL without withBasePath()", () => {
  const offenders: string[] = [];
  for (const dir of DIRS) {
    for (const file of walk(resolve(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      if (RAW_FETCH.test(src) || RAW_ORIGIN.test(src)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
  }
  expect(offenders).toEqual([]);
});
