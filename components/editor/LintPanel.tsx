"use client";
import { useEditor } from "@/lib/editor/store";
import { flatIndexOf } from "@/lib/editor/flatten-beats";
import type { LintIssue } from "@/lib/editor/lint";

export function LintPanel({ issues }: { issues: LintIssue[] }) {
  const doc = useEditor((s) => s.doc);
  const select = useEditor((s) => s.select);
  const selectAction = useEditor((s) => s.selectAction);

  const jump = (at: NonNullable<LintIssue["at"]>) => {
    if (!doc) return;
    const flatIdx = flatIndexOf(doc, at.sceneIdx, at.beatIdx ?? 0);
    if (flatIdx < 0) return;
    select(flatIdx);
    if (at.actionIdx !== undefined) selectAction(at.actionIdx);
  };

  return (
    <div className="ed__inspector" data-testid="lint-panel">
      <div className="ed__lbl">Issues</div>
      {issues.length === 0 && <p className="ed__lint-clean">No issues.</p>}
      {issues.map((issue, i) => {
        const located = issue.at !== undefined && doc !== null;
        const props = {
          key: i,
          className: "ed__lint-row",
          "data-testid": "lint-issue",
          "data-severity": issue.severity,
          "data-rule": issue.rule,
          "data-located": String(located),
        };
        const body = (
          <>
            <span className={`ed__lint-chip ed__lint-chip--${issue.severity}`}>
              {issue.severity === "error" ? "error" : "warn"}
            </span>
            <span>{issue.message}</span>
          </>
        );
        return located
          ? <button {...props} type="button" onClick={() => jump(issue.at!)}>{body}</button>
          : <div {...props}>{body}</div>;
      })}
    </div>
  );
}
