"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import "./editor.css";
import { useEditor } from "@/lib/editor/store";
import { loadDeck, listDecks, createDeck, deleteDeck } from "@/lib/api/decks-client";
import type { DeckMeta } from "@/engine/deck-doc";
import { DECK_ID_RE } from "@/engine/deck-doc";
import { useAutosave, type SaveStatus } from "@/lib/editor/use-autosave";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { Filmstrip } from "@/components/editor/Filmstrip";
import { Timeline } from "@/components/editor/Timeline";
import { Inspector } from "@/components/editor/Inspector";
import { DeckSettings } from "@/components/editor/DeckSettings";
import { deckDocToModule } from "@/lib/bridge/export-ts";

const STATUS_LABEL: Record<SaveStatus, string> = { idle: "", saving: "Saving…", saved: "Saved", error: "Save failed" };

export default function Editor() {
  const doc = useEditor((s) => s.doc);
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const revision = useEditor((s) => s.revision);
  const load = useEditor((s) => s.load);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const canvasRef = useRef<CanvasHandle>(null);
  const [time, setTime] = useState({ t: 0, duration: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [decks, setDecks] = useState<DeckMeta[]>([]);
  const [showExport, setShowExport] = useState(false);
  const exportText = doc ? deckDocToModule(doc) : "";
  const currentId = doc?.meta.id ?? "";
  useEffect(() => { listDecks().then(setDecks).catch(() => {}); }, []);

  const switchDeck = (id: string) => { if (id && id !== currentId) window.location.href = `/editor?deck=${id}`; };
  const onNewDeck = async () => {
    const id = window.prompt("New deck id (lowercase, a–z 0–9 -):")?.trim();
    if (!id) return;
    if (!DECK_ID_RE.test(id)) { window.alert("id must match a-z 0-9 - (start alphanumeric)"); return; }
    await createDeck({ id, title: id });
    window.location.href = `/editor?deck=${id}`;
  };
  const onDeleteDeck = async () => {
    if (!currentId || !window.confirm(`Delete deck "${currentId}"? This cannot be undone.`)) return;
    await deleteDeck(currentId);
    const next = decks.find((d) => d.id !== currentId)?.id ?? "demo";
    window.location.href = `/editor?deck=${next}`;
  };

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("deck") ?? "demo";
    loadDeck(id).then(load).catch((e) => { console.error("failed to load deck", e); setLoadError(true); });
  }, [load]);

  const onStatus = useCallback((s: SaveStatus) => setStatus(s), []);
  useAutosave(doc, revision, onStatus);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // let native text undo win
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const selectedFlat = beats[selected] ?? null;
  const onTime = useCallback((t: number, duration: number) => setTime({ t, duration }), []);
  return (
    <div className="ed">
      <div className="ed__bar">
        <span className="ed__brand">Morgana</span>
        <select className="ed__pill ed__pill--ghost" data-testid="deck-switcher" value={currentId} onChange={(e) => switchDeck(e.target.value)}>
          {!decks.some((d) => d.id === currentId) && <option value={currentId}>{doc?.meta.title ?? "…"}</option>}
          {decks.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        <button className="ed__pill ed__pill--ghost" data-testid="deck-new" onClick={onNewDeck}>＋ New</button>
        <button className="ed__pill ed__pill--ghost" data-testid="deck-delete" onClick={onDeleteDeck}>🗑 Delete</button>
        {loadError && <span style={{ color: "var(--ed-fg-muted)" }}>couldn&apos;t load deck</span>}
        <button className="ed__pill ed__pill--ghost" data-testid="undo" disabled={!canUndo} onClick={() => undo()}>↶ Undo</button>
        <button className="ed__pill ed__pill--ghost" data-testid="redo" disabled={!canRedo} onClick={() => redo()}>↷ Redo</button>
        <button className="ed__pill ed__pill--ghost" data-testid="deck-settings-toggle" onClick={() => setShowSettings(v => !v)}>Deck settings</button>
        <button className="ed__pill ed__pill--ghost" data-testid="export-toggle" onClick={() => setShowExport(v => !v)}>⤓ Export TS</button>
        <span data-testid="save-status" style={{ marginLeft: "auto", color: "var(--ed-fg-muted)", fontFamily: "var(--ed-mono)", fontSize: 12 }}>{STATUS_LABEL[status]}</span>
      </div>
      <Filmstrip />
      <div className="ed__canvas"><DeckCanvas ref={canvasRef} flat={selectedFlat} onTime={onTime} /></div>
      <Timeline canvasRef={canvasRef} time={time} />
      {showExport ? (
        <div className="ed__inspector" data-testid="export-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontFamily: "var(--ed-disp)", fontSize: 14 }}>Export TS</span>
            <button className="ed__pill ed__pill--ghost" data-testid="export-copy" onClick={() => navigator.clipboard?.writeText(exportText)}>Copy</button>
          </div>
          <textarea data-testid="export-output" readOnly value={exportText} style={{ width: "100%", height: "100%", minHeight: 240, fontFamily: "var(--ed-mono)", fontSize: 11, background: "var(--ed-bg-2)", color: "var(--ed-fg)", border: "1px solid var(--ed-line)", borderRadius: 8, padding: 8, resize: "none" }} />
        </div>
      ) : showSettings ? <DeckSettings /> : <Inspector />}
    </div>
  );
}
