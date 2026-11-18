import { z } from "zod";
import { devanagariRatio } from "../src/lib/i18n";
import { splitWords } from "../src/lib/timeline";
import type { Coverage, Segment, Short, Translation, Visual } from "../src/lib/types";
import { completeWithFallback, type LlmProvider } from "./llm";
import { extractJson, WORDS_PER_SECOND } from "./script";

const SYSTEM = [
  "You are a senior Hindi news-desk writer. You adapt an existing, already-original English news explainer script into natural SPOKEN Hindi (Devanagari) for a text-to-speech narrator.",
  "Register: clear, modern Hindustani as heard on a good news channel — avoid heavy Sanskritised vocabulary; common English loanwords (मोबाइल, सरकार, बैंक) are fine.",
  "Transliterate people, places and brands into Devanagari (Binance → बाइनेंस). Do not leave Latin letters in spoken text.",
  "In `segments[].text`, `title`, `hook` and other spoken text, write ALL numbers as Hindi words (e.g. पाँच करोड़, छह दशमलव तीन अरब डॉलर) so the voice reads them correctly. Inside `visual` objects keep digits exactly as given.",
  "Keep exactly the same number of segments, in the same order, saying the same things. Do not add or remove facts. Translate `visual` text labels; never change numbers, `kind`, `lat` or `lon`.",
  "Return ONLY a JSON object.",
].join("\n");

const hiSchema = z.object({
  title: z.string().min(3).max(140),
  hook: z.string().min(3).max(220),
  segments: z.array(z.object({ text: z.string().min(3).max(600), visual: z.unknown().optional().nullable() })).min(1),
  whyItMatters: z.string().min(5).max(800),
  context: z.string().min(5).max(900),
  coverage: z.array(z.object({ outlet: z.string(), angle: z.string(), emphasis: z.string().optional().nullable() })).optional().default([]),
  agreement: z.string().optional().nullable(),
  differences: z.string().optional().nullable(),
});

export function buildTranslationPrompt(s: Short): string {
  const src = {
    title: s.title,
    hook: s.hook,
    segments: s.segments.map((g) => ({ text: g.text, visual: g.visual ?? null })),
    whyItMatters: s.whyItMatters,
    context: s.context,
    coverage: s.coverage.map((c) => ({ outlet: c.outlet, angle: c.angle, emphasis: c.emphasis ?? "" })),
    agreement: s.coverageSummary?.agreement ?? "",
    differences: s.coverageSummary?.differences ?? "",
  };
  return `Adapt this English script into spoken Hindi. Output the same JSON shape (title, hook, segments[{text, visual}], whyItMatters, context, coverage[{outlet, angle, emphasis}], agreement, differences). Keep outlet names in English.\n\n${JSON.stringify(src)}`;
}

const digitsOf = (v: unknown) => (JSON.stringify(v).match(/\d+(?:\.\d+)?/g) ?? []).join("|");

/** Keep the translated visual only if it is the same kind, with identical numbers and coordinates; else keep the original. */
export function mergeVisual(original: Visual | null | undefined, translated: unknown): Visual | null {
  if (!original) return null;
  if (!translated || typeof translated !== "object") return original;
  const t = translated as Record<string, unknown>;
  if (t.kind !== original.kind) return original;
  if (original.kind === "map") {
    const place = typeof t.place === "string" && t.place.trim() ? t.place.trim() : original.place;
    return { ...original, place };
  }
  if (digitsOf({ ...t, kind: undefined }) !== digitsOf({ ...original, kind: undefined })) return original;
  // numbers match; accept the translated labels but re-pin numeric fields to the grounded originals
  switch (original.kind) {
    case "chart": {
      const bars = (t.bars as { label?: string; value?: number }[] | undefined) ?? [];
      return { ...original, title: String(t.title ?? original.title), bars: original.bars.map((b, i) => ({ label: String(bars[i]?.label ?? b.label), value: b.value })) };
    }
    case "timeline": {
      const items = (t.items as { when?: string; what?: string }[] | undefined) ?? [];
      return { ...original, items: original.items.map((it, i) => ({ when: String(items[i]?.when ?? it.when), what: String(items[i]?.what ?? it.what) })) };
    }
    case "compare": {
      const l = t.left as { label?: string } | undefined;
      const r = t.right as { label?: string } | undefined;
      return { ...original, left: { ...original.left, label: String(l?.label ?? original.left.label) }, right: { ...original.right, label: String(r?.label ?? original.right.label) } };
    }
    case "number":
      return { ...original, label: String(t.label ?? original.label) };
    case "headline":
      return { ...original, text: String(t.text ?? original.text) };
  }
}

export function draftToTranslation(raw: unknown, s: Short, provider: Translation["provider"]): Translation {
  const d = hiSchema.parse(raw);
  if (d.segments.length !== s.segments.length) throw new Error(`Expected ${s.segments.length} segments, got ${d.segments.length}`);
  const spoken = d.segments.map((g) => g.text).join(" ");
  const ratio = devanagariRatio(spoken);
  if (ratio < 0.8) throw new Error(`Not Hindi enough (Devanagari ${(ratio * 100).toFixed(0)}% of letters) — write in Devanagari, no Latin letters`);
  const words = splitWords(spoken).length;
  if (words < 90 || words > 330) throw new Error(`Hindi script length out of range (${words} words)`);
  const segments: Segment[] = d.segments.map((g, i) => ({ text: g.text.trim(), visual: mergeVisual(s.segments[i].visual, g.visual) }));
  const coverage: Coverage[] = [];
  for (const cv of d.coverage) {
    const base = s.coverage.find((c) => c.outlet.toLowerCase() === cv.outlet.toLowerCase());
    if (base) coverage.push({ ...base, angle: cv.angle.trim(), emphasis: cv.emphasis?.trim() || undefined });
  }
  return {
    title: d.title.trim(),
    hook: d.hook.trim(),
    segments,
    whyItMatters: d.whyItMatters.trim(),
    context: d.context.trim(),
    coverage,
    coverageSummary: s.coverageSummary && d.agreement?.trim() ? { agreement: d.agreement.trim(), differences: (d.differences ?? "").trim() } : null,
    estDurationSec: Math.round(words / (WORDS_PER_SECOND - 0.2)),
    audio: null,
    provider,
  };
}

/** Write the Hindi rendition of a short, with up to 3 attempts that feed validation errors back to the model. */
export async function translateToHindi(s: Short, chain: LlmProvider[], log: (m: string) => void = console.warn): Promise<Translation> {
  let feedback = "";
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await completeWithFallback(chain, { system: SYSTEM, user: buildTranslationPrompt(s) + feedback, json: true, temperature: 0.3 + attempt * 0.1 }, log);
      return draftToTranslation(extractJson(res.text), s, res.provider as Translation["provider"]);
    } catch (e) {
      last = e;
      const msg = (e as Error).message.slice(0, 240);
      log(`  ! hindi attempt ${attempt + 1}: ${msg}`);
      feedback = `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED: ${msg}. Fix it.`;
    }
  }
  throw last;
}
