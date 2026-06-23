export interface TimelineLockState {
  /** The landed slide is a cinematic beat — the only layout with an auto-played timeline. */
  isCinematic: boolean;
  /** prefers-reduced-motion / hidden tab: the beat renders its settled end-state instantly. */
  reduced: boolean;
  /** The engine reported the beat settled ("waiting for the user"). False while auto-playing. */
  waiting: boolean;
  /** The beat is paused at a click_gate — forward input should resume it, not skip ahead. */
  gated: boolean;
  /** This beat reveals its own nav arrows (has a reveal_arrows action) and controls their
   *  timing itself — e.g. the intro. Exempt from the lock so it can show the arrows and accept
   *  forward input on its own schedule. */
  selfRevealsArrows: boolean;
}

/**
 * True while a cinematic beat's timeline is actively auto-playing — the window in which forward
 * input is suppressed (and the nav arrows hidden) so the animation can't be skipped. Beats that
 * reveal their own arrows (selfRevealsArrows) are exempt: they manage arrow visibility and
 * advancement themselves.
 */
export function timelineLocked(s: TimelineLockState): boolean {
  return s.isCinematic && !s.reduced && !s.waiting && !s.gated && !s.selfRevealsArrows;
}
