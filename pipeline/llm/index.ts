import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import type { Env, LlmProvider, LlmRequest, LlmResponse } from "./types";

export * from "./types";

/**
 * Ordered provider chain. LLM_PROVIDER picks the preferred one; others act as fallbacks.
 * Returns an empty chain when no keys exist — callers then use the deterministic mock writer.
 */
export function providerChain(env: Env = process.env): LlmProvider[] {
  const all = [geminiProvider(env), groqProvider(env)];
  const pref = (env.LLM_PROVIDER || "auto").toLowerCase();
  if (pref === "mock") return [];
  const ordered = pref === "groq" ? [all[1], all[0]] : all;
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
