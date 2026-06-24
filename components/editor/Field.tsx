"use client";

// Temporary inline type — T5 will switch this to import from @/lib/editor/registry
interface FieldSpec {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "range";
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}

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

export function Field({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 11, color: "var(--ed-fg-muted)", marginBottom: 4 }}>{spec.label}</span>
      {spec.type === "textarea" ? (
        <textarea
          style={{ ...base, minHeight: 48, resize: "vertical" }}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : spec.type === "select" ? (
        <select style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
      ) : (
        <input style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
