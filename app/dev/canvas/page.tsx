"use client";
import { useRef } from "react";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import type { FlatBeat } from "@/lib/editor/flatten-beats";
const flat: FlatBeat = { sceneId: "s", beat: { id: "b", timeline: [
  { kind: "text", value: "Canvas copy one", in: "flyUp" }, { kind: "wait", ms: 300 }, { kind: "text", value: "Canvas copy two", in: "fade" } ] } };
export default function Page() {
  const c = useRef<CanvasHandle>(null);
  return (
    <div style={{ position: "fixed", inset: 0, padding: 40, background: "#222" }}>
      <div style={{ width: 480 }}><DeckCanvas ref={c} flat={flat} /></div>
      <button data-testid="seek-end" onClick={() => c.current?.seek(99)}>seek end</button>
    </div>
  );
}
