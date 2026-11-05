import { LlmError, type Env, type LlmProvider, type LlmRequest } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds to wait from a Groq 429 (`retry-after` header, or "try again in 12.3s" in the body). */
export function retryAfterSeconds(headers: Pick<Headers, "get">, body: string): number | null {
  const h = Number(headers.get("retry-after"));
  if (Number.isFinite(h) && h > 0) return h;
  const m = body.match(/try again in (?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  return null;
}

/**
 * Groq (free tier, OpenAI-compatible). GROQ_MODEL is a comma-separated preference list. On a rate limit we wait out
 * short `retry-after` windows (the free tier is token-per-minute limited) before falling to the next model.
 */
export function groqProvider(env: Env = process.env, sleepFn: (ms: number) => Promise<unknown> = sleep): LlmProvider {
  const key = env.GROQ_API_KEY;
  const models = (env.GROQ_MODEL || "openai/gpt-oss-120b,openai/gpt-oss-20b").split(",").map((s) => s.trim()).filter(Boolean);
  const maxWait = Number(env.GROQ_MAX_WAIT_SEC ?? 75);
  return {
    name: "groq",
    model: models[0],
    available: () => Boolean(key),
    async complete(req: LlmRequest) {
      let lastErr: unknown = new LlmError("Groq: no model succeeded", true);
      for (const model of models) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(120_000),
            body: JSON.stringify({
              model,
              temperature: req.temperature ?? 0.6,
              messages: [
                { role: "system", content: req.system },
                { role: "user", content: req.user },
              ],
              ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
              ...(req.json ? { response_format: { type: "json_object" } } : {}),
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
            const text = data.choices?.[0]?.message?.content ?? "";
            if (text) return { text, provider: "groq", model };
            lastErr = new LlmError(`Groq ${model} returned empty response`, true);
            continue;
          }
          const body = await res.text();
          lastErr = new LlmError(`Groq ${model} HTTP ${res.status}: ${body.slice(0, 200)}`, res.status === 429 || res.status >= 500);
          if (res.status === 429) {
            const wait = retryAfterSeconds(res.headers, body);
            if (wait !== null && wait <= maxWait && attempt < 2) {
              await sleepFn((wait + 1) * 1000);
              continue;
            }
          } else if (res.status >= 500) {
            await sleepFn(1500 * (attempt + 1));
            continue;
          }
          break; // try the next model
        }
      }
      throw lastErr;
    },
  };
}
