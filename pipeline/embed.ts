import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "@huggingface/transformers";
import { configureModels } from "./models";
import type { RawItem } from "./rss";

type Env = Record<string, string | undefined>;

/** Local sentence-embedding model: 22 MB, runs on CPU, no API quota. */
export const DEFAULT_EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
const CACHE_FILE = path.join(process.cwd(), "pipeline", ".cache", "embeddings.json");

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

/** What we embed per article: headline plus the start of the RSS summary. */
export function itemText(it: RawItem): string {
  return `${it.title}. ${it.summary.slice(0, 240)}`.trim();
}

const key = (model: string, text: string) => createHash("sha1").update(`${model}\n${text}`).digest("hex").slice(0, 20);

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

type Extractor = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): unknown }>;
let extractor: Promise<Extractor> | null = null;

/** Default embedder: transformers.js MiniLM, mean-pooled and L2-normalised. */
export function localEmbedder(env: Env = process.env): EmbedFn {
  const model = env.EMBED_MODEL || DEFAULT_EMBED_MODEL;
  return async (texts) => {
    configureModels(env);
    // Cast: the generic pipeline() overloads produce a union too large for the type checker.
    extractor ??= (pipeline as unknown as (task: string, model: string, o: object) => Promise<Extractor>)("feature-extraction", model, { dtype: "q8" });
    const ex = await extractor;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const t = await ex(texts.slice(i, i + 32), { pooling: "mean", normalize: true });
      out.push(...(t.tolist() as number[][]));
    }
    return out;
  };
}

export interface EmbedOptions {
  env?: Env;
  embed?: EmbedFn;
  cacheFile?: string | null;
  log?: (m: string) => void;
}

/**
 * Unit-length embeddings for each article, cached on disk by content hash so repeat runs only embed new
 * articles. Throws if the model can't load (e.g. offline first run) — callers fall back to lexical clustering.
 */
export async function embedItems(items: RawItem[], opts: EmbedOptions = {}): Promise<number[][]> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  const model = env.EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const embed = opts.embed ?? localEmbedder(env);
  const cacheFile = opts.cacheFile === undefined ? CACHE_FILE : opts.cacheFile;

  let cache: Record<string, number[]> = {};
  if (cacheFile && existsSync(cacheFile)) {
    try {
      cache = JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, number[]>;
    } catch {
      cache = {};
    }
  }
  const texts = items.map(itemText);
  const keys = texts.map((t) => key(model, t));
  const missing = [...new Set(keys.filter((k) => !cache[k]))];
  if (missing.length) {
    log(`embedding ${missing.length} new articles (${keys.length - missing.length} cached)`);
    const textByKey = new Map(keys.map((k, i) => [k, texts[i]]));
    const vecs = await embed(missing.map((k) => textByKey.get(k) ?? ""));
    if (vecs.length !== missing.length) throw new Error("embedder returned wrong number of vectors");
    missing.forEach((k, i) => (cache[k] = normalize(vecs[i])));
  }
  if (cacheFile) {
    const used: Record<string, number[]> = {};
    for (const k of keys) used[k] = cache[k].map((x) => Math.round(x * 1e4) / 1e4);
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(used));
  }
  return keys.map((k) => cache[k]);
}
