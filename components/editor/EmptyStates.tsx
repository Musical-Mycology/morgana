"use client";
import { useEditor } from "@/lib/editor/store";
import type { CanvasPlaceholder } from "@/lib/editor/empty-state";

const TEST_ID: Record<Exclude<CanvasPlaceholder, null>, string> = {
  "load-error": "couldnt-load-deck",
  "empty-deck": "empty-deck",
  "empty-scene": "empty-scene",
};

export function CanvasPlaceholderCard({ kind, deckId, onRetry }: {
  kind: Exclude<CanvasPlaceholder, null>;
  deckId: string | null;
  onRetry: () => void;
}) {
  const addScene = useEditor((s) => s.addScene);
  return (
    <div className="ed__empty-card" data-testid={TEST_ID[kind]}>
      {kind === "load-error" && (
        <>
          <p>Couldn&apos;t load deck{deckId ? ` "${deckId}"` : ""}.</p>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="ed__pill ed__pill--ghost" data-testid="load-retry" onClick={onRetry}>Retry</button>
            <a className="ed__pill ed__pill--ghost" href="/">Back to library</a>
          </span>
        </>
      )}
      {kind === "empty-deck" && (
        <>
          <p>No scenes yet.</p>
          <button className="ed__pill ed__pill--ghost" onClick={() => addScene()}>＋ Add the first scene</button>
        </>
      )}
      {kind === "empty-scene" && <p>This scene has no beats. Use ＋ on the scene in the filmstrip to add one.</p>}
    </div>
  );
}

export function EmptyBeatHint() {
  return <div className="ed__empty-hint" data-testid="empty-beat">This beat is empty — add an action in the timeline below.</div>;
}
