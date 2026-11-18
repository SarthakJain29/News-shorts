import type { ShortsFeed } from "../src/lib/types";

/** Pretty JSON, but numeric arrays (word timings) stay on one line so diffs stay readable. */
export function stringifyFeed(feed: ShortsFeed): string {
  return JSON.stringify(feed, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_m, inner: string) => `[${inner.replace(/\s+/g, " ")}]`) + "\n";
}
