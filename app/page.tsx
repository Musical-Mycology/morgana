"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import "./library.css";
import type { DeckMeta } from "@/engine/deck-doc";
import type { Beat } from "@/engine/deck/types";
import { listDecks, loadDeck } from "@/lib/api/decks-client";
import { flattenBeats } from "@/lib/editor/flatten-beats";
import { swatchGradient } from "@/lib/library/swatch";
import { BeatThumbnail } from "@/components/library/BeatThumbnail";

type LoadState = "loading" | "ready" | "error";

export default function Library() {
  const [decks, setDecks] = useState<DeckMeta[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, Beat | null>>({});
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    listDecks()
      .then((metas) => { setDecks(metas); setState("ready"); })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    decks.forEach((meta) => {
      if (meta.id in thumbs) return;
      loadDeck(meta.id)
        .then((doc) => setThumbs((t) => ({ ...t, [meta.id]: flattenBeats(doc)[0]?.beat ?? null })))
        .catch(() => setThumbs((t) => ({ ...t, [meta.id]: null })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks]);

  return (
    <div className="lib">
      <div className="lib__bar">
        <span className="lib__brand">Morgana</span>
      </div>
      {state === "error" && <p className="lib__error" data-testid="library-error">Couldn&apos;t load decks.</p>}
      {state === "ready" && decks.length === 0 ? (
        <div className="lib__empty" data-testid="library-empty">
          <h2>No decks yet</h2>
          <p>Create your first deck to start authoring.</p>
        </div>
      ) : (
        <div className="lib__grid" data-testid="library-grid">
          {decks.map((meta) => (
            <div className="lib__card" key={meta.id} data-testid="deck-card">
              <Link href={`/editor?deck=${meta.id}`} className="lib__card-open">
                <div className="lib__card-swatch" data-testid="deck-card-swatch" style={thumbs[meta.id] ? undefined : { background: swatchGradient(meta.id) }}>
                  {thumbs[meta.id] ? <BeatThumbnail beat={thumbs[meta.id]!} /> : null}
                </div>
                <div className="lib__card-body">
                  <p className="lib__card-title">{meta.title}</p>
                  <p className="lib__card-id">{meta.id}</p>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
