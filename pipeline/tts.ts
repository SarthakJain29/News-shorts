import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hashId } from "./cluster";

export interface TtsResult {
  file: string; // public path, e.g. /audio/abc.mp3
  durationSec: number;
  model: string;
  voice: string;
}

const AUDIO_DIR = path.join(process.cwd(), "public", "audio");

/** Wrap raw 16-bit little-endian PCM in a WAV container. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Duration of a PCM WAV buffer, reading the fmt/data chunks. */
export function wavDuration(wav: Buffer): number {
  let off = 12;
  let byteRate = 48000;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = wav.readUInt32LE(off + 16);
    if (id === "data") return Math.min(size, wav.length - off - 8) / byteRate;
    off += 8 + size + (size % 2);
  }
  return 0;
}

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function narrationKey(text: string, voice: string): string {
  return `${hashId(`${voice}|${text}`)}${hashId(text.split("").reverse().join(""))}`;
}

/** Look for a cached narration file for this exact text + voice. */
export function cachedNarration(text: string, voice: string): string | null {
  const key = narrationKey(text, voice);
  for (const ext of ["mp3", "wav"]) {
    const f = path.join(AUDIO_DIR, `${key}.${ext}`);
    if (existsSync(f) && statSync(f).size > 1000) return `/audio/${key}.${ext}`;
  }
  return null;
}

export function probeDuration(publicPath: string): number {
  const f = path.join(process.cwd(), "public", publicPath);
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

/** Disable a model for the rest of the run once it reports exhausted quota. */
const exhausted = new Set<string>();

export async function synthesize(text: string, env: Record<string, string | undefined> = process.env): Promise<TtsResult> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const voice = env.GEMINI_TTS_VOICE || "Kore";
  const models = (env.GEMINI_TTS_MODELS || "gemini-3.8-flash-lite-tts,gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview,gemini-2.5-flash-preview-tts")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m && !exhausted.has(m));
  if (models.length === 0) throw new Error("All TTS models exhausted for this run");

  const cached = cachedNarration(text, voice);
  if (cached) return { file: cached, durationSec: probeDuration(cached), model: "cache", voice };

  let lastErr = "";
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Read this as a warm, clear, upbeat news presenter at a natural pace:\n\n${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }) as unknown as Response);

    if (!res.ok) {
      lastErr = `${model} HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
      if (res.status === 429 || res.status === 404 || res.status === 400) exhausted.add(model);
      continue;
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[] };
    const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!inline) {
      lastErr = `${model}: no audio in response`;
      continue;
    }
    const bytes = Buffer.from(inline.data, "base64");
    const rate = Number(inline.mimeType.match(/rate=(\d+)/)?.[1] ?? 24000);
    const wav = inline.mimeType.includes("wav") ? bytes : pcmToWav(bytes, rate);
    const durationSec = wavDuration(wav);

    mkdirSync(AUDIO_DIR, { recursive: true });
    const name = narrationKey(text, voice);
    const wavPath = path.join(AUDIO_DIR, `${name}.wav`);
    writeFileSync(wavPath, wav);
    if (hasFfmpeg()) {
      const mp3Path = path.join(AUDIO_DIR, `${name}.mp3`);
      try {
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "48k", mp3Path]);
        execFileSync("rm", ["-f", wavPath]);
        return { file: `/audio/${name}.mp3`, durationSec: probeDuration(`/audio/${name}.mp3`) || durationSec, model, voice };
      } catch {
        /* keep wav */
      }
    }
    return { file: `/audio/${name}.wav`, durationSec, model, voice };
  }
  throw new Error(lastErr || "TTS failed");
}
