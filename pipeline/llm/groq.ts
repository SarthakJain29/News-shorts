import { LlmError, type Env, type LlmProvider, type LlmRequest } from "./types";

export function groqProvider(env: Env = process.env): LlmProvider {
  const key = env.GROQ_API_KEY;
  const model = env.GROQ_MODEL || "openai/gpt-oss-120b";
  return {
    name: "groq",
    model,
    available: () => Boolean(key),
    async complete(req: LlmRequest) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model,
          temperature: req.temperature ?? 0.6,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          ...(req.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new LlmError(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`, res.status === 429 || res.status >= 500);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text) throw new LlmError("Groq returned empty response", true);
      return { text, provider: "groq", model };
    },
  };
}
