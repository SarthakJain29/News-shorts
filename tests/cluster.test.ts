import { describe, expect, it } from "vitest";
import { agglomerate, canonicalUrl, cluster, clusterSemantic, dedupe, finalize, jaccard, pickStories, tokens } from "../pipeline/cluster";
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
});

describe("dedupe merges feed tracks", () => {
  it("keeps one copy of an article carried by two tracks' feeds and unions the tracks", () => {
    const out = dedupe([item({ url: "https://bbc.co.uk/a", tracks: ["world"] }), item({ url: "https://www.bbc.co.uk/a?at_medium=RSS", tracks: ["india"] })]);
    expect(out).toHaveLength(1);
    expect(out[0].tracks).toEqual(["world", "india"]);
  });
});

describe("semantic clustering", () => {
  // unit vectors on a circle: angle decides similarity
  const v = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const items = [
    item({ outlet: "BBC News", url: "https://bbc.co.uk/1", title: "A", tracks: ["world"] }),
    item({ outlet: "NPR", url: "https://npr.org/2", title: "B", tracks: ["politics"] }),
    item({ outlet: "DW", url: "https://dw.com/3", title: "C", tracks: ["world"] }),
    item({ outlet: "Al Jazeera", url: "https://aljazeera.com/4", title: "D", tracks: ["world"] }),
  ];
  const vectors = [v(0), v(15), v(90), v(100)];

  it("merges neighbours above the threshold only", () => {
    const groups = agglomerate(vectors, 0.9).map((g) => g.sort());
    expect(groups.sort((a, b) => a[0] - b[0])).toEqual([[0, 1], [2, 3]]);
    expect(agglomerate(vectors, 0.999)).toHaveLength(4);
  });

  it("uses average linkage so a chain cannot fuse unrelated stories", () => {
    // 0°-30°-60°-90°: single link at 0.85 would chain all four; average linkage must not.
    const chain = [v(0), v(30), v(60), v(90)];
    expect(agglomerate(chain, 0.85).length).toBeGreaterThan(1);
  });

  it("respects the maximum cluster size", () => {
    const same = Array.from({ length: 6 }, () => v(0));
    expect(agglomerate(same, 0.9, 3).every((g) => g.length <= 3)).toBe(true);
  });

  it("builds ranked clusters with track votes and a stable id", () => {
    const cs = clusterSemantic(items, vectors, now, 0.9);
    expect(cs).toHaveLength(2);
    const first = cs.find((c) => c.outlets.includes("BBC News"))!;
    expect(first.outlets.sort()).toEqual(["BBC News", "NPR"]);
    expect(first.tracks).toEqual({ world: 1, politics: 1 });
    expect(first.primary).toBe("politics"); // tie → the more specific desk wins
    const again = finalize([items[1], items[0]], now); // same members, different order
    expect(again.id).toBe(first.id);
  });

  it("falls back to lexical clustering when no vectors are given", () => {
    expect(cluster(items, now).length).toBeGreaterThan(0);
  });
});

describe("pickStories", () => {
  const mk = (id: string, primary: "world" | "india" | null, score: number, tracks: Record<string, number>) =>
    ({ id, items: [], outlets: [], score, latest: "", tracks, primary }) as unknown as Parameters<typeof pickStories>[0][number];
  it("gives each story to one track and tops up short tracks from secondary votes", () => {
    const clusters = [mk("a", "world", 9, { world: 2 }), mk("b", "world", 8, { world: 1 }), mk("c", "india", 7, { india: 1, world: 1 }), mk("d", "world", 6, { world: 1, india: 1 }), mk("e", "world", 5, { world: 1 })];
    const picks = pickStories(clusters, ["world", "india"], 2);
    expect(picks.map((p) => `${p.track}:${p.c.id}`)).toEqual(["world:a", "world:b", "india:c", "india:d"]);
  });
});
