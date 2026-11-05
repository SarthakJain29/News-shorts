import { describe, expect, it } from "vitest";
import { buildWordTimes, matchWords, normWord, wordSimilarity } from "../pipeline/align";

describe("word similarity", () => {
  it("normalises punctuation, case and combining marks", () => {
    expect(normWord("“Hello,”")).toBe("hello");
    expect(normWord("बनी।")).toBe("बनी");
  });
  it("tolerates ASR spelling and number formatting", () => {
    expect(wordSimilarity("Binance", "binance.")).toBe(1);
    expect(wordSimilarity("intruders", "intruder")).toBeGreaterThan(0.8);
    expect(wordSimilarity("$6.3bn", "$6.3")).toBeGreaterThanOrEqual(0.7);
    expect(wordSimilarity("cat", "dog")).toBe(0);
    expect(wordSimilarity("a", "an")).toBe(0); // too short to trust fuzzy matching
  });
});

describe("matchWords", () => {
  it("matches in order and leaves extras unmatched", () => {
    const script = "the attack began in June".split(" ");
    const heard = "um the attack began in june yes".split(" ");
    expect(matchWords(script, heard)).toEqual([1, 2, 3, 4, 5]);
  });
  it("skips script words the recogniser missed", () => {
    expect(matchWords("alpha beta gamma delta".split(" "), ["alpha", "gamma", "delta"])).toEqual([0, -1, 1, 2]);
  });
});

describe("buildWordTimes", () => {
  const segments = ["Alpha beta gamma.", "Delta epsilon zeta eta."];
  const segmentTimes: [number, number][] = [[0, 3], [3, 7]];
  const heard = [
    { word: "Alpha", start: 0.1, end: 0.5 },
    { word: "beta", start: 0.6, end: 1.0 },
    { word: "gamma", start: 1.1, end: 1.7 },
    { word: "Delta", start: 3.2, end: 3.6 },
    { word: "epsilon", start: 3.7, end: 4.4 },
    { word: "zeta", start: 4.5, end: 5.0 },
    { word: "eta", start: 5.1, end: 5.5 },
  ];

  it("uses recognised timings when everything matches", () => {
    const r = buildWordTimes({ segments, heard, segmentTimes, duration: 7 });
    expect(r.matched).toBe(7);
    expect(r.mode).toBe("whisper");
    expect(r.times[0]).toEqual([0.1, 0.5]);
    expect(r.times[3]).toEqual([3.2, 3.6]);
  });

  it("interpolates a missed word between its neighbours", () => {
    const r = buildWordTimes({ segments, heard: heard.filter((h) => h.word !== "epsilon"), segmentTimes, duration: 7 });
    expect(r.matched).toBe(6);
    const [s, e] = r.times[4];
    expect(s).toBeGreaterThanOrEqual(r.times[3][1] - 1e-9);
    expect(e).toBeLessThanOrEqual(r.times[5][0] + 1e-9);
  });

  it("falls back to exact segment windows with no recognition", () => {
    const r = buildWordTimes({ segments, heard: null, segmentTimes, duration: 7 });
    expect(r.mode).toBe("segments");
    expect(r.times).toHaveLength(7);
    expect(r.times[0][0]).toBe(0);
    expect(r.times[3][0]).toBeGreaterThanOrEqual(3);
    expect(r.times[2][1]).toBeLessThanOrEqual(3);
  });

  it("keeps recognition errors inside their own segment", () => {
    // a stray recognised word from segment 2 inside segment 1's window must not pull words across the boundary
    const noisy = [{ word: "delta", start: 1.2, end: 1.4 }, ...heard];
    const r = buildWordTimes({ segments, heard: noisy, segmentTimes, duration: 7 });
    expect(r.times[3][0]).toBeGreaterThanOrEqual(3);
  });

  it("is monotonic and bounded by the duration", () => {
    const r = buildWordTimes({ segments, heard, segmentTimes, duration: 7 });
    for (let i = 1; i < r.times.length; i++) expect(r.times[i][0]).toBeGreaterThanOrEqual(r.times[i - 1][0]);
    expect(Math.max(...r.times.map((t) => t[1]))).toBeLessThanOrEqual(7);
  });

  it("aligns globally when segment boundaries are unknown", () => {
    const r = buildWordTimes({ segments, heard, segmentTimes: null, duration: 7 });
    expect(r.matched).toBe(7);
    expect(r.times[6]).toEqual([5.1, 5.5]);
  });
});
