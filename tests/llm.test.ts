import { describe, expect, it } from "vitest";
import { completeWithFallback, LlmError, providerChain, type LlmProvider } from "../pipeline/llm";
import { retryAfterSeconds } from "../pipeline/llm/groq";

describe("providerChain", () => {
  it("orders by preference and filters missing keys", () => {
    expect(providerChain({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }).map((p) => p.name)).toEqual(["groq", "gemini"]);
    expect(providerChain({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", LLM_PROVIDER: "gemini" }).map((p) => p.name)).toEqual(["gemini", "groq"]);
    expect(providerChain({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", LLM_PROVIDER: "groq" }).map((p) => p.name)).toEqual(["groq"]);
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

describe("retryAfterSeconds", () => {
  const h = (v: string | null) => ({ get: () => v });
  it("reads the header, then the message", () => {
    expect(retryAfterSeconds(h("12"), "")).toBe(12);
    expect(retryAfterSeconds(h(null), "Rate limit reached. Please try again in 7.5s.")).toBeCloseTo(7.5);
    expect(retryAfterSeconds(h(null), "try again in 1m30s")).toBe(90);
    expect(retryAfterSeconds(h(null), "nothing useful")).toBeNull();
  });
});
