export type { Lang } from "../../src/lib/types";
import type { Lang } from "../../src/lib/types";

export interface NarrationRequest {
  /** One entry per script segment, in order. Providers synthesize segment by segment when they can. */
  segments: string[];
  lang: Lang;
  voice?: string;
}

export interface NarrationOutput {
  samples: Float32Array;
  sampleRate: number;
  /** [start, end] seconds of each segment within `samples`, contiguous; present when the engine synthesises per segment. */
  segmentTimes: [number, number][] | null;
  provider: string;
  model: string;
  voice: string;
}

export interface TtsProvider {
  name: string;
  langs: Lang[];
  available(): boolean;
  synthesize(req: NarrationRequest): Promise<NarrationOutput>;
}
