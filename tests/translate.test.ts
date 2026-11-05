import { describe, expect, it } from "vitest";
import { devanagariRatio, localize } from "../src/lib/i18n";
import { draftToTranslation, mergeVisual } from "../pipeline/translate";
import type { Short } from "../src/lib/types";
import { short } from "./fixtures";

const en: Short = short({
  segments: [
    { text: "Binance lost $6.3bn.", visual: { kind: "number", value: "$6.3bn", label: "Stolen" } },
    { text: "It happened in Malta.", visual: { kind: "map", place: "Malta", lat: 35.9, lon: 14.4 } },
    { text: "Staff were targeted.", visual: { kind: "chart", title: "Staff", bars: [{ label: "A", value: 3 }, { label: "B", value: 5 }] } },
    { text: "More soon.", visual: null },
  ],
  coverage: [{ outlet: "BBC News", angle: "Focus on the lure.", url: "https://bbc.co.uk" }],
  coverageSummary: { agreement: "All agree.", differences: "Emphasis differs." },
});

const hiText = "बाइनेंस ने छह दशमलव तीन अरब डॉलर गँवाए। ".repeat(8);
const draft = (over: object = {}) => ({
  title: "बाइनेंस में सेंध",
  hook: "एक नकली नौकरी इंटरव्यू से शुरू हुई कहानी",
  segments: [
    { text: hiText, visual: { kind: "number", value: "$6.3bn", label: "चोरी हुई रकम" } },
    { text: hiText, visual: { kind: "map", place: "माल्टा", lat: 0, lon: 0 } },
    { text: hiText, visual: { kind: "chart", title: "कर्मचारी", bars: [{ label: "ए", value: 99 }, { label: "बी", value: 5 }] } },
    { text: hiText, visual: null },
  ],
  whyItMatters: "इससे भरोसा हिलता है।",
  context: "बाइनेंस एक बड़ा एक्सचेंज है।",
  coverage: [{ outlet: "BBC News", angle: "नकली भर्ती पर ज़ोर।", emphasis: "भर्ती का जाल" }, { outlet: "Nobody", angle: "x" }],
  agreement: "सभी सहमत हैं।",
  differences: "ज़ोर अलग है।",
  ...over,
});

describe("mergeVisual", () => {
  it("accepts translated labels but pins numbers and coordinates to the originals", () => {
    expect(mergeVisual(en.segments[0].visual, draft().segments[0].visual)).toEqual({ kind: "number", value: "$6.3bn", label: "चोरी हुई रकम" });
    expect(mergeVisual(en.segments[1].visual, draft().segments[1].visual)).toEqual({ kind: "map", place: "माल्टा", lat: 35.9, lon: 14.4 });
  });
  it("keeps the English visual when the model altered the numbers or kind", () => {
    expect(mergeVisual(en.segments[2].visual, draft().segments[2].visual)).toEqual(en.segments[2].visual); // 99 ≠ 3
    expect(mergeVisual(en.segments[0].visual, { kind: "headline", text: "x" })).toEqual(en.segments[0].visual);
    expect(mergeVisual(null, { kind: "headline", text: "x" })).toBeNull();
  });
});

describe("draftToTranslation", () => {
  it("builds a translation with sourced coverage", () => {
    const t = draftToTranslation(draft(), en, "groq");
    expect(t.segments).toHaveLength(4);
    expect(t.coverage).toEqual([{ outlet: "BBC News", angle: "नकली भर्ती पर ज़ोर।", url: "https://bbc.co.uk", emphasis: "भर्ती का जाल" }]);
    expect(t.coverageSummary?.agreement).toBe("सभी सहमत हैं।");
    expect(t.audio).toBeNull();
  });
  it("rejects wrong segment counts and non-Hindi text", () => {
    expect(() => draftToTranslation(draft({ segments: draft().segments.slice(0, 2) }), en, "groq")).toThrow(/segments/);
    const latin = draft().segments.map((s) => ({ ...s, text: "This is plainly English text. ".repeat(10) }));
    expect(() => draftToTranslation(draft({ segments: latin }), en, "groq")).toThrow(/Hindi enough/);
  });
});

describe("localize", () => {
  const withHi: Short = { ...en, i18n: { hi: { ...draftToTranslation(draft(), en, "groq"), audio: { src: "/audio/hi.mp3", durationSec: 90, model: "m", voice: "v" } } } };
  it("swaps text and narration for the requested language and keeps ids and sources", () => {
    const hi = localize(withHi, "hi");
    expect(hi.lang).toBe("hi");
    expect(hi.title).toBe("बाइनेंस में सेंध");
    expect(hi.audio?.src).toBe("/audio/hi.mp3");
    expect(hi.id).toBe(en.id);
    expect(hi.sources).toBe(en.sources);
  });
  it("falls back to English when there is no translation", () => {
    expect(localize(en, "hi").lang).toBe("en");
    expect(localize(withHi, "en").title).toBe(en.title);
  });
  it("measures Devanagari share", () => {
    expect(devanagariRatio("नमस्ते दुनिया")).toBe(1);
    expect(devanagariRatio("hello")).toBe(0);
    expect(devanagariRatio("")).toBe(0);
  });
});
