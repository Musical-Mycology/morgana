import { expect, test } from "@playwright/test";

const id = "e2e-soundtrack";
const missing = "e2e-soundtrack-missing";

// Throwaway decks (and their media) go even when an assertion fails mid-test.
test.afterEach(async ({ request }) => {
  await request.delete(`/api/decks/${id}`);
  await request.delete(`/api/decks/${missing}`);
});

/** A mono 16-bit PCM WAV: `secs` of a 440 Hz sine at 8 kHz. */
function sineWav(secs: number): Buffer {
  const rate = 8000, n = rate * secs, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test("upload a soundtrack, see its waveform, and play it in the Player", async ({ page, request }) => {
  await request.delete(`/api/decks/${id}`);
  await request.post("/api/decks", { data: { id, title: "Soundtrack" } });
  const up = await request.post(`/api/decks/${id}/media`, { multipart: { file: { name: "tone.wav", mimeType: "audio/wav", buffer: sineWav(3) } } });
  expect(up.status()).toBe(201);
  const media = await up.json();
  const doc = { version: 1, meta: { id, title: "Soundtrack", timing: { targetSec: 3 }, soundtrack: { media: media.id },
    markers: [{ id: "m1", label: "drop", t: 1.5 }] }, scenes: [
    { id: "s", durationSec: 3, beats: [{ id: "b", timeline: [{ kind: "text", value: "Hello", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  ] };
  expect((await request.put(`/api/decks/${id}`, { data: doc })).status()).toBe(200);

  // Editor: settings show the track, the ruler draws the waveform + marker.
  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("deck-settings-toggle").click();
  await expect(page.getByTestId("soundtrack-name")).toHaveText("tone.wav");
  await expect(page.getByTestId("soundtrack-duration")).toHaveText("0:03");
  await expect(page.getByTestId("deck-ruler").getByTestId("timebar-waveform")).toBeVisible();
  await expect(page.getByTestId("deck-ruler").getByTestId("timebar-marker")).toHaveAttribute("title", "drop");

  // Player: waveform, track decoded (no loading/error notice), and Play is driven by the AUDIO clock
  // (data-clock="audio" — the stall-guard timer would report "timer"), which then advances.
  await page.goto(`/play?deck=${id}`);
  await expect(page.getByTestId("play-scrub").getByTestId("timebar-waveform")).toBeVisible();
  await expect(page.getByTestId("play-mute")).toBeVisible(); // soundtrack status is no longer "none"
  await expect(page.getByTestId("play-audio-status")).toHaveCount(0); // ready: neither loading nor error
  await page.keyboard.press(" ");
  // The audio context starts ~170 ms after the gesture; until then the picture holds, so poll.
  await expect(page.getByTestId("play-clock")).toHaveAttribute("data-clock", "audio", { timeout: 5000 });
  await expect.poll(async () => (await page.getByTestId("play-clock").textContent()) ?? "", { timeout: 5000 })
    .toMatch(/^0:0[1-3]\.\d/);
  // The clock is past 0:01 (beyond the 0.5 s stall-grace window): the audio must STILL be driving —
  // a stall-guard takeover would read "timer".
  await expect(page.getByTestId("play-clock")).toHaveAttribute("data-clock", "audio");

  await request.delete(`/api/decks/${id}`);
  expect((await request.get(`/api/decks/${id}/media/${media.id}`)).status()).toBe(404); // media went with the deck
});

test("a missing soundtrack file plays silently with a notice", async ({ page, request }) => {
  await request.delete(`/api/decks/${missing}`);
  await request.post("/api/decks", { data: { id: missing, title: "Missing" } });
  await request.put(`/api/decks/${missing}`, { data: { version: 1, meta: { id: missing, title: "Missing", soundtrack: { media: "ffffffffffffffff.mp3" } },
    scenes: [{ id: "s", durationSec: 2, beats: [{ id: "b", timeline: [{ kind: "wait", ms: 500 }] }] }] } });
  await page.goto(`/play?deck=${missing}`);
  await expect(page.getByTestId("play-audio-status")).toHaveText("Soundtrack unavailable — playing silent");
  await page.keyboard.press(" ");
  await expect.poll(async () => (await page.getByTestId("play-clock").textContent()) ?? "").not.toBe("0:00.0 / 0:02");
  await expect(page.getByTestId("play-clock")).toHaveAttribute("data-clock", "timer"); // no audio: the timer drives
});
