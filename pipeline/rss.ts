import { XMLParser } from "fast-xml-parser";
import type { TrackId } from "../src/lib/types";

export interface RawItem {
  outlet: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  /** Tracks whose feeds carried this article. */
  tracks?: TrackId[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: true,
});

const ENTITY: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

export function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return text(o["#text"]);
    if ("@href" in o) return text(o["@href"]);
  }
  return "";
}

function atomLink(v: unknown): string {
  const links = Array.isArray(v) ? v : [v];
  for (const l of links) {
    if (l && typeof l === "object") {
      const o = l as Record<string, unknown>;
      if (!o["@rel"] || o["@rel"] === "alternate") return text(o["@href"]);
    } else if (typeof l === "string") return l;
  }
  return "";
}

function toIso(d: string): string {
  const t = Date.parse(d);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

/** Parse RSS 2.0, RSS 1.0 (RDF) or Atom into a flat item list. */
export function parseFeed(xml: string, outlet: string): RawItem[] {
  const doc = parser.parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rssItems = doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item ?? doc?.channel?.item;
  const atomEntries = doc?.feed?.entry;
  const items: RawItem[] = [];
  const asArray = <T,>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

  for (const it of asArray(rssItems)) {
    const title = stripHtml(text(it.title));
    const url = text(it.link) || text(it.guid);
    if (!title || !url) continue;
    items.push({
      outlet,
      title,
      url: url.trim(),
      summary: stripHtml(text(it.description) || text(it["content:encoded"])).slice(0, 700),
      publishedAt: toIso(text(it.pubDate) || text(it["dc:date"]) || ""),
    });
  }
  for (const e of asArray(atomEntries)) {
    const title = stripHtml(text(e.title));
    const url = atomLink(e.link);
    if (!title || !url) continue;
    items.push({
      outlet,
      title,
      url: url.trim(),
      summary: stripHtml(text(e.summary) || text(e.content)).slice(0, 700),
      publishedAt: toIso(text(e.updated) || text(e.published) || ""),
    });
  }
  return items;
}

export async function fetchFeed(url: string, outlet: string, timeoutMs = 15000): Promise<RawItem[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "NewsShortsBot/0.1 (+https://github.com/SarthakJain29/News-shorts)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), outlet);
}
