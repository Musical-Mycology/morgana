"use client";
import type { RefObject } from "react";
import Link from "next/link";
import { useMemo } from "react";
import { useEditor } from "@/lib/editor/store";
import { deckLayout, deckTimeOf, locate } from "@/engine/authoring/deck-clock";
import { formatClock } from "@/lib/timing/clock-format";
import { TimeBar } from "@/components/timing/TimeBar";
import type { CanvasHandle } from "./DeckCanvas";

/** Deck-time ruler above the per-beat timeline (timed decks). Scrubbing selects the beat under
 *  T and seeks the editor canvas to its local time. Whole-deck continuous playback is the
 *  Player's job (/play) — the editor canvas uses the simpler seek.ts renderer. */
export function DeckRuler({ canvasRef, beatT }: { canvasRef: RefObject<CanvasHandle | null>; beatT: number }) {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const layout = useMemo(() => (doc ? deckLayout(doc) : null), [doc]);
  if (!doc || !layout) return null;
  const target = doc.meta.timing?.targetSec;
  if (target === undefined) {
    return <div className="ed__ruler-hint" data-testid="ruler-hint">Turn on “Timed deck” in Deck settings to time this deck.</div>;
  }
  const T = deckTimeOf(layout, selected, beatT);
  const onScrub = (to: number) => {
    const l = locate(layout, to);
    if (!l || l.flatIdx == null) return; // empty scene: nothing to select
    if (l.flatIdx !== selected) select(l.flatIdx);
    // DeckCanvas resets its time to 0 when the selected beat changes (its [flat] effect); seek
    // on the next frame so this seek lands after that reset.
    const localT = l.localT;
    requestAnimationFrame(() => canvasRef.current?.seek(localT));
  };
  return (
    <div className="ed__ruler">
      <span className="ed__ruler-clock" data-testid="ruler-clock">{formatClock(T)} / {formatClock(target, { tenths: false })}</span>
      <div className="ed__ruler-bar">
        <TimeBar layout={layout} sceneIds={doc.scenes.map((s) => s.id)} value={T} targetSec={target} onScrub={onScrub} testId="deck-ruler" />
      </div>
      <Link className="ed__pill ed__pill--ghost" data-testid="play-from-here" href={`/play?deck=${doc.meta.id}&t=${T.toFixed(2)}`} target="_blank">▶ Play from here</Link>
    </div>
  );
}
