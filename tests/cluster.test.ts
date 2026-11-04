import { describe, expect, it } from "vitest";
import { canonicalUrl, cluster, dedupe, jaccard, sameStory, tokens } from "../pipeline/cluster";
import { item, now } from "./fixtures";

describe("tokens & similarity", () => {
  it("drops stopwords and stems plurals", () => {
    expect([...tokens("The Rates of Banks are rising")]).toEqual(["rate", "bank", "rising"]);
  });
  it("computes jaccard", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0);
  });
  it("canonicalises URLs by stripping tracking params", () => {
    expect(canonicalUrl("https://www.bbc.co.uk/news/x/?at_medium=RSS&at_campaign=rss#top")).toBe("bbc.co.uk/news/x");
    expect(canonicalUrl("https://ex.com/a?id=3&utm_source=x")).toBe("ex.com/a?id=3");
  });
});

describe("dedupe", () => {
  it("removes duplicate URLs and same-outlet repeats", () => {
    const items = [
      item({ url: "https://bbc.co.uk/a?at_medium=RSS", title: "Fed holds interest rates steady" }),
      item({ url: "https://www.bbc.co.uk/a", title: "Something else" }),
      item({ url: "https://bbc.co.uk/b", title: "Fed holds interest rates steady" }),
      item({ url: "https://npr.org/c", outlet: "NPR", title: "Fed holds interest rates steady" }),
    ];
    expect(dedupe(items).map((i) => i.url)).toEqual(["https://bbc.co.uk/a?at_medium=RSS", "https://npr.org/c"]);
  });
});

describe("cluster", () => {
  const items = [
    item({ outlet: "BBC News", url: "https://bbc.co.uk/1", title: "Binance reveals how hackers stole $6.3bn in crypto heist" }),
    item({ outlet: "The Guardian", url: "https://theguardian.com/2", title: "Hackers behind $6.3bn Binance heist used bogus job interviews" }),
    item({ outlet: "NPR", url: "https://npr.org/3", title: "South Africans vote in local elections amid anger over services" }),
    item({ outlet: "Al Jazeera", url: "https://aljazeera.com/4", title: "South Africa local elections: ANC faces voter anger over services" }),
    item({ outlet: "DW", url: "https://dw.com/5", title: "Rare comet visible from Earth this weekend", publishedAt: "2026-11-01T10:00:00.000Z" }),
  ];
  const clusters = cluster(items, now);

  it("groups the same story across outlets", () => {
    expect(clusters).toHaveLength(3);
    const binance = clusters.find((c) => c.items.some((i) => i.title.includes("Binance")))!;
    expect(binance.outlets.sort()).toEqual(["BBC News", "The Guardian"]);
  });

  it("ranks multi-outlet, recent stories first", () => {
    expect(clusters[2].outlets).toEqual(["DW"]);
    expect(clusters[0].score).toBeGreaterThan(clusters[2].score);
  });

  it("produces stable ids", () => {
    expect(cluster(items, now).map((c) => c.id)).toEqual(clusters.map((c) => c.id));
  });

  it("detects the same story across tracks", () => {
    const [a, b] = [cluster(items.slice(0, 1), now)[0], cluster(items.slice(1, 2), now)[0]];
    expect(sameStory(a, b)).toBe(true);
    expect(sameStory(a, cluster(items.slice(4), now)[0])).toBe(false);
  });
});
