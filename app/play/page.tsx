"use client";
import { useEffect, useState } from "react";
import "./play.css";
import type { DeckDoc } from "@/engine/deck-doc";
import { loadDeck } from "@/lib/api/decks-client";
import { TimedPlayer } from "@/components/player/TimedPlayer";

export default function PlayPage() {
  const [state, setState] = useState<{ doc: DeckDoc; t: number } | "loading" | "error">("loading");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("deck") ?? "demo";
    const t = Number(q.get("t") ?? 0);
    loadDeck(id)
      .then((doc) => setState({ doc, t: Number.isFinite(t) ? t : 0 }))
      .catch((e) => { console.error("failed to load deck", e); setState("error"); });
  }, []);
  if (state === "loading") return <div className="play" />;
  if (state === "error") return <div className="play play--empty" data-testid="play-error">Couldn&apos;t load deck.</div>;
  return <TimedPlayer doc={state.doc} initialT={state.t} />;
}
