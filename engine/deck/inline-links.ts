/** Pure parser for inline markup inside cinematic text values:
 *  - `[label](target)` links — targets: jump:N (1-based slide), http(s)://…, mailto:…, tel:…
 *  - `**bold**` emphasis → a bold segment (rendered as <strong>). */

export type LinkKind = "jump" | "external" | "mailto" | "tel";

export type LinkSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; label: string; target: string; link: LinkKind; jumpTo?: number };

export type ParsedLine = LinkSegment[];

// One pass matches EITHER a link or a **bold** run, whichever comes next, so segments stay ordered.
// Groups: 1 = link label, 2 = link target, 3 = bold text.
const TOKEN_RE = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
const LINK_TEST = /\[[^\]]+\]\([^)]+\)/;
const BOLD_TEST = /\*\*[^*]+\*\*/;

function classify(target: string): { link: LinkKind; jumpTo?: number } {
  if (target.startsWith("jump:")) {
    const n = Number.parseInt(target.slice("jump:".length), 10);
    return { link: "jump", jumpTo: Number.isFinite(n) ? n : undefined };
  }
  if (target.startsWith("mailto:")) return { link: "mailto" };
  if (target.startsWith("tel:")) return { link: "tel" };
  return { link: "external" };
}

/** Split a value into ordered text / link / bold segments. Plain text → a single text segment. */
export function parseInlineLinks(value: string): ParsedLine {
  const segs: ParsedLine = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN_RE)) {
    const i = m.index ?? 0;
    if (i > last) segs.push({ kind: "text", text: value.slice(last, i) });
    if (m[1] !== undefined) {
      const [, label, target] = m;
      segs.push({ kind: "link", label, target, ...classify(target) });
    } else {
      segs.push({ kind: "bold", text: m[3] });
    }
    last = i + m[0].length;
  }
  if (last < value.length) segs.push({ kind: "text", text: value.slice(last) });
  if (!segs.length) segs.push({ kind: "text", text: value });
  return segs;
}

/** True if the value contains at least one inline link. */
export function hasInlineLink(value: string): boolean {
  return LINK_TEST.test(value);
}

/** True if the value contains any inline markup that can't survive SplitText (links or bold). */
export function hasInlineMarkup(value: string): boolean {
  return LINK_TEST.test(value) || BOLD_TEST.test(value);
}
