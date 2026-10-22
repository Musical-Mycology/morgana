"use client";
import Link from "next/link";
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { withBasePath } from "@/lib/base-path";

/** Persists the editor's pending (debounced) edits — the editor page provides useAutosave's
 *  `flush`. Absent (null) outside the editor page: the link then just opens the player. */
export const FlushSaveContext = createContext<(() => Promise<void>) | null>(null);

/** "Play deck" / "Play from here". The Player loads the deck from disk, so an edit still inside
 *  the autosave debounce would be missing: save first, then open. A failed save is logged and the
 *  player opens anyway (showing the last saved version). The real `href` stays on the anchor for
 *  copy-link / middle-click. */
export function PlayLink({ href, testId, children }: { href: string; testId: string; children: ReactNode }) {
  const flush = useContext(FlushSaveContext);
  const onClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    try {
      await flush?.();
    } catch (err) {
      console.error("save before play failed; opening the last saved version", err);
    }
    window.open(withBasePath(href), "_blank");
  };
  return (
    <Link className="ed__pill ed__pill--ghost" data-testid={testId} href={href} target="_blank" onClick={onClick}>
      {children}
    </Link>
  );
}
