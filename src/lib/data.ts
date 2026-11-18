import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ShortsFeed } from "./types";

function load(file: string): ShortsFeed | null {
  try {
    const feed = JSON.parse(readFileSync(path.join(process.cwd(), "data", file), "utf8")) as ShortsFeed;
    return Array.isArray(feed.shorts) && feed.shorts.length ? feed : null;
  } catch {
    return null;
  }
}

/** Live pipeline output if present, else the bundled mock dataset (always works offline). */
export function getFeed(): ShortsFeed {
  if (process.env.NEWS_SHORTS_DATA !== "mock") {
    const live = load("shorts.json");
    if (live) return live;
  }
  return load("mock-shorts.json") ?? { generatedAt: new Date().toISOString(), mode: "mock", shorts: [] };
}
