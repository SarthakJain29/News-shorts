import type { Lang, Short } from "./types";

export const LANGS: { id: Lang; label: string; native: string; speech: string }[] = [
  { id: "en", label: "English", native: "English", speech: "en-US" },
  { id: "hi", label: "Hindi", native: "हिन्दी", speech: "hi-IN" },
];

export function speechLang(lang: Lang): string {
  return LANGS.find((l) => l.id === lang)?.speech ?? "en-US";
}

/** Languages this short can be shown in (English always). */
export function availableLangs(s: Short): Lang[] {
  return ["en", ...(Object.keys(s.i18n ?? {}) as Lang[])];
}

/**
 * The short as the viewer wants to read/hear it. Same id, sources, location and track; text, visual labels and
 * narration swap to the translation when it exists. `lang` records what was actually applied.
 */
export function localize(s: Short, lang: Lang): Short & { lang: Lang } {
  const t = lang === "en" ? undefined : s.i18n?.[lang];
  if (!t) return { ...s, lang: "en" };
  return {
    ...s,
    lang,
    title: t.title,
    hook: t.hook,
    segments: t.segments,
    whyItMatters: t.whyItMatters,
    context: t.context,
    coverage: t.coverage.length ? t.coverage : s.coverage,
    coverageSummary: t.coverageSummary ?? s.coverageSummary,
    estDurationSec: t.estDurationSec,
    audio: t.audio,
  };
}

/** Devanagari share of letters — a cheap check that a "Hindi" text really is Hindi. */
export function devanagariRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  return letters.filter((c) => /[ऀ-ॿ]/.test(c)).length / letters.length;
}
