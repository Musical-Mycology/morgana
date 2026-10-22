import { useMemo } from "react";
import { useEditor } from "./store";
import { lintDeck, type LintContext, type LintIssue } from "./lint";

/** Re-lints whenever the doc reference changes. `commit()` produces a new reference on every
 *  real edit and none on a no-op, so this recomputes exactly when the deck actually changed.
 *  `ctx` carries what the doc alone can't know (the deck's media ids, the decoded soundtrack length). */
export function useLint(ctx?: LintContext): LintIssue[] {
  const doc = useEditor((s) => s.doc);
  return useMemo(() => (doc ? lintDeck(doc, ctx) : []), [doc, ctx?.mediaIds, ctx?.soundtrackSec]); // eslint-disable-line react-hooks/exhaustive-deps
}
