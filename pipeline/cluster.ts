import type { TrackId } from "../src/lib/types";
import type { RawItem } from "./rss";

const STOP = new Set(
  "a an the and or but of to in on at for from by with as is are was were be been being it its this that these those after before over under into about amid says say said new news live latest update updates how why what who when where will would could can may might has have had not no than more most just up out off top vs video watch".split(" "),
);

/** Lowercased, de-stopworded, lightly stemmed tokens. */
export function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    let w = raw;
    if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Overlap coefficient — robust when one headline is much shorter than the other. */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|at_|cmp|ns_|ref|ito)/i.test(k)) url.searchParams.delete(k);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch {
    return u;
  }
}

/** Drop exact duplicates (same canonical URL) and same-outlet near-identical headlines. */
export function dedupe(items: RawItem[]): RawItem[] {
  const seen = new Map<string, RawItem>();
  const out: RawItem[] = [];
  const mergeTracks = (into: RawItem, from: RawItem) => {
    if (from.tracks?.length) into.tracks = [...new Set([...(into.tracks ?? []), ...from.tracks])];
  };
  for (const it of items) {
    const key = canonicalUrl(it.url);
    const dup = seen.get(key);
    if (dup) {
      mergeTracks(dup, it);
      continue;
    }
    const tk = tokens(it.title);
    const near = out.find((o) => o.outlet === it.outlet && jaccard(tokens(o.title), tk) > 0.85);
    if (near) {
      mergeTracks(near, it);
      continue;
    }
    const copy = { ...it, tracks: it.tracks ? [...it.tracks] : undefined };
    seen.set(key, copy);
    out.push(copy);
  }
  return out;
}

/** When a story is carried by several tracks' feeds, the more specific desk wins; "world" is the catch-all. */
export const TRACK_SPECIFICITY: TrackId[] = ["politics", "india", "science", "finance", "technology", "sports", "world"];

export interface Cluster {
  id: string;
  items: RawItem[];
  outlets: string[];
  score: number;
  latest: string;
  /** How many member articles each track's feeds contributed. */
  tracks: Partial<Record<TrackId, number>>;
  /** Track that "owns" the story (most votes, ties broken by specificity). */
  primary: TrackId | null;
}

export function similar(a: RawItem, b: RawItem): boolean {
  const ta = tokens(a.title);
  const tb = tokens(b.title);
  const titleSim = jaccard(ta, tb);
  if (titleSim >= 0.34) return true;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  if (shared < 2) return false;
  const fa = tokens(`${a.title} ${a.summary.split(" ").slice(0, 40).join(" ")}`);
  const fb = tokens(`${b.title} ${b.summary.split(" ").slice(0, 40).join(" ")}`);
  return jaccard(fa, fb) >= 0.22 || (overlap(ta, tb) >= 0.6 && shared >= 3);
}

export function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Turn a group of articles into a ranked, identified cluster. */
export function finalize(group: RawItem[], now: number): Cluster {
  const g = [...group].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const outlets = [...new Set(g.map((x) => x.outlet))];
  const latest = g[0].publishedAt;
  const ageH = Math.max(0, (now - Date.parse(latest)) / 3.6e6);
  const recency = Math.max(0, 1 - ageH / 48);
  const score = outlets.length * 2 + Math.min(g.length, 6) * 0.3 + recency * 2;
  const votes: Partial<Record<TrackId, number>> = {};
  for (const it of g) for (const t of it.tracks ?? []) votes[t] = (votes[t] ?? 0) + 1;
  const primary = TRACK_SPECIFICITY.reduce<TrackId | null>((best, t) => ((votes[t] ?? 0) > (best ? (votes[best] ?? 0) : 0) ? t : best), null);
  // Anchor the id to the oldest article: stable as later outlets join the story.
  const oldest = [...g].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || canonicalUrl(a.url).localeCompare(canonicalUrl(b.url)))[0];
  return { id: hashId(canonicalUrl(oldest.url)), items: g, outlets, score, latest, tracks: votes, primary };
}

