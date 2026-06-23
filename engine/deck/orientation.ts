/** Which of the deck's three render states applies, given device capabilities. */
export type DeckView = "measuring" | "overlay" | "deck";

/**
 * Decide what the deck should render:
 *  - "measuring": orientation not yet read on the client (`portrait === null`) — avoids an
 *    SSR/CSR flash of the wrong state on first paint.
 *  - "overlay":   coarse pointer AND portrait → show the rotate-your-device overlay.
 *  - "deck":      everything else (any fine pointer, or any landscape) → the real deck.
 */
export function resolveDeckView(state: { coarse: boolean; portrait: boolean | null }): DeckView {
  if (state.portrait === null) return "measuring";
  return state.coarse && state.portrait ? "overlay" : "deck";
}
