"use client";
import { useMemo, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { deckDocToModule } from "@/lib/bridge/export-ts";

export function ExportPanel() {
  const doc = useEditor((s) => s.doc);
  const [copyLabel, setCopyLabel] = useState("Copy");
  const code = useMemo(() => (doc ? deckDocToModule(doc) : ""), [doc]);

  if (!doc) {
    return (
      <div className="ed__inspector" data-testid="export-panel">
        <p style={{ opacity: 0.6 }}>No deck.</p>
      </div>
    );
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyLabel("Copied");
      setTimeout(() => setCopyLabel("Copy"), 1500);
    } catch {
      // Fallback for insecure context / denied permission: select the text so the user can ⌘C.
      document.querySelector<HTMLTextAreaElement>('[data-testid="export-code"]')?.select();
      setCopyLabel("Copy failed — select + ⌘C");
      setTimeout(() => setCopyLabel("Copy"), 2500);
    }
  };

  const onDownload = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.meta.id}.ts`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ed__inspector" data-testid="export-panel">
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14, marginBottom: 11 }}>Export</div>
      <textarea
        data-testid="export-code"
        readOnly
        value={code}
        style={{ width: "100%", height: 260, fontFamily: "var(--ed-mono)", fontSize: 12, resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="ed__pill ed__pill--ghost" data-testid="export-copy" onClick={onCopy}>{copyLabel}</button>
        <button className="ed__pill ed__pill--ghost" data-testid="export-download" onClick={onDownload}>Download .ts</button>
      </div>
    </div>
  );
}
