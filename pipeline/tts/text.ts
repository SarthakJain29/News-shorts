/** Split text into sentence-sized chunks no longer than `max` characters (engines have token limits). */
export function chunkSentences(text: string, max = 260): string[] {
  const sentences = text.split(/(?<=[.!?।॥])\s+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const s of sentences) {
    if (s.length > max) {
      flush();
      // very long sentence: break at commas/semicolons
      let piece = "";
      for (const part of s.split(/(?<=[,;:—])\s+/)) {
        if ((piece + " " + part).trim().length > max && piece) {
          out.push(piece);
          piece = part;
        } else piece = (piece + " " + part).trim();
      }
      if (piece) out.push(piece);
      continue;
    }
    if ((cur + " " + s).trim().length > max && cur) {
      flush();
      cur = s;
    } else cur = (cur + " " + s).trim();
  }
  flush();
  return out;
}
