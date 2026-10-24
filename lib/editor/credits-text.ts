/** The Credits "Entries" textarea format (sub-project 6): one credit per line, `Role: Name, Name`;
 *  a line with no colon is one name; blank lines are ignored. Pure (no DOM). */
import type { CreditItem } from "@/engine/deck/types";

export function parseCredits(text: string): CreditItem[] {
  const out: CreditItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const c = line.indexOf(":");
    if (c < 0) { out.push({ names: [line] }); continue; }
    const role = line.slice(0, c).trim();
    const names = line.slice(c + 1).split(",").map((n) => n.trim()).filter(Boolean);
    out.push(role ? { role, names } : { names });
  }
  return out;
}

export function formatCredits(items: CreditItem[]): string {
  return items.map((it) => {
    const names = it.names.join(", ");
    if (it.role) return `${it.role}: ${names}`;
    // Role-less: a bare line parses back as ONE name with no colon, so anything else gets a leading ":".
    return it.names.length === 1 && !it.names[0].includes(":") ? names : `: ${names}`;
  }).join("\n");
}
