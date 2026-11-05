import { z } from "zod";
import type { Coverage, Segment, Short, SourceLink, TrackId, Visual } from "../src/lib/types";
import { TRACKS } from "../src/lib/tracks";
import type { Cluster } from "./cluster";

export const WORDS_PER_SECOND = 2.5;

const visualSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("headline"), text: z.string().min(1).max(90) }),
  z.object({ kind: z.literal("number"), value: z.string().min(1).max(16), label: z.string().min(1).max(70) }),
  z.object({
    kind: z.literal("chart"),
    title: z.string().min(1).max(70),
    unit: z.string().max(12).optional().nullable().transform((v) => v ?? undefined),
    bars: z.array(z.object({ label: z.string().min(1).max(24), value: z.number().finite() })).min(2).max(6),
  }),
  z.object({ kind: z.literal("map"), place: z.string().min(1).max(50), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  z.object({ kind: z.literal("timeline"), items: z.array(z.object({ when: z.string().min(1).max(20), what: z.string().min(1).max(70) })).min(2).max(5) }),
  z.object({
    kind: z.literal("compare"),
    left: z.object({ label: z.string().min(1).max(30), value: z.string().min(1).max(16) }),
    right: z.object({ label: z.string().min(1).max(30), value: z.string().min(1).max(16) }),
  }),
]);

