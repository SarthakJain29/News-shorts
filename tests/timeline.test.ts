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

import { splitWords, visualCues } from "../src/lib/timeline";
import type { Segment } from "../src/lib/types";

describe("exact word timings", () => {
  const segments: Segment[] = [
    { text: "Binance lost billions.", visual: { kind: "headline", text: "Binance heist rewrites security" } },
    { text: "Hackers stole 6.3 billion dollars.", visual: { kind: "number", value: "$6.3bn", label: "Stolen" } },
    { text: "Staff were targeted.", visual: null },
  ];
  // 3 + 5 + 3 = 11 words
  const starts = [0.2, 0.6, 1.0, 2.0, 2.4, 2.9, 3.3, 3.8, 5.0, 5.4, 5.9];
  const wt = starts.flatMap((s) => [s, s + 0.3]);

  it("splits words the way the pipeline does", () => {
    expect(splitWords("  a  b\nc ")).toEqual(["a", "b", "c"]);
  });

  it("uses the real timings for words and derives segment boundaries from them", () => {
    const tl = buildTimeline(segments, 7, 0.15, wt);
    expect(tl[0].words.map((w) => w.start)).toEqual([0.2, 0.6, 1.0]);
    expect(tl[1].words[0].start).toBe(2.0);
    expect(tl[0].start).toBe(0);
    // each later segment starts just before its first word, never before the previous one's last word ends
    expect(tl[1].start).toBeCloseTo(2.0 - 0.12, 5);
    expect(tl[2].start).toBeCloseTo(5.0 - 0.12, 5);
    expect(tl[0].end).toBe(tl[1].start);
    expect(tl[2].end).toBe(7);
  });

  it("falls back to the estimate when timings don't match the words", () => {
    const est = buildTimeline(segments, 7, 0.15);
    expect(buildTimeline(segments, 7, 0.15, wt.slice(0, 10))).toEqual(est);
    expect(buildTimeline(segments, 7, 0.15, [])).toEqual(est);
  });
});

describe("visualCues", () => {
  const segments: Segment[] = [
    { text: "Binance lost billions to hackers.", visual: { kind: "headline", text: "Binance heist: the hackers" } },
    { text: "They stole 6.3 billion dollars.", visual: { kind: "number", value: "$6.3bn", label: "Stolen" } },
    { text: "Staff were targeted over months.", visual: { kind: "chart", title: "t", bars: [{ label: "a", value: 1 }, { label: "b", value: 2 }, { label: "c", value: 3 }] } },
  ];
  const n = segments.reduce((k, s) => k + splitWords(s.text).length, 0);
  const wt = Array.from({ length: n }, (_, i) => [i * 0.5, i * 0.5 + 0.3]).flat();
  const tl = buildTimeline(segments, n * 0.5 + 1, 0.15, wt);

  it("highlights headline words at the moment they are spoken", () => {
    const c = visualCues(tl, 0)!;
    // "Binance" is word 0 (t=0), "heist:" is never spoken, "the" is too short to cue, "hackers." is word 4 (t=2.0)
    expect(c.spoken[0]).toBe(0);
    expect(c.spoken[1]).toBeNull();
    expect(c.spoken[2]).toBeNull();
    expect(c.spoken[3]).toBe(2);
    expect(c.start).toBe(tl[0].start);
    expect(c.end).toBe(tl[0].end);
  });

  it("finds when a figure is said aloud", () => {
    const c = visualCues(tl, 1)!;
    expect(c.spoken[0]).toBe(tl[1].words[2].start); // "6.3"
  });

  it("staggers reveals across chart bars within the scene", () => {
    const c = visualCues(tl, 2)!;
    expect(c.reveal).toHaveLength(3);
    expect(c.reveal[0]).toBeGreaterThanOrEqual(c.start);
    expect(c.reveal[1]).toBeGreaterThan(c.reveal[0]);
    expect(c.reveal[2]).toBeGreaterThan(c.reveal[1]);
  });

  it("returns null for segments without a visual", () => {
    expect(visualCues(buildTimeline([{ text: "No visual here." }], 3), 0)).toBeNull();
  });
});
