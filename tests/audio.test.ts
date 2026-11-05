import { describe, expect, it } from "vitest";
import { concatFloat, floatToPcm16, narrationKey, peakNormalize, pcmToWav, silence, trimSilence, wavDuration } from "../pipeline/audio";
import { chunkSentences } from "../pipeline/tts/text";

describe("wav helpers", () => {
  it("wraps PCM and reads the duration back", () => {
    const wav = pcmToWav(Buffer.alloc(24000 * 2 * 3));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wavDuration(wav)).toBeCloseTo(3, 5);
  });
  it("converts floats to clipped 16-bit PCM", () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 2, -2]));
    expect([...Array(5).keys()].map((i) => pcm.readInt16LE(i * 2))).toEqual([0, 32767, -32767, 32767, -32767]);
  });
});

describe("sample processing", () => {
  it("trims silence but keeps a pad", () => {
    const s = concatFloat([silence(1, 1000), new Float32Array(200).fill(0.5), silence(1, 1000)]);
    const t = trimSilence(s, 1000, 0.004, 0.05);
    expect(t.length).toBe(200 + 100); // 50 ms pad each side at 1 kHz
  });
  it("peak-normalises to the target level", () => {
    const out = peakNormalize(new Float32Array([0.1, -0.4, 0.2]), 0.8);
    expect(Math.max(...[...out].map(Math.abs))).toBeCloseTo(0.8, 5);
    expect(peakNormalize(new Float32Array([0, 0]))).toEqual(new Float32Array([0, 0])); // silence is left alone
  });
});

describe("narrationKey", () => {
  const base = { segments: ["a", "b"], voice: "af_heart", engine: "kokoro", lang: "en" };
  it("is stable and sensitive to every input", () => {
    expect(narrationKey(base)).toBe(narrationKey({ ...base }));
    for (const change of [{ segments: ["a", "c"] }, { voice: "bf_emma" }, { engine: "gemini" }, { lang: "hi" }]) expect(narrationKey({ ...base, ...change })).not.toBe(narrationKey(base));
  });
});

describe("chunkSentences", () => {
  it("keeps short text whole and splits long text at sentence boundaries", () => {
    expect(chunkSentences("One. Two.", 100)).toEqual(["One. Two."]);
    const long = "Alpha beta gamma. Delta epsilon zeta. Eta theta iota.";
    const chunks = chunkSentences(long, 25);
    expect(chunks.every((c) => c.length <= 25)).toBe(true);
    expect(chunks.join(" ")).toBe(long);
  });
  it("splits Hindi on the danda and breaks over-long sentences", () => {
    expect(chunkSentences("पहला वाक्य। दूसरा वाक्य।", 14)).toEqual(["पहला वाक्य।", "दूसरा वाक्य।"]);
    const run = Array.from({ length: 30 }, (_, i) => `word${i},`).join(" ");
    expect(chunkSentences(run, 60).every((c) => c.length <= 60)).toBe(true);
  });
});
