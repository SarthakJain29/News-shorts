"use client";
import { memo, useEffect, useState } from "react";
import { usePlayback } from "@/hooks/usePlayback";
import { activeVisual, visualCues } from "@/lib/timeline";
import { TRACKS } from "@/lib/tracks";
import { formatClock, timeAgo } from "@/lib/playlist";
import { LANGS } from "@/lib/i18n";
import type { Lang, Short } from "@/lib/types";
import { Captions } from "./Captions";
import { IconBookmark, IconCC, IconPause, IconPlay, IconRestart, IconShare, IconSources, IconSpark, IconVolume } from "./Icons";
import { MotionBackground } from "./MotionBackground";
import { Scene } from "./Scene";
import { StorySheet, type SheetTab } from "./Sheet";

export interface ShortCardProps {
  /** Already localised for the viewer's language. */
  short: Short & { lang?: Lang };
  /** Languages this story is available in (the language switch shows when there is more than one). */
  langs?: Lang[];
  onLang?: (l: Lang) => void;
  active: boolean;
  muted: boolean;
  captions: boolean;
  saved: boolean;
  badge?: string;
  /** Play only the first N beats (catch-up mode). */
  clip?: number;
  onEnded: () => void;
  onToggleSave: () => void;
  onShare: () => void;
  onToggleMute: () => void;
  onToggleCaptions: () => void;
  onSheet?: (open: boolean) => void;
}

