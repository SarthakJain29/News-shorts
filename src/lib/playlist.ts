import type { Short, TrackId } from "./types";

export function durationOf(s: Short): number {
  return s.audio?.durationSec || s.estDurationSec || 60;
}

/** Round-robin across tracks (each newest-first) so the feed stays varied. */
export function interleave(shorts: Short[], tracks: TrackId[]): Short[] {
  const buckets = tracks.map((t) =>
    shorts.filter((s) => s.track === t).sort((a, b) => score(b) - score(a)),
  );
  const out: Short[] = [];
  for (let i = 0; buckets.some((b) => i < b.length); i++) for (const b of buckets) if (b[i]) out.push(b[i]);
  return out;
}

/** Breadth of coverage + recency + narration availability. */
export function score(s: Short): number {
  const ageH = Math.max(0, (Date.now() - Date.parse(s.publishedAt)) / 3.6e6);
  return s.sources.length * 1.5 + Math.max(0, 2 - ageH / 24) + (s.audio ? 0.5 : 0) + (s.provider === "mock" ? -5 : 0);
}

export function buildFeed(shorts: Short[], tracks: TrackId[], seen: Set<string> = new Set()): Short[] {
  const chosen = tracks.length ? tracks : [...new Set(shorts.map((s) => s.track))];
  const ordered = interleave(shorts, chosen);
  return [...ordered.filter((s) => !seen.has(s.id)), ...ordered.filter((s) => seen.has(s.id))];
}

/**
 * "Catch me up in 3 minutes": the most important story from each chosen track first,
 * then fill greedily with the next-best stories while staying inside the time budget.
 */
export function catchUp(shorts: Short[], tracks: TrackId[], budgetSec = 180): Short[] {
  const pool = buildFeed(shorts.filter((s) => s.provider !== "mock"), tracks);
  const fallback = pool.length ? pool : buildFeed(shorts, tracks);
  const out: Short[] = [];
  let used = 0;
  const tryAdd = (s: Short) => {
    if (out.includes(s)) return;
    const d = durationOf(s);
    if (used + d <= budgetSec + 10) {
      out.push(s);
      used += d;
    }
  };
  const firstPerTrack = new Map<TrackId, Short>();
  for (const s of fallback) if (!firstPerTrack.has(s.track)) firstPerTrack.set(s.track, s);
  for (const s of firstPerTrack.values()) tryAdd(s);
  for (const s of fallback) tryAdd(s);
  if (out.length === 0 && fallback[0]) out.push(fallback[0]);
  return out;
}

export function totalDuration(list: Short[]): number {
  return list.reduce((a, s) => a + durationOf(s), 0);
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 60) return `${m || 1}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
