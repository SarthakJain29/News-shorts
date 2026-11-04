import { describe, expect, it } from "vitest";
import { activeVisual, buildTimeline, chunkWords, segmentIndexAt, wordIndexAt } from "../src/lib/timeline";

const segs = [
  { text: "Short one.", visual: { kind: "headline" as const, text: "Hi" } },
  { text: "This second segment is quite a lot longer than the first one, with a pause, and more words." },
  { text: "Third." },
];

describe("buildTimeline", () => {
  const tl = buildTimeline(segs, 20);
  it("covers the full duration contiguously", () => {
    expect(tl[0].start).toBe(0);
    expect(tl[2].end).toBeCloseTo(20, 5);
    for (let i = 1; i < tl.length; i++) expect(tl[i].start).toBeCloseTo(tl[i - 1].end, 5);
  });
  it("allocates time proportional to speaking cost", () => {
    expect(tl[1].end - tl[1].start).toBeGreaterThan((tl[0].end - tl[0].start) * 3);
  });
  it("orders words within their segment", () => {
    for (const s of tl)
      for (const w of s.words) {
        expect(w.start).toBeGreaterThanOrEqual(s.start - 1e-9);
        expect(w.end).toBeLessThanOrEqual(s.end + 1e-9);
      }
  });
  it("finds the current segment and word", () => {
    expect(segmentIndexAt(tl, 0)).toBe(0);
    expect(segmentIndexAt(tl, tl[1].start + 0.01)).toBe(1);
    expect(segmentIndexAt(tl, 999)).toBe(2);
    expect(wordIndexAt(tl[1], tl[1].words[3].start + 0.001)).toBe(3);
  });
  it("keeps the last visual on screen", () => {
    expect(activeVisual(tl, 2)).toEqual({ visual: segs[0].visual, from: 0 });
  });
});

describe("chunkWords", () => {
  it("breaks lines at sentence ends and length limits", () => {
    const words = "One two three four five six seven. Eight nine".split(" ").map((text) => ({ text }));
    expect(chunkWords(words, 5).map((l) => l.map((w) => w.text).join(" "))).toEqual(["One two three four five", "six seven.", "Eight nine"]);
  });
});
