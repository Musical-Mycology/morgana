"use client";
import type { Field as FieldSpec } from "@/lib/editor/registry";
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
          style={spec.type === "range" ? { width: "100%" } : base}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={Number(value ?? 0)}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      ) : spec.type === "checkbox" ? (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      ) : (
        <input style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
