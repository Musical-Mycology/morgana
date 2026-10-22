"use client";
import { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { getPath } from "@/lib/editor/paths";
import { Field } from "./Field";
import type { Field as FieldSpec } from "@/lib/editor/registry";
import { deckLayout } from "@/engine/authoring/deck-clock";
import { formatClock, parseClock } from "@/lib/timing/clock-format";
import { SoundtrackSettings } from "./SoundtrackSettings";
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
  const canonical = target !== undefined ? formatClock(target, { tenths: false }) : "";
  const [draft, setDraft] = useState(canonical);
  useEffect(() => { setDraft(canonical); }, [target, canonical]);
  const commit = () => {
    // The untouched canonical text is a no-op even when it doesn't round-trip: a fractional
    // target (90.5 via MCP/JSON) displays "1:30", which would otherwise parse back to 90.
    if (draft === canonical) return;
    const v = parseClock(draft);
    if (v === null || v === target) { setDraft(canonical); return; }
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
      <SoundtrackSettings />
    </div>
  );
}
