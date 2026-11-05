"use client";
import { useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/playlist";
import { TRACKS } from "@/lib/tracks";
import type { Short } from "@/lib/types";
import { IconClose, IconExternal } from "./Icons";

export type SheetTab = "why" | "context" | "coverage" | "sources";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** How to turn this short into a postable vertical video (the exporter runs in Node/CI, not in the browser). */
function ExportHint({ short }: { short: Short & { lang?: string } }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cmd = `npm run export:video -- ${short.id}${short.lang && short.lang !== "en" ? ` --lang=${short.lang}` : ""}`;
  const repo = process.env.NEXT_PUBLIC_REPO_URL;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <details className="export-hint">
      <summary>Post this as a video (YouTube Shorts / Reels)</summary>
      <p>Renders this short to a 1080×1920 MP4 with narration, plus a caption file with source credits.</p>
      <div className="cmd">
        <code>{cmd}</code>
        <button className="pill" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      {repo && (
        <p>
          No setup? Run the <a href={`${repo}/actions/workflows/export.yml`} target="_blank" rel="noopener noreferrer">Export MP4 workflow</a> with id <code>{short.id}</code> and download the artifact.
        </p>
      )}
    </details>
  );
}

/** Bottom sheet: the explainer's extras, how outlets covered the story, and the original reporting. */
export function StorySheet({ short, tab, onClose }: { short: Short; tab: SheetTab; onClose: () => void }) {
  const [current, setCurrent] = useState<SheetTab>(tab);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const multi = short.sources.length > 1;
  const politics = short.track === "politics";
  const tabs: { id: SheetTab; label: string }[] = [
    { id: "why", label: "Why it matters" },
    { id: "context", label: "New to this?" },
    ...(multi ? [{ id: "coverage" as const, label: politics ? "How outlets framed it" : `Coverage · ${short.sources.length}` }] : []),
    { id: "sources", label: `Sources · ${short.sources.length}` },
  ];
  const t = TRACKS[short.track];
  const summary = short.coverageSummary;

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
              <p className="eyebrow">{politics ? "Same story, different emphasis. Paraphrased, not endorsed." : `${short.sources.length} outlets covered this`}</p>
              <ul className="outlet-row" aria-label="Outlets">
                {short.sources.map((s) => (
                  <li key={s.outlet} title={s.outlet}><span className="outlet-badge">{initials(s.outlet)}</span><span>{s.outlet}</span></li>
                ))}
              </ul>
              {summary && (
                <div className="consensus">
                  <div className="cons-card agree">
                    <span className="cons-tag">Where they agree</span>
                    <p>{summary.agreement}</p>
                  </div>
                  {summary.differences && (
                    <div className="cons-card differ">
                      <span className="cons-tag">Where they differ</span>
                      <p>{summary.differences}</p>
                    </div>
                  )}
                </div>
              )}
              {short.coverage.length > 0 ? (
                <ul className="coverage">
                  {short.coverage.map((c) => (
                    <li key={c.outlet}>
                      <div className="cov-top">
                        <strong>{c.outlet}</strong>
                        {c.emphasis && <span className="emph">{c.emphasis}</span>}
                        {c.publishedAt && <span className="cov-time">{timeAgo(c.publishedAt)}</span>}
                      </div>
                      <p>{c.angle}</p>
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="cov-link">
                        {c.headline ? <em>&ldquo;{c.headline}&rdquo;</em> : "Read original"} <IconExternal width={14} height={14} />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dim small">A written comparison isn&apos;t available for this short — the outlets&apos; own headlines are under Sources.</p>
              )}
            </>
          )}
          {current === "sources" && (
            <>
              <p className="eyebrow">Original reporting. Our script is written independently from these.</p>
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
          <ExportHint short={short} />
          <p className="fineprint">
            Script by {short.provider === "mock" ? "offline fallback writer" : short.provider === "editorial" ? "News Shorts editors" : `AI (${short.provider})`}, generated {timeAgo(short.generatedAt)} · narration {short.audio ? `AI voice (${short.audio.model})` : "your device voice"}. AI can make mistakes. Check the sources.
          </p>
        </div>
      </section>
    </div>
  );
}
