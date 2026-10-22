"use client";
import { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { getPath } from "@/lib/editor/paths";
import { Field } from "./Field";
import type { Field as FieldSpec } from "@/lib/editor/registry";
import { deckLayout } from "@/engine/authoring/deck-clock";
import { formatClock, parseClock } from "@/lib/timing/clock-format";
import type { DeckDoc } from "@/engine/deck-doc";

const FIELDS: FieldSpec[] = [
  { key: "title", label: "Deck title", type: "text" },
  { key: "chrome.splash.tagline", label: "Splash tagline", type: "text" },
  { key: "chrome.splash.logo", label: "Splash logo (filename)", type: "text" },
  { key: "chrome.wordmark", label: "Footer wordmark", type: "text" },
];

function TimingFields({ doc, updateMeta }: { doc: DeckDoc; updateMeta: (path: string, value: unknown) => void }) {
  const target = doc.meta.timing?.targetSec;
  const total = useMemo(() => deckLayout(doc).total, [doc]);
  const [draft, setDraft] = useState(target !== undefined ? formatClock(target, { tenths: false }) : "");
  useEffect(() => { setDraft(target !== undefined ? formatClock(target, { tenths: false }) : ""); }, [target]);
  const commit = () => {
    const v = parseClock(draft);
    if (v === null) { setDraft(target !== undefined ? formatClock(target, { tenths: false }) : ""); return; }
    updateMeta("timing", { targetSec: v });
  };
  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
        <input type="checkbox" data-testid="timed-toggle" checked={target !== undefined}
          onChange={(e) => updateMeta("timing", e.target.checked ? { targetSec: Math.max(1, Math.ceil(total)) } : undefined)} />
        Timed deck (video)
      </label>
      {target !== undefined && (
        <label style={{ display: "block", marginTop: 8, fontSize: 12 }}>
          Target length (m:ss)
          <input data-testid="target-length" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); }} style={{ display: "block", width: 80, marginTop: 4 }} />
        </label>
      )}
    </div>
  );
}

export function DeckSettings() {
  const doc = useEditor((s) => s.doc);
  const updateMeta = useEditor((s) => s.updateMeta);
  if (!doc) return <div className="ed__inspector" data-testid="deck-settings"><p style={{ opacity: 0.6 }}>No deck.</p></div>;
  return (
    <div className="ed__inspector" data-testid="deck-settings">
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14, marginBottom: 11 }}>Deck settings</div>
      {FIELDS.map((f) => (
        <Field key={f.key} spec={f} value={getPath(doc.meta, f.key)} onChange={(v) => updateMeta(f.key, v)} />
      ))}
      <TimingFields doc={doc} updateMeta={updateMeta} />
    </div>
  );
}
