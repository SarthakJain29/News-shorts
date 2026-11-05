import type { Lang, NarrationOutput, NarrationRequest, TtsProvider } from "./types";

type Env = Record<string, string | undefined>;

/** Decode 16-bit PCM WAV (or raw PCM when `rawRate` is given) into floats. */
export function pcm16ToFloat(buf: Buffer, offset = 0): Float32Array {
  const n = Math.floor((buf.length - offset) / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(offset + i * 2) / 32768;
  return out;
}

function wavData(wav: Buffer): { samples: Float32Array; rate: number } {
  let off = 12;
  let rate = 24000;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4);
    const size = wav.readUInt32LE(off + 4);
    if (id === "fmt ") rate = wav.readUInt32LE(off + 12);
    if (id === "data") return { samples: pcm16ToFloat(wav.subarray(off + 8, off + 8 + size)), rate };
    off += 8 + size + (size % 2);
  }
  throw new Error("invalid WAV from Gemini TTS");
}

const exhausted = new Set<string>();

/**
 * OPTIONAL provider: Gemini TTS. Only used when GEMINI_API_KEY is set and TTS_PROVIDERS includes "gemini".
 * The free tier allows only ~10 requests/day/model, so the pipeline never depends on it. No style prefix is sent:
 * the 3.x TTS models read an instruction like "Read this warmly:" aloud.
 */
export function geminiTtsProvider(env: Env = process.env): TtsProvider {
  const wanted = () => (env.TTS_PROVIDERS ?? "kokoro,gemini").split(",").map((s) => s.trim()).includes("gemini");
  return {
    name: "gemini",
    langs: ["en", "hi"] as Lang[],
    available: () => Boolean(env.GEMINI_API_KEY) && wanted(),
    async synthesize(req: NarrationRequest): Promise<NarrationOutput> {
      const voice = req.voice || env.GEMINI_TTS_VOICE || "Kore";
      const models = (env.GEMINI_TTS_MODELS || "gemini-3.8-flash-lite-tts,gemini-3.8-flash-tts").split(",").map((m) => m.trim()).filter((m) => m && !exhausted.has(m));
      if (!models.length) throw new Error("all Gemini TTS models exhausted");
      let lastErr = "";
      for (const model of models) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
          signal: AbortSignal.timeout(180_000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: req.segments.join(" ") }] }],
            generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
          }),
        }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }) as unknown as Response);
        if (!res.ok) {
          lastErr = `${model} HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`;
          if (res.status === 429 || res.status === 404 || res.status === 400) exhausted.add(model);
          continue;
        }
        const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[] };
        const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
        if (!inline) {
          lastErr = `${model}: no audio`;
          continue;
        }
        const bytes = Buffer.from(inline.data, "base64");
        const isWav = inline.mimeType.includes("wav");
        const rate = Number(inline.mimeType.match(/rate=(\d+)/)?.[1] ?? 24000);
        const { samples, rate: r } = isWav ? wavData(bytes) : { samples: pcm16ToFloat(bytes), rate };
        return { samples, sampleRate: r, segmentTimes: null, provider: "gemini", model, voice };
      }
      throw new Error(lastErr || "Gemini TTS failed");
    },
  };
}
