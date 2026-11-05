import { describe, expect, it } from "vitest";
import { keyFor, narrate } from "../pipeline/narrate";
import type { AudioStore } from "../pipeline/storage";
import type { TtsProvider } from "../pipeline/tts";
import type { NarrationAudio } from "../src/lib/types";

const provider = (name: string, fn: () => never): TtsProvider => ({ name, langs: ["en", "hi"], available: () => true, synthesize: async () => fn() });

describe("narration cache", () => {
  const segments = ["First sentence.", "Second sentence."];
  const chain = [provider("kokoro", () => { throw new Error("must not synthesise on a cache hit"); })];
  const store = (src: string | null): AudioStore => ({ kind: "s3", dir: "/nonexistent", exists: async () => src, publish: async (p) => p });

  it("derives a key from text, language, voice and engine", () => {
    const k = keyFor(segments, "en", {}, chain);
    expect(k).toBe(keyFor(segments, "en", {}, chain));
    expect(k).not.toBe(keyFor(segments, "hi", {}, chain));
    expect(k).not.toBe(keyFor(["First sentence.", "Changed."], "en", {}, chain));
    expect(k).not.toBe(keyFor(segments, "en", { KOKORO_VOICE_EN: "bf_emma" }, chain));
  });

  it("reuses a known record without synthesising, adopting the store's public URL", async () => {
    const key = keyFor(segments, "en", {}, chain);
    const rec: NarrationAudio = { src: "/audio/old.mp3", durationSec: 12, model: "Kokoro-82M", voice: "af_heart", key, wordTimes: [0, 1] };
    const out = await narrate(segments, "en", { env: {}, store: store("https://cdn.example/audio/old.mp3"), chain, known: new Map([[key, rec]]), log: () => {} });
    expect(out.src).toBe("https://cdn.example/audio/old.mp3");
    expect(out.wordTimes).toEqual([0, 1]);
    expect(out.durationSec).toBe(12);
  });

  it("re-synthesises when the cached file is gone", async () => {
    const key = keyFor(segments, "en", {}, chain);
    const rec: NarrationAudio = { src: "/audio/old.mp3", durationSec: 12, model: "m", voice: "v", key };
    await expect(narrate(segments, "en", { env: {}, store: store(null), chain, known: new Map([[key, rec]]), log: () => {} })).rejects.toThrow(/must not synthesise/);
  });
});
