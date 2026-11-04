import type { TrackId } from "./types";

export interface TrackMeta {
  id: TrackId;
  label: string;
  short: string;
  /** Primary hue used for motion backgrounds & accents. */
  color: string;
  /** Secondary hue for gradients. */
  color2: string;
  ink: string;
  blurb: string;
}

export const TRACKS: Record<TrackId, TrackMeta> = {
  technology: { id: "technology", label: "Technology", short: "Tech", color: "#5B5BFF", color2: "#00E0FF", ink: "#0B0B2E", blurb: "AI, chips, apps & the platforms shaping them" },
  sports: { id: "sports", label: "Sports", short: "Sports", color: "#FF4D2E", color2: "#FFC21A", ink: "#2A0A02", blurb: "Results, transfers and the stories behind them" },
  finance: { id: "finance", label: "Finance", short: "Money", color: "#00C27A", color2: "#D4FF3A", ink: "#022615", blurb: "Markets, rates, companies and your wallet" },
  politics: { id: "politics", label: "Politics", short: "Politics", color: "#B44DFF", color2: "#FF5FA2", ink: "#1E0530", blurb: "Policy and power — framed neutrally, multi-outlet" },
  world: { id: "world", label: "World", short: "World", color: "#0091FF", color2: "#7CF5C8", ink: "#021A2E", blurb: "What's happening across borders" },
  india: { id: "india", label: "India", short: "India", color: "#FF8A00", color2: "#16C784", ink: "#2B1600", blurb: "National news, economy and policy in India" },
  science: { id: "science", label: "Science", short: "Science", color: "#00B3A4", color2: "#C38BFF", ink: "#00211E", blurb: "Space, health, climate and discovery" },
};

export const TRACK_LIST = Object.values(TRACKS);

export function isTrackId(v: unknown): v is TrackId {
  return typeof v === "string" && v in TRACKS;
}
