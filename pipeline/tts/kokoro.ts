import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Tensor } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import { concatFloat, peakNormalize, silence, trimSilence } from "../audio";
import { configureModels } from "../models";
import { hasEspeak, hindiPhonemes } from "./hindi";
import { chunkSentences } from "./text";
import type { Lang, NarrationOutput, NarrationRequest, TtsProvider } from "./types";

type Env = Record<string, string | undefined>;

/** Kokoro-82M (Apache-2.0) ONNX build, run on CPU through onnxruntime-node. */
export const KOKORO_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const DEFAULT_VOICES: Record<Lang, string> = { en: "af_heart", hi: "hf_alpha" };
const SAMPLE_RATE = 24000;
const SENTENCE_GAP = 0.14;
const SEGMENT_GAP = 0.32;

interface KokoroInternals {
  tokenizer: (text: string, opts: { truncation: boolean }) => { input_ids: Tensor };
  model: (inputs: Record<string, Tensor>) => Promise<{ waveform: { data: Float32Array } }>;
  generate: (text: string, opts: { voice: string; speed: number }) => Promise<{ audio: Float32Array }>;
}

let instance: Promise<KokoroInternals> | null = null;
function load(env: Env): Promise<KokoroInternals> {
  const hf = configureModels(env);
  instance ??= KokoroTTS.from_pretrained(KOKORO_REPO, { dtype: (env.KOKORO_DTYPE as "q8" | "fp32" | "fp16") || "q8", device: "cpu" }).then((t) => {
    void hf;
    return t as unknown as KokoroInternals;
  });
  return instance;
}

const voiceCache = new Map<string, Float32Array>();
/** Voice style vectors ship with kokoro-js for English; others (Hindi…) are fetched once from the model repo and cached. */
async function loadVoice(name: string, env: Env): Promise<Float32Array> {
  const hit = voiceCache.get(name);
  if (hit) return hit;
  const cacheDir = configureModels(env).cacheDir as string;
  const local = path.join(cacheDir, "kokoro-voices", `${name}.bin`);
  const bundled = path.join(process.cwd(), "node_modules", "kokoro-js", "voices", `${name}.bin`);
  let buf: Buffer;
  if (existsSync(bundled)) buf = readFileSync(bundled);
  else if (existsSync(local)) buf = readFileSync(local);
  else {
    const res = await fetch(`https://huggingface.co/${KOKORO_REPO}/resolve/main/voices/${name}.bin`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Kokoro voice "${name}" not found (HTTP ${res.status})`);
    buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(path.dirname(local), { recursive: true });
    writeFileSync(local, buf);
  }
  const v = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  voiceCache.set(name, v);
  return v;
}

async function synthChunk(k: KokoroInternals, text: string, lang: Lang, voice: string, speed: number, env: Env): Promise<Float32Array> {
  if (lang === "en") return (await k.generate(text, { voice, speed })).audio;
  const phonemes = hindiPhonemes(text);
  if (!phonemes) return new Float32Array(0);
  const { input_ids } = k.tokenizer(phonemes, { truncation: true });
  const style = await loadVoice(voice, env);
  const off = 256 * Math.min(Math.max(input_ids.dims.at(-1)! - 2, 0), 509);
  const out = await k.model({ input_ids, style: new Tensor("float32", style.slice(off, off + 256), [1, 256]), speed: new Tensor("float32", [speed], [1]) });
  return out.waveform.data;
}

export function kokoroProvider(env: Env = process.env): TtsProvider {
  const enabled = () => (env.TTS_PROVIDERS ?? "kokoro,gemini").split(",").map((s) => s.trim()).includes("kokoro");
  return {
    name: "kokoro",
    langs: ["en", "hi"],
    available: () => enabled(),
    async synthesize(req: NarrationRequest): Promise<NarrationOutput> {
      if (req.lang === "hi" && !hasEspeak()) throw new Error("Hindi narration needs the `espeak-ng` system package (apt-get install espeak-ng)");
      const voice = req.voice || (req.lang === "hi" ? env.KOKORO_VOICE_HI : env.KOKORO_VOICE_EN) || DEFAULT_VOICES[req.lang];
      const speed = Number(env.KOKORO_SPEED ?? 1);
      const k = await load(env);
      const parts: Float32Array[] = [];
      const times: [number, number][] = [];
      let n = 0;
      for (const text of req.segments) {
        const start = n;
        const chunks = chunkSentences(text, req.lang === "hi" ? 200 : 260);
        for (let i = 0; i < chunks.length; i++) {
          const wave = trimSilence(await synthChunk(k, chunks[i], req.lang, voice, speed, env), SAMPLE_RATE);
          parts.push(wave);
          n += wave.length;
          const gap = silence(i === chunks.length - 1 ? SEGMENT_GAP : SENTENCE_GAP, SAMPLE_RATE);
          parts.push(gap);
          n += gap.length;
        }
        times.push([start / SAMPLE_RATE, n / SAMPLE_RATE]);
      }
      return { samples: peakNormalize(concatFloat(parts)), sampleRate: SAMPLE_RATE, segmentTimes: times, provider: "kokoro", model: "Kokoro-82M", voice };
    },
  };
}
