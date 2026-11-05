"use client";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { localize } from "@/lib/i18n";
import { activeVisual, buildTimeline, segmentIndexAt, visualCues } from "@/lib/timeline";
import { TRACKS } from "@/lib/tracks";
import type { Lang, Short } from "@/lib/types";
import { Captions } from "./Captions";
import { MotionBackground } from "./MotionBackground";
import { Scene } from "./Scene";

declare global {
  interface Window {
    __render?: { duration: number; setTime: (t: number) => Promise<void> };
  }
}

const starts = new WeakMap<Animation, number>();

/** Pin every running CSS animation to "t seconds into the video": each is measured from the frame it first appeared. */
function seekAnimations(t: number) {
  for (const a of document.getAnimations()) {
    if (!starts.has(a)) starts.set(a, t);
    a.pause();
    a.currentTime = Math.max(0, (t - (starts.get(a) ?? t)) * 1000);
  }
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * Chrome-less 540×960 rendition of a short for video export. Everything is a pure function of `time`, which the
 * exporter sets frame by frame via `window.__render.setTime(t)` — no real-time playback involved.
 */
export default function RenderStage({ short }: { short: Short }) {
  const [lang] = useState<Lang>(() => (new URLSearchParams(window.location.search).get("lang") === "hi" ? "hi" : "en"));
  const view = useMemo(() => localize(short, lang), [short, lang]);
  const [time, setTime] = useState(0);
  const base = view.audio?.durationSec ?? view.estDurationSec;
  const timeline = useMemo(() => buildTimeline(view.segments, base, 0.15, view.audio?.wordTimes), [view, base]);
  const duration = Math.max(base, timeline.at(-1)?.end ?? 0);
  const t = TRACKS[short.track];

  useEffect(() => {
    // Ambient animations exist from the first paint: pin them to video time 0 so any worker, starting at any frame,
    // computes the same phase.
    for (const a of document.getAnimations()) if (!starts.has(a)) starts.set(a, 0);
    window.__render = {
      duration,
      async setTime(next: number) {
        flushSync(() => setTime(next));
        seekAnimations(next);
        await frame();
        await document.fonts.ready;
        for (let i = 0; i < 100 && document.querySelector(".globe") && !document.querySelector(".globe[data-ready]"); i++) await new Promise((r) => setTimeout(r, 50));
        seekAnimations(next);
      },
    };
    return () => {
      delete window.__render;
    };
  }, [duration]);

  const segIndex = Math.max(0, segmentIndexAt(timeline, time));
  const seg = timeline[segIndex];
  const { visual, from } = activeVisual(timeline, segIndex);
  const cues = from >= 0 ? visualCues(timeline, from) : null;

  return (
    <div className="render-page">
      <article className="short render-frame is-playing" style={{ ["--c1" as string]: t.color, ["--c2" as string]: t.color2, ["--tink" as string]: t.ink }} data-ready="1">
        <MotionBackground track={short.track} id={short.id} />
        <span className="render-brand">news<span>/</span>shorts</span>
        <div className="progress" aria-hidden>
          {timeline.map((s) => (
            <span key={s.index}><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, (time - s.start) / (s.end - s.start || 1)))})` }} /></span>
          ))}
        </div>
        <header className="short-meta">
          <span className="track-chip">{t.label}</span>
          <span className="meta-dim">{short.sources.length > 1 ? `${short.sources.length} outlets` : short.sources[0]?.outlet}</span>
        </header>
        <div className="stage">
          <Scene visual={visual} title={view.title} trackLabel={t.label} keyId={`${short.id}-${from}`} time={time} cues={cues} />
        </div>
        <Captions seg={seg} time={time} show />
        <footer className="short-foot">
          <h2 className="short-title">{view.title}</h2>
          <p className="render-sources">Sources: {short.sources.map((s) => s.outlet).join(" · ")}</p>
        </footer>
      </article>
    </div>
  );
}
