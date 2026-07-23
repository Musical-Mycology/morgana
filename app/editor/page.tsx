"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import "./editor.css";
import { useEditor } from "@/lib/editor/store";
import { loadDeck } from "@/lib/api/decks-client";
import { useAutosave, type SaveStatus } from "@/lib/editor/use-autosave";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { Filmstrip } from "@/components/editor/Filmstrip";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { Timeline } from "@/components/editor/Timeline";
import { Inspector } from "@/components/editor/Inspector";
import { DeckSettings } from "@/components/editor/DeckSettings";
import { ExportPanel } from "@/components/editor/ExportPanel";
import { McpPanel } from "@/components/editor/McpPanel";
import { primaryPath } from "@/lib/editor/selection";
import { useExternalChangePoll } from "@/lib/editor/use-external-change-poll";

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
  const deleteObject = useEditor((s) => s.deleteObject);
  const exitGroup = useEditor((s) => s.exitGroup);
  const selectedObjectPaths = useEditor((s) => s.selectedObjectPaths);
  const selectedObjectPath = primaryPath(selectedObjectPaths);
  const canvasRef = useRef<CanvasHandle>(null);
  const [time, setTime] = useState({ t: 0, duration: 0 });
  type Panel = "inspector" | "settings" | "export" | "mcp";
  const [panel, setPanel] = useState<Panel>("inspector");
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? "inspector" : p));
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const [deckId, setDeckId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("deck") ?? "demo";
    setDeckId(id);
    loadDeck(id).then(load).catch((e) => { console.error("failed to load deck", e); setLoadError(true); });
  }, [load]);

  const externalChange = useExternalChangePoll(deckId);
  const onStatus = useCallback((s: SaveStatus) => {
    setStatus(s);
    if (s === "saved") externalChange.resync();
  }, [externalChange]);
  useAutosave(doc, revision, onStatus);

  const selectedFlat = beats[selected] ?? null;
  const sceneId = selectedFlat?.sceneId ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // let native text undo win
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedObjectPath && sceneId) {
        e.preventDefault();
        deleteObject(sceneId, selectedObjectPath);
      }
      if (e.key === "Escape" && (selectedObjectPaths.length > 0)) {
        exitGroup();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedObjectPath, sceneId, deleteObject, exitGroup, selectedObjectPaths]);

  const onTime = useCallback((t: number, duration: number) => setTime({ t, duration }), []);
  const onReloadExternal = useCallback(() => {
    if (!deckId) return;
    loadDeck(deckId).then(load).then(() => externalChange.resync());
  }, [deckId, load, externalChange]);
  return (
    <div className="ed">
      {externalChange.changed && (
        <div className="ed__pill ed__pill--ghost" data-testid="external-change-banner" style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
          Deck changed externally.{" "}
          <button data-testid="external-change-reload" onClick={onReloadExternal}>Reload</button>{" "}
          <button data-testid="external-change-dismiss" onClick={externalChange.dismiss}>Dismiss</button>
        </div>
      )}
      <div className="ed__bar">
        <span className="ed__brand">Morgana</span>
        <span style={{ color: "var(--ed-fg-muted)" }}>{doc?.meta.title ?? (loadError ? "couldn't load deck" : "no deck")}</span>
        <button className="ed__pill ed__pill--ghost" data-testid="undo" disabled={!canUndo} onClick={() => undo()}>↶ Undo</button>
        <button className="ed__pill ed__pill--ghost" data-testid="redo" disabled={!canRedo} onClick={() => redo()}>↷ Redo</button>
        <button className="ed__pill ed__pill--ghost" data-testid="deck-settings-toggle" onClick={() => togglePanel("settings")}>Deck settings</button>
        <button className="ed__pill ed__pill--ghost" data-testid="export-toggle" onClick={() => togglePanel("export")}>Export</button>
        <button className="ed__pill ed__pill--ghost" data-testid="mcp-toggle" onClick={() => togglePanel("mcp")}>Connect Claude</button>
        <span data-testid="save-status" style={{ marginLeft: "auto", color: "var(--ed-fg-muted)", fontFamily: "var(--ed-mono)", fontSize: 12 }}>{STATUS_LABEL[status]}</span>
      </div>
      <div className="ed__leftdock">
        <div className="ed__leftdock-film"><Filmstrip /></div>
        <div className="ed__leftdock-layers"><LayersPanel /></div>
      </div>
      <div className="ed__canvas"><DeckCanvas ref={canvasRef} flat={selectedFlat} onTime={onTime} /></div>
      <Timeline canvasRef={canvasRef} time={time} />
      {panel === "settings" ? <DeckSettings /> : panel === "export" ? <ExportPanel /> : panel === "mcp" ? <McpPanel /> : <Inspector />}
    </div>
  );
}
