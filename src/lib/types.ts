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
  /** 2–4 word label for what this outlet emphasised, e.g. "legal angle". */
  emphasis?: string;
  /** The outlet's own headline (shown as attribution, never in the script). */
  headline?: string;
  publishedAt?: string;
}

/** Cross-outlet synthesis: what every outlet reports vs. where framing differs. */
export interface CoverageSummary {
  agreement: string;
  differences: string;
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

export type Lang = "en" | "hi";

export interface NarrationAudio {
  /** Same-origin path (/audio/x.mp3) or an absolute URL when audio lives in object storage. */
  src: string;
  durationSec: number;
  model: string;
  voice: string;
  /** Content hash of text + voice + engine: the cache key. */
  key?: string;
  lang?: Lang;
  /** Flat [start0, end0, start1, end1, …] seconds per word of `segments` (split on whitespace). Absent → estimated. */
  wordTimes?: number[];
  /** How wordTimes were obtained. */
  align?: "whisper-groq" | "whisper-local" | "segments";
}

/** A full alternate-language rendition of a short (script, visuals' labels, narration). */
export interface Translation {
  title: string;
  hook: string;
  segments: Segment[];
  whyItMatters: string;
  context: string;
  coverage: Coverage[];
  coverageSummary?: CoverageSummary | null;
  estDurationSec: number;
  audio: NarrationAudio | null;
  provider: "gemini" | "groq" | "mock" | "editorial";
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
  coverageSummary?: CoverageSummary | null;
  sources: SourceLink[];
  location: { place: string; lat: number; lon: number } | null;
  publishedAt: string;
  generatedAt: string;
  /** Estimated narration length when no audio file exists. */
  estDurationSec: number;
  audio: NarrationAudio | null;
  /** Alternate-language renditions, keyed by language (currently Hindi for the India track). */
  i18n?: Partial<Record<Exclude<Lang, "en">, Translation>>;
  provider: "gemini" | "groq" | "mock" | "editorial";
}

export interface ShortsFeed {
  generatedAt: string;
  mode: "live" | "mock";
  shorts: Short[];
}
