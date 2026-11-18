"use client";
import Link from "next/link";
import { formatClock, durationOf, timeAgo } from "@/lib/playlist";
import { KEYS, useStored } from "@/lib/store";
import { TRACKS } from "@/lib/tracks";
import type { Short } from "@/lib/types";
import { IconBookmark, IconClose } from "./Icons";

const NONE: string[] = [];

export function SavedList({ shorts }: { shorts: Short[] }) {
  const [saved, setSaved, hydrated] = useStored<string[]>(KEYS.saved, NONE);
  const items = saved.map((id) => shorts.find((s) => s.id === id)).filter((s): s is Short => Boolean(s));
  const missing = saved.length - items.length;
  return (
    <main className="page">
      <header className="page-head">
        <Link href="/" className="wordmark">news<span>/</span>shorts</Link>
        <Link href="/" className="pill">Back to feed</Link>
      </header>
      <h1 className="page-title">Saved</h1>
      {hydrated && items.length === 0 && (
        <div className="empty">
          <IconBookmark width={32} height={32} />
          <p>Nothing saved yet. Tap <strong>Save</strong> on any short to keep it here.</p>
        </div>
      )}
      <ul className="saved-grid">
        {items.map((s, i) => {
          const t = TRACKS[s.track];
          return (
            <li key={s.id} style={{ ["--c1" as string]: t.color, ["--c2" as string]: t.color2, animationDelay: `${i * 40}ms` }}>
              <Link href={`/s/${encodeURIComponent(s.id)}`} className="saved-card">
                <span className="track-chip">{t.label}</span>
                <span className="saved-title">{s.title}</span>
                <span className="mono dim">{formatClock(durationOf(s))} · {timeAgo(s.publishedAt)}</span>
              </Link>
              <button className="icon-btn ghost" aria-label="Remove" onClick={() => setSaved((p) => p.filter((x) => x !== s.id))}><IconClose width={18} height={18} /></button>
            </li>
          );
        })}
      </ul>
      {missing > 0 && <p className="dim small">{missing} saved short{missing > 1 ? "s have" : " has"} rotated out of the feed.</p>}
    </main>
  );
}
