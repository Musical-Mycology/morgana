import type { Beat } from "@/engine/deck/types";

export const sampleBeat: Beat = {
  id: "spike",
  timeline: [
    { kind: "text", value: "We grow a network", in: "flyUp" },
    { kind: "note_emitter", color: "#E3F84F", pos: { x: 0.5, y: 0.55 }, dir: 0, var: 40, decay: 1400, freq: 6 },
    { kind: "wait", ms: 300 },
    { kind: "text", value: "to make music.", in: "fade" },
    { kind: "art", art: { to: "3.03", mode: "fade" } },
  ],
};
