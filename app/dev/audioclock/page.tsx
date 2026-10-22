"use client";
import { useState } from "react";
import { createSoundtrack } from "@/lib/audio/soundtrack";

// Gate for the soundtrack sub-project (plan Task 1): does the Web Audio clock advance in the
// e2e browser? Builds a 3 s, 440 Hz buffer in-page (no upload), plays it, reports now() after 600 ms.
export default function Page() {
  const [result, setResult] = useState("idle");
  const run = () => {
    const ctx = new AudioContext();
    const rate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, rate * 3, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / rate);
    const st = createSoundtrack(buf, ctx);
    st.play(0);
    setTimeout(() => { setResult(`now=${(st.now() ?? -1).toFixed(3)} state=${ctx.state}`); st.dispose(); }, 600);
  };
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <button data-testid="audio-run" onClick={run}>Run</button>
      <output data-testid="audio-now" style={{ marginLeft: 12 }}>{result}</output>
    </main>
  );
}