function rank(clusters: Cluster[]): Cluster[] {
  return clusters.sort((a, b) => b.score - a.score || b.latest.localeCompare(a.latest));
}

/** Single-link clustering on headline/summary token overlap (no API needed). */
export function clusterLexical(items: RawItem[], now = Date.now()): Cluster[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (similar(items[i], items[j])) parent[find(i)] = find(j);
  const groups = new Map<number, RawItem[]>();
  items.forEach((it, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), it]);
  });
  return rank([...groups.values()].map((g) => finalize(g, now)));
}

/** Embedding similarity above which two articles are treated as the same story (calibrated on real feeds). */
export const DEFAULT_EMBED_THRESHOLD = 0.6;
export const MAX_CLUSTER_SIZE = 14;

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Average-linkage agglomerative clustering over unit vectors. Average linkage (not single link)
 * stops a chain of loosely-related headlines from fusing unrelated stories.
 * Returns groups of indices.
 */
export function agglomerate(vectors: number[][], threshold = DEFAULT_EMBED_THRESHOLD, maxSize = MAX_CLUSTER_SIZE): number[][] {
  const n = vectors.length;
  const S = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) S[i * n + j] = S[j * n + i] = dot(vectors[i], vectors[j]);
  const members: number[][] = vectors.map((_, i) => [i]);
  const active = new Set(vectors.map((_, i) => i));
  for (;;) {
    let best = -1;
    let ba = -1;
    let bb = -1;
    const ids = [...active];
    for (let x = 0; x < ids.length; x++)
      for (let y = x + 1; y < ids.length; y++) {
        const a = ids[x];
        const b = ids[y];
        const v = S[a * n + b];
        if (v > best && v >= threshold && members[a].length + members[b].length <= maxSize) {
          best = v;
          ba = a;
          bb = b;
        }
      }
    if (ba < 0) break;
    const sa = members[ba].length;
    const sb = members[bb].length;
    for (const k of active) {
      if (k === ba || k === bb) continue;
      const v = (sa * S[ba * n + k] + sb * S[bb * n + k]) / (sa + sb);
      S[ba * n + k] = S[k * n + ba] = v;
    }
    members[ba].push(...members[bb]);
    active.delete(bb);
  }
  return [...active].map((i) => members[i]);
}

/** Semantic clustering: `vectors[i]` must be the unit-length embedding of `items[i]`. */
export function clusterSemantic(items: RawItem[], vectors: number[][], now = Date.now(), threshold = DEFAULT_EMBED_THRESHOLD): Cluster[] {
  if (vectors.length !== items.length) throw new Error("vectors/items length mismatch");
  return rank(agglomerate(vectors, threshold).map((idx) => finalize(idx.map((i) => items[i]), now)));
}

/** Cluster with embeddings when provided, else the lexical method. */
export function cluster(items: RawItem[], now = Date.now(), vectors?: number[][], threshold = DEFAULT_EMBED_THRESHOLD): Cluster[] {
  return vectors ? clusterSemantic(items, vectors, now, threshold) : clusterLexical(items, now);
}

/**
 * Pick stories per track from globally-clustered news. Each story goes to the track that owns it
 * (most feed votes); tracks that come up short are topped up with stories their feeds also carried.
 */
export function pickStories(clusters: Cluster[], tracks: TrackId[], perTrack: number): { track: TrackId; c: Cluster }[] {
  const picked: { track: TrackId; c: Cluster }[] = [];
  const taken = new Set<Cluster>();
  const byTrack = new Map<TrackId, Cluster[]>();
  for (const t of tracks) {
    const own = clusters.filter((c) => c.primary === t).slice(0, perTrack);
    byTrack.set(t, own);
    own.forEach((c) => taken.add(c));
  }
  for (const t of tracks) {
    const list = byTrack.get(t) ?? [];
    if (list.length < perTrack) {
      const extra = clusters.filter((c) => !taken.has(c) && (c.tracks[t] ?? 0) > 0).slice(0, perTrack - list.length);
      extra.forEach((c) => taken.add(c));
      list.push(...extra);
    }
    for (const c of list) picked.push({ track: t, c });
  }
  return picked;
}
