"use client";
import { chunkWords, wordIndexAt, type TimedSegment } from "@/lib/timeline";

/** Karaoke-style captions: one short line at a time, current word lit in the track accent. */
export function Captions({ seg, time, show }: { seg: TimedSegment | undefined; time: number; show: boolean }) {
  if (!seg || !show) return null;
  const wi = wordIndexAt(seg, time);
  const lines = chunkWords(seg.words.map((w, i) => ({ ...w, i })));
  const li = Math.max(0, lines.findIndex((l) => l.some((w) => w.i === Math.max(0, wi))));
  const line = lines[li] ?? lines[0];
  return (
    <div className="captions" aria-live="off">
      <p key={`${seg.index}-${li}`} className="caption-line">
        {line.map((w) => (
          <span key={w.i} className={w.i === wi ? "w on" : w.i < wi ? "w past" : "w"}>
            {w.text}
          </span>
        ))}
      </p>
    </div>
  );
}
