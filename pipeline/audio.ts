import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

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

export function floatToPcm16(samples: Float32Array): Buffer {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  return out;
}

/** Trim leading/trailing near-silence, keeping a small pad so words aren't clipped. */
export function trimSilence(samples: Float32Array, sampleRate: number, threshold = 0.004, padSec = 0.05): Float32Array {
  let a = 0;
  let b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < threshold) a++;
  while (b > a && Math.abs(samples[b]) < threshold) b--;
  const pad = Math.round(padSec * sampleRate);
  return samples.subarray(Math.max(0, a - pad), Math.min(samples.length, b + 1 + pad));
}

export function silence(seconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate));
}

export function concatFloat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Encode a WAV buffer to a small mono MP3 (speech needs ~48 kbps); returns the written path. Keeps the WAV if ffmpeg is absent. */
export function writeNarrationFile(wav: Buffer, outBase: string): string {
  mkdirSync(path.dirname(outBase), { recursive: true });
  const wavPath = `${outBase}.wav`;
  writeFileSync(wavPath, wav);
  if (!hasFfmpeg()) return wavPath;
  const mp3Tmp = `${outBase}.tmp.mp3`;
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "48k", mp3Tmp]);
    renameSync(mp3Tmp, `${outBase}.mp3`);
    rmSync(wavPath);
    return `${outBase}.mp3`;
  } catch {
    rmSync(mp3Tmp, { force: true });
    return wavPath;
  }
}

export function probeDuration(file: string): number {
  if (!existsSync(file)) return 0;
  try {
    return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim()) || 0;
  } catch {
    return file.endsWith(".wav") ? wavDuration(readFileSync(file)) : 0;
  }
}

/** Content-addressed narration key: same text + voice + engine → same file, so audio is cached across runs. */
export function narrationKey(parts: { segments: string[]; voice: string; engine: string; lang: string }): string {
  return createHash("sha1").update(JSON.stringify([parts.engine, parts.lang, parts.voice, parts.segments])).digest("hex").slice(0, 16);
}

/** Scale so the loudest peak sits at ~-1 dBFS, giving every short the same level. */
export function peakNormalize(samples: Float32Array, target = 0.89): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-4) return samples;
  const g = target / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}
