"use client";
import { useEditor } from "@/lib/editor/store";

export function Filmstrip() {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  return (
    <div className="ed__film" data-testid="filmstrip">
      {beats.map((b, i) => (
        <button
          key={`${b.sceneId}-${b.beat.id}-${i}`}
          onClick={() => select(i)}
          aria-current={i === selected}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            border: 0,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            cursor: "pointer",
            background: i === selected ? "rgba(212,168,67,0.22)" : "transparent",
            color: "inherit",
            fontFamily: "var(--font-body)",
          }}>
          <span style={{ opacity: 0.6, marginRight: 8 }}>{String(i + 1).padStart(2, "0")}</span>
          <span style={{ opacity: 0.5 }}>{b.sceneId} ·</span> {b.beat.id}
        </button>
      ))}
    </div>
  );
}
