import type { Cluster } from "../pipeline/cluster";
import type { RawItem } from "../pipeline/rss";
import type { Short } from "../src/lib/types";

export const now = Date.parse("2026-11-04T12:00:00Z");

export function item(p: Partial<RawItem>): RawItem {
  return { outlet: "BBC News", title: "Title", url: "https://example.com/a", summary: "", publishedAt: "2026-11-04T10:00:00.000Z", ...p };
}

export const binanceCluster: Cluster = {
  id: "abc",
  outlets: ["The Guardian", "BBC News"],
  score: 5,
  latest: "2026-11-04T10:00:00.000Z",
  tracks: { technology: 2 },
  primary: "technology",
  items: [
    item({ outlet: "The Guardian", title: "Hackers behind $6.3bn Binance heist used malware and bogus job interviews", url: "https://theguardian.com/x", summary: "The exchange said attackers stole 6.3bn after an employee downloaded malware in June and an engineer was targeted in September." }),
    item({ outlet: "BBC News", title: "Binance reveals how hackers stole billions", url: "https://bbc.co.uk/y", summary: "Fake job interviews on a recruitment platform were used to reach staff, the company said." }),
  ],
};

export function short(p: Partial<Short> = {}): Short {
  return {
    id: "technology-x",
    track: "technology",
    title: "A title",
    hook: "A hook",
    segments: [
      { text: "First sentence of the explainer. It sets the scene." },
      { text: "Second segment explains what happened next, in order." },
      { text: "Third segment adds background for newcomers to the story." },
      { text: "Fourth says why it matters." },
      { text: "Fifth looks ahead." },
    ],
    whyItMatters: "Because.",
    context: "Background.",
    coverage: [],
    sources: [{ outlet: "BBC News", title: "t", url: "https://bbc.co.uk", publishedAt: "2026-11-04T10:00:00.000Z" }],
    location: null,
    publishedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    estDurationSec: 60,
    audio: null,
    provider: "gemini",
    ...p,
  };
}
