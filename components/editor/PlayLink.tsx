"use client";
import Link from "next/link";
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { withBasePath } from "@/lib/base-path";

/** Persists the editor's pending (debounced) edits — the editor page provides useAutosave's
 *  `flush`. Absent (null) outside the editor page: the link then just opens the player. */
export const FlushSaveContext = createContext<(() => Promise<void>) | null>(null);

/** Same-tab fallback, behind an object so tests can stub it (jsdom can't navigate). */
export const playNavigation = { sameTab: (url: string) => window.location.assign(url) };

/** "Play deck" / "Play from here". The Player loads the deck from disk, so an edit still inside
 *  the autosave debounce would be missing: save first, then open. A failed save is logged and the
 *  player opens anyway (showing the last saved version). The real `href` stays on the anchor for
 *  copy-link / middle-click.
 *
 *  The tab is opened SYNCHRONOUSLY in the click and only pointed at the player after the save:
 *  Safari drops the user gesture across an `await`, so a `window.open` after the save would be
 *  popup-blocked and Play would silently do nothing. If the browser blocks even the synchronous
 *  open, the player opens in this tab (the edits are saved by then). Modifier-clicks are left to
 *  the browser so Cmd/Ctrl-click still means "background tab"; they flush without waiting. */
export function PlayLink({ href, testId, children }: { href: string; testId: string; children: ReactNode }) {
  const flush = useContext(FlushSaveContext);
  const onClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      void flush?.().catch(() => {});
      return;
    }
    e.preventDefault();
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      await flush?.();
    } catch (err) {
      console.error("save before play failed; opening the last saved version", err);
    }
    const url = withBasePath(href);
    if (tab) tab.location.href = url;
    else playNavigation.sameTab(url);
  };
  return (
    <Link className="ed__pill ed__pill--ghost" data-testid={testId} href={href} target="_blank" onClick={onClick}>
      {children}
    </Link>
  );
}
