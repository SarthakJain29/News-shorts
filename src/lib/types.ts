export const TRACK_IDS = [
  "technology",
  "sports",
  "finance",
  "politics",
  "world",
  "india",
  "science",
] as const;

export type TrackId = (typeof TRACK_IDS)[number];

export interface SourceLink {
  outlet: string;
  title: string;
  url: string;
  publishedAt: string;
}

/** How one outlet framed the story (neutral, paraphrased — never quoted). */
export interface Coverage {
  outlet: string;
  angle: string;
  url: string;
}

export type Visual =
  | { kind: "headline"; text: string }
  | { kind: "number"; value: string; label: string }
  | { kind: "chart"; title: string; unit?: string; bars: { label: string; value: number }[] }
  | { kind: "map"; place: string; lat: number; lon: number }
  | { kind: "timeline"; items: { when: string; what: string }[] }
  | { kind: "compare"; left: { label: string; value: string }; right: { label: string; value: string } };

export interface Segment {
  text: string;
  visual?: Visual | null;
}

export interface NarrationAudio {
  src: string;
  durationSec: number;
  model: string;
  voice: string;
}

export interface Short {
  id: string;
  track: TrackId;
  title: string;
  hook: string;
  segments: Segment[];
  whyItMatters: string;
  context: string;
  coverage: Coverage[];
  sources: SourceLink[];
  location: { place: string; lat: number; lon: number } | null;
  publishedAt: string;
  generatedAt: string;
  /** Estimated narration length when no audio file exists. */
  estDurationSec: number;
  audio: NarrationAudio | null;
  provider: "gemini" | "groq" | "mock" | "editorial";
}

export interface ShortsFeed {
  generatedAt: string;
  mode: "live" | "mock";
  shorts: Short[];
}
