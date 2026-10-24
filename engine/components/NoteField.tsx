"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Scene } from "@/engine/deck/types";
import type { StoryAsset } from "@/engine/deck/story-assets";
import { useAssetResolver } from "@/engine/asset-resolver-react";
import { makeNoteHex } from "./effects/notes";
import { isTextSpriteKey, noteFieldStateAt, type NoteSpriteState, type TextSource } from "./effects/note-state";

export interface NoteFieldHandle {
  /** Paint every live note sprite at (beatIndex, t seconds into that beat).
   *  The caller owns the clock — this component holds no time state of its own. `textSources`:
   *  the beat's measured text-particle sources (sub-project 6), painted into `textHost`. */
  renderAt(scene: Scene, beatIndex: number, t: number, textSources?: readonly TextSource[]): void;
}

/** The only place reducer output touches a sprite node. Pure DOM writer. */
export function applyNoteState(
  node: HTMLElement, s: NoteSpriteState, resolveStory: (key: StoryAsset) => string,
): void {
  node.style.display = "block";
  node.style.left = `${s.x * 100}%`;
  node.style.top = `${s.y * 100}%`;
  node.style.opacity = String(s.opacity);
  node.style.transform = `translate(-50%, -50%) scale(${s.scale})`;
  // A pool slot is reused by successive notes, whose glyph/colour differ — restyle only
  // when they actually change, so the common case is three style writes.
  if (node.dataset.hex !== s.hex) {
    node.style.backgroundColor = s.hex;
    node.style.filter = `drop-shadow(0 0 6px ${s.hex})`;
    node.dataset.hex = s.hex;
  }
  if (node.dataset.glyph !== s.glyph) {
    const url = resolveStory(s.glyph);
    node.style.maskImage = `url(${url})`;
    node.style.setProperty("-webkit-mask-image", `url(${url})`);
    node.dataset.glyph = s.glyph;
  }
}

interface Props {
  reduced?: boolean;
  /** Where text-particle sprites go (BeatStage's fixed .notefield__text, outside the camera's
   *  world: text never moves, so its notes must not either). Unset → this field's own stage. */
  textHost?: React.RefObject<HTMLElement | null>;
}

export const NoteField = forwardRef<NoteFieldHandle, Props>(function NoteField({ reduced, textHost }, ref) {
  const assets = useAssetResolver();
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const stage = useRef<HTMLDivElement>(null);
  const pool = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => () => { pool.current.forEach((n) => n.remove()); pool.current.clear(); }, []);

  useImperativeHandle(ref, () => ({
    renderAt(scene, beatIndex, t, textSources) {
      const host = stage.current;
      if (!host) return;
      const sprites = reduced ? [] : noteFieldStateAt(scene, beatIndex, t, textSources);
      const seen = new Set<string>();
      for (const s of sprites) {
        seen.add(s.key);
        let node = pool.current.get(s.key);
        if (!node) {
          node = makeNoteHex(s.hex, s.glyph, assetsRef.current.story);
          (isTextSpriteKey(s.key) ? (textHost?.current ?? host) : host).appendChild(node);
          pool.current.set(s.key, node);
        }
        applyNoteState(node, s, assetsRef.current.story);
      }
      for (const [key, node] of pool.current) if (!seen.has(key)) node.style.display = "none";
    },
  }), [reduced, textHost]);

  return (
    <div aria-hidden className="notefield" data-testid="notefield">
      <div className="notefield__stage" ref={stage} />
      <style>{`
        .notefield { position: absolute; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
        /* Sprites are positioned against the SAME 16:9 letterbox as .cin__stage, not the
           host. The host differs between the two render paths (DeckCanvas is 16:9;
           BeatStage is fixed/inset:0 = the viewport), so host-relative positioning put the
           same emitter in different places in each. */
        .notefield__stage { position: absolute; inset: 0; margin: auto;
          width: min(100cqw, calc(100cqh * 16 / 9)); height: min(100cqh, calc(100cqw * 9 / 16)); }
        /* Text particles (sub-project 6): BeatStage's fixed .notefield__text, the same 16:9 letterbox. */
        .notefield__text { position: absolute; inset: 0; margin: auto;
          width: min(100cqw, calc(100cqh * 16 / 9)); height: min(100cqh, calc(100cqw * 9 / 16)); }
      `}</style>
    </div>
  );
});
