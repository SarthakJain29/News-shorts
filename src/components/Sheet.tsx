"use client";
import { useEffect, useState } from "react";
import { TRACKS } from "@/lib/tracks";
import { timeAgo } from "@/lib/playlist";
import type { Short } from "@/lib/types";
import { IconClose, IconExternal } from "./Icons";

export type SheetTab = "why" | "context" | "coverage" | "sources";

/** Bottom sheet with the explainer's extras and the original reporting. */
export function StorySheet({ short, tab, onClose }: { short: Short; tab: SheetTab; onClose: () => void }) {
  const [current, setCurrent] = useState<SheetTab>(tab);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabs: { id: SheetTab; label: string }[] = [
    { id: "why", label: "Why it matters" },
    { id: "context", label: "New to this?" },
    ...(short.coverage.length ? [{ id: "coverage" as const, label: short.track === "politics" ? "How outlets framed it" : "Coverage" }] : []),
    { id: "sources", label: `Sources · ${short.sources.length}` },
  ];
  const t = TRACKS[short.track];

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <section className="sheet" role="dialog" aria-modal="true" aria-label={short.title} onClick={(e) => e.stopPropagation()} style={{ ["--c1" as string]: t.color, ["--c2" as string]: t.color2 }}>
        <div className="sheet-grip" />
        <header className="sheet-head">
          <span className="mono-chip">{t.label}</span>
          <button className="icon-btn ghost" onClick={onClose} aria-label="Close"><IconClose /></button>
        </header>
        <h3 className="sheet-title">{short.title}</h3>
        <nav className="tabs" role="tablist">
          {tabs.map((x) => (
            <button key={x.id} role="tab" aria-selected={current === x.id} className={current === x.id ? "tab on" : "tab"} onClick={() => setCurrent(x.id)}>{x.label}</button>
          ))}
        </nav>
        <div className="sheet-body">
          {current === "why" && <p className="lede">{short.whyItMatters}</p>}
          {current === "context" && (
            <>
              <p className="eyebrow">Context if you&apos;re new to this</p>
              <p className="lede">{short.context}</p>
            </>
          )}
          {current === "coverage" && (
            <>
              <p className="eyebrow">{short.track === "politics" ? "Same story, different emphasis — paraphrased, not endorsed" : "How different outlets emphasised it"}</p>
              <ul className="coverage">
                {short.coverage.map((c, i) => (
                  <li key={i}>
                    <a href={c.url} target="_blank" rel="noopener noreferrer"><strong>{c.outlet}</strong> <IconExternal width={14} height={14} /></a>
                    <p>{c.angle}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
          {current === "sources" && (
            <>
              <p className="eyebrow">Original reporting — our script is written independently from these</p>
              <ul className="sources">
                {short.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      <span className="src-outlet">{s.outlet} · {timeAgo(s.publishedAt)}</span>
                      <span className="src-title">{s.title}</span>
                      <span className="src-open">Open original <IconExternal width={14} height={14} /></span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="fineprint">
            Script by {short.provider === "mock" ? "offline fallback writer" : short.provider === "editorial" ? "News Shorts editors" : `AI (${short.provider})`}, generated {timeAgo(short.generatedAt)} · narration {short.audio ? "Gemini TTS" : "your device voice"}. AI can make mistakes — check the sources.
          </p>
        </div>
      </section>
    </div>
  );
}
