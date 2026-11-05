import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cosine, embedItems, itemText, normalize } from "../pipeline/embed";
import { item } from "./fixtures";

describe("vector helpers", () => {
  it("computes cosine and normalises", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(Math.hypot(...normalize([3, 4]))).toBeCloseTo(1);
  });
  it("embeds headline plus summary", () => {
    expect(itemText(item({ title: "T", summary: "S" }))).toBe("T. S");
  });
});

describe("embedItems cache", () => {
  it("embeds only unseen articles and reuses the disk cache", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "emb-"));
    const cacheFile = path.join(dir, "e.json");
    const seen: string[][] = [];
    const embed = async (texts: string[]) => (seen.push(texts), texts.map((t) => [t.length, 1]));
    const a = item({ title: "Alpha story", url: "https://x/a" });
    const b = item({ title: "Beta", url: "https://x/b" });
    const first = await embedItems([a, b], { cacheFile, embed, env: {} });
    expect(seen[0]).toHaveLength(2);
    const second = await embedItems([a, b, item({ title: "Gamma story here", url: "https://x/c" })], { cacheFile, embed, env: {} });
    expect(seen[1]).toEqual(["Gamma story here."]); // only the new article
    expect(second.slice(0, 2)).toEqual(first.map((v) => normalize(v).map((x) => Math.round(x * 1e4) / 1e4)));
    expect(Math.hypot(...second[2])).toBeCloseTo(1, 3);
    rmSync(dir, { recursive: true });
  });
  it("rejects an embedder that returns the wrong number of vectors", async () => {
    await expect(embedItems([item({})], { cacheFile: null, embed: async () => [], env: {} })).rejects.toThrow(/wrong number/);
  });
});
