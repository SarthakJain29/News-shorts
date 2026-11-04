import { LlmError, type LlmProvider, type LlmRequest } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function geminiProvider(env = process.env): LlmProvider {
  const key = env.GEMINI_API_KEY;
  const models = (env.GEMINI_TEXT_MODEL || "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-2.5-flash-lite")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name: "gemini",
    model: models[0],
    available: () => Boolean(key),
    async complete(req: LlmRequest) {
      let lastErr: unknown;
      for (const model of models) {
        try {
          const res = await fetch(`${BASE}/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key ?? "" },
            signal: AbortSignal.timeout(90_000),
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: req.system }] },
              contents: [{ role: "user", parts: [{ text: req.user }] }],
              generationConfig: {
                temperature: req.temperature ?? 0.6,
                ...(req.json ? { responseMimeType: "application/json" } : {}),
              },
            }),
          });
          if (!res.ok) {
            const body = await res.text();
            throw new LlmError(`Gemini ${model} HTTP ${res.status}: ${body.slice(0, 200)}`, res.status === 429 || res.status >= 500);
          }
          const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
          const text = (data.candidates?.[0]?.content?.parts ?? [])
            .filter((p) => !p.thought)
            .map((p) => p.text ?? "")
            .join("");
          if (!text) throw new LlmError(`Gemini ${model} returned empty response`, true);
          return { text, provider: "gemini", model };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new LlmError(String(lastErr), true);
    },
  };
}
