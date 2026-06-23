"use client";
import { useState } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Beat } from "@/engine/deck/types";
import type { DeckChrome } from "@/engine/deck-doc";

const beat: Beat = { id: "demo", timeline: [{ kind: "text", value: "Body copy", in: "fade" }] };
const chrome: DeckChrome = { splash: { tagline: "Injected tagline" } };

export default function Page() {
  const [on, setOn] = useState(false);
  return (
    <>
      <button data-testid="toggle" style={{ position: "fixed", zIndex: 20, top: 8, left: 8 }} onClick={() => setOn((v) => !v)}>toggle</button>
      <BeatStage sceneId="intro" beat={beat} chrome={on ? chrome : undefined} />
    </>
  );
}
