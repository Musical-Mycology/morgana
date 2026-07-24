import { useMemo } from "react";
import { useEditor } from "./store";
import { lintDeck, type LintIssue } from "./lint";

/** Re-lints whenever the doc reference changes. `commit()` produces a new reference on every
 *  real edit and none on a no-op, so this recomputes exactly when the deck actually changed. */
export function useLint(): LintIssue[] {
  const doc = useEditor((s) => s.doc);
  return useMemo(() => (doc ? lintDeck(doc) : []), [doc]);
}
