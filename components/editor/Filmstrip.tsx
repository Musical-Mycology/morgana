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
          className="ed__beat">
          <span style={{ color: "var(--ed-fg-muted)", marginRight: 8 }}>{String(i + 1).padStart(2, "0")}</span>
          <span style={{ color: "var(--ed-fg-muted)" }}>{b.sceneId} ·</span> {b.beat.id}
        </button>
      ))}
    </div>
  );
}
