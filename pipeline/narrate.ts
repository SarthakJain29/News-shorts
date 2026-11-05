import { existsSync } from "node:fs";
import path from "node:path";
import { buildWordTimes, recognise } from "./align";
import { floatToPcm16, narrationKey, pcmToWav, probeDuration, writeNarrationFile } from "./audio";
import type { AudioStore } from "./storage";
import { synthesizeNarration, type Lang, type TtsProvider } from "./tts";
import type { NarrationAudio } from "../src/lib/types";

type Env = Record<string, string | undefined>;

export interface NarrateContext {
  env: Env;
  store: AudioStore;
  chain: TtsProvider[];
  /** Audio records from earlier runs, by cache key — lets us skip synthesis AND re-alignment. */
  known: Map<string, NarrationAudio>;
  log: (m: string) => void;
}

/** Cache key for a script's narration (the engine name keeps different voices from colliding). */
export function keyFor(segments: string[], lang: Lang, env: Env, chain: TtsProvider[]): string {
  const voice = (lang === "hi" ? env.KOKORO_VOICE_HI : env.KOKORO_VOICE_EN) || "default";
  return narrationKey({ segments, lang, voice, engine: chain[0]?.name ?? "none" });
}

/**
 * Narrate one script: reuse the cached file when its content hash is unchanged, else synthesise
 * (segment by segment), encode to MP3, publish to the store, and derive exact word timings.
 */
export async function narrate(segments: string[], lang: Lang, ctx: NarrateContext): Promise<NarrationAudio> {
  const key = keyFor(segments, lang, ctx.env, ctx.chain);
  const known = ctx.known.get(key);
  if (known && (await ctx.store.exists(path.basename(known.src)))) return known;

  const hint = segments[0]?.slice(0, 200);
  const local = await findLocal(ctx.store, key);
  if (local) {
    // File survived from an earlier run but its record didn't: rebuild timings without re-synthesising.
    const duration = probeDuration(local);
    const heard = await recognise(local, lang, ctx.env, ctx.log, hint);
    const r = buildWordTimes({ segments, heard: heard?.words ?? null, segmentTimes: null, duration });
    const src = await ctx.store.publish(local);
    return { src, durationSec: round1(duration), model: "cache", voice: "cache", key, lang, ...(heard ? { wordTimes: r.times.flat(), align: heard.engine as NarrationAudio["align"] } : {}) };
  }

  const out = await synthesizeNarration({ segments, lang }, ctx.chain, ctx.log);
  const wav = pcmToWav(floatToPcm16(out.samples), out.sampleRate);
  const file = writeNarrationFile(wav, path.join(ctx.store.dir, key));
  const duration = probeDuration(file) || out.samples.length / out.sampleRate;

  const heard = await recognise(file, lang, ctx.env, ctx.log, hint);
  const timing = buildWordTimes({ segments, heard: heard?.words ?? null, segmentTimes: out.segmentTimes, duration });
  const src = await ctx.store.publish(file);
  const audio: NarrationAudio = { src, durationSec: round1(duration), model: out.model, voice: out.voice, key, lang };
  if (out.segmentTimes || heard) {
    audio.wordTimes = timing.times.flat();
    audio.align = heard ? (heard.engine as NarrationAudio["align"]) : "segments";
  }
  ctx.log(`    timing: ${heard ? heard.engine : "segments only"} · ${timing.matched}/${timing.total} words matched`);
  return audio;
}

async function findLocal(store: AudioStore, key: string): Promise<string | null> {
  for (const ext of ["mp3", "wav"]) {
    const p = path.join(store.dir, `${key}.${ext}`);
    if (existsSync(p) && probeDuration(p) > 1) return p;
  }
  return null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
