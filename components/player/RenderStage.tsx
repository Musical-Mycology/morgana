"use client";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import type { DeckDoc } from "@/engine/deck-doc";
import { NOTE_GLYPHS } from "@/engine/deck/story-assets";
import { useAssetResolver } from "@/engine/asset-resolver-react";
import { pendingVideoSeeks } from "@/engine/components/video-sync";
import { cameraEvents, hasNoteActions } from "@/engine/authoring/camera-clock";
import { useDeckStage } from "./DeckStage";

/** What one rendered frame reports back: image or clip srcs that failed for the FIRST time
 *  (each src is reported once per page; the frame shows whatever the browser shows). */
export interface RenderFrameResult { failed: string[] }

declare global {
  interface Window {
    /** Set by the /render page. The MP4 CLI waits for `ready`, then steps frames with renderFrame(T). */
    __morganaRender?:
      | { ready: true; total: number; renderFrame(T: number): Promise<RenderFrameResult> }
      | { ready: false; error: string };
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Decode `src` through a detached Image so the browser's image cache holds it. NoteField glyphs
 *  are CSS mask-image URLs, not <img>s, so renderFrame cannot wait on them per frame: an
 *  unloaded mask paints nothing. Preloading every glyph before `ready` makes that load-timing
 *  independent. */
function preloadImage(src: string): Promise<void> {
  const img = new Image();
  img.src = src;
  return img.decode();
}

/** Chrome-free, fixed-size stage for the MP4 renderer (spec §3). The CLI calls
 *  window.__morganaRender.renderFrame(T) and screenshots only after it resolves. */
export function RenderStage({ doc }: { doc: DeckDoc }) {
  const { apply, layout, stage } = useDeckStage(doc, 0);
  const assets = useAssetResolver();
  const root = useRef<HTMLDivElement>(null);
  const hasCamera = useMemo(() => cameraEvents(doc).length > 0, [doc]);
  const hasNotes = useMemo(() => hasNoteActions(doc), [doc]);
  // Camera decks and note decks get a full raster per frame (below); decks with neither render as before.
  const needsFullRaster = hasCamera || hasNotes;
  useLayoutEffect(() => {
    document.documentElement.dataset.render = "1";
    return () => { delete document.documentElement.dataset.render; };
  }, []);
  useEffect(() => {
    if (!(layout.total > 0)) {
      window.__morganaRender = { ready: false, error: "deck has no duration" };
      return () => { delete window.__morganaRender; };
    }
    let live = true;
    const failed = new Set<string>();
    const unreported: string[] = [];
    const fail = (src: string) => { if (!failed.has(src)) { failed.add(src); unreported.push(src); } };
    const glyphs = NOTE_GLYPHS.map((g) => assets.story(g));
    void Promise.all(glyphs.map((src) => preloadImage(src).catch(() => fail(new URL(src, document.baseURI).href)))).then(() => {
      if (!live) return;
      window.__morganaRender = {
        ready: true,
        total: layout.total,
        async renderFrame(T: number) {
          // flushSync commits a beat swap (and its layout-effect seek) before we query images, so the
          // query always sees the NEW beat's <img>s rather than racing React's scheduler.
          flushSync(() => apply(T));
          await nextFrame();
          // Every clip seek this apply issued (stage clipMode is always "seek" here) must present its
          // frame before the screenshot; a clip that errors or never lands is reported, not awaited forever.
          (await pendingVideoSeeks()).forEach(fail);
          const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("[data-render-root] img"));
          // A broken image is tolerated: the frame shows what the browser shows; the CLI warns once.
          await Promise.all(imgs.map((img) => img.decode().catch(() => fail(img.currentSrc || img.src))));
          await document.fonts.ready;
          if (needsFullRaster && root.current) {
            // A frame whose paint was only partly invalidated rasterised differently from a full
            // raster, so a stepped frame differed from the same frame jumped to: under a camera
            // transform (notes moving over zoomed art or objects), and in a camera-less deck whose note
            // sprites animate their own scale and opacity. A transient clip-path change forces the
            // whole stage to re-raster, so every such frame is a full raster whatever came before.
            // Two frames: a rAF callback runs before its own frame paints, so one would clear the clip
            // before any frame had painted with it.
            root.current.style.clipPath = "inset(0.5px)";
            await nextFrame(); await nextFrame();
            root.current.style.clipPath = "";
          }
          await nextFrame(); await nextFrame();
          return { failed: unreported.splice(0) };
        },
      };
    });
    return () => { live = false; delete window.__morganaRender; };
  }, [apply, layout.total, assets, needsFullRaster]);
  return <div ref={root} data-render-root style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000", containerType: "size" }}>
    {/* A note deck's sprites (and art layers) drop their will-change hints here, /render only, so
        each full raster re-rasters them too (a hinted layer keeps its own raster across the clip).
        Camera decks already drop them in DeckStage; /play and the editor keep them. Both halves are
        needed: the hint drop alone or the clip alone still differed stepped vs jumped. */}
    {hasNotes && !hasCamera && <style>{`html[data-render="1"] [data-render-root] .artstage__layer, html[data-render="1"] [data-render-root] .notefield__stage > * { will-change: auto !important; }`}</style>}
    {stage}</div>;
}
