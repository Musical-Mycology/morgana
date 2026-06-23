"use client";
import { useEffect, useRef, useState } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { sampleBeat } from "@/engine/authoring/sample-beat";
import { beatDuration, renderBeatAt } from "@/engine/authoring/seek";

export default function Spike() {
  const art = useRef<ArtStageHandle>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const total = beatDuration(sampleBeat.timeline);
  const [t, setT] = useState(0);

  useEffect(() => {
    if (textHost.current) renderBeatAt(sampleBeat.timeline, t, { textHost: textHost.current, art: art.current });
  }, [t]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--color-mm-dark-brown)" }}>
      <ArtStage ref={art} nightlight={0.6} reduced={false} transparentBg />
      <div className="cin"><div className="cin__stage"><div ref={textHost} className="cin__text" data-testid="spike-text" /></div></div>
      <input
        data-testid="scrub" type="range" min={0} max={total} step={0.01} value={t}
        onChange={(e) => setT(parseFloat(e.target.value))}
        style={{ position: "fixed", left: 24, right: 24, bottom: 24, width: "calc(100% - 48px)", zIndex: 10 }}
      />
    </div>
  );
}
