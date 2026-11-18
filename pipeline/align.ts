import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { splitWords, wordWeight } from "../src/lib/timeline";
import { retryAfterSeconds } from "./llm/groq";
import { configureModels } from "./models";
import type { Lang } from "./tts/types";

type Env = Record<string, string | undefined>;

export interface HeardWord {
  word: string;
  start: number;
  end: number;
}

// ───────────────────────── matching ─────────────────────────

export function normWord(w: string): string {
  return w.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 0..1 similarity between a script token and a recognised token (tolerant of ASR spelling and number formatting). */
export function wordSimilarity(a: string, b: string): number {
  const x = normWord(a);
  const y = normWord(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const dx = x.replace(/\D/g, "");
  const dy = y.replace(/\D/g, "");
  if (dx && dy && /\d/.test(x) && /\d/.test(y)) return dx === dy ? 0.9 : dx.startsWith(dy) || dy.startsWith(dx) ? 0.7 : 0;
  if (Math.min(x.length, y.length) <= 2) return 0;
  return Math.max(0, 1 - levenshtein(x, y) / Math.max(x.length, y.length));
}

const MATCH_MIN = 0.6;

/** Order-preserving best matching (LCS weighted by similarity). Returns, per script word, the heard index or -1. */
export function matchWords(script: string[], heard: string[]): number[] {
  const n = script.length;
  const m = heard.length;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const sim: number[][] = script.map((s) => heard.map((h) => wordSimilarity(s, h)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const s = sim[i - 1][j - 1];
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], s >= MATCH_MIN ? dp[i - 1][j - 1] + s : -Infinity);
    }
  const out = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const s = sim[i - 1][j - 1];
    if (s >= MATCH_MIN && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + s)) < 1e-9) {
      out[i - 1] = j - 1;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return out;
}

// ───────────────────────── word timings ─────────────────────────

