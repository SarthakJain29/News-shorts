"use client";
import { TRACK_LIST } from "@/lib/tracks";
import type { TrackId } from "@/lib/types";

export function TrackGrid({ selected, onToggle, counts }: { selected: TrackId[]; onToggle: (t: TrackId) => void; counts: Partial<Record<TrackId, number>> }) {
  return (
    <ul className="track-grid">
      {TRACK_LIST.map((t, i) => {
        const on = selected.includes(t.id);
        return (
          <li key={t.id} style={{ ["--c1" as string]: t.color, ["--c2" as string]: t.color2, animationDelay: `${i * 50}ms` }}>
            <button className={on ? "track-tile on" : "track-tile"} onClick={() => onToggle(t.id)} aria-pressed={on}>
              <span className="tile-name">{t.label}</span>
              <span className="tile-blurb">{t.blurb}</span>
              <span className="tile-count mono">{counts[t.id] ?? 0} shorts</span>
              <span className="tile-check" aria-hidden>{on ? "✓" : "+"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function Onboarding({ selected, onToggle, counts, onStart }: { selected: TrackId[]; onToggle: (t: TrackId) => void; counts: Partial<Record<TrackId, number>>; onStart: (catchUp: boolean) => void }) {
  return (
    <div className="onboarding">
      <div className="onb-hero">
        <p className="mono-chip">news / shorts</p>
        <h1 className="onb-title">
          The news,<br />
          <em>in 60 seconds</em>
          <br />a swipe.
        </h1>
        <p className="onb-sub">Original, narrated explainers built from multiple reputable outlets. Pick what you care about.</p>
      </div>
      <TrackGrid selected={selected} onToggle={onToggle} counts={counts} />
      <div className="onb-actions">
        <button className="cta" disabled={!selected.length} onClick={() => onStart(false)}>Start watching</button>
        <button className="cta ghost" disabled={!selected.length} onClick={() => onStart(true)}>Catch me up in 3 min</button>
      </div>
    </div>
  );
}
