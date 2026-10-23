import { describe, expect, test } from "vitest";
import { frameTimes, parseRenderArgs, RenderArgError } from "@/lib/render/args";

const USAGE = "Usage: npm run render -- --deck <id> --out <file.mp4>";
const base = ["--deck", "alt", "--out", "a.mp4"];

function usageError(argv: string[]) {
  let err: unknown;
  try {
    parseRenderArgs(argv);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(RenderArgError);
  expect((err as Error).message).toContain(USAGE);
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
    usageError(["--out", "a.mp4"]);
    usageError(["--deck", "alt"]);
  });

  test("fps must be a positive number", () => {
    usageError([...base, "--fps", "abc"]);
    usageError([...base, "--fps", "0"]);
    usageError([...base, "--fps", "-5"]);
    usageError([...base, "--fps", "Infinity"]);
  });

  test("width/height must be positive integers", () => {
    usageError([...base, "--width", "0"]);
    usageError([...base, "--width", "-1920"]);
    usageError([...base, "--width", "19.5"]);
    usageError([...base, "--height", "abc"]);
    usageError([...base, "--height", "720.5"]);
  });

  test("from must be finite and >= 0", () => {
    usageError([...base, "--from", "-1"]);
    usageError([...base, "--from", "NaN"]);
    usageError([...base, "--from", "x"]);
  });

  test("--to must be a finite number greater than --from", () => {
    usageError([...base, "--from", "5", "--to", "5"]);
    usageError([...base, "--from", "5", "--to", "4"]);
    usageError([...base, "--to", "abc"]);
  });

  test("unknown flag and missing flag value throw with usage", () => {
    usageError([...base, "--bogus", "1"]);
    usageError([...base, "--fps"]);
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
    // (0.3 - 0.1) * 10 = 2.0000000000000004 in floating point
    expect(frameTimes(0.1, 0.3, 10)).toHaveLength(2);
  });

  test("T is from + i/fps, not accumulated", () => {
    const t = frameTimes(10, 20, 30);
    expect(t).toHaveLength(300);
    expect(t[299]).toBe(10 + 299 / 30);
  });
});
