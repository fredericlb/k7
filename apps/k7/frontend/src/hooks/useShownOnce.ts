// A notice a song shows once: the first visit it appears on records it in this browser, and later
// visits skip it. Kept per browser, not on the song, because the songbook is shared.

import { useEffect, useMemo } from "react";

/** The ids already shown, as the stored list says; an unreadable store counts as none. */
export function readShown(raw: string | null): Set<string> {
  try {
    const list = JSON.parse(raw ?? "[]");
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

function load(key: string): Set<string> {
  try {
    return readShown(localStorage.getItem(key));
  } catch {
    return new Set(); // storage blocked: shown every visit, which is the safe side
  }
}

/** Whether the notice `key` shows for `id` on this visit; it is recorded once `active` makes it appear. */
export function useShownOnce(
  key: string,
  id: string,
  active: boolean,
): boolean {
  // Read once per song, so the notice stays up for the whole visit it first appears on.
  const firstTime = useMemo(() => !load(key).has(id), [key, id]);
  useEffect(() => {
    if (!active || !firstTime) return;
    const shown = load(key);
    shown.add(id);
    try {
      localStorage.setItem(key, JSON.stringify([...shown]));
    } catch {
      // storage blocked: nothing to remember it in
    }
  }, [key, id, active, firstTime]);
  return firstTime;
}
