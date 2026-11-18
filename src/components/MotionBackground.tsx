import { TRACKS } from "@/lib/tracks";
import type { TrackId } from "@/lib/types";

function seeded(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (n: number) => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000 * n;
}

/** Generative, per-story motion background: drifting colour fields + grain. No publisher imagery. */
export function MotionBackground({ track, id, intensity = 1 }: { track: TrackId; id: string; intensity?: number }) {
  const t = TRACKS[track];
  const r = seeded(id);
  const blobs = [0, 1, 2].map((i) => ({
    left: `${10 + r(70)}%`,
    top: `${5 + r(70)}%`,
    size: `${55 + r(45)}vmax`,
    color: i === 1 ? t.color2 : t.color,
    dur: `${14 + r(10)}s`,
    delay: `-${r(10)}s`,
  }));
  return (
    <div className="motion-bg" aria-hidden style={{ ["--c1" as string]: t.color, ["--c2" as string]: t.color2, opacity: intensity }}>
      {blobs.map((b, i) => (
        <span key={i} className={`blob b${i}`} style={{ left: b.left, top: b.top, width: b.size, height: b.size, ["--blob" as string]: b.color, animationDuration: b.dur, animationDelay: b.delay }} />
      ))}
      <span className="rings" />
      <span className="grain" />
    </div>
  );
}
