import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("engine-tokens.css declares every --color-mm-* var the engine references", () => {
  const css = readFileSync(resolve(process.cwd(), "engine/engine-tokens.css"), "utf8");
  for (const v of [
    "--color-mm-cream", "--color-mm-cream-pale", "--color-mm-dark-brown",
    "--color-mm-gold", "--color-mm-hairline", "--color-mm-mushroom",
    "--color-mm-terracotta", "--color-mm-warm-tan",
  ]) {
    expect(css).toContain(`${v}:`);
  }
});
