"use client";
import { useCallback, useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    /* storage may be blocked */
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = fallback;
  try {
    if (raw != null) value = JSON.parse(raw) as T;
  } catch {
    /* ignore corrupt value */
  }
  cache.set(key, { raw, value });
  return value;
}

function write<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    cache.set(key, { raw: JSON.stringify(value), value });
  }
  listeners.get(key)?.forEach((l) => l());
}

/** Tiny localStorage-backed state hook (per-device preferences only). */
export function useStored<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const subscribe = useCallback(
    (l: Listener) => {
      const set = listeners.get(key) ?? new Set();
      set.add(l);
      listeners.set(key, set);
      const onStorage = (e: StorageEvent) => e.key === key && l();
      window.addEventListener("storage", onStorage);
      return () => {
        set.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = read(key, fallback);
      write(key, typeof next === "function" ? (next as (p: T) => T)(prev) : next);
    },
    [key, fallback],
  );
  return [value, set, hydrated];
}

export const KEYS = {
  tracks: "ns.tracks.v1",
  saved: "ns.saved.v1",
  seen: "ns.seen.v1",
  prefs: "ns.prefs.v1",
} as const;
