import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import type { Env, LlmProvider, LlmRequest, LlmResponse } from "./types";

export * from "./types";

/**
 * Ordered provider chain. Groq (free) is the default; Gemini is an optional fallback that only joins the chain when
 * GEMINI_API_KEY is set (LLM_PROVIDER=gemini puts it first). Returns an empty chain when no keys exist — callers then
 * use the deterministic offline writer, so nothing depends on any single vendor.
 */
export function providerChain(env: Env = process.env): LlmProvider[] {
  const groq = groqProvider(env);
  const gemini = geminiProvider(env);
  const pref = (env.LLM_PROVIDER || "auto").toLowerCase();
  if (pref === "mock") return [];
  const ordered = pref === "gemini" ? [gemini, groq] : pref === "groq" ? [groq] : [groq, gemini];
  return ordered.filter((p) => p.available());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Try each provider (with one retry on transient errors) until one succeeds. */
export async function completeWithFallback(chain: LlmProvider[], req: LlmRequest, log = console.warn): Promise<LlmResponse> {
  let last: unknown = new Error("No LLM providers configured");
  for (const p of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await p.complete(req);
      } catch (e) {
        last = e;
        log(`  ! ${p.name} attempt ${attempt + 1} failed: ${(e as Error).message}`);
        const retryable = (e as { retryable?: boolean }).retryable ?? true;
        if (!retryable) break;
        await sleep(2000 * (attempt + 1));
      }
    }
  }
  throw last;
}
