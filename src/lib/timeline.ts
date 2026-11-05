import type { Segment, Visual } from "./types";

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface TimedSegment {
  index: number;
  text: string;
  start: number;
  end: number;
  words: TimedWord[];
  visual: Visual | null;
}

/** The one tokenisation of narration text into words — pipeline timings and the player must agree on it. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Relative "speaking cost" of a word: characters plus a pause after punctuation. */
export function wordWeight(w: string): number {
  let weight = Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length) + 1.5;
  if (/[.!?]["')\]]?$/.test(w)) weight += 6;
  else if (/[,;:—–-]["')\]]?$/.test(w)) weight += 3;
  if (/\d/.test(w)) weight += w.length * 0.8; // numbers are read out longer than they look
  return weight;
}

/**
 * Distribute narration time across segments and words, proportional to speaking cost.
 * TTS gives us no word timestamps, so this estimate (with a small lead-in) keeps captions
 * visually locked to the voice within a few hundred ms for typical scripts.
 */
export function buildTimeline(segments: Segment[], totalSec: number, leadIn = 0.15): TimedSegment[] {
  const segWords = segments.map((s) => s.text.split(/\s+/).filter(Boolean));
  const segCost = segWords.map((ws) => ws.reduce((a, w) => a + wordWeight(w), 0) + 4);
  const total = segCost.reduce((a, b) => a + b, 0) || 1;
  const usable = Math.max(0.1, totalSec - leadIn);
  let t = leadIn;
  return segments.map((s, i) => {
    const segDur = (segCost[i] / total) * usable;
    const start = i === 0 ? 0 : t;
    const end = t + segDur;
    const inner = segDur * (1 - 4 / segCost[i]);
    const wTotal = segWords[i].reduce((a, w) => a + wordWeight(w), 0) || 1;
    let wt = t;
    const words = segWords[i].map((w) => {
      const d = (wordWeight(w) / wTotal) * inner;
      const word = { text: w, start: wt, end: wt + d };
      wt += d;
      return word;
    });
    t = end;
    return { index: i, text: s.text, start, end, words, visual: s.visual ?? null };
  });
}

export function segmentIndexAt(tl: TimedSegment[], t: number): number {
  if (tl.length === 0) return -1;
  for (let i = tl.length - 1; i >= 0; i--) if (t >= tl[i].start) return i;
  return 0;
}

export function wordIndexAt(seg: TimedSegment, t: number): number {
  for (let i = seg.words.length - 1; i >= 0; i--) if (t >= seg.words[i].start) return i;
  return -1;
}

/** Split words into caption "lines" so captions stay big and readable. */
export function chunkWords<T extends { text: string }>(words: T[], maxWords = 5, maxChars = 26): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const w of words) {
    if (cur.length && (cur.length >= maxWords || chars + w.text.length > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(w);
    chars += w.text.length + 1;
    if (/[.!?]$/.test(w.text) && cur.length >= 2) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The visual that should be on screen for segment i: the latest non-null one so far. */
export function activeVisual(tl: TimedSegment[], i: number): { visual: Visual | null; from: number } {
  for (let k = i; k >= 0; k--) if (tl[k]?.visual) return { visual: tl[k].visual, from: k };
  return { visual: null, from: -1 };
}
