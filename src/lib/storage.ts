import { useCallback, useEffect, useState } from "react";

export function readStored<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** localStorage-backed state that hydrates after mount so SSR markup matches. */
export function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    setValue(readStored(key, fallback));
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) setValue(readStored(key, fallback));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (c: T) => T)(current) : next;
        try {
          localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage may be full or blocked; the in-memory value still updates.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update] as const;
}

export type SavedStation = { id: string; name: string };
export type RecentJourney = { from: string; to: string; fromName: string; toName: string };

export function toggleInList<T>(list: T[], item: T, same: (a: T, b: T) => boolean): T[] {
  return list.some((entry) => same(entry, item))
    ? list.filter((entry) => !same(entry, item))
    : [...list, item];
}

export function pushRecent<T>(list: T[], item: T, same: (a: T, b: T) => boolean, max = 6): T[] {
  return [item, ...list.filter((entry) => !same(entry, item))].slice(0, max);
}

export const sameStation = (a: SavedStation, b: SavedStation) => a.id === b.id;
export const sameJourney = (a: RecentJourney, b: RecentJourney) =>
  a.from === b.from && a.to === b.to;

export const STORAGE_KEYS = {
  favouriteStations: "tfl:favourite-stations",
  recentStations: "tfl:recent-stations",
  recentJourneys: "tfl:recent-journeys",
  watchedLines: "tfl:watched-lines",
} as const;
