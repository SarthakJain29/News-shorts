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
  let weight = Math.max(2, w.replace(/[^\p{L}\p{M}\p{N}]/gu, "").length) + 1.5;
  if (/[.!?।]["')\]]?$/.test(w)) weight += 6;
  else if (/[,;:—–-]["')\]]?$/.test(w)) weight += 3;
  if (/\d/.test(w)) weight += w.length * 0.8; // numbers are read out longer than they look
  return weight;
}

/** How long a visual appears before the first word of its segment is spoken. */
const VISUAL_LEAD = 0.12;

/** Timeline from exact per-word timings ([s0,e0,s1,e1…], from Whisper / segment-level TTS timing). */
function exactTimeline(segments: Segment[], totalSec: number, wt: number[]): TimedSegment[] {
  let k = 0;
  const raw = segments.map((s) =>
    splitWords(s.text).map((text) => {
      const w = { text, start: wt[2 * k], end: wt[2 * k + 1] };
      k++;
      return w;
    }),
  );
  const first = raw.map((ws, i) => ws[0]?.start ?? (i === 0 ? 0 : raw[i - 1].at(-1)?.end ?? 0));
  const last = raw.map((ws) => ws.at(-1)?.end ?? 0);
  // A segment starts just before its first word (so visuals land with the voice), never before the previous one ends.
  const starts = raw.map((_, i) => (i === 0 ? 0 : Math.min(first[i], Math.max(last[i - 1], first[i] - VISUAL_LEAD))));
  return segments.map((s, i) => ({ index: i, text: s.text, start: starts[i], end: i + 1 < segments.length ? starts[i + 1] : Math.max(totalSec, last[i]), words: raw[i], visual: s.visual ?? null }));
}

/** Estimate: spread narration time over segments and words by speaking cost. */
function estimatedTimeline(segments: Segment[], totalSec: number, leadIn: number): TimedSegment[] {
  const segWords = segments.map((s) => splitWords(s.text));
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

/**
 * Caption/visual timeline. With `wordTimes` (flat [start,end] pairs, one per word) captions and scenes follow the real
 * voice; otherwise (device voice, old data) timing is estimated from the text.
 */
export function buildTimeline(segments: Segment[], totalSec: number, leadIn = 0.15, wordTimes?: number[]): TimedSegment[] {
  const nWords = segments.reduce((n, s) => n + splitWords(s.text).length, 0);
  if (wordTimes && wordTimes.length === nWords * 2 && nWords > 0) return exactTimeline(segments, totalSec, wordTimes);
  return estimatedTimeline(segments, totalSec, leadIn);
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
    if (/[.!?।]$/.test(w.text) && cur.length >= 2) {
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

// ───────────────────────── visual cues ─────────────────────────

export interface VisualCues {
  /** When the visual appears. */
  start: number;
  /** When it is replaced (or the short ends). */
  end: number;
  /** Headline: per word, the moment the narrator says it (null = not spoken in this scene). Number: [moment the figure is spoken]. */
  spoken: (number | null)[];
  /** Chart bars / timeline items / compare sides: staggered reveal moments, spread over the scene. */
  reveal: number[];
}

const norm = (w: string) => w.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}]/gu, "");

function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  return n >= 5 && a.slice(0, 5) === b.slice(0, 5); // crude stem: "stole" / "stolen", "hack" / "hackers"
}

/**
 * Moments, derived from the real word timings, at which parts of the active visual should react.
 * `from` is the segment the visual belongs to (see `activeVisual`).
 */
export function visualCues(tl: TimedSegment[], from: number): VisualCues | null {
  const seg = tl[from];
  const visual = seg?.visual;
  if (!seg || !visual) return null;
  let to = from + 1;
  while (to < tl.length && !tl[to].visual) to++;
  const start = seg.start;
  const end = tl[to - 1].end;
  const pool = tl.slice(from, to).flatMap((s) => s.words).map((w) => ({ n: norm(w.text), raw: w.text, start: w.start }));
  let spoken: (number | null)[] = [];
  if (visual.kind === "headline") {
    const used = new Set<number>();
    spoken = visual.text.split(/\s+/).filter(Boolean).map((hw) => {
      const h = norm(hw);
      if (h.length < 3) return null; // skip "the", "of"… they'd highlight at random
      const i = pool.findIndex((p, k) => !used.has(k) && sameWord(h, p.n));
      if (i < 0) return null;
      used.add(i);
      return pool[i].start;
    });
  } else if (visual.kind === "number") {
    const digits = visual.value.replace(/\D/g, "");
    const hit = digits ? pool.find((p) => p.raw.replace(/\D/g, "").includes(digits)) : undefined;
    spoken = [hit ? hit.start : null];
  }
  const count = visual.kind === "chart" ? visual.bars.length : visual.kind === "timeline" ? visual.items.length : visual.kind === "compare" ? 2 : 0;
  const step = count ? Math.min(0.9, Math.max(0.2, (end - start - 0.8) / count)) : 0;
  const reveal = Array.from({ length: count }, (_, i) => start + 0.3 + i * step);
  return { start, end, spoken, reveal };
}
