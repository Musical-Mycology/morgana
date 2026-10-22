"use client";
import { useContext, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { uploadMedia } from "@/lib/api/media-client";
import { DeckMediaContext } from "@/lib/editor/use-deck-media";
import { useSoundtrack } from "@/lib/audio/use-soundtrack";
import { loadSoundtrack, type Soundtrack } from "@/lib/audio/soundtrack";
import { formatClock } from "@/lib/timing/clock-format";

/** Deck settings → Soundtrack: one pre-mixed track (spec §5). Remove drops the reference only —
 *  the file stays in the media store so Undo can bring it back. */
export function SoundtrackSettings({ loadTrack = loadSoundtrack }: { loadTrack?: (url: string) => Promise<Soundtrack> }) {
  const doc = useEditor((s) => s.doc);
  const updateMeta = useEditor((s) => s.updateMeta);
  const { media, refresh } = useContext(DeckMediaContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mediaId = doc?.meta.soundtrack?.media;
  const sound = useSoundtrack(doc?.meta.id ?? null, mediaId, loadTrack);
  if (!doc) return null;
  const name = media?.find((m) => m.id === mediaId)?.name ?? mediaId;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const info = await uploadMedia(doc.meta.id, file);
      if (info.id !== mediaId) updateMeta("soundtrack", { media: info.id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, marginBottom: 6 }}>Soundtrack</div>
      <input ref={input} data-testid="soundtrack-upload" type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac"
        style={{ display: mediaId ? "none" : "block", fontSize: 11 }} disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
      {!mediaId && <div style={{ fontSize: 10, opacity: 0.6 }}>One pre-mixed track for the whole deck. MP3, M4A or WAV play everywhere.</div>}
      {mediaId && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <span data-testid="soundtrack-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          <span data-testid="soundtrack-duration" style={{ opacity: 0.7 }}>
            {sound.status === "ready" ? formatClock(sound.track.duration, { tenths: false }) : sound.status === "loading" ? "…" : "?"}
          </span>
          <button className="ed__pill ed__pill--ghost" data-testid="soundtrack-replace" disabled={busy} onClick={() => input.current?.click()}>Replace</button>
          <button className="ed__pill ed__pill--ghost" data-testid="soundtrack-remove" disabled={busy} onClick={() => updateMeta("soundtrack", undefined)}>Remove</button>
        </div>
      )}
      {busy && <div style={{ fontSize: 11, opacity: 0.7 }}>Uploading…</div>}
      {error && <div data-testid="soundtrack-error" style={{ fontSize: 11, color: "#e0614f" }}>{error}</div>}
    </div>
  );
}
