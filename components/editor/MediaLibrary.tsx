"use client";
import { useContext, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { deleteMedia, mediaUrl, uploadMedia } from "@/lib/api/media-client";
import { DeckMediaContext } from "@/lib/editor/use-deck-media";
import { readMediaDuration } from "@/lib/editor/media-duration";
import { findMediaRefs } from "@/lib/editor/media-refs";
import { mediaKind, toMediaRef } from "@/engine/deck/media-ref";
import { formatClock } from "@/lib/timing/clock-format";
import type { MediaInfo } from "@/lib/store/media-store"; // type-only: the store pulls Node fs/crypto

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/*";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface Pending { media: MediaInfo; uses: string[] }

/** Deck settings → Media library (spec §5): upload (button + drag-drop, per-file errors), thumbnail
 *  grid, copy `media:<id>` ref, delete with a reference check. */
export function MediaLibrary() {
  const doc = useEditor((s) => s.doc);
  const { media, refresh } = useContext(DeckMediaContext);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name: string; message: string }[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (!doc) return null;
  const deckId = doc.meta.id;

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setErrors([]);
    const failed: { name: string; message: string }[] = [];
    for (const file of files) {
      try {
        const durationSec = await readMediaDuration(file);
        await uploadMedia(deckId, file, durationSec);
      } catch (e) {
        failed.push({ name: file.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
    setErrors(failed);
    try { await refresh(); } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const doDelete = async (m: MediaInfo) => {
    setPending(null); setErrors([]);
    try { await deleteMedia(deckId, m.id); await refresh(); }
    catch (e) { setErrors([{ name: m.name, message: e instanceof Error ? e.message : String(e) }]); }
  };

  const onDelete = (m: MediaInfo) => {
    const uses = findMediaRefs(doc)
      .filter((u) => u.ref === toMediaRef(m.id))
      .map((u) => {
        const scene = doc.scenes[u.sceneIdx]; const beat = scene?.beats[u.beatIdx];
        return `${scene?.id ?? u.sceneIdx} / ${beat?.id ?? u.beatIdx} (${u.where})`;
      });
    if (doc.meta.soundtrack?.media === m.id) uses.push("Deck soundtrack");
    if (uses.length === 0) void doDelete(m); else setPending({ media: m, uses });
  };

  const onCopy = async (m: MediaInfo) => {
    try { await navigator.clipboard.writeText(toMediaRef(m.id)); setCopied(m.id); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard unavailable */ }
  };

  const meta = (m: MediaInfo) => (
    <div style={{ minWidth: 0, flex: 1 }}>
      <div title={m.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
      <div style={{ opacity: 0.6, fontSize: 10 }}>
        {formatBytes(m.bytes)}{m.durationSec !== undefined ? ` · ${formatClock(m.durationSec, { tenths: false })}` : ""}
      </div>
    </div>
  );
  const actions = (m: MediaInfo) => (
    <div style={{ display: "flex", gap: 4 }}>
      <button className="ed__pill ed__pill--ghost" style={{ padding: "3px 9px", fontSize: 11 }} data-testid={`media-copy-${m.id}`} onClick={() => void onCopy(m)}>
        {copied === m.id ? "Copied" : "Copy ref"}
      </button>
      <button className="ed__pill ed__pill--ghost" style={{ padding: "3px 9px", fontSize: 11 }} data-testid={`media-delete-${m.id}`} aria-label={`Delete ${m.name}`} onClick={() => onDelete(m)}>Delete</button>
    </div>
  );
  const card = (m: MediaInfo) => {
    const kind = mediaKind(m.mime);
    const thumb = kind === "image"
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={mediaUrl(deckId, m.id)} alt={m.name} loading="lazy" style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 4, background: "#0006" }} />
      : kind === "video"
        ? <video src={mediaUrl(deckId, m.id)} preload="metadata" muted playsInline style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 4, background: "#0006" }} />
        : null;
    return (
      <div key={m.id} data-testid={`media-item-${m.id}`}
        style={{ border: "1px solid var(--ed-line-2)", borderRadius: 6, padding: 6, fontSize: 11, display: "flex", flexDirection: thumb ? "column" : "row", gap: 6, alignItems: thumb ? "stretch" : "center", gridColumn: thumb ? undefined : "1 / -1" }}>
        {thumb}
        <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between", flex: 1, minWidth: 0, flexWrap: "wrap" }}>
          {kind === "audio" && <span aria-hidden>♪</span>}
          {meta(m)}
          {actions(m)}
        </div>
      </div>
    );
  };

  return (
    <div data-testid="media-library" style={{ marginTop: 14 }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); void upload(Array.from(e.dataTransfer?.files ?? [])); }}>
      <div style={{ fontSize: 12, marginBottom: 6 }}>Media library</div>
      <label style={{ display: "block", fontSize: 11, marginBottom: 6 }}>
        <span style={{ display: "block", marginBottom: 2 }}>Upload media</span>
        <input ref={input} data-testid="media-upload" type="file" multiple accept={ACCEPT} disabled={busy} style={{ fontSize: 11 }}
          onChange={(e) => void upload(Array.from(e.target.files ?? []))} />
      </label>
      <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 6 }}>Or drop images, MP4/WebM clips and audio here. Copy a ref to use it as art or a media tile source.</div>
      {busy && <div style={{ fontSize: 11, opacity: 0.7 }}>Uploading…</div>}
      {errors.map((er, i) => (
        <div key={`${er.name}-${i}`} data-testid="media-error" style={{ fontSize: 11, color: "#e0614f", marginBottom: 3 }}>
          <strong>{er.name}</strong>: {er.message}
        </div>
      ))}
      {pending && (
        <div data-testid="media-confirm" role="alertdialog" aria-label="Delete referenced media"
          style={{ border: "1px solid #e0614f", borderRadius: 6, padding: 8, fontSize: 11, margin: "6px 0" }}>
          <div style={{ marginBottom: 4 }}><strong>{pending.media.name}</strong> is still used by this deck:</div>
          <ul style={{ margin: "0 0 6px 16px", padding: 0 }}>
            {pending.uses.map((u, i) => <li key={i} data-testid="media-confirm-ref">{u}</li>)}
          </ul>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="ed__pill ed__pill--ghost" data-testid="media-confirm-cancel" onClick={() => setPending(null)}>Cancel</button>
            <button className="ed__pill ed__pill--gold" data-testid="media-confirm-ok" onClick={() => void doDelete(pending.media)}>Delete anyway</button>
          </div>
        </div>
      )}
      {media && media.length === 0 && <div style={{ fontSize: 11, opacity: 0.6 }}>No media yet.</div>}
      {media && media.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6 }}>
          {media.map(card)}
        </div>
      )}
    </div>
  );
}
