"use client";
import { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { formatClock, parseClock } from "@/lib/timing/clock-format";
import type { DeckMarker } from "@/engine/deck-doc";

const MAX_LABEL = 40;

function MarkerRow({ marker }: { marker: DeckMarker }) {
  const updateMarker = useEditor((s) => s.updateMarker);
  const deleteMarker = useEditor((s) => s.deleteMarker);
  const canonicalTime = formatClock(marker.t);
  const [label, setLabel] = useState(marker.label);
  const [time, setTime] = useState(canonicalTime);
  useEffect(() => { setLabel(marker.label); }, [marker.label]);
  useEffect(() => { setTime(canonicalTime); }, [marker.t, canonicalTime]);

  const commitLabel = () => {
    const v = label.trim();
    if (!v || v.length > MAX_LABEL || v === marker.label) { setLabel(marker.label); return; }
    updateMarker(marker.id, { label: v });
  };
  const commitTime = () => {
    // The untouched canonical text is a no-op even when it doesn't round-trip (t = 5.04 shows 0:05.0).
    if (time === canonicalTime) return;
    const v = parseClock(time, { allowZero: true });
    if (v === null || v === marker.t) { setTime(canonicalTime); return; }
    updateMarker(marker.id, { t: v });
  };
  return (
    <div data-testid="marker-row" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
      <input data-testid="marker-label" aria-label="Marker label" value={label}
        onChange={(e) => setLabel(e.target.value)} onBlur={commitLabel}
        onKeyDown={(e) => { if (e.key === "Enter") commitLabel(); }} style={{ flex: 1, minWidth: 0 }} />
      <input data-testid="marker-time" aria-label="Marker time (m:ss)" value={time}
        onChange={(e) => setTime(e.target.value)} onBlur={commitTime}
        onKeyDown={(e) => { if (e.key === "Enter") commitTime(); }} style={{ width: 64 }} />
      <button data-testid="marker-delete" aria-label="Delete marker" onClick={() => deleteMarker(marker.id)}>✕</button>
    </div>
  );
}

/** Deck-settings list of cue markers (sorted by time): rename, retime, delete. */
export function MarkerSettings() {
  const markers = useEditor((s) => s.doc?.meta.markers);
  const sorted = useMemo(() => [...(markers ?? [])].sort((a, b) => a.t - b.t), [markers]);
  return <div data-testid="marker-settings">{sorted.map((m) => <MarkerRow key={m.id} marker={m} />)}</div>;
}
