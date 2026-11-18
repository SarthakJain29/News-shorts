import { execFileSync } from "node:child_process";

/** True when the system `espeak-ng` binary (needed for Hindi grapheme-to-phoneme) is installed. */
export function hasEspeak(): boolean {
  try {
    execFileSync("espeak-ng", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Devanagari text → Kokoro phoneme string, via espeak-ng's Hindi voice. Mirrors the clean-ups misaki applies for
 * espeak-based languages; the Kokoro tokenizer itself drops any symbol outside its vocabulary.
 */
export function hindiPhonemes(text: string): string {
  const clean = text.replace(/[।॥]/g, ".").replace(/[“”«»]/g, '"').replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const raw = execFileSync("espeak-ng", ["-v", "hi", "-q", "--ipa", "--", clean], { encoding: "utf8", maxBuffer: 1 << 20 });
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\([a-z-]+\)/gi, "") // language-switch markers like (en)
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}
