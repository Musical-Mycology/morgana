"use client";
import { useEffect, useLayoutEffect } from "react";
import type { DeckDoc } from "@/engine/deck-doc";
import { useDeckStage } from "./DeckStage";

declare global {
  interface Window {
    /** Set by the /render page. The MP4 CLI waits for `ready`, then steps frames with renderFrame(T). */
    __morganaRender?:
      | { ready: true; total: number; renderFrame(T: number): Promise<void> }
      | { ready: false; error: string };
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Chrome-free, fixed-size stage for the MP4 renderer (spec §3). The CLI calls
 *  window.__morganaRender.renderFrame(T) and screenshots only after it resolves. */
export function RenderStage({ doc }: { doc: DeckDoc }) {
  const { apply, layout, stage } = useDeckStage(doc, 0);
  useLayoutEffect(() => {
    document.documentElement.dataset.render = "1";
    return () => { delete document.documentElement.dataset.render; };
  }, []);
  useEffect(() => {
    window.__morganaRender = {
      ready: true,
      total: layout.total,
      async renderFrame(T: number) {
        apply(T);
        await nextFrame();                                   // React commits a beat swap; layout effect seeks
        const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("[data-render-root] img"));
        await Promise.all(imgs.map((img) => img.decode().catch(() => { /* broken image: render what the browser shows */ })));
        await document.fonts.ready;
        await nextFrame(); await nextFrame();
      },
    };
    return () => { delete window.__morganaRender; };
  }, [apply, layout.total]);
  return <div data-render-root style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000", containerType: "size" }}>{stage}</div>;
}
