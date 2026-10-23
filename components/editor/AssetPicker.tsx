"use client";
import { useContext, useEffect, useRef, useState } from "react";
import { DeckMediaContext } from "@/lib/editor/use-deck-media";
import { useAssetResolver } from "@/engine/asset-resolver-react";
import { isMediaRef, isVideoRef, mediaKind, mediaRefId, toMediaRef } from "@/engine/deck/media-ref";
import { OVERLAYS, PANELS, type StoryAsset } from "@/engine/deck/story-assets";
import type { ClipOpts } from "@/engine/deck/types";
import type { Field } from "@/lib/editor/registry";
import type { MediaInfo } from "@/lib/store/media-store"; // type-only: the store pulls Node fs/crypto

export interface AssetPickerProps {
  value: string | string[] | undefined;
  /** Ordered list (art `to`) vs a single value (tile `src`). Also picks the clip shape:
   *  multiple → `Record<MediaRef, ClipOpts>`, single → one `ClipOpts`. */
  multiple?: boolean;
  accept: Field["accept"];
  clips?: unknown;
  onChange(v: string | string[]): void;
  onClipsChange?(v: unknown): void;
}

const STORY_KEYS = new Set<string>([...PANELS, ...OVERLAYS]);

const input: React.CSSProperties = {
  background: "var(--ed-bg-2)", border: "1px solid var(--ed-line)", borderRadius: 8, color: "var(--ed-fg)",
  fontFamily: "var(--ed-body)", fontSize: 12.5, padding: "7px 9px", width: "100%",
};
const thumbBox: React.CSSProperties = { width: 40, height: 24, objectFit: "cover", borderRadius: 3, background: "#0006", flex: "none" };
const small: React.CSSProperties = { padding: "2px 7px", fontSize: 11 };

function toList(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string");
  return typeof v === "string" && v !== "" ? [v] : [];
}
/** One item stays a plain string, keeping today's `to` shape. */
const fromList = (l: string[]): string | string[] => (l.length === 1 ? l[0] : l);

function isClipOpts(v: unknown): v is ClipOpts { return !!v && typeof v === "object" && !Array.isArray(v); }

function Thumb({ value, media }: { value: string; media: MediaInfo | undefined }) {
  const resolve = useAssetResolver();
  if (STORY_KEYS.has(value)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolve.story(value as StoryAsset)} alt="" loading="lazy" style={thumbBox} />;
  }
  if (isMediaRef(value)) {
    const url = resolve.media(value);
    const kind = media ? mediaKind(media.mime) : isVideoRef(value) ? "video" : "image";
    if (url && kind === "video") return <video src={`${url}#t=0.001`} preload="metadata" muted playsInline style={thumbBox} />;
    // eslint-disable-next-line @next/next/no-img-element
    if (url && kind === "image") return <img src={url} alt="" loading="lazy" style={thumbBox} />;
  }
  return <span aria-hidden style={{ ...thumbBox, display: "inline-block" }} />;
}

/** In-point (s) + Loop for one video ref. Edits a local draft so partial numbers ("0.") survive typing. */
function ClipControls({ refKey, opts, onChange }: { refKey: string; opts: ClipOpts | undefined; onChange(next: ClipOpts | undefined): void }) {
  const shown = opts?.in !== undefined ? String(opts.in) : "";
  const [draft, setDraft] = useState(shown);
  // Re-sync on outside changes (undo, another field) without clobbering an equivalent draft like "0.".
  useEffect(() => { setDraft((d) => (d.trim() !== "" && Number(d) === opts?.in ? d : shown)); }, [shown, opts?.in]);
  const emit = (next: ClipOpts) => onChange(next.in === undefined && !next.loop ? undefined : next);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, padding: "4px 0 2px 46px" }}>
      <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span style={{ color: "var(--ed-fg-muted)" }}>In-point (s)</span>
        <input data-testid={`clip-in-${refKey}`} type="number" min={0} step={0.1} value={draft} style={{ ...input, width: 64, padding: "3px 6px", fontSize: 11 }}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const rest: ClipOpts = { ...opts }; delete rest.in;
            if (raw.trim() === "") { emit(rest); return; }
            const n = parseFloat(raw);
            if (Number.isFinite(n) && n >= 0) emit({ ...rest, in: n });
          }} />
      </label>
      <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input data-testid={`clip-loop-${refKey}`} type="checkbox" checked={Boolean(opts?.loop)}
          onChange={(e) => {
            const rest: ClipOpts = { ...opts }; delete rest.loop;
            emit(e.target.checked ? { ...rest, loop: true } : rest);
          }} />
        <span style={{ color: "var(--ed-fg-muted)" }}>Loop</span>
      </label>
    </div>
  );
}

/** Asset field (spec §5): a popover of built-in panels/overlays and this deck's image + video uploads,
 *  an ordered chip list (art) or a single value (tile), free-text entry, and per-video clip options. */