export interface WordTimingResult {
  /** [start, end] seconds for every script word, in order (flattened over segments). */
  times: [number, number][];
  matched: number;
  total: number;
  mode: "whisper" | "segments";
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Spread unmatched words over [from, to] in proportion to speaking cost. */
function distribute(words: string[], from: number, to: number): [number, number][] {
  const w = words.map(wordWeight);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  let t = from;
  return words.map((_, i) => {
    const d = ((to - from) * w[i]) / total;
    const r: [number, number] = [t, t + d];
    t += d;
    return r;
  });
}

/**
 * Combine the engine's exact segment boundaries (when known) with recognised word timestamps (when available).
 * Words are matched inside their own segment window, so recognition errors can never drift across segments.
 * Unmatched words are interpolated between matched neighbours; with no recognition at all, words are spread
 * across their (exact) segment window, which is still far tighter than a whole-clip estimate.
 */
export function buildWordTimes(opts: { segments: string[]; heard: HeardWord[] | null; segmentTimes: [number, number][] | null; duration: number; tailGap?: number }): WordTimingResult {
  const { segments, heard, segmentTimes, duration } = opts;
  const tail = opts.tailGap ?? 0.3;
  const segWords = segments.map(splitWords);
  const total = segWords.reduce((n, w) => n + w.length, 0);
  const times: [number, number][] = [];
  let matched = 0;

  // Windows: exact per-segment spans when known, else one span covering everything (global alignment).
  const windows: { from: number; to: number; words: string[] }[] = segmentTimes
    ? segWords.map((words, i) => ({ from: segmentTimes[i][0], to: segmentTimes[i][1], words }))
    : [{ from: 0, to: duration, words: segWords.flat() }];

  windows.forEach((win, wi) => {
    const isLast = wi === windows.length - 1;
    const end = Math.max(win.from + 0.1, Math.min(win.to, duration) - (segmentTimes ? tail : 0.05));
    const inWin = heard ? heard.filter((h) => (h.start + h.end) / 2 >= win.from - 0.25 && (h.start + h.end) / 2 <= win.to + (isLast ? 1 : 0.25)) : [];
    const idx = inWin.length ? matchWords(win.words, inWin.map((h) => h.word)) : win.words.map(() => -1);
    const out: ([number, number] | null)[] = idx.map((j) => (j >= 0 ? [inWin[j].start, Math.max(inWin[j].end, inWin[j].start + 0.05)] : null));
    matched += idx.filter((j) => j >= 0).length;
    // fill runs of unmatched words between anchors
    let i = 0;
    while (i < out.length) {
      if (out[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < out.length && !out[j]) j++;
      const a = i > 0 ? out[i - 1]![1] : win.from;
      const b = j < out.length ? out[j]![0] : end;
      const filled = distribute(win.words.slice(i, j), a, Math.max(a + 0.05 * (j - i), b));
      filled.forEach((f, k) => (out[i + k] = f));
      i = j;
    }
    times.push(...(out as [number, number][]));
  });

  // enforce monotonic starts, ends within [start, duration]
  let prev = 0;
  const clean = times.map(([s, e]) => {
    const start = Math.min(Math.max(s, prev), duration);
    const end = Math.min(Math.max(e, start + 0.04), duration);
    prev = start;
    return [r2(start), r2(end)] as [number, number];
  });
  return { times: clean, matched, total, mode: matched > 0 ? "whisper" : "segments" };
}

// ───────────────────────── recognisers ─────────────────────────

/** Groq-hosted Whisper large-v3-turbo with word timestamps (free tier). */
export async function groqWhisper(file: string, lang: Lang, env: Env = process.env, prompt?: string): Promise<HeardWord[]> {
  if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY missing");
  for (let attempt = 0; attempt < 3; attempt++) {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(file)], { type: file.endsWith(".mp3") ? "audio/mpeg" : "audio/wav" }), path.basename(file));
    form.append("model", env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("language", lang);
    form.append("temperature", "0");
    if (prompt) form.append("prompt", prompt.slice(0, 400));
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: form, signal: AbortSignal.timeout(180_000) });
    if (res.ok) {
      const data = (await res.json()) as { words?: { word: string; start: number; end: number }[] };
      if (!data.words?.length) throw new Error("Whisper returned no word timestamps");
      return data.words;
    }
    const body = await res.text();
    const wait = res.status === 429 ? retryAfterSeconds(res.headers, body) : null;
    if (wait !== null && wait <= 90 && attempt < 2) {
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      continue;
    }
    throw new Error(`Groq Whisper HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  throw new Error("Groq Whisper failed");
}

type Asr = (audio: Float32Array, opts: object) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[] }>;
const asrCache = new Map<string, Promise<Asr>>();

/** Fully local Whisper via transformers.js (no network after the first model download). Slower; used as a fallback. */
export async function localWhisper(file: string, lang: Lang, env: Env = process.env): Promise<HeardWord[]> {
  const { pipeline } = await import("@huggingface/transformers");
  configureModels(env);
  const model = lang === "hi" ? env.LOCAL_WHISPER_MODEL_HI || "Xenova/whisper-base" : env.LOCAL_WHISPER_MODEL || "Xenova/whisper-base.en";
  const asr = await (asrCache.get(model) ?? asrCache.set(model, (pipeline as unknown as (t: string, m: string, o: object) => Promise<Asr>)("automatic-speech-recognition", model, { dtype: "q8" })).get(model)!);
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"], { maxBuffer: 1 << 28 });
  const audio = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  const out = await asr(audio, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, ...(lang === "hi" ? { language: "hindi", task: "transcribe" } : {}) });
  const words = (out.chunks ?? []).filter((c) => c.text.trim()).map((c) => ({ word: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }));
  if (!words.length) throw new Error("local Whisper returned no words");
  return words;
}

/** Recognise word timings: Groq Whisper first, local Whisper next. Returns null when neither works. */
export async function recognise(file: string, lang: Lang, env: Env = process.env, log: (m: string) => void = () => {}, hint?: string): Promise<{ words: HeardWord[]; engine: string } | null> {
  const order = (env.ALIGN_ENGINES ?? "groq,local").split(",").map((s) => s.trim());
  for (const e of order) {
    try {
      if (e === "groq" && env.GROQ_API_KEY) return { words: await groqWhisper(file, lang, env, hint), engine: "whisper-groq" };
      if (e === "local") return { words: await localWhisper(file, lang, env), engine: "whisper-local" };
    } catch (err) {
      log(`  ! align ${e}: ${(err as Error).message.slice(0, 140)}`);
    }
  }
  return null;
}
