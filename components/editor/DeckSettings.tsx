"use client";
import { useEditor } from "@/lib/editor/store";
import { getPath } from "@/lib/editor/paths";
import { Field } from "./Field";
import type { Field as FieldSpec } from "@/lib/editor/registry";

const FIELDS: FieldSpec[] = [
  { key: "title", label: "Deck title", type: "text" },
  { key: "chrome.splash.tagline", label: "Splash tagline", type: "text" },
  { key: "chrome.splash.logo", label: "Splash logo (filename)", type: "text" },
  { key: "chrome.wordmark", label: "Footer wordmark", type: "text" },
];

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
    </div>
  );
}
