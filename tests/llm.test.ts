import { describe, expect, it } from "vitest";
import { completeWithFallback, LlmError, providerChain, type LlmProvider } from "../pipeline/llm";
import { pcmToWav, wavDuration } from "../pipeline/tts";

describe("providerChain", () => {
  it("orders by preference and filters missing keys", () => {
    expect(providerChain({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }).map((p) => p.name)).toEqual(["gemini", "groq"]);
    expect(providerChain({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", LLM_PROVIDER: "groq" }).map((p) => p.name)).toEqual(["groq", "gemini"]);
    expect(providerChain({ GROQ_API_KEY: "q" }).map((p) => p.name)).toEqual(["groq"]);
    expect(providerChain({ GEMINI_API_KEY: "g", LLM_PROVIDER: "mock" })).toEqual([]);
    expect(providerChain({})).toEqual([]);
  });
});

describe("completeWithFallback", () => {
  const fake = (name: "gemini" | "groq", impl: () => Promise<string>): LlmProvider => ({
    name,
    model: "m",
    available: () => true,
    complete: async () => ({ text: await impl(), provider: name, model: "m" }),
  });
  it("falls through to the next provider on a hard error", async () => {
    const res = await completeWithFallback(
      [fake("gemini", () => Promise.reject(new LlmError("bad request", false))), fake("groq", async () => "ok")],
      { system: "", user: "" },
      () => {},
    );
    expect(res).toMatchObject({ text: "ok", provider: "groq" });
  });
  it("throws when every provider fails", async () => {
    await expect(completeWithFallback([fake("gemini", () => Promise.reject(new LlmError("nope", false)))], { system: "", user: "" }, () => {})).rejects.toThrow("nope");
  });
});

describe("wav helpers", () => {
  it("wraps PCM and reads duration back", () => {
    const pcm = Buffer.alloc(24000 * 2 * 3); // 3s of 24kHz mono 16-bit
    const wav = pcmToWav(pcm);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wavDuration(wav)).toBeCloseTo(3, 5);
  });
});
