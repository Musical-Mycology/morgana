"use client";

import { memo, useEffect, useMemo, useState } from "react";
import Particles from "@tsparticles/react";
import { ensureEngine } from "@/engine/engine";
import { paletteFor } from "@/engine/deck/nightlight";
import { sporeOptions, burstOptions } from "./effects/spores";

const StableParticles = memo(Particles);

interface Props {
  /** Live (possibly mid-tween) nightlight for the background + glow. */
  nightlight: number;
  /** Settled destination nightlight that keys the spore palette. */
  sporeNightlight: number;
  /** Whether spores should render at all. */
  spores: boolean;
  /** Whether the warm radial glow should render. */
  glow: boolean;
  /** Whether the one-shot spore burst should fire. */
  burst: boolean;
  /** Reduced-motion: skip particles. */
  reduced: boolean;
}

export function Atmosphere({ nightlight, sporeNightlight, spores, glow, burst, reduced }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (reduced) return;
    ensureEngine({ emitters: true }).then(() => setReady(true));
  }, [reduced]);

  const palette = paletteFor(nightlight);
  const options = useMemo(() => sporeOptions(sporeNightlight), [sporeNightlight]);
  const burstOpts = useMemo(() => burstOptions(sporeNightlight), [sporeNightlight]);

  return (
    <div aria-hidden="true" className="atmo" style={{ background: `linear-gradient(180deg, ${palette.bgTop}, ${palette.bgBottom})` }}>
      {spores && ready && !reduced && (
        <StableParticles id="deck-spores" className="atmo__spores" options={options} />
      )}
      {burst && ready && !reduced && (
        <StableParticles id="deck-burst" className="atmo__spores" options={burstOpts} />
      )}
      {glow && <div className="atmo__glow" style={{ opacity: palette.glow * 0.5 }} />}
      <style>{`
        .atmo { position: absolute; inset: 0; overflow: hidden; transition: background 120ms linear; }
        .atmo__spores { position: absolute; inset: 0; }
        .atmo__glow {
          position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(60% 50% at 50% 55%, rgba(232,189,90,0.5), transparent 70%);
        }
        @media (prefers-reduced-motion: reduce) { .atmo { transition: none; } }
      `}</style>
    </div>
  );
}