function ShortCardImpl(p: ShortCardProps) {
  const { short } = p;
  const t = TRACKS[short.track];
  const [sheet, setSheet] = useState<SheetTab | null>(null);
  const pb = usePlayback(short, { active: p.active && !sheet, muted: p.muted, onEnded: p.onEnded, clip: p.clip });
  const seg = pb.timeline[pb.segIndex];
  const { visual, from } = activeVisual(pb.timeline, Math.max(0, pb.segIndex));
  const cues = from >= 0 ? visualCues(pb.timeline, from) : null;

  const { toggle } = pb;
  useEffect(() => {
    if (!p.active || sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && (e.target as HTMLElement)?.tagName !== "BUTTON") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.active, sheet, toggle]);

  const openSheet = (tab: SheetTab) => {
    pb.pause();
    setSheet(tab);
    p.onSheet?.(true);
  };
  const closeSheet = () => {
    setSheet(null);
    p.onSheet?.(false);
  };

  const onTapZone = (zone: "prev" | "toggle" | "next") => {
    if (zone === "toggle") return pb.toggle();
    pb.seekSegment(pb.segIndex + (zone === "next" ? 1 : -1));
    if (!pb.playing) pb.play();
  };

  return (
    <article className={`short ${pb.playing ? "is-playing" : "is-paused"}`} style={{ ["--c1" as string]: t.color, ["--c2" as string]: t.color2, ["--tink" as string]: t.ink }} aria-label={short.title} data-track={short.track}>
      <MotionBackground track={short.track} id={short.id} />

      <div className="progress" aria-hidden>
        {pb.timeline.map((s) => {
          const k = Math.max(0, Math.min(1, (pb.time - s.start) / (s.end - s.start || 1)));
          return <span key={s.index}><i style={{ transform: `scaleX(${k})` }} /></span>;
        })}
      </div>

      <header className="short-meta">
        <span className="track-chip">{t.label}</span>
        {p.badge && <span className="mono-chip hot">{p.badge}</span>}
        {short.sources.length > 1 ? (
          <button className="outlets-chip" onClick={() => openSheet("coverage")} aria-label={`How ${short.sources.length} outlets covered this`}>{short.sources.length} outlets ›</button>
        ) : (
          <span className="meta-dim">{short.sources[0]?.outlet}</span>
        )}
        <span className="meta-dim">{timeAgo(short.publishedAt)}</span>
      </header>

      <div className="stage">
        <Scene visual={visual} title={short.title} trackLabel={t.label} keyId={`${short.id}-${short.lang ?? "en"}-${from}`} time={pb.time} cues={cues} />
      </div>

      <div className="tapzones" aria-hidden>
        <button tabIndex={-1} onClick={() => onTapZone("prev")} />
        <button tabIndex={-1} onClick={() => onTapZone("toggle")} />
        <button tabIndex={-1} onClick={() => onTapZone("next")} />
      </div>

      <Captions seg={seg} time={pb.time} show={p.captions} />

      {!pb.playing && !pb.ended && p.active && (
        <button className="center-play" onClick={pb.play} aria-label="Play"><IconPlay width={34} height={34} /></button>
      )}
      {pb.ended && (
        <div className="ended">
          <button className="pill" onClick={pb.restart}><IconRestart width={18} height={18} /> Replay</button>
          {p.clip ? (
            <button className="pill solid" onClick={pb.playFull}><IconPlay width={16} height={16} /> Full story</button>
          ) : (
            <button className="pill solid" onClick={() => openSheet("sources")}><IconSources width={18} height={18} /> Read the sources</button>
          )}
        </div>
      )}

      <footer className="short-foot">
        <h2 className="short-title">{short.title}</h2>
        <div className="foot-row">
          <button className="pill solid" onClick={() => openSheet("why")}><IconSpark width={16} height={16} /> {short.lang === "hi" ? "क्यों ज़रूरी है" : "Why it matters"}</button>
          <button className="pill" onClick={() => openSheet("context")}>{short.lang === "hi" ? "नए हैं?" : "New to this?"}</button>
          {p.langs && p.langs.length > 1 && (
            <span className="lang-seg" role="group" aria-label="Language">
              {p.langs.map((l) => (
                <button key={l} className={l === (short.lang ?? "en") ? "on" : ""} onClick={() => p.onLang?.(l)} aria-pressed={l === (short.lang ?? "en")} lang={l}>
                  {l === "en" ? "EN" : LANGS.find((x) => x.id === l)?.native.slice(0, 2)}
                </button>
              ))}
            </span>
          )}
        </div>
        <div className="foot-row dim">
          <button className="mini-btn" onClick={pb.toggle} aria-label={pb.playing ? "Pause" : "Play"}>{pb.playing ? <IconPause width={16} height={16} /> : <IconPlay width={16} height={16} />}</button>
          <span className="mono">{formatClock(pb.time)} / {formatClock(pb.duration)}</span>
          <span className="engine" title={pb.engine === "neural" ? "Narrated with Gemini TTS" : pb.engine === "device" ? "Narrated by your device voice" : "Captions only"}>
            {pb.engine === "neural" ? "AI voice" : pb.engine === "device" ? "Device voice" : "Captions"}
          </span>
        </div>
      </footer>

      <aside className="rail">
        <button className={p.saved ? "rail-btn on" : "rail-btn"} onClick={p.onToggleSave} aria-pressed={p.saved} aria-label={p.saved ? "Remove from saved" : "Save"}>
          <IconBookmark filled={p.saved} /><span>{p.saved ? "Saved" : "Save"}</span>
        </button>
        <button className="rail-btn" onClick={p.onShare} aria-label="Share"><IconShare /><span>Share</span></button>
        <button className="rail-btn" onClick={() => openSheet(short.coverage.length ? "coverage" : "sources")} aria-label="Sources and coverage"><IconSources /><span>Sources</span></button>
        <button className={p.captions ? "rail-btn on" : "rail-btn"} onClick={p.onToggleCaptions} aria-pressed={p.captions} aria-label="Captions"><IconCC on={p.captions} /><span>CC</span></button>
        <button className="rail-btn" onClick={p.onToggleMute} aria-pressed={p.muted} aria-label={p.muted ? "Unmute" : "Mute"}><IconVolume muted={p.muted} /><span>{p.muted ? "Muted" : "Sound"}</span></button>
      </aside>

      {sheet && <StorySheet short={short} tab={sheet} onClose={closeSheet} />}
    </article>
  );
}

export const ShortCard = memo(ShortCardImpl);
