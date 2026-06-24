import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
test("mm-tokens + editor theme declare the editor's key vars", () => {
  const mm = readFileSync(join(process.cwd(), "app/mm-tokens.css"), "utf8");
  const ed = readFileSync(join(process.cwd(), "app/editor/theme.css"), "utf8");
  for (const v of ["--mm-mushroom", "--mm-cream", "--mm-gold", "--mm-font-display"]) expect(mm).toContain(v);
  for (const v of ["--ed-bg-0", "--ed-fg", "--ed-accent", "--ed-line"]) expect(ed).toContain(v);
});