export const scriptSchema = z.object({
  title: z.string().min(5).max(110),
  hook: z.string().min(5).max(220),
  segments: z
    .array(z.object({ text: z.string().min(3).max(400), visual: z.unknown().optional().nullable() }))
    .min(4)
    .max(12),
  whyItMatters: z.string().min(10).max(500),
  context: z.string().min(10).max(600),
  coverage: z
    .array(z.object({ outlet: z.string(), angle: z.string().min(3).max(240), emphasis: z.string().max(40).optional().nullable() }))
    .optional()
    .default([]),
  agreement: z.string().max(300).optional().nullable(),
  differences: z.string().max(360).optional().nullable(),
  location: z
    .object({ place: z.string(), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
    .nullable()
    .optional()
    .default(null),
});

export type ScriptDraft = z.infer<typeof scriptSchema>;

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Up to 8 articles for the prompt: one per outlet first (so every outlet is represented), then extras. */
export function promptSources(c: Cluster, max = 8): Cluster["items"] {
  const firstPerOutlet = c.outlets.map((o) => c.items.find((i) => i.outlet === o)!).filter(Boolean);
  const rest = c.items.filter((i) => !firstPerOutlet.includes(i));
  return [...firstPerOutlet, ...rest].slice(0, max);
}

export function buildPrompt(track: TrackId, c: Cluster): { system: string; user: string } {
  const isPolitics = track === "politics";
  const system = [
    "You are the head writer of News Shorts, a vertical-video news explainer app.",
    "Write ORIGINAL narration in your own words. Never copy sentences or distinctive phrases from the source snippets; never quote them.",
    "Only state facts supported by the snippets. If a detail is uncertain, say so plainly. No speculation, no sensationalism, no opinions.",
    "Write for the ear: short sentences, active voice, conversational but precise. Spell out abbreviations the first time.",
    isPolitics
      ? "This is POLITICS: use strictly neutral framing. Attribute claims to who made them. Avoid loaded words. Give each side's stated position fairly. Always fill `coverage`, `agreement` and `differences` (when 2+ outlets)."
      : "When 2+ outlets cover the story, fill `coverage` (one entry per outlet), `agreement` and `differences`.",
    "COVERAGE COMPARISON RULES: base it only on the per-outlet headlines/snippets provided. `angle` = one sentence, in your own words, on what that outlet emphasised or how it framed the story. `emphasis` = a 2–4 word label (e.g. \"economic impact\", \"legal angle\", \"human cost\"). `agreement` = one sentence on the facts every outlet reports. `differences` = one sentence on where emphasis, framing or detail differs; if the snippets show no meaningful difference say so plainly. Never quote, never invent details an outlet did not report, never judge which outlet is right.",
    "Return ONLY a JSON object matching the requested schema.",
  ].join("\n");

  const sources = promptSources(c)
    .map((it, i) => `[${i + 1}] OUTLET: ${it.outlet} — ${it.publishedAt.slice(0, 10)}\nHEADLINE: ${it.title}\nSNIPPET: ${it.summary.slice(0, 450) || "(none)"}`)
    .join("\n\n");

  const user = `Track: ${TRACKS[track].label}
Today: ${new Date().toISOString().slice(0, 10)}
Outlets covering it: ${c.outlets.join(", ")}

SOURCE SNIPPETS (reference only — do not copy wording):
${sources}

Write a 60–90 second narrated explainer. LENGTH IS CRITICAL: the segment texts together must total 160–210 words (7–9 segments of 20–28 words each, usually two sentences). Count your words before answering.

JSON schema:
{
  "title": string (our own headline, max 70 chars, not the outlets' wording),
  "hook": string (one punchy opening line, max 110 chars),
  "segments": [ { "text": string (two spoken sentences, 20–28 words), "visual": Visual | null } ] (8 segments in this order: 1 hook; 2–4 what happened, who and where; 5–6 background a newcomer needs; 7 why it matters to ordinary people; 8 what to watch next),
  "whyItMatters": string (2 sentences, plain language),
  "context": string ("Context if you're new to this": 2–3 sentences of background),
  "coverage": [ { "outlet": string (exactly as listed above), "angle": string, "emphasis": string } ] ([] if only one outlet),
  "agreement": string ("" if only one outlet),
  "differences": string ("" if only one outlet),
  "location": { "place": string, "lat": number, "lon": number } | null (main place the story is about)
}
Visual is one of:
  { "kind": "headline", "text": string }  (a 3–7 word on-screen title)
  { "kind": "number", "value": string, "label": string }  (key figure, e.g. "4.5%" — MUST appear in the snippets)
  { "kind": "chart", "title": string, "unit": string, "bars": [ { "label": string, "value": number } ] }  (only with numbers from the snippets)
  { "kind": "compare", "left": { "label": string, "value": string }, "right": { "label": string, "value": string } }  (numbers from snippets)
  { "kind": "timeline", "items": [ { "when": string, "what": string } ] }
  { "kind": "map", "place": string, "lat": number, "lon": number }
Use a variety of visuals; at least half of segments should have one. Never invent numbers.`;
  return { system, user };
}

/** Extract the first JSON object from a model response (handles code fences / prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in response");
  return JSON.parse(body.slice(start, end + 1));
}

function ngrams(s: string, n: number): Set<string> {
  const w = s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/**
 * Originality guard: flags scripts that reuse source wording.
 * Fails if any 8-word run is copied, or >12% of the script's 5-grams appear in the sources.
 */
export function originalityReport(script: string, sourceTexts: string[]): { ok: boolean; copiedRuns: string[]; shared5: number } {
  const src = sourceTexts.join(" \n ");
  const src8 = ngrams(src, 8);
  const copiedRuns = [...ngrams(script, 8)].filter((g) => src8.has(g));
  const s5 = ngrams(script, 5);
  const src5 = ngrams(src, 5);
  const shared = [...s5].filter((g) => src5.has(g)).length;
  const shared5 = s5.size ? shared / s5.size : 0;
  return { ok: copiedRuns.length === 0 && shared5 <= 0.12, copiedRuns, shared5 };
}

function numericTokens(s: string): string[] {
  return (s.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []);
}

/** Every number shown on screen must be present in the source text. */
export function isGrounded(v: Visual, sourceText: string): boolean {
  const src = new Set(numericTokens(sourceText));
  const all = (vals: string[]) => vals.flatMap(numericTokens).every((n) => src.has(n));
  switch (v.kind) {
    case "number":
      return numericTokens(v.value).length > 0 && all([v.value]);
    case "chart":
      return v.bars.every((b) => src.has(String(b.value)) || src.has(String(Number(b.value.toFixed(2)))));
    case "compare":
      return all([v.left.value, v.right.value]);
    default:
      return true;
  }
}

export function sanitizeVisual(raw: unknown, sourceText: string): Visual | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = visualSchema.safeParse(raw);
  if (!parsed.success) return null;
  return isGrounded(parsed.data as Visual, sourceText) ? (parsed.data as Visual) : null;
}

export function sourcesOf(c: Cluster): SourceLink[] {
  const byOutlet = new Map<string, SourceLink>();
  for (const it of c.items) if (!byOutlet.has(it.outlet)) byOutlet.set(it.outlet, { outlet: it.outlet, title: it.title, url: it.url, publishedAt: it.publishedAt });
  return [...byOutlet.values()];
}

/** Validate a model draft and turn it into a Short. Throws with a reason on failure. */
export function draftToShort(raw: unknown, track: TrackId, c: Cluster, provider: Short["provider"]): Short {
  const draft = scriptSchema.parse(raw);
  const sourceText = c.items.map((i) => `${i.title}. ${i.summary}`).join("\n");
  const narration = draft.segments.map((s) => s.text).join(" ");
  const words = wordCount(narration);
  if (words < 120) throw new Error(`Script too short (${words} words) — write 160–210 words total, 7–9 segments of 20–28 words`);
  if (words > 260) throw new Error(`Script too long (${words} words) — write 160–210 words total`);
  const orig = originalityReport(narration, c.items.flatMap((i) => [i.title, i.summary]));
  if (!orig.ok) throw new Error(`Originality guard failed (shared5=${orig.shared5.toFixed(2)}, runs=${orig.copiedRuns.length})`);

  const segments: Segment[] = draft.segments.map((s) => ({ text: s.text.trim(), visual: sanitizeVisual(s.visual, sourceText) }));
  const sources = sourcesOf(c);
  const seenOutlets = new Set<string>();
  const coverage: Coverage[] = [];
  for (const cv of draft.coverage) {
    const src = sources.find((s) => s.outlet.toLowerCase() === cv.outlet.toLowerCase());
    if (!src || seenOutlets.has(src.outlet)) continue;
    seenOutlets.add(src.outlet);
    coverage.push({ outlet: src.outlet, angle: cv.angle.trim(), url: src.url, emphasis: cv.emphasis?.trim() || undefined, headline: src.title, publishedAt: src.publishedAt });
  }
  const coverageSummary = sources.length > 1 && coverage.length > 1 && draft.agreement?.trim() ? { agreement: draft.agreement.trim(), differences: (draft.differences ?? "").trim() } : null;

  return {
    id: `${track}-${c.id}`,
    track,
    title: draft.title.trim(),
    hook: draft.hook.trim(),
    segments,
    whyItMatters: draft.whyItMatters.trim(),
    context: draft.context.trim(),
    coverage,
    coverageSummary,
    sources,
    location: draft.location ?? null,
    publishedAt: c.latest,
    generatedAt: new Date().toISOString(),
    estDurationSec: Math.round(words / WORDS_PER_SECOND),
    audio: null,
    provider,
  };
}

/**
 * Deterministic no-LLM writer used when keys are missing or every provider fails.
 * It deliberately avoids reusing article text: it reports *that* outlets are covering a story
 * and points to the sources, using only the shortest headline as the on-screen topic.
 */
export function mockShort(track: TrackId, c: Cluster): Short {
  const sources = sourcesOf(c);
  const topic = [...c.items].sort((a, b) => a.title.length - b.title.length)[0].title;
  const n = c.outlets.length;
  const label = TRACKS[track].label.toLowerCase();
  const segments: Segment[] = [
    { text: `Here's a ${label} story worth a minute of your time.`, visual: { kind: "headline", text: "Developing story" } },
    { text: `The topic, in the outlets' own headline: ${topic}.`, visual: { kind: "headline", text: topic.slice(0, 88) } },
    { text: n > 1 ? `${n} outlets are covering it, including ${c.outlets.slice(0, 3).join(", ")}.` : `It's being reported by ${c.outlets[0]}.`, visual: { kind: "number", value: String(n), label: n > 1 ? "outlets covering this" : "outlet covering this" } },
    { text: "This short was prepared in offline mode, so we haven't written a full explainer yet.", visual: null },
    { text: "Tap the sources button to read the original reporting, and check back after the next refresh.", visual: null },
  ];
  const words = wordCount(segments.map((s) => s.text).join(" "));
  return {
    id: `${track}-${c.id}`,
    track,
    title: topic.slice(0, 90),
    hook: `${n} outlet${n > 1 ? "s" : ""} on this ${label} story`,
    segments,
    whyItMatters: "A full explainer will be generated when an AI provider is available. Until then, the original sources are one tap away.",
    context: "This card was produced by the offline fallback writer, which never rewrites article text.",
    coverage: [],
    sources,
    location: null,
    publishedAt: c.latest,
    generatedAt: new Date().toISOString(),
    estDurationSec: Math.round(words / WORDS_PER_SECOND),
    audio: null,
    provider: "mock",
  };
}
