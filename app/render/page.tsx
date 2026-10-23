"use client";
import { useEffect, useState } from "react";
import type { DeckDoc } from "@/engine/deck-doc";
import { loadDeck } from "@/lib/api/decks-client";
import { RenderStage } from "@/components/player/RenderStage";
import { loadDeckFonts } from "@/components/player/render-fonts";

/** Chrome-free page the MP4 CLI drives (spec §3): `/render?deck=<id>`. */
export default function RenderPage() {
  const [state, setState] = useState<DeckDoc | "loading" | "error">("loading");
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("deck");
    const fail = (error: string) => { window.__morganaRender = { ready: false, error }; setState("error"); };
    if (!id) { fail("missing deck id"); return; }
    // Fonts load BEFORE RenderStage mounts: the first beat's SplitText measures text as it builds.
    Promise.all([loadDeck(id), loadDeckFonts()])
      .then(([doc]) => setState(doc))
      .catch((e) => {
        console.error("failed to load deck", e);
        fail(e instanceof Error ? e.message : String(e));
      });
  }, []);
  if (state === "loading") return <div style={{ position: "fixed", inset: 0, background: "#000" }} />;
  if (state === "error") return <div data-testid="render-error" style={{ position: "fixed", inset: 0, background: "#000", color: "#ccc", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif" }}>Couldn&apos;t load deck.</div>;
  return <RenderStage doc={state} />;
}
