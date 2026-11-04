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
  const seen = new Set<string>();
  const out: RawItem[] = [];
  for (const it of items) {
    const key = canonicalUrl(it.url);
    if (seen.has(key)) continue;
    const tk = tokens(it.title);
    if (out.some((o) => o.outlet === it.outlet && jaccard(tokens(o.title), tk) > 0.85)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export interface Cluster {
  id: string;
  items: RawItem[];
  outlets: string[];
  score: number;
  latest: string;
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

/** Single-link clustering with union-find; ranks by outlet breadth, then recency. */
export function cluster(items: RawItem[], now = Date.now()): Cluster[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) if (similar(items[i], items[j])) parent[find(i)] = find(j);

  const groups = new Map<number, RawItem[]>();
  items.forEach((it, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), it]);
  });

  const clusters: Cluster[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const outlets = [...new Set(g.map((x) => x.outlet))];
    const latest = g[0].publishedAt;
    const ageH = Math.max(0, (now - Date.parse(latest)) / 3.6e6);
    const recency = Math.max(0, 1 - ageH / 48);
    const score = outlets.length * 2 + Math.min(g.length, 6) * 0.3 + recency * 2;
    clusters.push({ id: hashId(g.map((x) => canonicalUrl(x.url)).sort()[0]), items: g, outlets, score, latest });
  }
  return clusters.sort((a, b) => b.score - a.score || b.latest.localeCompare(a.latest));
}

/**
 * Pull in matching articles from other tracks' feeds (e.g. a world desk covering a politics story)
 * so each short can cite — and compare — more outlets.
 */
export function enrich(c: Cluster, pool: RawItem[]): Cluster {
  const have = new Set(c.items.map((i) => canonicalUrl(i.url)));
  const extra = pool.filter((p) => !have.has(canonicalUrl(p.url)) && !c.outlets.includes(p.outlet) && c.items.some((i) => similar(i, p)));
  const byOutlet = new Map<string, RawItem>();
  for (const e of extra) if (!byOutlet.has(e.outlet)) byOutlet.set(e.outlet, e);
  if (byOutlet.size === 0) return c;
  const items = [...c.items, ...byOutlet.values()];
  return { ...c, items, outlets: [...new Set(items.map((i) => i.outlet))] };
}

/** True if two clusters cover the same story (used to avoid cross-track repeats). */
export function sameStory(a: Cluster, b: Cluster): boolean {
  return a.items.some((x) => b.items.some((y) => canonicalUrl(x.url) === canonicalUrl(y.url) || similar(x, y)));
}
