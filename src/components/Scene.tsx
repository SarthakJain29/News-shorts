"use client";
import type { VisualCues } from "@/lib/timeline";
import type { Visual } from "@/lib/types";
import GlobeMap from "./GlobeMap";

/** Numeric part of a figure like "$6.3bn" or "1,200", counted up to its final value as progress k goes 0 → 1. */
export function CountValue({ value, k }: { value: string; k: number }) {
  const m = value.match(/^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  const target = m ? Number(m[2].replace(/,/g, "")) : NaN;
  if (!m || Number.isNaN(target)) return <>{value}</>;
  const decimals = m[2].split(".")[1]?.length ?? 0;
  const shown = (target * k).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <>
      {m[1]}
      {shown}
      {m[3]}
    </>
  );
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 4);

/** Count-up starts as the scene appears and lands on the figure when the narrator says it (if they do). */
export function countProgress(t: number, spokenAt: number | null | undefined, start: number): number {
  const from = 0.1;
  const to = spokenAt != null ? Math.min(from + 3, Math.max(from + 0.6, spokenAt - start)) : from + 1.1;
  return easeOut((t - from) / (to - from));
}

export function Scene({ visual, title, trackLabel, keyId, time, cues }: { visual: Visual | null; title: string; trackLabel: string; keyId: string; time: number; cues: VisualCues | null }) {
  const start = cues?.start ?? 0;
  const t = Math.max(0, time - start);
  const lit = (i: number) => (cues?.reveal[i] != null ? time >= cues.reveal[i] : true);

  if (!visual) {
    return (
      <div className="scene scene-title" key={keyId}>
        <span className="mono-chip">{trackLabel}</span>
        <h2 className="kinetic">{title.split(" ").map((w, i) => <span key={i} style={{ animationDelay: `${i * 55}ms` }}>{w}</span>)}</h2>
      </div>
    );
  }
  switch (visual.kind) {
    case "headline":
      return (
        <div className="scene scene-headline" key={keyId}>
          <h2 className="kinetic">
            {visual.text.split(/\s+/).filter(Boolean).map((w, i) => {
              const at = cues?.spoken[i];
              return (
                <span key={i} className={at != null && time >= at ? "kw said" : "kw"} style={{ animationDelay: `${i * 70}ms` }}>
                  {w}
                </span>
              );
            })}
          </h2>
        </div>
      );
    case "number":
      return (
        <div className="scene scene-number" key={keyId}>
          <div className="big-number"><CountValue value={visual.value} k={countProgress(t, cues?.spoken[0], 0)} /></div>
          <p className="scene-label">{visual.label}</p>
        </div>
      );
    case "chart": {
      const max = Math.max(...visual.bars.map((b) => Math.abs(b.value))) || 1;
      return (
        <div className="scene scene-chart" key={keyId}>
          <p className="scene-label">{visual.title}</p>
          <ul className="bars">
            {visual.bars.map((b, i) => (
              <li key={i} className={lit(i) ? "lit" : ""} style={{ ["--w" as string]: `${(Math.abs(b.value) / max) * 100}%` }}>
                <span className="bar-label">{b.label}</span>
                <span className="bar"><i /></span>
                <span className="bar-value">{b.value.toLocaleString("en-US")}{visual.unit ? ` ${visual.unit}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "map":
      return (
        <div className="scene scene-map" key={keyId}>
          <GlobeMap lat={visual.lat} lon={visual.lon} place={visual.place} t={t} />
        </div>
      );
    case "timeline":
      return (
        <div className="scene scene-timeline" key={keyId}>
          <ol>
            {visual.items.map((it, i) => (
              <li key={i} className={lit(i) ? "lit" : ""}>
                <span className="mono-chip">{it.when}</span>
                <span>{it.what}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "compare":
      return (
        <div className="scene scene-compare" key={keyId}>
          <div className={lit(0) ? "cmp lit" : "cmp"}><span className="big-number sm"><CountValue value={visual.left.value} k={countProgress(t, null, 0)} /></span><span className="scene-label">{visual.left.label}</span></div>
          <span className="vs">vs</span>
          <div className={lit(1) ? "cmp lit" : "cmp"}><span className="big-number sm"><CountValue value={visual.right.value} k={countProgress(t - 0.3, null, 0)} /></span><span className="scene-label">{visual.right.label}</span></div>
        </div>
      );
  }
}
