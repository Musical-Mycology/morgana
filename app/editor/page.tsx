"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import "./editor.css";
import { useEditor } from "@/lib/editor/store";
import { loadDeck } from "@/lib/api/decks-client";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { Filmstrip } from "@/components/editor/Filmstrip";
import { Timeline } from "@/components/editor/Timeline";
import { Inspector } from "@/components/editor/Inspector";

export default function Editor() {
  const doc = useEditor((s) => s.doc);
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const load = useEditor((s) => s.load);
  const canvasRef = useRef<CanvasHandle>(null);
  const [time, setTime] = useState({ t: 0, duration: 0 });
  useEffect(() => { loadDeck("demo").then(load).catch(() => {}); }, [load]);
  const selectedFlat = beats[selected] ?? null;
  const onTime = useCallback((t: number, duration: number) => setTime({ t, duration }), []);
  return (
    <div className="ed">
      <div className="ed__bar"><span className="ed__brand">Morgana</span><span style={{ color: "var(--ed-fg-muted)" }}>{doc?.meta.title ?? "no deck"}</span></div>
      <Filmstrip />
      <div className="ed__canvas"><DeckCanvas ref={canvasRef} flat={selectedFlat} onTime={onTime} /></div>
      <Timeline canvasRef={canvasRef} time={time} />
      <Inspector />
    </div>
  );
}
