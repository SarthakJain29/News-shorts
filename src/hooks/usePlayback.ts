"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTimeline, segmentIndexAt, type TimedSegment } from "@/lib/timeline";
import type { Short } from "@/lib/types";

export type Engine = "neural" | "device" | "silent";

export interface Playback {
  timeline: TimedSegment[];
  time: number;
  duration: number;
  playing: boolean;
  ended: boolean;
  engine: Engine;
  segIndex: number;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seekSegment: (i: number) => void;
  restart: () => void;
  /** Lift the catch-up clip and continue to the end of the full story. */
  playFull: () => void;
}

const SPEECH_WPS = 2.6;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  const rank = (v: SpeechSynthesisVoice) =>
    (/natural|neural|premium|enhanced/i.test(v.name) ? 8 : 0) +
    (/google|samantha|daniel|serena|aria|jenny|guy|libby|sonia/i.test(v.name) ? 4 : 0) +
    (/en-(us|gb|in)/i.test(v.lang) ? 1 : 0) -
    (/compact|espeak/i.test(v.name) ? 6 : 0);
  return voices.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

/**
 * One clock for three narration engines:
 *  - neural: pre-rendered Gemini TTS file (time = audio.currentTime)
 *  - device: browser Web Speech API, spoken segment-by-segment; the clock holds at a segment
 *            boundary until the utterance finishes, and boundary events refine word position
 *  - silent: muted / no speech support — a plain clock so captions & visuals still play
 */
export function usePlayback(short: Short, opts: { active: boolean; muted: boolean; onEnded?: () => void; clip?: number }): Playback {
  const { active, muted, onEnded } = opts;
  const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
  const engine: Engine = short.audio ? "neural" : muted || !hasSpeech ? "silent" : "device";

  const [audioDur, setAudioDur] = useState<number | null>(null);
  const fullDuration = short.audio ? audioDur || short.audio.durationSec : short.estDurationSec * (2.5 / SPEECH_WPS);
  const fullTimeline = useMemo(() => buildTimeline(short.segments, fullDuration), [short.segments, fullDuration]);
  const [unclipped, setUnclipped] = useState(false);
  const clipN = !unclipped && opts.clip ? Math.min(opts.clip, fullTimeline.length) : fullTimeline.length;
  const timeline = useMemo(() => fullTimeline.slice(0, clipN), [fullTimeline, clipN]);
  const duration = timeline.length ? timeline[timeline.length - 1].end : fullDuration;

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clock = useRef({ t: 0, last: 0, hold: false, spokenSeg: -1, speaking: false });
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  // Audio element lifecycle
  useEffect(() => {
    if (!short.audio) return;
    const a = new Audio();
    a.preload = active ? "auto" : "metadata";
    a.src = short.audio.src;
    a.onloadedmetadata = () => Number.isFinite(a.duration) && setAudioDur(a.duration);
    a.onended = () => {
      setPlaying(false);
      setEnded(true);
      onEndedRef.current?.();
    };
    a.onerror = () => setAudioDur(null);
    audioRef.current = a;
    return () => {
      a.pause();
      a.src = "";
      audioRef.current = null;
    };
  }, [short.audio, active]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  const stopSpeech = useCallback(() => {
    if (hasSpeech) window.speechSynthesis.cancel();
    clock.current.speaking = false;
    clock.current.spokenSeg = -1;
  }, [hasSpeech]);

  const speakSegment = useCallback(
    (i: number) => {
      const seg = timeline[i];
      if (!seg || !hasSpeech) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(seg.text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1.04;
      u.pitch = 1;
      clock.current.spokenSeg = i;
      clock.current.speaking = true;
      u.onboundary = (e) => {
        if (clock.current.spokenSeg !== i || !seg.text.length) return;
        const target = seg.start + (seg.end - seg.start) * Math.min(0.98, e.charIndex / seg.text.length);
        if (target > clock.current.t) clock.current.t = target;
      };
      u.onend = () => {
        if (clock.current.spokenSeg !== i) return;
        clock.current.speaking = false;
        clock.current.hold = false;
        if (clock.current.t < seg.end) clock.current.t = seg.end; // speech ran faster than estimate
      };
      window.speechSynthesis.speak(u);
    },
    [timeline, hasSpeech],
  );

  const play = useCallback(() => {
    setEnded(false);
    setPlaying(true);
    if (engine === "neural") {
      audioRef.current?.play().catch(() => setPlaying(false));
    } else {
      clock.current.last = 0;
      if (clock.current.t >= duration - 0.05) clock.current.t = 0;
    }
  }, [engine, duration]);

  const pause = useCallback(() => {
    setPlaying(false);
    audioRef.current?.pause();
    stopSpeech();
  }, [stopSpeech]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, duration - 0.1));
      clock.current.t = clamped;
      setTime(clamped);
      if (audioRef.current) audioRef.current.currentTime = clamped;
      stopSpeech();
      setEnded(false);
    },
    [duration, stopSpeech],
  );

  const seekSegment = useCallback((i: number) => seek(timeline[Math.max(0, Math.min(i, timeline.length - 1))]?.start ?? 0), [seek, timeline]);
  const restart = useCallback(() => {
    seek(0);
    play();
  }, [seek, play]);
  const playFull = useCallback(() => {
    setUnclipped(true);
    setEnded(false);
    setPlaying(true);
    if (engine === "neural") audioRef.current?.play().catch(() => setPlaying(false));
    else clock.current.last = 0;
  }, [engine]);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  // Drive the clock while playing.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const loop = (now: number) => {
      const c = clock.current;
      if (engine === "neural") {
        const a = audioRef.current;
        if (a) {
          setTime(a.currentTime);
          if (a.currentTime >= duration - 0.05 && duration < fullDuration - 0.5) {
            a.pause();
            setPlaying(false);
            setEnded(true);
            onEndedRef.current?.();
            return;
          }
        }
      } else {
        const dt = c.last ? (now - c.last) / 1000 : 0;
        c.last = now;
        const i = segmentIndexAt(timeline, c.t);
        if (engine === "device" && c.spokenSeg !== i && !c.speaking) speakSegment(i);
        const seg = timeline[i];
        let next = c.t + dt;
        if (engine === "device" && c.speaking && seg && next >= seg.end - 0.05) next = seg.end - 0.05; // hold for the voice
        c.t = Math.min(next, duration);
        setTime(c.t);
        if (c.t >= duration - 0.01 && !c.speaking) {
          setPlaying(false);
          setEnded(true);
          onEndedRef.current?.();
          return;
        }
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing, engine, timeline, duration, fullDuration, speakSegment]);

  // Switching engines mid-play (e.g. mute toggled on a device-voice short).
  useEffect(() => {
    stopSpeech();
  }, [engine, stopSpeech]);

  // Autoplay when card becomes active; reset when it leaves.
  useEffect(() => {
    const id = active
      ? setTimeout(play, 350)
      : setTimeout(() => {
          pause();
          seek(0);
        }, 0);
    return () => clearTimeout(id);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopSpeech(), [stopSpeech]);

  return { timeline, time, duration, playing, ended, engine, segIndex: segmentIndexAt(timeline, time), toggle, play, pause, seekSegment, restart, playFull };
}
