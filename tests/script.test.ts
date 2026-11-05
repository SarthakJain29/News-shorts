import { describe, expect, it } from "vitest";
import { buildPrompt, draftToShort, extractJson, isGrounded, mockShort, originalityReport, sanitizeVisual } from "../pipeline/script";
import { binanceCluster } from "./fixtures";

const seg = (text: string, visual: unknown = null) => ({ text, visual });
const goodDraft = {
  title: "How a Six Billion Dollar Crypto Raid Unfolded",
  hook: "A months-long con, a fake recruiter, and a drained exchange.",
  segments: [
    seg("Crypto platform Binance has laid out how intruders pulled off one of the largest digital thefts on record this year.", { kind: "number", value: "$6.3bn", label: "Taken by the attackers" }),
    seg("According to the company, it began quietly in June, when a staff member unknowingly installed harmful software on a work machine.", { kind: "timeline", items: [{ when: "June", what: "Malware lands" }, { when: "September", what: "Engineer approached" }] }),
    seg("By September the group had moved on to an engineer, reaching out with what looked like a genuine job opportunity and interview process.", null),
    seg("That fake recruitment drive gave them a foothold inside, and over the following weeks they worked their way deeper into internal systems.", { kind: "number", value: "99", label: "invented figure" }),
    seg("If you're new to this, exchanges keep some funds in online wallets so trades settle fast, which makes those wallets an obvious prize.", null),
    seg("Security teams have long warned that people, not code, are usually the easiest way in, and this case fits that pattern closely.", { kind: "map", place: "Global", lat: 0, lon: 0 }),
    seg("For ordinary users, it is a reminder that even giant platforms can be hit, and that keeping savings spread out lowers the risk.", null),
    seg("Next, watch for whether regulators step in, and whether the stolen funds can be traced as they move through other services.", null),
  ],
  whyItMatters: "Large thefts shake trust in crypto platforms. They also show how social engineering beats technical defences.",
  context: "Binance is one of the biggest crypto exchanges. Hot wallets are online and used for quick transfers.",
  coverage: [{ outlet: "BBC News", angle: "Focused on the recruitment ploy." }, { outlet: "Unknown Paper", angle: "Not a source." }],
  location: null,
};

describe("extractJson", () => {
  it("handles fenced and prose-wrapped JSON", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"b": {"c": 2}} hope that helps')).toEqual({ b: { c: 2 } });
    expect(() => extractJson("no json")).toThrow();
  });
});

describe("originality guard", () => {
  const sources = ["Hackers behind $6.3bn Binance heist used malware and bogus job interviews, the exchange said on Tuesday"];
  it("passes rewritten narration", () => {
    expect(originalityReport("Binance says intruders took billions after tricking staff with fake hiring.", sources).ok).toBe(true);
  });
  it("flags copied runs of 8+ words", () => {
    const r = originalityReport("Today: hackers behind 6.3bn binance heist used malware and bogus job interviews.", sources);
    expect(r.ok).toBe(false);
    expect(r.copiedRuns.length).toBeGreaterThan(0);
  });
});

describe("number grounding", () => {
  const src = "Rates rose to 4.5% from 4.25%, affecting 1,200 firms.";
  it("accepts numbers present in sources (with commas/units)", () => {
    expect(isGrounded({ kind: "number", value: "1,200", label: "firms" }, src)).toBe(true);
    expect(isGrounded({ kind: "compare", left: { label: "now", value: "4.5%" }, right: { label: "before", value: "4.25%" } }, src)).toBe(true);
  });
  it("rejects invented numbers", () => {
    expect(isGrounded({ kind: "number", value: "7%", label: "x" }, src)).toBe(false);
    expect(isGrounded({ kind: "chart", title: "t", bars: [{ label: "a", value: 4.5 }, { label: "b", value: 9 }] }, src)).toBe(false);
  });
  it("drops malformed visuals", () => {
    expect(sanitizeVisual({ kind: "map", place: "X", lat: 200, lon: 0 }, src)).toBeNull();
    expect(sanitizeVisual({ kind: "sparkles" }, src)).toBeNull();
    expect(sanitizeVisual({ kind: "headline", text: "Rates up" }, src)).toEqual({ kind: "headline", text: "Rates up" });
  });
});

describe("draftToShort", () => {
  it("builds a validated short with grounded visuals and linked coverage", () => {
    const s = draftToShort(goodDraft, "technology", binanceCluster, "gemini");
    expect(s.id).toBe("technology-abc");
    expect(s.segments[0].visual).toMatchObject({ kind: "number", value: "$6.3bn" });
    expect(s.segments[3].visual).toBeNull(); // "99" is not in the sources
    expect(s.coverage).toHaveLength(1);
    expect(s.coverage[0].url).toBe("https://bbc.co.uk/y");
    expect(s.sources.map((x) => x.outlet)).toEqual(["The Guardian", "BBC News"]);
    expect(s.estDurationSec).toBeGreaterThan(55);
  });
  it("rejects scripts that are too short", () => {
    expect(() => draftToShort({ ...goodDraft, segments: goodDraft.segments.slice(0, 4) }, "technology", binanceCluster, "gemini")).toThrow(/too short/);
  });
});

describe("prompts & offline writer", () => {
  it("asks for neutral multi-outlet framing on politics", () => {
    expect(buildPrompt("politics", binanceCluster).system).toMatch(/neutral/i);
    expect(buildPrompt("technology", binanceCluster).user).toContain("The Guardian, BBC News");
  });
  it("mock writer never reuses article summaries", () => {
    const m = mockShort("technology", binanceCluster);
    const text = m.segments.map((s) => s.text).join(" ");
    for (const it of binanceCluster.items) expect(text).not.toContain(it.summary.slice(0, 40));
    expect(m.provider).toBe("mock");
    expect(m.sources).toHaveLength(2);
  });
});

describe("story check", () => {
  it("drops outlets the writer flags as covering a different event", () => {
    const s = draftToShort({ ...goodDraft, unrelatedOutlets: ["BBC News"] }, "technology", binanceCluster, "groq");
    expect(s.sources.map((x) => x.outlet)).toEqual(["The Guardian"]);
    expect(s.coverage).toEqual([]); // the only coverage entry was BBC's
    expect(s.coverageSummary).toBeNull();
  });
  it("never drops every source", () => {
    const s = draftToShort({ ...goodDraft, unrelatedOutlets: ["BBC News", "The Guardian"] }, "technology", binanceCluster, "groq");
    expect(s.sources).toHaveLength(1);
  });
});
