import { describe, expect, it } from "vitest";
import { buildFeed, catchUp, clipDuration, durationOf, formatClock, interleave, timeAgo } from "../src/lib/playlist";
import { short } from "./fixtures";

const list = [
  short({ id: "t1", track: "technology", estDurationSec: 80 }),
  short({ id: "t2", track: "technology", estDurationSec: 70 }),
  short({ id: "s1", track: "sports", estDurationSec: 75 }),
  short({ id: "f1", track: "finance", estDurationSec: 90, audio: { src: "/audio/x.mp3", durationSec: 85, model: "m", voice: "v" } }),
  short({ id: "m1", track: "science", estDurationSec: 20, provider: "mock" }),
];

describe("feed ordering", () => {
  it("interleaves tracks round-robin", () => {
    expect(interleave(list, ["technology", "sports"]).map((s) => s.track)).toEqual(["technology", "sports", "technology"]);
  });
  it("puts seen shorts last", () => {
    const feed = buildFeed(list, ["technology", "sports", "finance"], new Set(["f1"]));
    expect(feed.at(-1)!.id).toBe("f1");
    expect(feed).toHaveLength(4);
  });
  it("prefers real audio duration", () => {
    expect(durationOf(list[3])).toBe(85);
  });
});

describe("catchUp", () => {
  it("covers each chosen track first and stays within ~3 minutes", () => {
    const pl = catchUp(list, ["technology", "sports", "finance"], 180, 2);
    expect(new Set(pl.map((s) => s.track))).toEqual(new Set(["technology", "sports", "finance"]));
    expect(pl.reduce((a, s) => a + clipDuration(s, 2), 0)).toBeLessThanOrEqual(190);
    expect(pl.some((s) => s.provider === "mock")).toBe(false);
  });
  it("clips each story to its first beats", () => {
    expect(clipDuration(list[0], 2)).toBeLessThan(durationOf(list[0]));
    expect(clipDuration(list[0], 99)).toBe(durationOf(list[0]));
  });
});

describe("formatting", () => {
  it("formats clocks and relative times", () => {
    expect(formatClock(185)).toBe("3:05");
    const now = Date.parse("2026-11-04T12:00:00Z");
    expect(timeAgo("2026-11-04T11:30:00Z", now)).toBe("30m ago");
    expect(timeAgo("2026-11-03T12:00:00Z", now)).toBe("24h ago");
    expect(timeAgo("2026-11-01T12:00:00Z", now)).toBe("3d ago");
  });
});
