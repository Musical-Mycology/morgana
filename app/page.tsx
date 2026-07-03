"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import "./library.css";
import type { DeckMeta } from "@/engine/deck-doc";
import type { Beat } from "@/engine/deck/types";
import { deleteDeck, listDecks, loadDeck } from "@/lib/api/decks-client";
import { flattenBeats } from "@/lib/editor/flatten-beats";
import { swatchGradient } from "@/lib/library/swatch";
import { slugify } from "@/lib/library/slugify";
import { createDeckWithRetry } from "@/lib/library/create-deck-with-retry";
import { BeatThumbnail } from "@/components/library/BeatThumbnail";

type LoadState = "loading" | "ready" | "error";

function NewDeckCard({ onCreated }: { onCreated: (meta: DeckMeta) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const doc = await createDeckWithRetry(trimmed);
      onCreated(doc.meta);
      setOpen(false); setTitle(""); setError(null);
    } catch {
      setError("Couldn't create deck — try a different title.");
    }
  };

  if (!open) {
    return (
      <button className="lib__new" data-testid="new-deck-toggle" onClick={() => setOpen(true)}>
        + New deck
      </button>
    );
  }
  return (
    <div className="lib__new lib__new-form" data-testid="new-deck-form">
      <input
        className="lib__new-input"
        placeholder="Deck title…"
        value={title}
        autoFocus
        data-testid="new-deck-title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <p className="lib__new-slug">→ {slugify(title || "deck")}</p>
      <div className="lib__new-actions">
        <button className="lib__pill lib__pill--gold" data-testid="new-deck-create" onClick={submit}>Create</button>
        <button className="lib__pill lib__pill--ghost" data-testid="new-deck-cancel" onClick={() => { setOpen(false); setTitle(""); setError(null); }}>Cancel</button>
      </div>
      {error && <p className="lib__error" data-testid="new-deck-error">{error}</p>}
    </div>
  );
}

export default function Library() {
  const [decks, setDecks] = useState<DeckMeta[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, Beat | null>>({});
  const [state, setState] = useState<LoadState>("loading");

  const onCreated = (meta: DeckMeta) => setDecks((d) => [...d, meta]);
  const onDelete = async (meta: DeckMeta) => {
    if (!window.confirm(`Delete deck "${meta.title}"? This can't be undone.`)) return;
    await deleteDeck(meta.id);
    setDecks((d) => d.filter((m) => m.id !== meta.id));
  };

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
          <NewDeckCard onCreated={onCreated} />
        </div>
      ) : (
        <div className="lib__grid" data-testid="library-grid">
          {decks.map((meta) => (
            <div className="lib__card" key={meta.id} data-testid="deck-card">
              <button
                className="lib__card-del"
                title="Delete"
                data-testid="deck-card-delete"
                onClick={(e) => { e.preventDefault(); onDelete(meta); }}
              >
                ✕
              </button>
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
          <NewDeckCard onCreated={onCreated} />
        </div>
      )}
    </div>
  );
}
