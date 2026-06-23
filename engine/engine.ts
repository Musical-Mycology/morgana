import { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import { loadEmittersPlugin } from "@tsparticles/plugin-emitters";

/** Options for {@link ensureEngine}. */
export interface EnsureEngineOptions {
  /**
   * Also load the emitters plugin (needed for one-shot spore bursts). Slim is
   * always loaded; emitters is opt-in so consumers that don't need it don't
   * pay for it. Default `false`.
   */
  emitters?: boolean;
}

// Single shared tsParticles engine init for the whole app. Both the home-hero
// spore field and the deck atmosphere drive the same global engine, so init
// must be guaranteed-once with an explicit plugin set.
//
// Module state survives client-side route changes, so the plugin sets are
// tracked as independent once-promises: `slim` always loads; `emitters` chains
// AFTER slim and only when first requested. Chaining (rather than a fixed
// up-front set) means a later `emitters: true` caller still gets emitters even
// if an earlier slim-only caller — e.g. navigating `/` → `/presentation` —
// initialized the engine first.
let slimPromise: Promise<void> | null = null;
let emittersPromise: Promise<void> | null = null;

/**
 * Lazily initialize the shared tsParticles engine, loading the plugins the
 * caller needs (slim always; emitters opt-in via {@link EnsureEngineOptions}).
 * Safe to call repeatedly: each plugin set loads at most once. Resolves once
 * the requested plugins are registered.
 */
export function ensureEngine(opts?: EnsureEngineOptions): Promise<void> {
  if (!slimPromise) {
    slimPromise = initParticlesEngine((engine) => loadSlim(engine));
  }
  if (opts?.emitters) {
    if (!emittersPromise) {
      emittersPromise = slimPromise.then(() =>
        initParticlesEngine((engine) => loadEmittersPlugin(engine))
      );
    }
    return emittersPromise;
  }
  return slimPromise;
}
