"use client";
import { useEffect, useState } from "react";
import type { CreditItem } from "@/engine/deck/types";
import type { Field as FieldSpec } from "@/lib/editor/registry";
import { formatCredits, parseCredits } from "@/lib/editor/credits-text";
import { AssetPicker } from "./AssetPicker";

const base: React.CSSProperties = {
  background: "var(--ed-bg-2)",
  border: "1px solid var(--ed-line)",
  borderRadius: 8,
  color: "var(--ed-fg)",
  fontFamily: "var(--ed-body)",
  fontSize: 12.5,
  padding: "7px 9px",
  width: "100%",
};

export interface FieldExtra { clips?: unknown; onClipsChange?(v: unknown): void }

export function Field({ spec, value, onChange, extra }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; extra?: FieldExtra }) {
  if (spec.type === "credits") return <CreditsField spec={spec} value={value} onChange={onChange} />;
  if (spec.type === "asset") {
    // A div, not a <label>: the picker holds several buttons/inputs and a label would forward clicks to the first.
    return (
      <div data-testid={`field-${spec.key}`} style={{ marginBottom: 10 }}>
        <span style={{ display: "block", fontSize: 11, color: "var(--ed-fg-muted)", marginBottom: 4 }}>{spec.label}</span>
        <AssetPicker
          value={typeof value === "string" || Array.isArray(value) ? (value as string | string[]) : undefined}
          multiple={spec.multiple}
          accept={spec.accept ?? []}
          clips={extra?.clips}
          onChange={onChange}
          onClipsChange={extra?.onClipsChange}
        />
      </div>
    );
  }
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 11, color: "var(--ed-fg-muted)", marginBottom: 4 }}>{spec.label}</span>
      {spec.type === "textarea" ? (
        <textarea
          style={{ ...base, minHeight: 48, resize: "vertical" }}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : spec.type === "select" || spec.type === "objectRef" ? (
        <select data-testid={`field-${spec.key}`} style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : spec.type === "number" && spec.optional ? (
        // Optional (camera `to`): unset shows empty with an "inherit" placeholder; clearing deletes the key.
        <input
          type="number"
          data-testid={`field-${spec.key}`}
          style={base}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          placeholder="inherit"
          value={typeof value === "number" && Number.isFinite(value) ? value : ""}
          onChange={(e) => {
            if (e.target.value === "") { onChange(undefined); return; }
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      ) : spec.type === "range" || spec.type === "number" ? (
        <input
          type={spec.type === "range" ? "range" : "number"}
          data-testid={`field-${spec.key}`}
          style={spec.type === "range" ? { width: "100%" } : base}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={Number(value ?? 0)}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      ) : spec.type === "checkbox" ? (
        <input
          type="checkbox"
          data-testid={`field-${spec.key}`}
          checked={Boolean(value)}
          onChange={(e) => onChange(spec.toggle ? (e.target.checked ? { ...spec.toggle } : undefined) : e.target.checked)}
        />
      ) : (
        <input style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/** The Credits "Entries" textarea: one credit per line (`Role: Name, Name`), parsed live. It keeps
 *  its own draft so typing is never reformatted under the cursor, and re-syncs only when the items
 *  change from outside (undo, MCP) — i.e. when the draft no longer parses to them. It writes ONLY
 *  from the user's edit, never on mount or re-render, so items that do not round-trip through the
 *  text format (authored via MCP/JSON) survive opening the inspector untouched. */
function CreditsField({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const items = Array.isArray(value) ? (value as CreditItem[]) : [];
  const shown = formatCredits(items);
  const [draft, setDraft] = useState(shown);
  useEffect(() => {
    if (formatCredits(parseCredits(draft)) !== shown) setDraft(shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 11, color: "var(--ed-fg-muted)", marginBottom: 4 }}>{spec.label}</span>
      <textarea
        data-testid={`field-${spec.key}`}
        style={{ ...base, minHeight: 96, resize: "vertical" }}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); onChange(parseCredits(e.target.value)); }}
      />
    </label>
  );
}
