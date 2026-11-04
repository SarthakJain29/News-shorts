"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFeed, catchUp, CATCHUP_BEATS, clipDuration, formatClock } from "@/lib/playlist";
import { KEYS, useStored } from "@/lib/store";
import { TRACKS } from "@/lib/tracks";
import { TRACK_IDS, type Short, type TrackId } from "@/lib/types";
import { IconArrowDown, IconBolt, IconBookmark, IconClose, IconSliders } from "./Icons";
import { ShortCard } from "./ShortCard";
import { Onboarding, TrackGrid } from "./TrackPicker";

export type FeedMode = "feed" | "catchup" | "single";

interface Prefs {
  muted: boolean;
  captions: boolean;
  onboarded: boolean;
}
const DEFAULT_PREFS: Prefs = { muted: false, captions: true, onboarded: false };
const NO_TRACKS: TrackId[] = [];
const NO_IDS: string[] = [];

function unlockSpeech() {
  // iOS/Safari only allow speech after a user gesture: speak a silent utterance once.
  try {
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* ignore */
  }
}

export function FeedApp({ shorts, mode, startId, generatedAt, dataMode }: { shorts: Short[]; mode: FeedMode; startId?: string; generatedAt: string; dataMode: "live" | "mock" }) {
  const [tracks, setTracks, hydrated] = useStored<TrackId[]>(KEYS.tracks, NO_TRACKS);
  const [saved, setSaved] = useStored<string[]>(KEYS.saved, NO_IDS);
  const [seen, setSeen] = useStored<string[]>(KEYS.seen, NO_IDS);
  const [prefs, setPrefs] = useStored<Prefs>(KEYS.prefs, DEFAULT_PREFS);
  const [gestured, setGestured] = useState(false);
  const [picker, setPicker] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const counts = useMemo(() => {
    const c: Partial<Record<TrackId, number>> = {};
    for (const s of shorts) c[s.track] = (c[s.track] ?? 0) + 1;
    return c;
  }, [shorts]);

  // Freeze the ordering per session so marking "seen" doesn't reshuffle the feed under the user.
  const [seenAtStart] = useState(() => new Set(seen));
  const list = useMemo(() => {
    const chosen = tracks.length ? tracks : [...TRACK_IDS];
    if (mode === "catchup") return catchUp(shorts, chosen);
    const feed = buildFeed(shorts, chosen, seenAtStart);
    if (startId) {
      const s = shorts.find((x) => x.id === startId);
      if (s) return [s, ...feed.filter((x) => x.id !== startId)];
    }
    return feed;
  }, [shorts, tracks, mode, startId, seenAtStart]);

  const needsOnboarding = hydrated && mode === "feed" && !startId && (!prefs.onboarded || tracks.length === 0);
  const needsGesture = hydrated && !needsOnboarding && !gestured;

  const toggleTrack = (t: TrackId) => setTracks((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  // Track which card is on screen.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.6) setActive(Number((e.target as HTMLElement).dataset.index));
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll("[data-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [list.length, needsOnboarding]);

  useEffect(() => {
    const id = list[active]?.id;
    if (id && gestured) setSeen((prev) => (prev.includes(id) ? prev : [...prev.slice(-300), id]));
  }, [active, list, gestured, setSeen]);

  const goTo = useCallback((i: number) => {
    const root = scroller.current;
    const el = root?.querySelector<HTMLElement>(`[data-index="${i}"]`);
    if (root && el) root.scrollTo({ top: el.offsetTop, behavior: "smooth" });
  }, []);

  const onEnded = useCallback(
    (i: number) => {
      if (i + 1 < list.length) setTimeout(() => goTo(i + 1), 900);
    },
    [list.length, goTo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen || picker || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        goTo(Math.min(active + 1, list.length));
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        goTo(Math.max(active - 1, 0));
      }
      if (e.key === "m") setPrefs((p) => ({ ...p, muted: !p.muted }));
      if (e.key === "c") setPrefs((p) => ({ ...p, captions: !p.captions }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, list.length, goTo, setPrefs, sheetOpen, picker]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const share = async (s: Short) => {
    const url = `${window.location.origin}/s/${encodeURIComponent(s.id)}`;
    const data = { title: s.title, text: `${s.hook} — 60-second explainer on News Shorts`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(url);
        flash("Link copied");
      }
    } catch {
      /* user cancelled */
    }
  };

  const start = (catchUpMode: boolean) => {
    unlockSpeech();
    setPrefs((p) => ({ ...p, onboarded: true }));
    setGestured(true);
    if (catchUpMode) router.push("/catch-up");
  };

  const clip = mode === "catchup" ? CATCHUP_BEATS : undefined;
  const lengthOf = (s: Short) => clipDuration(s, clip);
  const totalLen = list.reduce((a, s) => a + lengthOf(s), 0);
  const remaining = list.slice(Math.min(active, list.length)).reduce((a, s) => a + lengthOf(s), 0);
  const current = list[active];
  const ambient = current ? TRACKS[current.track] : TRACKS.technology;

  if (!hydrated) return <div className="app-shell" />;

  if (needsOnboarding) {
    return (
      <div className="app-shell onb-shell" key="onboarding">
        <Onboarding selected={tracks} onToggle={toggleTrack} counts={counts} onStart={start} />
      </div>
    );
  }

  return (
    <div className="app-shell" key="feed" style={{ ["--amb1" as string]: ambient.color, ["--amb2" as string]: ambient.color2 }}>
      <div className="ambient" aria-hidden />
      <div className="phone">
        <nav className="topbar">
          <Link href="/" className="wordmark" aria-label="News Shorts home">news<span>/</span>shorts</Link>
          <div className="seg">
            <Link href="/" className={mode !== "catchup" ? "on" : ""}>For you</Link>
            <Link href="/catch-up" className={mode === "catchup" ? "on" : ""}><IconBolt width={14} height={14} /> 3-min</Link>
          </div>
          <div className="top-actions">
            <Link href="/saved" className="icon-btn" aria-label="Saved"><IconBookmark width={20} height={20} /></Link>
            <button className="icon-btn" onClick={() => setPicker(true)} aria-label="Choose tracks"><IconSliders width={20} height={20} /></button>
          </div>
        </nav>

        {mode === "catchup" && list.length > 0 && (
          <div className="catchup-bar">
            <span className="mono">CATCH-UP · {active + 1}/{list.length}</span>
            <span className="catchup-track"><i style={{ width: `${((active + 1) / list.length) * 100}%` }} /></span>
            <span className="mono">{formatClock(remaining)} left</span>
          </div>
        )}

        <div className="feed" ref={scroller}>
          {list.map((s, i) => (
            <section key={s.id} className="slot" data-index={i}>
              {Math.abs(i - active) <= 1 ? (
                <ShortCard
                  short={s}
                  active={i === active && gestured}
                  clip={clip}
                  muted={prefs.muted}
                  captions={prefs.captions}
                  saved={saved.includes(s.id)}
                  badge={mode === "catchup" ? `${i + 1} of ${list.length}` : s.provider === "mock" ? "offline" : undefined}
                  onEnded={() => onEnded(i)}
                  onToggleSave={() => {
                    const was = saved.includes(s.id);
                    setSaved((prev) => (was ? prev.filter((x) => x !== s.id) : [s.id, ...prev]));
                    flash(was ? "Removed from saved" : "Saved for later");
                  }}
                  onShare={() => share(s)}
                  onToggleMute={() => setPrefs((p) => ({ ...p, muted: !p.muted }))}
                  onToggleCaptions={() => setPrefs((p) => ({ ...p, captions: !p.captions }))}
                  onSheet={setSheetOpen}
                />
              ) : (
                <div className="short placeholder" style={{ ["--c1" as string]: TRACKS[s.track].color, ["--c2" as string]: TRACKS[s.track].color2 }} />
              )}
            </section>
          ))}
          {list.length > 0 && (
            <section className="slot end-slot" data-index={list.length}>
              <div className="end-card">
                <p className="mono-chip">{mode === "catchup" ? "You're caught up" : "That's everything for now"}</p>
                <h2>{mode === "catchup" ? `${list.length} stories, ${formatClock(totalLen)}.` : "Fresh shorts land every few hours."}</h2>
                <p className="dim">Feed updated {new Date(generatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{dataMode === "mock" ? " · demo dataset" : ""}</p>
                <div className="foot-row">
                  <button className="pill solid" onClick={() => goTo(0)}>Back to top</button>
                  <button className="pill" onClick={() => setPicker(true)}>Add tracks</button>
                </div>
              </div>
            </section>
          )}
          {list.length === 0 && (
            <div className="end-card">
              <h2>No shorts for these tracks yet.</h2>
              <button className="pill solid" onClick={() => setPicker(true)}>Choose tracks</button>
            </div>
          )}
        </div>

        {needsGesture && list.length > 0 && (
          <button className="gesture-gate" onClick={() => { unlockSpeech(); setGestured(true); }}>
            <span className="gate-inner">
              <span className="mono-chip">{mode === "catchup" ? `${list.length} stories · ${formatClock(totalLen)}` : `${list.length} shorts ready`}</span>
              <span className="gate-title">{mode === "catchup" ? "Catch me up" : "Tap to play"}</span>
              <span className="gate-sub">Sound on for narration · swipe up for the next story <IconArrowDown width={14} height={14} /></span>
            </span>
          </button>
        )}

        {picker && (
          <div className="sheet-backdrop" onClick={() => setPicker(false)}>
            <section className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose tracks">
              <div className="sheet-grip" />
              <header className="sheet-head">
                <h3 className="sheet-title">Your tracks</h3>
                <button className="icon-btn ghost" onClick={() => setPicker(false)} aria-label="Close"><IconClose /></button>
              </header>
              <TrackGrid selected={tracks} onToggle={toggleTrack} counts={counts} />
              <button className="cta" onClick={() => { setPicker(false); goTo(0); }} disabled={!tracks.length}>Done</button>
            </section>
          </div>
        )}

        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
      <aside className="desk-hints" aria-hidden>
        <p className="mono">↑ ↓ swipe · space/tap pause · M mute · C captions</p>
      </aside>
    </div>
  );
}
