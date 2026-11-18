import { geminiTtsProvider } from "./gemini";
import { kokoroProvider } from "./kokoro";
import type { Lang, NarrationOutput, NarrationRequest, TtsProvider } from "./types";

export * from "./types";

/** Providers in preference order. TTS_PROVIDERS="kokoro,gemini" (default); Gemini needs a key and is only a fallback. */
export function ttsChain(env: Record<string, string | undefined> = process.env, lang?: Lang): TtsProvider[] {
  const all: Record<string, TtsProvider> = { kokoro: kokoroProvider(env), gemini: geminiTtsProvider(env) };
  const order = (env.TTS_PROVIDERS ?? "kokoro,gemini").split(",").map((s) => s.trim()).filter((s) => s in all);
  return order.map((n) => all[n]).filter((p) => p.available() && (!lang || p.langs.includes(lang)));
}

/** Try each provider in turn; throws with every reason when none works. */
export async function synthesizeNarration(req: NarrationRequest, chain: TtsProvider[], log: (m: string) => void = () => {}): Promise<NarrationOutput> {
  const errors: string[] = [];
  for (const p of chain) {
    if (!p.langs.includes(req.lang)) continue;
    try {
      return await p.synthesize(req);
    } catch (e) {
      errors.push(`${p.name}: ${(e as Error).message}`);
      log(`  ! tts ${p.name}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  throw new Error(errors.join(" | ") || "no TTS provider available");
}
