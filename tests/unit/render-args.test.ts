import { describe, expect, test } from "vitest";
import { frameTimes, parseRenderArgs, RenderArgError } from "@/lib/render/args";

const USAGE = "Usage: npm run render -- --deck <id> --out <file.mp4>";
const base = ["--deck", "alt", "--out", "a.mp4"];

function usageError(argv: string[], reason?: RegExp) {
  let err: unknown;
  try {
    parseRenderArgs(argv);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(RenderArgError);
  expect((err as Error).message).toContain(USAGE);
  if (reason) expect((err as Error).message).toMatch(reason);
}

describe("parseRenderArgs", () => {
  test("defaults", () => {
    expect(parseRenderArgs(base)).toEqual({
      deck: "alt",
      out: "a.mp4",
      baseUrl: "http://localhost:3000",
      fps: 30,
      width: 1920,
      height: 1080,
      from: 0,
      to: undefined,
    });
  });

  test("all flags parsed, trailing slash stripped from base url", () => {
    expect(
      parseRenderArgs([
        ...base,
        "--fps", "60",
        "--width", "3840",
        "--height", "2160",
        "--from", "10",
        "--to", "20",
        "--base-url", "http://h/morgana/",
      ]),
    ).toEqual({
      deck: "alt",
      out: "a.mp4",
      baseUrl: "http://h/morgana",
      fps: 60,
      width: 3840,
      height: 2160,
      from: 10,
      to: 20,
    });
  });

  test("missing --deck / --out throws with usage", () => {
    usageError(["--out", "a.mp4"], /--deck/);
    usageError(["--deck", "alt"], /--out/);
  });

  test("fps must be a positive number", () => {
    usageError([...base, "--fps", "abc"], /fps/i);
    usageError([...base, "--fps", "0"], /fps/i);
    usageError([...base, "--fps", "-5"], /fps/i);
    usageError([...base, "--fps", "Infinity"], /fps/i);
  });

  test("width/height must be positive integers", () => {
    usageError([...base, "--width", "0"], /width/i);
    usageError([...base, "--width", "-1920"], /width/i);
    usageError([...base, "--width", "19.5"], /width/i);
    usageError([...base, "--height", "abc"], /height/i);
    usageError([...base, "--height", "720.5"], /height/i);
  });

  test("width/height must be even (H.264 yuv420p)", () => {
    usageError([...base, "--width", "1921"], /even/i);
    usageError([...base, "--height", "1081"], /even/i);
  });

  test("from must be finite and >= 0", () => {
    usageError([...base, "--from", "-1"], /from/i);
    usageError([...base, "--from", "NaN"], /from/i);
    usageError([...base, "--from", "x"], /from/i);
  });

  test("--to must be a finite number greater than --from", () => {
    usageError([...base, "--from", "5", "--to", "5"], /--to/);
    usageError([...base, "--from", "5", "--to", "4"], /--to/);
    usageError([...base, "--to", "abc"], /--to/);
  });

  test("unknown flag and missing flag value throw with usage", () => {
    usageError([...base, "--bogus", "1"], /Unknown argument: --bogus/);
    usageError([...base, "--fps"], /--fps requires a value/);
  });

  test("a flag-like token is not accepted as a value", () => {
    usageError(["--deck", "--out", "a.mp4"], /--deck requires a value/);
    usageError([...base, "--base-url", "--fps", "10"], /--base-url requires a value/);
  });

  test("repeated flags are rejected", () => {
    usageError([...base, "--fps", "10", "--fps", "20"], /Duplicate argument: --fps/);
  });

  test("base url normalisation", () => {
    expect(parseRenderArgs([...base, "--base-url", "http://h//"]).baseUrl).toBe("http://h");
    expect(parseRenderArgs([...base, "--base-url", "http://h/morgana"]).baseUrl).toBe("http://h/morgana");
    usageError([...base, "--base-url", "/"], /base-url/);
    usageError([...base, "--base-url", ""], /base-url/);
  });
});

describe("frameTimes", () => {
  test("0..2 at 10fps is 20 frames", () => {
    const t = frameTimes(0, 2, 10);
    expect(t).toHaveLength(20);
    t.forEach((v, i) => expect(v).toBeCloseTo(i / 10, 9));
    expect(t[19]).toBeCloseTo(1.9, 9);
  });

  test("partial range", () => {
    const t = frameTimes(1, 1.25, 4);
    expect(t).toHaveLength(1);
    expect(t[0]).toBeCloseTo(1, 9);
  });

  test("fractional tail rounds up", () => {
    expect(frameTimes(0, 2.05, 10)).toHaveLength(21);
  });

  test("float drift does not add an extra frame (epsilon pinned)", () => {
    // Raw products that drift UP past an integer: (0.4 - 0.1) * 10 = 3.0000000000000004 and
    // (0.8 - 0.1) * 10 = 7.000000000000001; without the epsilon ceil() gives 4 and 8.
    expect(frameTimes(0.1, 0.4, 10)).toHaveLength(3);
    expect(frameTimes(0.1, 0.8, 10)).toHaveLength(7);
    // Drifting down was already safe; kept as a sanity check.
    expect(frameTimes(0.1, 0.3, 10)).toHaveLength(2);
  });

  test("T is from + i/fps, not accumulated", () => {
    const t = frameTimes(10, 20, 30);
    expect(t).toHaveLength(300);
    expect(t[299]).toBe(10 + 299 / 30);
  });
});