export function AssetPicker({ value, multiple, accept = [], clips, onChange, onClipsChange }: AssetPickerProps) {
  const { media } = useContext(DeckMediaContext);
  const [open, setOpen] = useState(false);
  const list = toList(value);
  const single = multiple ? "" : (typeof value === "string" ? value : "");
  const [text, setText] = useState(single);
  useEffect(() => { setText(single); }, [single]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    // The popover owns Escape while open: the editor's window handler would also exit the group.
    // (document's listener runs before window's in the bubble phase.)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const byRef = new Map<string, MediaInfo>((media ?? []).map((m) => [toMediaRef(m.id), m]));
  const labelOf = (v: string) => (isMediaRef(v) ? byRef.get(v)?.name ?? mediaRefId(v) : v);

  const builtIn: string[] = [
    ...(accept.includes("panel") ? PANELS : []),
    ...(accept.includes("overlay") ? OVERLAYS : []),
  ];
  const uploads = (media ?? []).filter((m) => {
    const k = mediaKind(m.mime);
    return (k === "image" || k === "video") && accept.includes(k);
  });

  const choose = (v: string) => {
    if (multiple) {
      if (!list.includes(v)) onChange(fromList([...list, v]));
    } else {
      onChange(v);
      setOpen(false);
    }
  };
  const commitText = () => {
    const t = text.trim();
    if (multiple) {
      if (t && !list.includes(t)) onChange(fromList([...list, t]));
      setText("");
    } else if (t !== single) {
      onChange(t);
    }
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(fromList(next));
  };

  // Clip options: art → Record<MediaRef, ClipOpts> (merged per ref); tile → one ClipOpts.
  const clipOf = (ref: string): ClipOpts | undefined => {
    if (!multiple) return isClipOpts(clips) ? clips : undefined;
    const rec = isClipOpts(clips) ? (clips as Record<string, unknown>) : {};
    const o = rec[ref];
    return isClipOpts(o) ? o : undefined;
  };
  const setClip = (ref: string, next: ClipOpts | undefined) => {
    if (!onClipsChange) return;
    if (!multiple) { onClipsChange(next); return; }
    const rec: Record<string, unknown> = { ...(isClipOpts(clips) ? (clips as Record<string, unknown>) : {}) };
    if (next) rec[ref] = next; else delete rec[ref];
    onClipsChange(Object.keys(rec).length ? rec : undefined);
  };
  const clipControls = (ref: string) =>
    onClipsChange && isVideoRef(ref) ? <ClipControls refKey={ref} opts={clipOf(ref)} onChange={(n) => setClip(ref, n)} /> : null;

  const option = (v: string, label: string, m?: MediaInfo) => {
    const chosen = multiple ? list.includes(v) : v === single;
    return (
      <button key={v} type="button" data-testid={`asset-option-${v}`} aria-pressed={chosen} title={v}
        onClick={() => choose(v)}
        style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch", padding: 4, borderRadius: 6, cursor: "pointer",
          background: chosen ? "rgba(212,168,67,0.14)" : "transparent", color: "var(--ed-fg)", fontSize: 10.5, textAlign: "left",
          border: `1px solid ${chosen ? "var(--ed-accent)" : "var(--ed-line)"}` }}>
        <Thumb value={v} media={m} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
    );
  };
  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 4, marginBottom: 8 };
  const heading: React.CSSProperties = { fontFamily: "var(--ed-disp)", letterSpacing: "0.06em", fontSize: 10, color: "var(--ed-fg-muted)", textTransform: "uppercase", margin: "2px 0 4px" };

  return (
    <div ref={root} data-testid="asset-picker" style={{ position: "relative" }}>
      {multiple && list.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {list.map((v, i) => (
            <div key={`${v}-${i}`}>
              <div data-testid={`asset-chip-${v}`} className="ed__chip" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "default" }}>
                <Thumb value={v} media={byRef.get(v)} />
                <span title={v} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(v)}</span>
                <button type="button" className="ed__icon" data-testid={`asset-chip-up-${v}`} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="ed__icon" data-testid={`asset-chip-down-${v}`} title="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="ed__icon" data-testid={`asset-chip-remove-${v}`} title="Remove" onClick={() => onChange(fromList(list.filter((_, k) => k !== i)))}>✕</button>
              </div>
              {clipControls(v)}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <input data-testid="asset-picker-text" style={input} value={text}
          placeholder={multiple ? "Add a key or media: ref…" : "Key, media: ref or URL"}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitText(); } }} />
        <button type="button" className="ed__pill ed__pill--ghost" style={small} data-testid="asset-picker-toggle"
          aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>Browse</button>
      </div>
      {!multiple && single && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11 }}>
          <Thumb value={single} media={byRef.get(single)} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(single)}</span>
        </div>
      )}
      {!multiple && single && clipControls(single)}
      {open && (
        <div data-testid="asset-picker-popover" role="dialog" aria-label="Choose an asset"
          style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 30, marginTop: 4, maxHeight: 320, overflow: "auto",
            background: "var(--ed-bg-1)", border: "1px solid var(--ed-line-2)", borderRadius: 8, padding: 8, boxShadow: "0 8px 24px #0008" }}>
          {builtIn.length > 0 && (
            <div data-testid="asset-section-builtin">
              <div style={heading}>Built-in</div>
              <div style={grid}>{builtIn.map((k) => option(k, k))}</div>
            </div>
          )}
          {(accept.includes("image") || accept.includes("video")) && (
            <div data-testid="asset-section-deck">
              <div style={heading}>This deck</div>
              {uploads.length === 0
                ? <div style={{ fontSize: 11, opacity: 0.6 }}>{media === null ? "Media unavailable." : "No uploads yet — add some in Deck settings."}</div>
                : <div style={grid}>{uploads.map((m) => option(toMediaRef(m.id), m.name, m))}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
